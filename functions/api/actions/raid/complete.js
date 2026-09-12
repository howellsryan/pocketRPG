import { makeCompletionHandler } from '../_completeShared.js'
import { rollRaidRewardsById } from '../../../_lib/game/raidRewards.js'
import { hardModeForKill } from '../../../_lib/game/hardMode.js'
import { GameApiError } from '../../../_lib/game/errors.js'
import { rollSunspireRunRewards } from '../../../../src/engine/sunspireRewards.js'

const SUNSPIRE_ID = 'sunspire_colosseum'
const SUNSPIRE_FINAL_WAVE = 12

function sunspireWaveFromBody(body) {
  const wave = Number(body?.wave)
  if (!Number.isInteger(wave) || wave < 1 || wave > SUNSPIRE_FINAL_WAVE) {
    throw new GameApiError('INVALID_SUNSPIRE_WAVE', 'Sunspire cash-out requires a cleared wave from 1 to 12', 400)
  }
  return wave
}

async function sunspireObtainedIds(env, characterId) {
  if (!env?.DB) return new Set()
  const rows = await env.DB.prepare(
    `SELECT item_id FROM collection_log
      WHERE character_id = ? AND source_type = 'raids' AND source_id = ?`,
  ).bind(characterId, SUNSPIRE_ID).all()
  return new Set((rows.results || []).map((row) => row?.item_id).filter(Boolean))
}

export async function resolveRaidCompletionRewards({ sourceId, body, env, characterId, isGrindman }) {
  if (sourceId === SUNSPIRE_ID) {
    const wave = sunspireWaveFromBody(body)
    return rollSunspireRunRewards({
      throughWave: wave,
      obtainedIds: await sunspireObtainedIds(env, characterId),
    })
  }
  return rollRaidRewardsById(
    sourceId,
    Math.random,
    await hardModeForKill(env, characterId, 'raids', sourceId, body),
    isGrindman,
  )
}

export const onRequestPost = makeCompletionHandler('raids', {
  resolveRewards: resolveRaidCompletionRewards,
  // Cashing out is a legitimate reward settlement, not a Colosseum clear.
  // Only wave 12 increments raid KC; the body cannot opt in separately.
  shouldPersistKillCount: ({ sourceId, body }) => (
    sourceId !== SUNSPIRE_ID || sunspireWaveFromBody(body) === SUNSPIRE_FINAL_WAVE
  ),
})
