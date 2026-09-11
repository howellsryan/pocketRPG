import { GameApiError } from './errors.js'

const OPEN = "status IN ('active','decision','settling')"

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

export function hydrateSunspireRun(row) {
  if (!row) return null
  return {
    run_id: row.run_id,
    character_id: Number(row.character_id),
    mode: row.mode || 'solo',
    party_session_id: row.party_session_id || null,
    status: row.status,
    current_wave: Math.max(1, Number(row.current_wave) || 1),
    cleared_wave: Math.max(0, Number(row.cleared_wave) || 0),
    modifierState: parseJson(row.modifier_json, {}),
    offers: parseJson(row.offers_json, []),
    chest: parseJson(row.chest_json, []),
    staged: parseJson(row.staged_json, []),
    settlement: parseJson(row.settlement_json, null),
    claim_nonce: row.claim_nonce || null,
    last_action_nonce: row.last_action_nonce || null,
    final_wave_cleared: row.final_wave_cleared === 1,
    completion_counted: row.completion_counted === 1,
    created_at: Number(row.created_at) || 0,
    updated_at: Number(row.updated_at) || 0,
    settled_at: row.settled_at == null ? null : Number(row.settled_at),
  }
}

export async function getOpenSunspireRun(env, characterId) {
  const row = await env.DB.prepare(
    `SELECT * FROM sunspire_runs WHERE character_id = ? AND ${OPEN} ORDER BY updated_at DESC LIMIT 1`
  ).bind(characterId).first()
  return hydrateSunspireRun(row)
}

export async function getLatestSunspireRun(env, characterId) {
  const row = await env.DB.prepare(
    'SELECT * FROM sunspire_runs WHERE character_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).bind(characterId).first()
  return hydrateSunspireRun(row)
}

export async function getSunspireRunById(env, characterId, runId) {
  const row = await env.DB.prepare(
    'SELECT * FROM sunspire_runs WHERE character_id = ? AND run_id = ? LIMIT 1'
  ).bind(characterId, runId).first()
  return hydrateSunspireRun(row)
}

export async function createSunspireRun(env, characterId, { mode = 'solo', partySessionId = null, runId = null } = {}) {
  const existing = await getOpenSunspireRun(env, characterId)
  if (existing) return existing
  const now = Date.now()
  const id = runId || crypto.randomUUID()
  try {
    await env.DB.prepare(
      `INSERT INTO sunspire_runs (
        run_id, character_id, mode, party_session_id, status, current_wave, cleared_wave,
        modifier_json, offers_json, chest_json, staged_json, final_wave_cleared,
        completion_counted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', 1, 0, '{}', '[]', '[]', '[]', 0, 0, ?, ?)`
    ).bind(id, characterId, mode, partySessionId, now, now).run()
  } catch {
    const raced = await getOpenSunspireRun(env, characterId)
    if (raced) return raced
    throw new GameApiError('SUNSPIRE_RUN_CREATE_FAILED', 'Could not create Sunspire run', 500)
  }
  return getSunspireRunById(env, characterId, id)
}

export async function persistSunspireRun(env, characterId, run) {
  const now = Date.now()
  const res = await env.DB.prepare(
    `UPDATE sunspire_runs SET
      status = ?, current_wave = ?, cleared_wave = ?, modifier_json = ?, offers_json = ?,
      chest_json = ?, staged_json = ?, settlement_json = ?, claim_nonce = ?,
      last_action_nonce = ?, final_wave_cleared = ?, updated_at = ?, settled_at = ?
     WHERE character_id = ? AND run_id = ?`
  ).bind(
    run.status,
    Math.max(1, Number(run.current_wave) || 1),
    Math.max(0, Number(run.cleared_wave) || 0),
    JSON.stringify(run.modifierState || {}),
    JSON.stringify(run.offers || []),
    JSON.stringify(run.chest || []),
    JSON.stringify(run.staged || []),
    run.settlement == null ? null : JSON.stringify(run.settlement),
    run.claim_nonce || null,
    run.last_action_nonce || null,
    run.final_wave_cleared ? 1 : 0,
    now,
    run.settled_at ?? null,
    characterId,
    run.run_id,
  ).run()
  if (!res?.meta?.changes) throw new GameApiError('SUNSPIRE_RUN_STALE', 'Sunspire run changed', 409)
  return getSunspireRunById(env, characterId, run.run_id)
}

export async function obtainedSunspireIds(env, characterId) {
  const rows = await env.DB.prepare(
    `SELECT item_id FROM collection_log
      WHERE character_id = ? AND source_type = 'raids' AND source_id = 'sunspire_colosseum'`
  ).bind(characterId).all()
  return new Set((rows?.results || []).map(row => row?.item_id).filter(Boolean))
}
