import { performance } from 'node:perf_hooks'
import { createServer } from 'vite'
import { CHAT_TOOL_ROUTING_CASES } from './fixtures/chatToolRoutingCases.mjs'

const vite = await createServer({
  root: process.cwd(),
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
})

let searchToolsByQuery
let routeToolsWithJev
try {
  ;({ searchToolsByQuery } = await vite.ssrLoadModule('/functions/_lib/chat/prompt.js'))
  ;({ routeToolsWithJev } = await vite.ssrLoadModule('/functions/_lib/chat/toolRouting.js'))
} catch (error) {
  await vite.close()
  throw error
}

function argValue(name, fallback) {
  const prefix = `--${name}=`
  const arg = process.argv.find((value) => value.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : fallback
}

const scope = argValue('scope', 'hidden')
const runs = Math.max(1, Number.parseInt(argValue('runs', '1'), 10) || 1)
if (!['hidden', 'all'].includes(scope)) {
  console.error('Usage: npm run benchmark:chat-routing -- [--scope=hidden|all] [--runs=N]')
  process.exit(2)
}

const apiKey = process.env.TYPESAFE_API_KEY
if (!apiKey) {
  console.error('TYPESAFE_API_KEY is required for the live Jev benchmark. No synthetic result was produced.')
  process.exit(2)
}

const cases = CHAT_TOOL_ROUTING_CASES.filter((entry) => scope === 'all' || entry.scope === 'hidden')
const samples = []

function percentile(values, fraction) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index]
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function rankedHit(names, expectedTool, k) {
  if (expectedTool === null) return names.length === 0
  const index = names.indexOf(expectedTool)
  return index !== -1 && index < k
}

async function measureLexical(entry) {
  const started = performance.now()
  const result = searchToolsByQuery(entry.query)
  return { ...result, latencyMs: performance.now() - started }
}

async function measureJev(entry) {
  const started = performance.now()
  const result = await routeToolsWithJev(entry.query, { apiKey })
  return { ...result, latencyMs: performance.now() - started }
}

for (let run = 1; run <= runs; run++) {
  for (const entry of cases) {
    const lexical = await measureLexical(entry)
    let jev
    try {
      jev = await measureJev(entry)
    } catch (error) {
      jev = {
        names: [],
        latencyMs: 0,
        usage: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    samples.push({ ...entry, run, lexical, jev })
    process.stdout.write('.')
  }
}
process.stdout.write('\n')

function summarize(provider) {
  const rows = samples.map((sample) => sample[provider])
  const latencies = rows.filter((row) => !row.error).map((row) => row.latencyMs)
  const valid = samples.filter((sample) => !sample[provider].error)
  const errors = samples.length - valid.length
  const hit = (k) =>
    samples.filter(
      (sample) => !sample[provider].error && rankedHit(sample[provider].names, sample.expectedTool, k),
    ).length

  return {
    requests: samples.length,
    errors,
    top1: samples.length ? hit(1) / samples.length : 0,
    top3: samples.length ? hit(3) / samples.length : 0,
    top6: samples.length ? hit(6) / samples.length : 0,
    meanMs: mean(latencies),
    medianMs: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
  }
}

const lexicalSummary = summarize('lexical')
const jevSummary = summarize('jev')
const jevUsage = samples.reduce(
  (totals, sample) => {
    totals.input += Number(sample.jev.usage?.input_tokens) || 0
    totals.output += Number(sample.jev.usage?.output_tokens) || 0
    return totals
  },
  { input: 0, output: 0 },
)

function pct(value) {
  return `${(value * 100).toFixed(1)}%`
}

function ms(value) {
  return `${value.toFixed(1)}ms`
}

console.log(`\nPocketRPG chat tool-routing benchmark (${cases.length} cases × ${runs} run(s), scope=${scope})`)
console.table([
  {
    router: 'lexical',
    top1: pct(lexicalSummary.top1),
    top3: pct(lexicalSummary.top3),
    top6: pct(lexicalSummary.top6),
    errors: lexicalSummary.errors,
    median: ms(lexicalSummary.medianMs),
    p95: ms(lexicalSummary.p95Ms),
  },
  {
    router: 'jev',
    top1: pct(jevSummary.top1),
    top3: pct(jevSummary.top3),
    top6: pct(jevSummary.top6),
    errors: jevSummary.errors,
    median: ms(jevSummary.medianMs),
    p95: ms(jevSummary.p95Ms),
  },
])

console.log(
  `Jev usage: ${jevUsage.input} input tokens, ${jevUsage.output} output tokens. Top-1 delta vs lexical: ${((jevSummary.top1 - lexicalSummary.top1) * 100).toFixed(1)}pp.`,
)

const jevCorrectConfidence = samples
  .filter((sample) => !sample.jev.error && rankedHit(sample.jev.names, sample.expectedTool, 1))
  .map((sample) => sample.jev.confidence)
  .filter(Number.isFinite)
const jevMissConfidence = samples
  .filter((sample) => !sample.jev.error && !rankedHit(sample.jev.names, sample.expectedTool, 1))
  .map((sample) => sample.jev.confidence)
  .filter(Number.isFinite)

console.log(
  `Jev confidence: correct top-1 avg=${jevCorrectConfidence.length ? mean(jevCorrectConfidence).toFixed(3) : 'n/a'}, misses avg=${jevMissConfidence.length ? mean(jevMissConfidence).toFixed(3) : 'n/a'}.`,
)

const misses = samples.filter(
  (sample) =>
    sample.jev.error ||
    !rankedHit(sample.jev.names, sample.expectedTool, 1) ||
    !rankedHit(sample.lexical.names, sample.expectedTool, 1),
)

if (misses.length) {
  console.log('\nCases where either router missed top-1:')
  for (const sample of misses) {
    console.log(
      `- [run ${sample.run}] "${sample.query}" expected=${sample.expectedTool || 'none'} lexical=${sample.lexical.names[0] || 'none'} jev=${sample.jev.error ? `ERROR(${sample.jev.error})` : sample.jev.names[0] || 'none'}`,
    )
  }
}


await vite.close()
