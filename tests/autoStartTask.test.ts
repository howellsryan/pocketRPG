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

  it('rebuilds a regular-monster combat task with the saved stance', () => {
    const t: any = buildAutoStartTask({ kind: 'combat', monsterId: 'cave_goblin' }, { stance: 'aggressive' })
    expect(t?.type).toBe('combat')
    expect(t.monster?.id).toBe('cave_goblin')
    expect(t.stance).toBe('aggressive')
    expect(t.spell).toBeNull()
  })

  it('normalises the legacy controlled stance and defaults to accurate', () => {
    expect((buildAutoStartTask({ kind: 'combat', monsterId: 'cave_goblin' }, { stance: 'controlled' }) as any).stance).toBe('accurate')
    expect((buildAutoStartTask({ kind: 'combat', monsterId: 'cave_goblin' }) as any).stance).toBe('accurate')
  })

  it('resolves the active spell for a magic loadout (but not for powered staffs)', () => {
    const itemsData = {
      battlestaff: { id: 'battlestaff', slot: 'weapon', attackStyle: 'magic' },
      sanguine_staff: { id: 'sanguine_staff', slot: 'weapon', attackStyle: 'magic', poweredStaff: true },
    }
    const withSpell: any = buildAutoStartTask({ kind: 'combat', monsterId: 'cave_goblin' }, {
      equipment: { weapon: { itemId: 'battlestaff' } }, itemsData, activeSpellId: 'fire_strike',
    })
    expect(withSpell.spell?.id).toBe('fire_strike')
    const powered: any = buildAutoStartTask({ kind: 'combat', monsterId: 'cave_goblin' }, {
      equipment: { weapon: { itemId: 'sanguine_staff' } }, itemsData, activeSpellId: 'fire_strike',
    })
    expect(powered.spell).toBeNull()
  })

  it('resumes minigame partial progress from the activity ledger', () => {
    const fresh: any = buildAutoStartTask({ kind: 'minigame', taskId: 'ba_fighter_hat' })
    expect(fresh.ticksRemaining).toBe(fresh.totalTicks)
    const partial: any = buildAutoStartTask({ kind: 'minigame', taskId: 'ba_fighter_hat' }, {
      getProgressTicks: (key: string) => (key === 'minigame:ba_fighter_hat' ? 3000 : 0),
    })
    expect(partial.totalTicks).toBe(12000)
    expect(partial.ticksRemaining).toBe(9000)
  })

  it('returns null for live-resume types (boss/raid/farming/slayer)', () => {
    expect(buildAutoStartTask({ kind: 'combat', monsterId: 'duskmare' })).toBeNull()
    expect(buildAutoStartTask({ kind: 'raid', raidId: 'anything' })).toBeNull()
    expect(buildAutoStartTask({ kind: 'farming', locationId: 'anywhere' })).toBeNull()
    expect(buildAutoStartTask({ kind: 'slayer', masterId: 'anyone' })).toBeNull()
  })

  it('returns null for unknown ids and empty descriptors', () => {
    expect(buildAutoStartTask(null as any)).toBeNull()
    expect(buildAutoStartTask({} as any)).toBeNull()
    expect(buildAutoStartTask({ kind: 'skill', skill: 'woodcutting', actionId: 'nope' })).toBeNull()
    expect(buildAutoStartTask({ kind: 'combat', monsterId: 'nope' })).toBeNull()
  })
})
