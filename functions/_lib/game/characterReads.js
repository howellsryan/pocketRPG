// The per-character read queries that both /api/bootstrap and the individual
// endpoints run, as statement + mapper pairs.
//
// Split that way because bootstrap issues all four in one `DB.batch()` (one
// round trip) while the standalone endpoints issue one each — and a batched
// statement comes back as `{ results }` whether it is a SELECT of one row or
// many, so every mapper here reads that shape and `.all()` is used on the
// single-statement path to match it.
//
// The SQL lives here once. A second copy is a divergence waiting to happen:
// bootstrap and /api/kill-counts answering differently for the same character
// is indistinguishable, from the client, from a save bug.

export function rowsOf(result) {
  return result?.results || []
}

export function killCountsStatement(env, characterId) {
  return env.DB.prepare(
    `SELECT source_type, source_id, kill_count
       FROM kill_counts
      WHERE character_id = ?`,
  ).bind(characterId)
}

export function mapKillCounts(result) {
  return rowsOf(result).map((r) => ({
    sourceType: r.source_type,
    sourceId: r.source_id,
    killCount: r.kill_count,
  }))
}

// The matching mapper lives in hardMode.js, next to the `hardModeTarget`
// content predicate it filters on — importing that here would make this module
// and hardMode.js mutually dependent.
export function hardModeTargetsStatement(env, characterId) {
  return env.DB.prepare(
    'SELECT source_type, source_id FROM hard_mode_targets WHERE character_id = ?',
  ).bind(characterId)
}

export function idleStateStatement(env, characterId) {
  return env.DB.prepare(
    'SELECT last_active_at, active_task, updated_at FROM character_idle_state WHERE character_id = ?',
  ).bind(characterId)
}

/** The idle row, or null when the character has never been stamped. */
export function mapIdleState(result) {
  const row = rowsOf(result)[0]
  if (!row) return null
  let activeTask = null
  // A row written by an older client can hold JSON this build no longer parses.
  // Losing the task is a resumed-activity bug; failing the read would cost the
  // whole boot, so the timestamp survives on its own.
  if (row.active_task) {
    try { activeTask = JSON.parse(row.active_task) } catch { activeTask = null }
  }
  return {
    lastActiveAt: row.last_active_at,
    activeTask,
    updatedAt: row.updated_at,
  }
}

export function activityProgressStatement(env, characterId) {
  return env.DB.prepare(
    'SELECT activity_key, progress_ticks, total_ticks, updated_at FROM character_activity_progress WHERE character_id = ?',
  ).bind(characterId)
}

export function mapActivityProgress(result) {
  const progress = {}
  for (const row of rowsOf(result)) {
    progress[row.activity_key] = {
      progressTicks: row.progress_ticks,
      totalTicks: row.total_ticks ?? null,
      updatedAt: row.updated_at,
    }
  }
  return progress
}
