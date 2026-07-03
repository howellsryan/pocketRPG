// In-game help chatbot endpoint. Per-character daily quota + global daily
// spend budget, degrading to retrieval-only answers. Read-only — the chatbot
// can never mutate game state (tool allowlist in _lib/chat/prompt.js).

import { requireAuth, json } from '../_lib/auth.js'
import { utcDayKey, nextResetMs } from '../_lib/game/dailyTasks.js'
import { auditLog } from '../_lib/game/audit.js'
import { callTool } from '../_lib/mcp/tools.js'
import { KNOWLEDGE_CHUNKS } from '../_lib/chat/knowledge.js'
import { buildIndex, searchKnowledge } from '../_lib/chat/retrieval.js'
import {
  claimCharacterMessage,
  refundCharacterMessage,
  reserveMessageNeurons,
  settleMessageNeurons,
  usageMilliNeurons,
  openaiPoolKey,
  CHAT_DAILY_LIMIT,
  CHAT_MESSAGE_RESERVE_MILLI,
  CHAT_NEURON_BUDGET_MILLI,
  CHAT_OPENAI_MESSAGE_RESERVE_TOKENS,
  CHAT_OPENAI_TOKEN_BUDGET,
} from '../_lib/chat/quota.js'
import {
  CHAT_MODEL,
  CHAT_OPENAI_MODEL,
  CHAT_FALLBACK_MODEL,
  CHAT_MAX_TOOL_ROUNDS,
  CHAT_MAX_ANSWER_TOKENS,
  CHAT_MAX_TOOL_RESULT_CHARS,
  CHAT_MAX_QUESTION_CHARS,
  CHAT_TIME_BUDGET_MS,
  CHAT_TOOL_ALLOWLIST,
  chatToolDefs,
  buildMessages,
  retrievalOnlyAnswer,
} from '../_lib/chat/prompt.js'

let knowledgeIndex = null
function getIndex() {
  if (!knowledgeIndex) knowledgeIndex = buildIndex(KNOWLEDGE_CHUNKS)
  return knowledgeIndex
}

function parseToolArgs(raw) {
  if (raw && typeof raw === 'object') return { ...raw }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

function toolResultText(result) {
  const text = (result?.content || [])
    .map((c) => (typeof c?.text === 'string' ? c.text : ''))
    .join('\n')
    .trim()
  const clipped = text.slice(0, CHAT_MAX_TOOL_RESULT_CHARS)
  return result?.isError ? `Tool error: ${clipped || 'unknown error'}` : clipped || '(empty result)'
}

const CHAT_RUN_OPTS = {
  max_tokens: CHAT_MAX_ANSWER_TOKENS,
  temperature: 0.6,
}

// Gemini-backed binding with the same `run(model, payload)` shape as env.AI,
// via Google's OpenAI-compatible endpoint — the chat-completions plumbing
// (messages/tools/usage) works unchanged.
export function geminiChatBinding(env) {
  return {
    async run(model, payload) {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.GEMINI_API_KEY}`,
        },
        body: JSON.stringify({ model, ...payload }),
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300)
        throw new Error(`Gemini ${res.status}: ${detail}`)
      }
      return res.json()
    },
  }
}

// OpenAI-backed binding with the same `run(model, payload)` shape as env.AI,
// via OpenAI's chat completions endpoint — the chat-completions plumbing
// (messages/tools/usage) works unchanged.
export function openaiChatBinding(env) {
  return {
    async run(model, payload) {
      // gpt-5.x reasoning models 400 on `max_tokens` (want
      // `max_completion_tokens`) and on any non-default `temperature`.
      const { max_tokens, temperature, ...rest } = payload
      const body = { model, ...rest }
      if (max_tokens !== undefined) body.max_completion_tokens = max_tokens
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300)
        throw new Error(`OpenAI ${res.status}: ${detail}`)
      }
      return res.json()
    },
  }
}

// Ordered AI attempts for a message: OpenAI first (if configured), then
// CHAT_MODEL (Gemini) when OpenAI is unconfigured or fails/answers empty,
// then the Workers AI fallback model. Empty = AI path unavailable, straight
// to retrieval-only.
export function chatAttempts(env) {
  const attempts = []
  if (env.OPENAI_API_KEY && CHAT_OPENAI_MODEL) {
    attempts.push({ ai: openaiChatBinding(env), model: CHAT_OPENAI_MODEL, pool: 'openai' })
  }
  if (CHAT_MODEL.startsWith('@')) {
    if (env.AI) attempts.push({ ai: env.AI, model: CHAT_MODEL, pool: 'neuron' })
  } else if (env.GEMINI_API_KEY) {
    attempts.push({ ai: geminiChatBinding(env), model: CHAT_MODEL, pool: 'neuron' })
  }
  if (env.AI && CHAT_FALLBACK_MODEL && CHAT_FALLBACK_MODEL !== CHAT_MODEL) {
    attempts.push({ ai: env.AI, model: CHAT_FALLBACK_MODEL, pool: 'neuron' })
  }
  return attempts
}

function answerText(res) {
  const content = res?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return ''
  // Also strip an unterminated <think> tail: if max_tokens cuts the model off
  // mid-reasoning, the block never closes and must not leak to the player.
  return content.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim()
}

// Accumulate a call's reported token usage into per-pool message stats.
// A call that doesn't report both token counts marks the message unknown so
// the endpoint keeps its full worst-case reserve instead of refunding.
function trackUsage(stats, res) {
  const usage = res?.usage
  if (usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
    stats.promptTokens += usage.prompt_tokens
    stats.completionTokens += usage.completion_tokens
  } else {
    stats.usageUnknown = true
  }
}

// Thrown when the wall-clock budget runs out; the endpoint catches it and
// falls back to a retrieval-only answer.
export class ChatTimeoutError extends Error {
  constructor() {
    super('chat_time_budget_exceeded')
  }
}

// Race a promise against the absolute deadline. The losing work is abandoned,
// not cancelled — fine here: model/tool calls are read-only.
function raceDeadline(promise, deadline) {
  const ms = deadline - Date.now()
  if (ms <= 0) return Promise.reject(new ChatTimeoutError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ChatTimeoutError()), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// Execute one model-requested tool call. Always resolves to result text — a
// failing or disallowed tool becomes a `Tool error:` message the model can
// work around, never a rejection that sinks the whole answer.
async function runChatTool(call, { env, authorization, identity, characterId }) {
  const name = call.function.name
  if (!CHAT_TOOL_ALLOWLIST.includes(name)) return `Tool error: '${name}' is not available.`
  const args = parseToolArgs(call.function.arguments)
  args.character_id = characterId
  try {
    const result = await callTool(name, args, { env, authorization, identity })
    return toolResultText(result)
  } catch (err) {
    return `Tool error: ${String(err?.message || err).slice(0, 200)}`
  }
}

// Run the Workers AI tool loop. Tool calls are restricted to the read-only
// allowlist and character_id is pinned to the authenticated character.
// Returns '' when the model produced no usable answer; throws ChatTimeoutError
// past `deadline` — the endpoint turns both into a retrieval-only answer.
// Exported for tests.
export async function runAiChat(env, messages, { authorization, identity, characterId, stats, deadline, ai, model }) {
  const binding = ai || env.AI
  const modelId = model || CHAT_MODEL
  const tools = chatToolDefs()
  const runModel = async (payload) => {
    // Not worth starting a reasoning call with under 1.5s left.
    if (deadline - Date.now() < 1500) throw new ChatTimeoutError()
    try {
      const res = await raceDeadline(binding.run(modelId, payload), deadline)
      trackUsage(stats, res)
      return res
    } catch (err) {
      // An abandoned call may still bill tokens we never saw — keep the full
      // worst-case reserve instead of settling low.
      if (err instanceof ChatTimeoutError) stats.usageUnknown = true
      throw err
    }
  }
  for (let round = 0; round < CHAT_MAX_TOOL_ROUNDS; round++) {
    const res = await runModel({ messages, tools, ...CHAT_RUN_OPTS })
    const message = res?.choices?.[0]?.message
    const calls = (Array.isArray(message?.tool_calls) ? message.tool_calls : [])
      .filter((c) => c?.type === 'function' && c.function)
      .slice(0, 3)
      .map((c, i) => ({ ...c, id: c.id || `call_${round}_${i}` }))
    if (!calls.length) {
      const answer = answerText(res)
      if (answer) return answer
      break
    }
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls })
    // Independent read-only lookups — run them in parallel.
    const results = await raceDeadline(
      Promise.all(calls.map((call) => runChatTool(call, { env, authorization, identity, characterId }))),
      deadline,
    )
    calls.forEach((call, i) => messages.push({ role: 'tool', tool_call_id: call.id, content: results[i] }))
  }
  // Tool budget exhausted or empty response — one last call with no tools so
  // the model must answer from what it has.
  const final = await runModel({ messages, ...CHAT_RUN_OPTS })
  return answerText(final)
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)
  const authorization = request.headers.get('Authorization')

  const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
  if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)
  const owned = await env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
  )
    .bind(characterId, auth.identity.id)
    .first()
  if (!owned) return json({ error: 'Character not found' }, 404)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const question = typeof body?.message === 'string' ? body.message.trim().slice(0, CHAT_MAX_QUESTION_CHARS) : ''
  if (!question) return json({ error: 'Missing message' }, 400)

  const dayKey = utcDayKey()
  const claim = await claimCharacterMessage(env, characterId, dayKey)
  if (!claim.allowed) {
    return json({
      answer: `You've used all ${CHAT_DAILY_LIMIT} helper questions for today — they refresh at 00:00 UTC.`,
      mode: 'quota',
      remaining: 0,
      resetInMs: nextResetMs(),
    })
  }

  // 6 chunks: guide sections average ~68 tokens, so wider retrieval is nearly
  // free and lifts answer quality more than any other input.
  const hits = searchKnowledge(question, getIndex(), 6)
  const chunks = hits.map((h) => h.chunk)
  const sources = chunks.map((c) => ({ id: c.id, title: c.title }))

  let answer = ''
  let mode = 'ai'
  // Why the AI path yielded no answer (surfaced as `reason` on a degraded
  // response so the cause is visible without server-log access).
  let reason = null
  const attempts = chatAttempts(env)
  if (!attempts.length) {
    // The silent blind spot: no provider is configured from the function's
    // view, so we never even attempt a call. Almost always a secret that
    // isn't reaching this deployment (e.g. set for the wrong Pages
    // environment) — log it loudly rather than degrade without a trace.
    reason = 'ai_unconfigured'
    console.warn(
      '[PocketRPG][chat] no AI provider configured — OPENAI_API_KEY / GEMINI_API_KEY / Workers AI (env.AI) all unavailable to this deployment',
    )
  }
  // Two independent daily pools: the OpenAI attempt spends the complimentary
  // token allotment, Gemini/Workers AI attempts spend the neuron budget. Each
  // pool is reserved lazily before its first attempt; a pool that no longer
  // fits skips only its own attempts, so an exhausted OpenAI pool still falls
  // through to the budget-capped paid paths. `stats` is undefined until the
  // pool is tried, null when its reserve was refused.
  const pools = {
    openai: {
      key: openaiPoolKey(dayKey),
      reserve: CHAT_OPENAI_MESSAGE_RESERVE_TOKENS,
      budget: CHAT_OPENAI_TOKEN_BUDGET,
      cost: (s) => s.promptTokens + s.completionTokens,
    },
    neuron: {
      key: dayKey,
      reserve: CHAT_MESSAGE_RESERVE_MILLI,
      budget: CHAT_NEURON_BUDGET_MILLI,
      cost: (s) => usageMilliNeurons({ prompt_tokens: s.promptTokens, completion_tokens: s.completionTokens }),
    },
  }
  if (attempts.length) {
    const deadline = Date.now() + CHAT_TIME_BUDGET_MS
    // Each attempt gets a fresh transcript; a failed or empty attempt falls
    // through to the next model, all under the one deadline.
    for (const { ai, model, pool: poolName } of attempts) {
      const pool = pools[poolName]
      if (pool.stats === undefined) {
        const reserved = await reserveMessageNeurons(env, pool.key, pool.reserve, pool.budget)
        pool.stats = reserved ? { promptTokens: 0, completionTokens: 0, usageUnknown: false } : null
      }
      if (!pool.stats) {
        reason = 'budget'
        continue
      }
      try {
        const messages = buildMessages({ question, history: body?.history, chunks })
        answer = await runAiChat(env, messages, { authorization, identity: auth.identity, characterId, stats: pool.stats, deadline, ai, model })
        if (answer) break
        reason = 'empty'
      } catch (err) {
        console.error(`[PocketRPG][chat] AI call failed (${model}):`, err?.message || err)
        answer = ''
        reason = err instanceof ChatTimeoutError ? 'timeout' : 'ai_error'
        if (err instanceof ChatTimeoutError) break
      }
    }
    // Reconcile each reserved pool back to actual metered usage. Always
    // settle — even when a call didn't report usage (a timed-out/abandoned
    // call). Skipping it there would permanently burn the full worst-case
    // reserve, and a handful of those drains the day's budget and forces
    // every later message to retrieval-only until the 00:00 UTC reset.
    for (const pool of Object.values(pools)) {
      if (pool.stats) await settleMessageNeurons(env, pool.key, pool.reserve, pool.cost(pool.stats))
    }
  }
  // Whatever went wrong on the AI path — no budget, model error, time budget
  // exceeded, empty answer — the player always gets a knowledge-index answer.
  if (!answer) {
    answer = retrievalOnlyAnswer(chunks)
    mode = 'retrieval'
  }

  // A degraded answer shouldn't cost the player one of their daily questions.
  let remaining = claim.remaining
  if (mode === 'retrieval') {
    await refundCharacterMessage(env, characterId, dayKey)
    remaining = Math.min(CHAT_DAILY_LIMIT, remaining + 1)
  }

  await auditLog(
    env,
    'chat_message',
    { identityId: auth.identity.id, characterId, mode, questionChars: question.length },
    { swallow: true },
  )

  return json({ answer, sources, mode, remaining, resetInMs: nextResetMs(), ...(mode === 'retrieval' && reason ? { reason } : {}) })
}
