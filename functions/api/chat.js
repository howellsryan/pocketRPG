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
  CHAT_DAILY_LIMIT,
  CHAT_MESSAGE_RESERVE_MILLI,
} from '../_lib/chat/quota.js'
import {
  CHAT_MODEL,
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

// OpenAI-backed binding with the same `run(model, payload)` shape as env.AI,
// so runAiChat is provider-agnostic. gpt-5 models reject `max_tokens` and
// non-default `temperature`, hence the translation.
export function openAiChatBinding(env) {
  return {
    async run(model, payload) {
      const { max_tokens, temperature: _temperature, ...rest } = payload
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: max_tokens,
          reasoning_effort: 'low',
          ...rest,
        }),
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300)
        throw new Error(`OpenAI ${res.status}: ${detail}`)
      }
      return res.json()
    },
  }
}

// Pick the model binding for CHAT_MODEL; null = AI path unavailable
// (missing binding/key), which degrades to retrieval-only.
export function chatAiBinding(env) {
  if (CHAT_MODEL.startsWith('@')) return env.AI || null
  return env.OPENAI_API_KEY ? openAiChatBinding(env) : null
}

function answerText(res) {
  const content = res?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return ''
  // Also strip an unterminated <think> tail: if max_tokens cuts the model off
  // mid-reasoning, the block never closes and must not leak to the player.
  return content.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim()
}

// Accumulate a call's reported token usage into per-message neuron stats.
// A call that doesn't report both token counts marks the message unknown so
// the endpoint keeps its full worst-case reserve instead of refunding.
function trackUsage(stats, res) {
  const usage = res?.usage
  if (usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
    stats.milliNeurons += usageMilliNeurons(usage)
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
export async function runAiChat(env, messages, { authorization, identity, characterId, stats, deadline, ai }) {
  const binding = ai || env.AI
  const tools = chatToolDefs()
  const runModel = async (payload) => {
    // Not worth starting a reasoning call with under 1.5s left.
    if (deadline - Date.now() < 1500) throw new ChatTimeoutError()
    try {
      const res = await raceDeadline(binding.run(CHAT_MODEL, payload), deadline)
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
  const ai = chatAiBinding(env)
  const aiAvailable = ai && (await reserveMessageNeurons(env, dayKey))
  if (aiAvailable) {
    const stats = { milliNeurons: 0, usageUnknown: false }
    const deadline = Date.now() + CHAT_TIME_BUDGET_MS
    try {
      const messages = buildMessages({ question, history: body?.history, chunks })
      answer = await runAiChat(env, messages, { authorization, identity: auth.identity, characterId, stats, deadline, ai })
      // Swap the worst-case reserve for the actual metered usage. Skipped
      // when any call didn't report usage — keeping the full reserve only
      // makes the budget more conservative, never billable.
      if (!stats.usageUnknown) {
        await settleMessageNeurons(env, dayKey, CHAT_MESSAGE_RESERVE_MILLI, stats.milliNeurons)
      }
    } catch (err) {
      console.error('[PocketRPG][chat] AI call failed:', err?.message || err)
      answer = ''
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

  return json({ answer, sources, mode, remaining, resetInMs: nextResetMs() })
}
