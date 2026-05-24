import { GameApiError } from './errors.js'

const MAX_NONCE_LENGTH = 128

// Claim a single-use action nonce for this character. On first call,
// INSERTs the row and returns. On replay, the ON CONFLICT path silently
// no-ops and the helper throws STALE_REPLAYED_ACTION. Callers (action
// completion endpoints) must claim BEFORE running settleActionCompletion
// so a duplicate request can never settle twice — even if the save blob
// rolls back to a state where the prior settlement is missing.
export async function claimActionNonce(env, characterId, nonce) {
  if (!nonce || typeof nonce !== 'string') {
    throw new GameApiError('INVALID_NONCE', 'Invalid action nonce', 400)
  }
  if (nonce.length > MAX_NONCE_LENGTH) {
    throw new GameApiError('INVALID_NONCE', 'Nonce too long', 400)
  }
  if (!env?.DB) {
    throw new GameApiError('INTERNAL', 'D1 binding missing', 500)
  }
  const res = await env.DB.prepare(
    `INSERT INTO action_nonces (character_id, nonce, used_at)
     VALUES (?, ?, ?)
     ON CONFLICT(character_id, nonce) DO NOTHING`
  ).bind(characterId, nonce, Date.now()).run()
  if (!res?.meta?.changes) {
    throw new GameApiError('STALE_REPLAYED_ACTION', 'stale_replayed_action', 409)
  }
}

// One-shot lift of pre-step-6 nonces from a save blob into the table.
// Called from loadCharacterWithSave so any active character migrates on
// next read. INSERT ON CONFLICT keeps it idempotent across multiple
// reads of the same legacy blob.
export async function migrateLegacyNonces(env, characterId, saveObject) {
  if (!env?.DB || !characterId || !saveObject) return false
  const legacy = saveObject._serverActionNonces
  if (!legacy || typeof legacy !== 'object') return false
  const entries = Object.entries(legacy)
  if (entries.length === 0) {
    delete saveObject._serverActionNonces
    return false
  }
  const now = Date.now()
  const stmts = entries.map(([nonce, usedAt]) =>
    env.DB.prepare(
      `INSERT INTO action_nonces (character_id, nonce, used_at)
       VALUES (?, ?, ?)
       ON CONFLICT(character_id, nonce) DO NOTHING`
    ).bind(characterId, String(nonce), Number(usedAt) || now)
  )
  try {
    await env.DB.batch(stmts)
  } catch {
    // Migration is best-effort. If it fails, leave the legacy field in
    // place; the next read will retry. The new claimActionNonce path
    // still works for any nonce not present in the table.
    return false
  }
  delete saveObject._serverActionNonces
  return true
}
