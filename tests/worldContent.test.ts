import { describe, it, expect } from 'vitest'
import {
  activityRef,
  autoStartFromTask,
  placesForActivity,
  resolveActivityStart,
  resolveTaskStart,
  describeActivity,
} from '../src/engine/worldContent.js'
import worldData from '../src/data/world.json'
import monstersData from '../src/data/monsters.json'
import skillsData from '../src/data/skills.json'
import raidsData from '../src/data/raids.json'
import minigamesData from '../src/data/minigames.json'
import { GATHER_TASKS } from '../src/engine/gatherTasks.js'

const asArray = (v: any) => (Array.isArray(v) ? v : Object.values(v || {}))

// Raid bosses are raid-only content (placed as kind 'raid', not standalone monsters).
const raidBossIds = new Set<string>()
for (const r of asArray(raidsData)) for (const b of (r.bosses || [])) raidBossIds.add(b)
// First regular (non-raid-boss) monster — a stable subject for the gating tests.
const regularMonster = asArray(monstersData).find((m: any) => !raidBossIds.has(m.id))

describe('activityRef', () => {
  it('derives the gating ref from each gated task shape', () => {
    expect(activityRef({ type: 'combat', monster: { id: 'cave_goblin' } })).toEqual({ kind: 'combat', ref: 'cave_goblin' })
    expect(activityRef({ type: 'skill', skill: 'mining', action: { id: 'copper' } })).toEqual({ kind: 'skill', ref: 'mining:copper' })
    expect(activityRef({ type: 'gather', gatherTask: { id: 'collect_sand' } })).toEqual({ kind: 'gather', ref: 'collect_sand' })
    expect(activityRef({ type: 'agility', action: { id: 'gnome_stronghold' } })).toEqual({ kind: 'agility', ref: 'gnome_stronghold' })
    expect(activityRef({ type: 'thieving', npc: { id: 'villager' } })).toEqual({ kind: 'thieving', ref: 'villager' })
    expect(activityRef({ type: 'hunter', action: { id: 'hunt_cow' } })).toEqual({ kind: 'hunter', ref: 'hunt_cow' })
    expect(activityRef({ type: 'raid', raid: { id: 'crimson_night_theatre' } })).toEqual({ kind: 'raid', ref: 'crimson_night_theatre' })
    expect(activityRef({ type: 'minigame', minigameTask: { id: 'pc_void_set', minigame: 'pest_control' } })).toEqual({ kind: 'minigame', ref: 'pest_control' })
  })

  it('returns null for non-place-bound task types', () => {
    expect(activityRef({ type: 'pvp' })).toBeNull()
    expect(activityRef(null)).toBeNull()
    expect(activityRef({ type: 'combat' })).toBeNull() // missing monster
  })
})

describe('content -> place coverage', () => {
  it('maps every non-raid monster to at least one place', () => {
    for (const m of asArray(monstersData)) {
      if (raidBossIds.has(m.id)) continue // raid bosses are placed as kind 'raid', not combat
      expect(placesForActivity('combat', m.id).length, `monster ${m.id}`).toBeGreaterThan(0)
    }
  })

  it('places each raid (kind raid) at a city, and never its bosses as standalone combat', () => {
    const seen = new Set<string>()
    for (const r of asArray(raidsData)) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      const places = placesForActivity('raid', r.id)
      expect(places.length, `raid ${r.id}`).toBeGreaterThan(0)
      for (const id of places) expect((worldData.places as any)[id].tier).toBe('city')
      // its bosses must not leak into the combat layer
      for (const b of r.bosses || []) expect(placesForActivity('combat', b), `boss ${b}`).toEqual([])
    }
  })

  it('places each agility course at its namesake world city', () => {
    expect(placesForActivity('agility', 'ardougne')).toEqual(['ardounne'])
    expect(placesForActivity('agility', 'falador')).toEqual(['faloden'])
    expect(placesForActivity('agility', 'varrock')).toEqual(['varrick'])
    expect(placesForActivity('agility', 'al_kharid')).toEqual(['alkarid'])
  })

  it('maps every gather task to at least one place', () => {
    for (const t of GATHER_TASKS) {
      expect(placesForActivity('gather', t.id).length, `gather ${t.id}`).toBeGreaterThan(0)
    }
  })

  it('places each minigame at its authored venue', () => {
    expect(placesForActivity('minigame', 'pest_control')).toEqual(['portsarin'])
    expect(placesForActivity('minigame', 'castle_wars')).toEqual(['ardounne'])
    expect(placesForActivity('minigame', 'barbarian_assault')).toEqual(['camlann'])
    expect(placesForActivity('minigame', 'fishing_trawler')).toEqual(['catherra'])
    expect(placesForActivity('minigame', 'mage_arena')).toEqual(['edgevale'])
    expect(placesForActivity('minigame', 'warriors_guild')).toEqual(['barlock'])
  })

  it('returns no places for unmapped content', () => {
    expect(placesForActivity('combat', 'no_such_monster')).toEqual([])
    expect(placesForActivity('skill', 'magic:no_such_spell')).toEqual([]) // fake ref
    expect(placesForActivity('skill', 'dungeoneering:dungeoneering_floor_1')).toEqual([]) // skill intentionally unmapped
  })
})

describe('facility-bound skills', () => {
  const hasFacility = (id: string, f: string) => (worldData.places[id] as any).facilities?.includes(f)
  const bankPlaces = Object.keys(worldData.places).filter((id) => hasFacility(id, 'bank'))
  const furnacePlaces = Object.keys(worldData.places).filter((id) => hasFacility(id, 'furnace_anvil'))
  const noBank = Object.keys(worldData.places).filter((id) => !hasFacility(id, 'bank'))
  const noFurnace = Object.keys(worldData.places).filter((id) => !hasFacility(id, 'furnace_anvil'))

  it('places a bank skill (cooking) at every bank place and nowhere else', () => {
    const places = placesForActivity('skill', 'cooking:cook_shrimp')
    expect(places.length).toBeGreaterThan(0)
    expect([...places].sort()).toEqual([...bankPlaces].sort())
  })

  it('places smithing only at furnace & anvil places', () => {
    const places = placesForActivity('skill', 'smithing:smelt_bronze')
    expect([...places].sort()).toEqual([...furnacePlaces].sort())
    // a place without a furnace & anvil must NOT offer smithing
    for (const id of noFurnace) expect(places).not.toContain(id)
  })

  it('maps every thieving target to the bank places', () => {
    const npcs = (skillsData as any).thieving.npcs
    for (const n of npcs) {
      expect([...placesForActivity('thieving', n.id)].sort(), `thieving ${n.id}`).toEqual([...bankPlaces].sort())
    }
  })

  it('does not offer a facility skill at a place without the facility', () => {
    for (const id of noBank) {
      expect(placesForActivity('skill', 'prayer:bury_bones').includes(id)).toBe(false)
    }
  })
})

describe('resolveActivityStart', () => {
  // Pick a real mapping to drive the gate (a regular, non-raid monster).
  const monster = regularMonster
  const place = placesForActivity('combat', monster.id)[0]
  const elsewhere = Object.keys(worldData.places).find((p) => p !== place)!

  it('starts when at a place that offers the activity', () => {
    const r = resolveActivityStart({ location: place, travel: null, kind: 'combat', ref: monster.id })
    expect(r.status).toBe('start')
  })

  it('requires travel when at a different place', () => {
    const r = resolveActivityStart({ location: elsewhere, travel: null, kind: 'combat', ref: monster.id })
    expect(r.status).toBe('travel')
    expect(r.places).toContain(place)
  })

  it('blocks while travelling', () => {
    const r = resolveActivityStart({ location: elsewhere, travel: { type: 'travel' }, kind: 'combat', ref: monster.id })
    expect(r.status).toBe('blocked-transit')
  })

  it('always starts unmapped content, even from elsewhere', () => {
    const r = resolveActivityStart({ location: elsewhere, travel: null, kind: 'combat', ref: 'no_such_monster' })
    expect(r.status).toBe('start')
  })

  it('resolveTaskStart starts untracked task types', () => {
    expect(resolveTaskStart({ type: 'pvp' }, { location: elsewhere, travel: null }).status).toBe('start')
  })
})

describe('autoStartFromTask', () => {
  it('extracts a compact, serialisable resume descriptor per task type', () => {
    expect(autoStartFromTask({ type: 'combat', monster: { id: 'cow' } })).toEqual({ kind: 'combat', monsterId: 'cow' })
    expect(autoStartFromTask({ type: 'raid', raid: { id: 'crimson_night_theatre' } })).toEqual({ kind: 'raid', raidId: 'crimson_night_theatre' })
    expect(autoStartFromTask({ type: 'skill', skill: 'mining', action: { id: 'copper' } })).toEqual({ kind: 'skill', skill: 'mining', actionId: 'copper' })
    expect(autoStartFromTask({ type: 'agility', action: { id: 'ardougne' } })).toEqual({ kind: 'agility', actionId: 'ardougne' })
    expect(autoStartFromTask({ type: 'thieving', npc: { id: 'guard' } })).toEqual({ kind: 'thieving', npcId: 'guard' })
    expect(autoStartFromTask({ type: 'gather', gatherTask: { id: 'collect_sand' } })).toEqual({ kind: 'gather', gatherTaskId: 'collect_sand' })
    expect(autoStartFromTask({ type: 'minigame', minigameTask: { id: 'pc_void_set', minigame: 'pest_control' } })).toEqual({ kind: 'minigame', taskId: 'pc_void_set' })
  })

  it('returns null for untracked or empty tasks', () => {
    expect(autoStartFromTask(null)).toBeNull()
    expect(autoStartFromTask({ type: 'pvp' })).toBeNull()
    expect(autoStartFromTask({ type: 'combat' })).toBeNull()
  })
})

describe('describeActivity', () => {
  it('resolves human-readable names from refs', () => {
    const monster = asArray(monstersData)[0]
    expect(describeActivity('combat', monster.id).name).toBe(monster.name)
    expect(describeActivity('skill', 'mining:copper').name).toBeTruthy()
    expect(describeActivity('combat', 'no_such_monster').name).toBe('no_such_monster') // falls back to ref
    expect(describeActivity('raid', 'crimson_night_theatre').name).toBe('Crimson Night Theatre')
    expect(describeActivity('minigame', 'pest_control').name).toBe('Void Breach')
  })
})
