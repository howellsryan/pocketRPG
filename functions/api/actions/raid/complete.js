import { makeCompletionHandler } from '../_completeShared.js'
import { rollRaidRewardsById } from '../../../_lib/game/raidRewards.js'
import { hardModeForKill } from '../../../_lib/game/hardMode.js'
import { GameApiError } from '../../../_lib/game/errors.js'

export async function resolveRaidCompletionRewards({ sourceId, body, env, characterId, isGrindman }) {
    if (sourceId === 'sunspire_colosseum') {
      throw new GameApiError(
        'SERVER_ROOM_REQUIRED',
        'Sunspire progression and rewards are resolved only by its server-run combat room',
        403,
      )
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
})
