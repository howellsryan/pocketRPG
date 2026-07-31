import { makeCompletionHandler } from '../_completeShared.js'
import { rollRaidRewardsById } from '../../../_lib/game/raidRewards.js'
import { isHardModeEnabled } from '../../../_lib/game/hardMode.js'

export const onRequestPost = makeCompletionHandler('raids', {
  resolveRewards: async ({ sourceId, env, characterId }) => (
    rollRaidRewardsById(sourceId, Math.random, await isHardModeEnabled(env, characterId, 'raids', sourceId))
  ),
})
