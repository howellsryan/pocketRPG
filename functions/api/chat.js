// In-game help chatbot endpoint. Answers PocketRPG questions AND performs
// actions (MCP write tools) on the player's behalf — but every write is gated:
// the model's write call is captured, never run inline, and executed only after
// the player confirms and the signed action token is verified back (see
// _lib/chat/actions.js). Messages are unlimited; only the paid AI paths (Workers
// AI fallback, OpenAI) are budget-capped — the free Gemini primary is unmetered.

import { requireAuth, json } from '../_lib/auth.js'
import { utcDayKey } from '../_lib/game/dailyTasks.js'
import { auditLog } from '../_lib/game/audit.js'
import { callTool } from '../_lib/mcp/tools.js'
import { KNOWLEDGE_CHUNKS } from '../_lib/chat/knowledge.js'
import { buildIndex, searchKnowledge } from '../_lib/chat/retrieval.js'
import {
  reserveMessageNeurons,
  settleMessageNeurons,
  usageMilliNeurons,
  openaiPoolKey,
  CHAT_MESSAGE_RESERVE_MILLI,
  CHAT_NEURON_BUDGET_MILLI,
  CHAT_OPENAI_MESSAGE_RESERVE_TOKENS,
  CHAT_OPENAI_TOKEN_BUDGET,
} from '../_lib/chat/quota.js'
import {
  isWriteTool,
  signPendingAction,
  verifyPendingAction,
  actionLabel,
  actionCreditCost,
  CHAT_ACTION_FEE,
  PENDING_CONFIRMATION_NOTE,
  SECONDARY_WRITE_NOTE,
} from '../_lib/chat/actions.js'
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
  SYSTEM_PROMPT,
  chatToolDefs,
  buildMessages,
  retrievalOnlyAnswer,
} from '../_lib/chat/prompt.js'

// Preface for the post-confirmation summary call: the action already ran, so the
// model must report the outcome, not propose it again.
const ACTION_RESULT_PREFACE =
  'The player confirmed and this PocketRPG action just ran on their account. Tell them what happened in 1-2 friendly sentences using the result below. If it reports an error, explain it plainly and suggest a fix. Do not invent anything beyond the result, and do not ask for confirmation again.'

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
      const body = JSON.stringify({ model, ...payload })
      // Free-tier Gemini is limited per minute, not per day, so a 429/503 is
      // usually a brief burst. Retry a couple of times with a short backoff
      // (kept small to stay inside the request time budget) before giving up and
      // letting the endpoint fall through to the Workers AI fallback.
      const backoffs = [500, 1200]
      for (let attempt = 0; ; attempt++) {
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.GEMINI_API_KEY}`,
          },
          body,
        })
        if (res.ok) return res.json()
        if ((res.status === 429 || res.status === 503) && attempt < backoffs.length) {
          await new Promise((resolve) => setTimeout(resolve, backoffs[attempt]))
          continue
        }
        const detail = (await res.text().catch(() => '')).slice(0, 300)
        throw new Error(`Gemini ${res.status}: ${detail}`)
      }
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
// to retrieval-only. `pool` is which daily spend budget the attempt meters
// against; null = unmetered (the free Gemini primary).
export function chatAttempts(env) {
  const attempts = []
  if (env.OPENAI_API_KEY && CHAT_OPENAI_MODEL) {
    attempts.push({ ai: openaiChatBinding(env), model: CHAT_OPENAI_MODEL, pool: 'openai' })
  }
  if (CHAT_MODEL.startsWith('@')) {
    // A Workers AI primary bills neurons like the fallback — meter it.
    if (env.AI) attempts.push({ ai: env.AI, model: CHAT_MODEL, pool: 'neuron' })
  } else if (env.GEMINI_API_KEY) {
    // Gemini is the free primary (unlimited on this key, only per-minute rate
    // limited) — do not meter it against the paid neuron budget.
    attempts.push({ ai: geminiChatBinding(env), model: CHAT_MODEL, pool: null })
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

// Run the model tool loop. Read tools run inline; write tools are gated — the
// first one the model calls is captured as `pendingWrite` (never executed here)
// and the loop stops so the endpoint can turn it into a confirmation. Tool calls
// are restricted to the allowlist and character_id is pinned to the
// authenticated character. Returns { answer, pendingWrite }: answer is '' when
// the model produced nothing usable; throws ChatTimeoutError past `deadline`.
// With `withTools:false` it does a single no-tools call (used for the
// post-confirmation summary). Exported for tests.
export async function runAiChat(
  env,
  messages,
  { authorization, identity, characterId, stats, deadline, ai, model, allowWrites = true, withTools = true },
) {
  const binding = ai || env.AI
  const modelId = model || CHAT_MODEL
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
  if (!withTools) {
    const res = await runModel({ messages, ...CHAT_RUN_OPTS })
    return { answer: answerText(res), pendingWrite: null }
  }
  const tools = chatToolDefs()
  let pendingWrite = null
  for (let round = 0; round < CHAT_MAX_TOOL_ROUNDS; round++) {
    const res = await runModel({ messages, tools, ...CHAT_RUN_OPTS })
    const message = res?.choices?.[0]?.message
    const calls = (Array.isArray(message?.tool_calls) ? message.tool_calls : [])
      .filter((c) => c?.type === 'function' && c.function)
      .slice(0, 3)
      .map((c, i) => ({ ...c, id: c.id || `call_${round}_${i}` }))
    if (!calls.length) {
      const answer = answerText(res)
      if (answer) return { answer, pendingWrite: null }
      break
    }
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls })
    // A write is never executed inline — capture the first one for the player to
    // confirm; reads run in parallel. A second write this round is deferred.
    const firstWriteIdx = allowWrites ? calls.findIndex((c) => isWriteTool(c.function.name)) : -1
    const results = await raceDeadline(
      Promise.all(
        calls.map((call, i) => {
          if (allowWrites && isWriteTool(call.function.name)) {
            if (i === firstWriteIdx) {
              const args = parseToolArgs(call.function.arguments)
              args.character_id = characterId
              pendingWrite = { tool: call.function.name, args }
              return Promise.resolve(PENDING_CONFIRMATION_NOTE)
            }
            return Promise.resolve(SECONDARY_WRITE_NOTE)
          }
          return runChatTool(call, { env, authorization, identity, characterId })
        }),
      ),
      deadline,
    )
    calls.forEach((call, i) => messages.push({ role: 'tool', tool_call_id: call.id, content: results[i] }))
    if (pendingWrite) {
      // One more no-tools call so the model phrases the confirmation request.
      const final = await runModel({ messages, ...CHAT_RUN_OPTS })
      return { answer: answerText(final), pendingWrite }
    }
  }
  // Tool budget exhausted or empty response — one last call with no tools so
  // the model must answer from what it has.
  const final = await runModel({ messages, ...CHAT_RUN_OPTS })
  return { answer: answerText(final), pendingWrite: null }
}

// Walk the ordered AI attempts to produce an answer (and, on the tool path, a
// captured pendingWrite). Handles the paid-pool reserve/settle so the day's
// spend can never cross budget mid-flight; the free Gemini attempt (pool null)
// is unmetered. Returns { answer, pendingWrite, reason }.
async function resolveAnswer(env, { buildTranscript, characterId, authorization, identity, withTools = true, allowWrites = true }) {
  const attempts = chatAttempts(env)
  if (!attempts.length) {
    // No provider reaches this deployment — almost always a secret set for the
    // wrong Pages environment. Log it loudly rather than degrade silently.
    console.warn(
      '[PocketRPG][chat] no AI provider configured — OPENAI_API_KEY / GEMINI_API_KEY / Workers AI (env.AI) all unavailable to this deployment',
    )
    return { answer: '', pendingWrite: null, reason: 'ai_unconfigured' }
  }
  const dayKey = utcDayKey()
  // Two paid daily pools reserved lazily on first use; a pool that no longer
  // fits skips only its own attempts. The free Gemini attempt has no pool.
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
  let answer = ''
  let pendingWrite = null
  let reason = null
  const deadline = Date.now() + CHAT_TIME_BUDGET_MS
  for (const { ai, model, pool: poolName } of attempts) {
    const pool = poolName ? pools[poolName] : null
    if (pool && pool.stats === undefined) {
      const reserved = await reserveMessageNeurons(env, pool.key, pool.reserve, pool.budget)
      pool.stats = reserved ? { promptTokens: 0, completionTokens: 0, usageUnknown: false } : null
    }
    if (pool && !pool.stats) {
      reason = 'budget'
      continue
    }
    // Unmetered attempts still need a stats sink for runAiChat; throwaway.
    const stats = pool ? pool.stats : { promptTokens: 0, completionTokens: 0, usageUnknown: false }
    try {
      const messages = buildTranscript()
      const out = await runAiChat(env, messages, { authorization, identity, characterId, stats, deadline, ai, model, allowWrites, withTools })
      answer = out.answer
      pendingWrite = out.pendingWrite || null
      if (answer || pendingWrite) break
      reason = 'empty'
    } catch (err) {
      console.error(`[PocketRPG][chat] AI call failed (${model}):`, err?.message || err)
      answer = ''
      reason = err instanceof ChatTimeoutError ? 'timeout' : 'ai_error'
      if (err instanceof ChatTimeoutError) break
    }
  }
  // Always settle a reserved pool back to actual usage — even a timed-out call
  // that reported none — so a leaked reserve can't drain the day's budget.
  for (const pool of Object.values(pools)) {
    if (pool.stats) await settleMessageNeurons(env, pool.key, pool.reserve, pool.cost(pool.stats))
  }
  return { answer, pendingWrite, reason }
}

// Atomically debit the flat chatbot action fee (server-authoritative, same
// credits column as skip-hour). Returns { ok, remaining }; ok:false = the
// character can't afford it, so nothing runs.
async function chargeActionFee(env, characterId, identityId) {
  const debit = await env.DB.prepare(
    `UPDATE characters
     SET credits = credits - ?1, credits_used = credits_used + ?1
     WHERE id = ?2 AND owner_id = ?3 AND deleted_at IS NULL AND credits >= ?1
     RETURNING credits AS credits_remaining`,
  )
    .bind(CHAT_ACTION_FEE, characterId, identityId)
    .first()
  return debit ? { ok: true, remaining: debit.credits_remaining ?? 0 } : { ok: false }
}

// Give the fee back when the action didn't actually run (a failed tool call), so
// a rejected attempt is free.
async function refundActionFee(env, characterId, identityId) {
  try {
    await env.DB.prepare(
      `UPDATE characters
       SET credits = credits + ?1, credits_used = MAX(0, credits_used - ?1)
       WHERE id = ?2 AND owner_id = ?3 AND deleted_at IS NULL`,
    )
      .bind(CHAT_ACTION_FEE, characterId, identityId)
      .run()
  } catch (err) {
    console.error('[PocketRPG][chat] action-fee refund failed:', err?.message || err)
  }
}

// Confirmation path: a previously-proposed write action, signed at propose time.
// Charge the 1-credit assistant fee FIRST — before any execution or AI spend —
// then execute it via the same MCP bridge (auth/locks/audit run in the real
// endpoint), then phrase the outcome. A failed action refunds the fee.
async function confirmAction({ env, authorization, identity, characterId, token }) {
  const payload = await verifyPendingAction(token, env.JWT_SECRET, characterId)
  if (!payload) {
    return json({ answer: "That action link has expired — just ask me again and I'll set it back up.", mode: 'action_expired' })
  }

  // No credit, no action — and crucially, no AI spend past this point.
  const fee = await chargeActionFee(env, characterId, identity.id)
  if (!fee.ok) {
    return json({
      answer: `Running an action costs ${CHAT_ACTION_FEE} credit and you're out — top up credits in the shop, then ask me again.`,
      mode: 'action_no_credit',
    })
  }

  let result
  try {
    result = await callTool(payload.tool, payload.args, { env, authorization, identity })
  } catch (err) {
    result = { content: [{ type: 'text', text: `Error: ${String(err?.message || err)}` }], isError: true }
  }
  const isError = !!result?.isError
  if (isError) await refundActionFee(env, characterId, identity.id)

  const resultText = toolResultText(result)
  const label = actionLabel(payload.tool, payload.args)
  // Let the summary state the fee (and remaining balance on success).
  const feeNote = isError
    ? `The ${CHAT_ACTION_FEE}-credit action fee was refunded because the action failed.`
    : `This cost ${CHAT_ACTION_FEE} credit (the assistant action fee); the player has ${fee.remaining} credit(s) left afterwards.`

  // Phrase the outcome with the free/unmetered AI path (no tools); fall back to
  // a deterministic line if the AI path is unavailable.
  let answer = ''
  try {
    const out = await resolveAnswer(env, {
      buildTranscript: () => [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${ACTION_RESULT_PREFACE}\n${feeNote}\nAction: ${label}\nResult JSON: ${resultText}` },
      ],
      characterId,
      authorization,
      identity,
      withTools: false,
      allowWrites: false,
    })
    answer = out.answer
  } catch {
    /* fall through to the deterministic line */
  }
  if (!answer) {
    answer = isError
      ? `That didn't go through (your ${CHAT_ACTION_FEE} credit was refunded): ${resultText.replace(/^(Tool error|Error):\s*/, '')}`
      : `Done — ${label}. That cost ${CHAT_ACTION_FEE} credit; you have ${fee.remaining} left.`
  }

  await auditLog(
    env,
    'chat_action',
    { identityId: identity.id, characterId, tool: payload.tool, isError, feeCharged: !isError },
    { swallow: true },
  )
  return json({
    answer,
    mode: isError ? 'action_error' : 'action_done',
    tool: payload.tool,
    ...(isError ? {} : { creditsRemaining: fee.remaining }),
  })
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

  // A confirm token means "run the action I already approved" — no question.
  if (typeof body?.confirm === 'string' && body.confirm.trim()) {
    return confirmAction({ env, authorization, identity: auth.identity, characterId, token: body.confirm.trim() })
  }

  const question = typeof body?.message === 'string' ? body.message.trim().slice(0, CHAT_MAX_QUESTION_CHARS) : ''
  if (!question) return json({ error: 'Missing message' }, 400)

  // 6 chunks: guide sections average ~68 tokens, so wider retrieval is nearly
  // free and lifts answer quality more than any other input.
  const hits = searchKnowledge(question, getIndex(), 6)
  const chunks = hits.map((h) => h.chunk)
  const sources = chunks.map((c) => ({ id: c.id, title: c.title }))

  const { answer: aiAnswer, pendingWrite, reason } = await resolveAnswer(env, {
    buildTranscript: () => buildMessages({ question, history: body?.history, chunks }),
    characterId,
    authorization,
    identity: auth.identity,
  })

  let answer = aiAnswer
  let mode = 'ai'
  let pendingAction = null
  if (pendingWrite) {
    // The model proposed a write — hand the player a signed, confirmable action
    // instead of running it. This is the enforcement point: no write executes
    // without a confirm round-trip.
    mode = 'action_pending'
    const label = actionLabel(pendingWrite.tool, pendingWrite.args)
    const cost = actionCreditCost(pendingWrite.tool, pendingWrite.args)
    const signed = await signPendingAction({ tool: pendingWrite.tool, args: pendingWrite.args, characterId }, env.JWT_SECRET)
    pendingAction = { token: signed, label, cost }
    if (!answer) answer = `I can ${label.toLowerCase()} for you — confirm below and I'll do it.`
  } else if (!answer) {
    // Whatever went wrong on the AI path — the player always gets a
    // knowledge-index answer.
    answer = retrievalOnlyAnswer(chunks)
    mode = 'retrieval'
  }

  await auditLog(
    env,
    'chat_message',
    { identityId: auth.identity.id, characterId, mode, questionChars: question.length },
    { swallow: true },
  )

  return json({
    answer,
    sources,
    mode,
    ...(pendingAction ? { pendingAction } : {}),
    ...(mode === 'retrieval' && reason ? { reason } : {}),
  })
}
