// Q5 regression: spam-clicking the monster you're ALREADY fighting must not
// reset the engine's attack timer for a free instant hit. isSameFightTarget is
// the predicate WorldZone.handleInteract uses to keep player.combat alive when
// the click re-targets the fight in progress.
import { describe, expect, it } from 'vitest'
import { isSameFightTarget } from '../server/combat'
import type { TickPlayer } from '../server/tick'

function playerFighting(npcId: string | null): TickPlayer {
  return { combat: npcId ? { npcId, state: {} as never } : null } as TickPlayer
}

describe('isSameFightTarget', () => {
  it('is true when re-clicking the npc already being fought', () => {
    expect(isSameFightTarget(playerFighting('bull_1'), { kind: 'npc', id: 'bull_1' })).toBe(true)
  })

  it('is false when clicking a different npc', () => {
    expect(isSameFightTarget(playerFighting('bull_1'), { kind: 'npc', id: 'goblin_2' })).toBe(false)
  })

  it('is false when the player is not in combat', () => {
    expect(isSameFightTarget(playerFighting(null), { kind: 'npc', id: 'bull_1' })).toBe(false)
  })

  it('is false for a non-npc intent even when the id matches', () => {
    expect(isSameFightTarget(playerFighting('bull_1'), { kind: 'rock', id: 'bull_1' })).toBe(false)
  })

  it('is false for a null intent', () => {
    expect(isSameFightTarget(playerFighting('bull_1'), null)).toBe(false)
  })
})
