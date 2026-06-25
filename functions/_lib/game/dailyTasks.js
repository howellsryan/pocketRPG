import dailyTasksPool from '../../../src/data/dailyTasks.json' assert { type: 'json' }

export const COMPLEXITY_ORDER_SERVER = ['Novice', 'Intermediate', 'Experienced', 'Master', 'Grandmaster']

export function utcDayKey(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10)
}

export function nextResetMs(nowMs = Date.now()) {
  const d = new Date(nowMs)
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
  return midnight - nowMs
}

// xfnv1a — deterministic string → uint32 hash
function hashSeed(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (Math.imul(h, 0x01000193) >>> 0)
  }
  return h >>> 0
}

// mulberry32 — fast uint32 PRNG, deterministic from seed
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function selectDailyTasks(characterId, dateKey, pool) {
  const seed = hashSeed(`${characterId}:${dateKey}`)
  const rand = mulberry32(seed)
  const tasks = []
  for (let slot = 0; slot < COMPLEXITY_ORDER_SERVER.length; slot++) {
    const tier = COMPLEXITY_ORDER_SERVER[slot]
    const candidates = pool.filter(t => t.tier === tier).sort((a, b) => a.id < b.id ? -1 : 1)
    if (candidates.length === 0) continue
    const idx = Math.floor(rand() * candidates.length)
    const chosen = candidates[idx]
    tasks.push({ slot, taskId: chosen.id, tier, target: chosen.trigger.target })
  }
  return tasks
}

export async function ensureDailyTasks(env, characterId, dateKey, pool = dailyTasksPool) {
  const existing = await env.DB.prepare(
    `SELECT slot, task_id, tier, target, progress, completed_at, credited
       FROM character_daily_tasks
      WHERE character_id = ? AND task_date = ?
      ORDER BY slot`
  ).bind(characterId, dateKey).all()

  if ((existing.results || []).length >= 5) {
    return existing.results
  }

  const selected = selectDailyTasks(characterId, dateKey, pool)
  const now = Date.now()
  const stmts = selected.map(({ slot, taskId, tier, target }) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO character_daily_tasks
         (character_id, task_date, slot, task_id, tier, target, progress, credited, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`
    ).bind(characterId, dateKey, slot, taskId, tier, target, now)
  )
  await env.DB.batch(stmts)

  const refreshed = await env.DB.prepare(
    `SELECT slot, task_id, tier, target, progress, completed_at, credited
       FROM character_daily_tasks
      WHERE character_id = ? AND task_date = ?
      ORDER BY slot`
  ).bind(characterId, dateKey).all()
  return refreshed.results || []
}
