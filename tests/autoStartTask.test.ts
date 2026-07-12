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

  it('returns null for live-resume types (combat/raid/farming/slayer)', () => {
    expect(buildAutoStartTask({ kind: 'combat', monsterId: 'goblin' })).toBeNull()
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
