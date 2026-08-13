// Client-reported kill counts, applied from the save push's side channel.
//
// The idle game has no per-kill cloud write (§6), so ordinary kills arrive
// batched on /api/save as `kills`. This is a client-trusted number in the same
// deliberate, bounded band as the XP and loot the same kill already puts in the
// blob (§14) — bounded because filterReportableKills refuses every monster that
// answers a boss entry gate or has a server-authoritative completion of its
// own. Nothing here can unlock a door, and nothing here double-counts a kill
// that _completeShared already counted.

import { filterReportableKills, MAX_REPORTED_MONSTERS } from '../../../src/engine/killCountReports.js'
import { auditLog } from './audit.js'

/**
 * Adds a reported tally to kill_counts, one upsert per monster.
 *
 * Returns the tally actually applied (empty when nothing was reportable), so a
 * caller can audit what it accepted rather than what it was handed.
 */
export async function applyReportedKillCounts(env, characterId, tally, now = Date.now()) {
  if (!env?.DB || !Number.isInteger(characterId) || characterId <= 0) return {}
  const accepted = filterReportableKills(tally)
  const entries = Object.entries(accepted).slice(0, MAX_REPORTED_MONSTERS)
  if (entries.length === 0) return {}

  await env.DB.batch(
    entries.map(([monsterId, count]) => env.DB.prepare(
      `INSERT INTO kill_counts (character_id, source_type, source_id, kill_count, updated_at)
       VALUES (?, 'monsters', ?, ?, ?)
       ON CONFLICT(character_id, source_type, source_id)
       DO UPDATE SET kill_count = kill_count + excluded.kill_count, updated_at = excluded.updated_at`,
    ).bind(characterId, monsterId, count, now)),
  )
  return Object.fromEntries(entries)
}

/**
 * The save endpoint's wrapper: applies the report and audits it, swallowing
 * every failure. A kill count is a tally, not a grant — it must never turn a
 * legitimate save into a failed one.
 */
export async function applyReportedKillCountsFromSave(env, { characterId, identityId, kills }, now = Date.now()) {
  if (!kills || typeof kills !== 'object') return
  try {
    const applied = await applyReportedKillCounts(env, characterId, kills, now)
    if (Object.keys(applied).length === 0) return
    await auditLog(env, 'kill_counts_reported', { characterId, identityId, kills: applied }, { swallow: true })
  } catch (err) {
    console.error('[PocketRPG][killCounts] reported tally not applied', { characterId, message: err?.message || err })
  }
}
