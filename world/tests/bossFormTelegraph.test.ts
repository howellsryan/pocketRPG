// Zaryth rerolls its style every swing, and the whole point of that is that the
// swing is READABLE before it lands: the client starts the wind-up clip two
// ticks early (signalSwing) and tints the model by the same form.
//
// The roll used to happen ON the swing tick, after the wind-up had already been
// broadcast — so the animation and the tint described the form the boss had just
// finished using, and the damage arrived in a different style entirely. There
// was no protection prayer a player could read off the screen and set.
import { describe, expect, it } from 'vitest'
import { advanceSharedSwing, npcsFromZone, toNpcDiff, type NpcState } from '../server/npc'
import { monsterWindupLeadTicks } from '../server/combat'
import { monsterAttackAnim } from '../server/tick'

const ZARYTH = 'zaryth_the_empty_lord'

function zaryth(): NpcState {
  const npcs = npcsFromZone([{ id: 'boss', monsterId: ZARYTH, x: 5, z: 5, wander: { x: 5, z: 5, w: 1, h: 1 } }])
  const boss = npcs.get('boss')!
  boss.state = 'combat'
  return boss
}

describe('a multi-form boss telegraphs the form it is about to swing with', () => {
  it('holds the form it announced from the wind-up tick through the blow', () => {
    const boss = zaryth()
    const lead = monsterWindupLeadTicks(ZARYTH)
    let announced: { form: string | undefined; anim: string } | null = null

    for (let tick = 1; tick <= 60; tick++) {
      advanceSharedSwing(boss)
      // What the client is told on the wind-up tick — the clip it starts and the
      // phase it tints by both come from this.
      if (!boss.sharedSwing && boss.attackTimer === lead) {
        announced = { form: toNpcDiff(boss).form, anim: monsterAttackAnim(ZARYTH, boss.currentForm) }
      }
      if (boss.sharedSwing && announced) {
        // The swing the sessions resolve this tick wears npc.currentForm.
        expect(boss.currentForm).toBe(announced.form)
        expect(monsterAttackAnim(ZARYTH, boss.currentForm)).toBe(announced.anim)
        announced = null
      }
    }
  })

  it('still rotates — a telegraph that never changed would just be one form', () => {
    const boss = zaryth()
    const seen = new Set<string>()
    for (let tick = 1; tick <= 400; tick++) {
      advanceSharedSwing(boss)
      if (boss.currentForm) seen.add(boss.currentForm)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('puts the form on the wire so the client can tint by it', () => {
    const boss = zaryth()
    advanceSharedSwing(boss)
    expect(toNpcDiff(boss).form).toBe(boss.currentForm)
    expect(toNpcDiff(boss).form).toBeTruthy()
  })

  it('leaves a monster with no forms alone', () => {
    const npcs = npcsFromZone([{ id: 'bull', monsterId: 'pasture_bull', x: 1, z: 1, wander: { x: 1, z: 1, w: 1, h: 1 } }])
    const bull = npcs.get('bull')!
    bull.state = 'combat'
    advanceSharedSwing(bull)
    expect(toNpcDiff(bull).form).toBeUndefined()
  })
})
