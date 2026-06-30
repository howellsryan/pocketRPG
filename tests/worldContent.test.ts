import { describe, it, expect } from 'vitest'
import {
  activityRef,
  placesForActivity,
  resolveActivityStart,
  resolveTaskStart,
  describeActivity,
} from '../src/engine/worldContent.js'
import worldData from '../src/data/world.json'
import monstersData from '../src/data/monsters.json'
import skillsData from '../src/data/skills.json'
import { GATHER_TASKS } from '../src/engine/gatherTasks.js'

const asArray = (v: any) => (Array.isArray(v) ? v : Object.values(v || {}))

describe('activityRef', () => {
  it('derives the gating ref from each gated task shape', () => {
    expect(activityRef({ type: 'combat', monster: { id: 'cave_goblin' } })).toEqual({ kind: 'combat', ref: 'cave_goblin' })
    expect(activityRef({ type: 'skill', skill: 'mining', action: { id: 'copper' } })).toEqual({ kind: 'skill', ref: 'mining:copper' })
    expect(activityRef({ type: 'gather', gatherTask: { id: 'collect_sand' } })).toEqual({ kind: 'gather', ref: 'collect_sand' })
    expect(activityRef({ type: 'agility', action: { id: 'gnome_stronghold' } })).toEqual({ kind: 'agility', ref: 'gnome_stronghold' })
    expect(activityRef({ type: 'thieving', npc: { id: 'villager' } })).toEqual({ kind: 'thieving', ref: 'villager' })
    expect(activityRef({ type: 'hunter', action: { id: 'hunt_cow' } })).toEqual({ kind: 'hunter', ref: 'hunt_cow' })
  })

  it('returns null for non-place-bound task types', () => {
    expect(activityRef({ type: 'pvp' })).toBeNull()
    expect(activityRef(null)).toBeNull()
    expect(activityRef({ type: 'combat' })).toBeNull() // missing monster
  })
})

describe('content -> place coverage', () => {
  it('maps every monster to at least one place', () => {
    for (const m of asArray(monstersData)) {
      expect(placesForActivity('combat', m.id).length, `monster ${m.id}`).toBeGreaterThan(0)
    }
  })

  it('maps every gather task to at least one place', () => {
    for (const t of GATHER_TASKS) {
      expect(placesForActivity('gather', t.id).length, `gather ${t.id}`).toBeGreaterThan(0)
    }
  })

  it('returns no places for unmapped content', () => {
    expect(placesForActivity('combat', 'no_such_monster')).toEqual([])
    expect(placesForActivity('skill', 'magic:no_such_spell')).toEqual([]) // fake ref
    expect(placesForActivity('skill', 'dungeoneering:dungeoneering_floor_1')).toEqual([]) // skill intentionally unmapped
  })
})

describe('facility-bound skills', () => {
  const bankPlaces = Object.keys(worldData.places).filter((id) => (worldData.places[id] as any).facilities?.includes('bank'))
  const furnacePlaces = Object.keys(worldData.places).filter((id) => (worldData.places[id] as any).facilities?.includes('furnace_anvil'))
  const noBank = Object.keys(worldData.places).filter((id) => !(worldData.places[id] as any).facilities?.includes('bank'))

  it('places a bank skill (cooking) at every bank place and nowhere else', () => {
    const places = placesForActivity('skill', 'cooking:cook_shrimp')
    expect(places.length).toBeGreaterThan(0)
    expect([...places].sort()).toEqual([...bankPlaces].sort())
  })

  it('places smithing only at furnace & anvil places', () => {
    const places = placesForActivity('skill', 'smithing:smelt_bronze')
    expect([...places].sort()).toEqual([...furnacePlaces].sort())
    // a bank-only place must NOT offer smithing
    for (const id of noBank) expect(places).not.toContain(id)
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
  // Pick a real mapping to drive the gate.
  const monster = asArray(monstersData)[0]
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

describe('describeActivity', () => {
  it('resolves human-readable names from refs', () => {
    const monster = asArray(monstersData)[0]
    expect(describeActivity('combat', monster.id).name).toBe(monster.name)
    expect(describeActivity('skill', 'mining:copper').name).toBeTruthy()
    expect(describeActivity('combat', 'no_such_monster').name).toBe('no_such_monster') // falls back to ref
  })
})
