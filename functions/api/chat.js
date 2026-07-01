// In-game help chatbot endpoint. Zero-cost by design: Workers AI free
// allocation + per-character daily quota + global circuit-breaker that
// degrades to retrieval-only answers. Read-only — the chatbot can never
// mutate game state (tool allowlist in _lib/chat/prompt.js).

import { requireAuth, json } from '../_lib/auth.js'
import { utcDayKey, nextResetMs } from '../_lib/game/dailyTasks.js'
import { auditLog } from '../_lib/game/audit.js'
import { callTool } from '../_lib/mcp/tools.js'
import { KNOWLEDGE_CHUNKS } from '../_lib/chat/knowledge.js'
import { buildIndex, searchKnowledge } from '../_lib/chat/retrieval.js'
import { claimCharacterMessage, claimGlobalAiCall, CHAT_DAILY_LIMIT } from '../_lib/chat/quota.js'
import {
  CHAT_MODEL,
  CHAT_MAX_TOOL_ROUNDS,
  CHAT_MAX_ANSWER_TOKENS,
  CHAT_MAX_TOOL_RESULT_CHARS,
  CHAT_MAX_QUESTION_CHARS,
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

// GLM-4.7-flash speaks the OpenAI chat-completions shape: answers live in
// choices[0].message. Reasoning is disabled via chat_template_kwargs (help
// answers don't need it; thinking tokens would eat the answer budget), but
// strip any <think> block defensively in case it reasons anyway.
const CHAT_RUN_OPTS = {
  max_tokens: CHAT_MAX_ANSWER_TOKENS,
  chat_template_kwargs: { enable_thinking: false },
}

function answerText(res) {
  const content = res?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return ''
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

// Run the Workers AI tool loop. Tool calls are restricted to the read-only
// allowlist and character_id is pinned to the authenticated character.
async function runAiChat(env, messages, { authorization, identity, characterId }) {
  const tools = chatToolDefs()
  for (let round = 0; round < CHAT_MAX_TOOL_ROUNDS; round++) {
    const res = await env.AI.run(CHAT_MODEL, { messages, tools, ...CHAT_RUN_OPTS })
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
    for (const call of calls) {
      const name = call.function.name
      let text
      if (!CHAT_TOOL_ALLOWLIST.includes(name)) {
        text = `Tool error: '${name}' is not available.`
      } else {
        const args = parseToolArgs(call.function.arguments)
        args.character_id = characterId
        const result = await callTool(name, args, { env, authorization, identity })
        text = toolResultText(result)
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: text })
    }
  }
  // Tool budget exhausted or empty response — one last call with no tools so
  // the model must answer from what it has.
  const final = await env.AI.run(CHAT_MODEL, { messages, ...CHAT_RUN_OPTS })
  return answerText(final) || 'Sorry, I had trouble answering that — try rephrasing your PocketRPG question.'
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

  const hits = searchKnowledge(question, getIndex(), 4)
  const chunks = hits.map((h) => h.chunk)
  const sources = chunks.map((c) => ({ id: c.id, title: c.title }))

  let answer
  let mode = 'ai'
  const aiAvailable = env.AI && (await claimGlobalAiCall(env, dayKey))
  if (!aiAvailable) {
    answer = retrievalOnlyAnswer(chunks)
    mode = 'retrieval'
  } else {
    try {
      const messages = buildMessages({ question, history: body?.history, chunks })
      answer = await runAiChat(env, messages, { authorization, identity: auth.identity, characterId })
    } catch (err) {
      console.error('[PocketRPG][chat] AI call failed:', err?.message || err)
      answer = retrievalOnlyAnswer(chunks)
      mode = 'retrieval'
    }
  }

  await auditLog(
    env,
    'chat_message',
    { identityId: auth.identity.id, characterId, mode, questionChars: question.length },
    { swallow: true },
  )

  return json({ answer, sources, mode, remaining: claim.remaining, resetInMs: nextResetMs() })
}
