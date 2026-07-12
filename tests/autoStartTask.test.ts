import { describe, it, expect } from 'vitest'
import { buildAutoStartTask } from '../src/engine/autoStartTask.js'

describe('buildAutoStartTask (Skip-1h rolls the walk into the activity)', () => {
  it('rebuilds a skilling task from a skill autoStart', () => {
    const t: any = buildAutoStartTask({ kind: 'skill', skill: 'woodcutting', actionId: 'normal' })
    expect(t?.type).toBe('skill')
    expect(t.skill).toBe('woodcutting')
    expect(t.action?.id).toBe('normal')
    expect(t.bankingEnabled).toBe(true)
  })

  it('rebuilds agility / thieving / hunter tasks', () => {
    expect(buildAutoStartTask({ kind: 'agility', actionId: 'gnome_stronghold' })?.type).toBe('agility')
    const th: any = buildAutoStartTask({ kind: 'thieving', npcId: 'villager' })
    expect(th?.type).toBe('thieving')
    expect(th.npc?.id).toBe('villager')
    expect(buildAutoStartTask({ kind: 'hunter', actionId: 'hunt_cow' })?.type).toBe('hunter')
  })

  it('rebuilds a regular combat task so Skip-1h fights the monster travelled to', () => {
    const t: any = buildAutoStartTask({ kind: 'combat', monsterId: 'field_chicken' })
    expect(t?.type).toBe('combat')
    expect(t.monster?.id).toBe('field_chicken')
    expect(t.bankingEnabled).toBe(true)
  })

  it('returns null for boss combat and other live-resume types (raid/farming/slayer)', () => {
    expect(buildAutoStartTask({ kind: 'combat', monsterId: 'deepmaw_kraken' })).toBeNull()
    expect(buildAutoStartTask({ kind: 'combat', monsterId: 'nope' })).toBeNull()
    expect(buildAutoStartTask({ kind: 'raid', raidId: 'anything' })).toBeNull()
    expect(buildAutoStartTask({ kind: 'farming', locationId: 'anywhere' })).toBeNull()
    expect(buildAutoStartTask({ kind: 'slayer', masterId: 'anyone' })).toBeNull()
  })

  it('returns null for unknown ids and empty descriptors', () => {
    expect(buildAutoStartTask(null as any)).toBeNull()
    expect(buildAutoStartTask({} as any)).toBeNull()
    expect(buildAutoStartTask({ kind: 'skill', skill: 'woodcutting', actionId: 'nope' })).toBeNull()
  })
})
