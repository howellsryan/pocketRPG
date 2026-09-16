import { TOOL_SCHEMAS } from '../mcp/schema.js'
import { ALWAYS_ON_TOOL_NAMES, searchToolsByQuery } from './prompt.js'

export const JEV_TOOL_ROUTING_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const JEV_TOOL_ROUTING_MODEL = 'jev-latest'
export const JEV_NO_MATCH = '__no_match__'
export const JEV_TOOL_ROUTING_TIMEOUT_MS = 2500
export const JEV_TOOL_ROUTING_LIMIT = 6
export const JEV_TOOL_ROUTING_MAX_QUERY_CHARS = 240

const toolByName = new Map(TOOL_SCHEMAS.map((tool) => [tool.name, tool]))

function compact(text, max = 360) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

const JEV_TOOL_CRITERIA = Object.fromEntries([
  ...TOOL_SCHEMAS.filter((tool) => !ALWAYS_ON_TOOL_NAMES.includes(tool.name)).map((tool) => [
    tool.name,
    `${tool.annotations?.title || tool.name}: ${compact(tool.description)}`,
  ]),
  [
    JEV_NO_MATCH,
    'No available PocketRPG tool matches the requested capability. Use only when none of the named tools would help perform or look up what the player asked for.',
  ],
])

function resultText(names, query) {
  if (!names.length) {
    return `No tool matched "${query}". Try a different phrase, or tell the player it is not supported here.`
  }
  return `Now available to call:\n${names
    .map((name) => {
      const tool = toolByName.get(name)
      return `${name} — ${tool?.description || 'PocketRPG tool'}`
    })
    .join('\n')}`
}

export function isJevToolRoutingEnabled(env) {
  const value = env?.CHAT_JEV_TOOL_ROUTING
  return value === true || (typeof value === 'string' && value.toLowerCase() === 'true')
}

function normalizeQuery(query) {
  return typeof query === 'string' ? query.trim().slice(0, JEV_TOOL_ROUTING_MAX_QUERY_CHARS) : ''
}

export function buildJevToolRoutingRequest(query) {
  return {
    model: JEV_TOOL_ROUTING_MODEL,
    state: { query: normalizeQuery(query) },
    questions: {
      tool: {
        type: 'choice',
        instructions:
          'Choose the one PocketRPG tool whose capability best matches the player request in `query`. Judge the requested capability, not literal keyword overlap. Prefer a specific action/read over a broad reference lookup. Choose __no_match__ only when none of the tools fit.',
        criteria: JEV_TOOL_CRITERIA,
      },
    },
  }
}

function validateJevChoice(payload) {
  const answer = payload?.answers?.tool
  if (answer?.type !== 'choice') throw new Error('invalid Jev tool-routing answer type')
  if (typeof answer.choice !== 'string' || !(answer.choice in JEV_TOOL_CRITERIA)) {
    throw new Error('invalid Jev tool-routing choice')
  }
  if (!answer.probabilities || typeof answer.probabilities !== 'object') {
    throw new Error('invalid Jev tool-routing probabilities')
  }
  if (
    typeof answer.confidence !== 'number' ||
    !Number.isFinite(answer.confidence) ||
    answer.confidence < 0 ||
    answer.confidence > 1
  ) {
    throw new Error('invalid Jev tool-routing confidence')
  }
  for (const [name, probability] of Object.entries(answer.probabilities)) {
    if (
      !(name in JEV_TOOL_CRITERIA) ||
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new Error('invalid Jev tool-routing probability')
    }
  }
  const selectedProbability = answer.probabilities[answer.choice]
  if (typeof selectedProbability !== 'number') {
    throw new Error('invalid Jev tool-routing selected probability')
  }
  return answer
}

export async function routeToolsWithJev(
  query,
  {
    apiKey,
    fetchImpl = globalThis.fetch,
    limit = JEV_TOOL_ROUTING_LIMIT,
    timeoutMs = JEV_TOOL_ROUTING_TIMEOUT_MS,
  } = {},
) {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) {
    return {
      names: [],
      text: 'No matching tool for an empty query. Describe the action or data needed.',
      provider: 'jev',
      choice: JEV_NO_MATCH,
      confidence: 1,
      probabilities: { [JEV_NO_MATCH]: 1 },
      model: JEV_TOOL_ROUTING_MODEL,
      usage: null,
    }
  }
  if (!apiKey) throw new Error('TYPESAFE_API_KEY is required for Jev tool routing')
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required for Jev tool routing')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(JEV_TOOL_ROUTING_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildJevToolRoutingRequest(normalizedQuery)),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response?.ok) {
    throw new Error(`Jev tool routing HTTP ${response?.status || 'error'}`)
  }

  const payload = await response.json()
  const answer = validateJevChoice(payload)
  const probabilities = Object.fromEntries(
    Object.entries(answer.probabilities).filter(
      ([name, probability]) =>
        name in JEV_TOOL_CRITERIA &&
        typeof probability === 'number' &&
        Number.isFinite(probability) &&
        probability >= 0 &&
        probability <= 1,
    ),
  )

  if (answer.choice === JEV_NO_MATCH) {
    return {
      names: [],
      text: resultText([], normalizedQuery),
      provider: 'jev',
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities,
      model: payload?.model || JEV_TOOL_ROUTING_MODEL,
      usage: payload?.usage || null,
    }
  }

  const max = Math.max(1, Math.min(JEV_TOOL_ROUTING_LIMIT, Math.floor(Number(limit) || JEV_TOOL_ROUTING_LIMIT)))
  const names = Object.entries(probabilities)
    .filter(([name]) => name !== JEV_NO_MATCH && toolByName.has(name))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([name]) => name)

  if (!names.includes(answer.choice)) {
    names.unshift(answer.choice)
    if (names.length > max) names.length = max
  }

  return {
    names,
    text: resultText(names, normalizedQuery),
    provider: 'jev',
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities,
    model: payload?.model || JEV_TOOL_ROUTING_MODEL,
    usage: payload?.usage || null,
  }
}

export async function routeToolsForChat(query, env, options = {}) {
  const lexical = () => ({ ...searchToolsByQuery(query), provider: 'lexical' })

  if (!isJevToolRoutingEnabled(env)) return lexical()
  if (!env?.TYPESAFE_API_KEY) return { ...lexical(), fallbackReason: 'missing_key' }

  try {
    return await routeToolsWithJev(query, { ...options, apiKey: env.TYPESAFE_API_KEY })
  } catch (error) {
    console.warn('[PocketRPG][chat] Jev tool routing failed; using lexical fallback', error?.name || 'Error')
    return { ...lexical(), fallbackReason: 'jev_error' }
  }
}
