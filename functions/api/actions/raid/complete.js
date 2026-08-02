import { makeCompletionHandler } from '../_completeShared.js'
import { rollRaidRewardsById } from '../../../_lib/game/raidRewards.js'
import { hardModeForKill } from '../../../_lib/game/hardMode.js'

export const onRequestPost = makeCompletionHandler('raids', {
  resolveRewards: async ({ sourceId, body, env, characterId }) => (
    rollRaidRewardsById(sourceId, Math.random, await hardModeForKill(env, characterId, 'raids', sourceId, body))
  ),
})
