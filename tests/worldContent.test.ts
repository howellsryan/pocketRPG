import { describe, it, expect } from 'vitest'
import {
  activityRef,
  autoStartFromTask,
  placesForActivity,
  resolveActivityStart,
  resolveTaskStart,
  describeActivity,
  isPlaceVaryingSkillRef,
  activityLevelRequirement,
  activityLockReason,
  activityGroupLabel,
  activityLocationLabel,
  placeActivities,
} from '../src/engine/worldContent.js'
import worldData from '../src/data/world.json'
import farmingData from '../src/data/farming.json'
import monstersData from '../src/data/monsters.json'
import skillsData from '../src/data/skills.json'
import raidsData from '../src/data/raids.json'
import minigamesData from '../src/data/minigames.json'
import questsData from '../src/data/quests.json'
import { GATHER_TASKS } from '../src/engine/gatherTasks.js'
import { SLAYER_MASTERS } from '../src/engine/slayerMasters.js'
import { getXPForLevel } from '../src/engine/experience.js'
import { COMPLEXITY_ORDER } from '../src/utils/complexityColors.js'

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
    expect(activityRef({ type: 'farming', location: { id: 'falador' } })).toEqual({ kind: 'farming', ref: 'falador' })
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
  })

  it('places every dungeoneering floor at exactly one place, spread by level like mining/woodcutting', () => {
    for (const a of asArray(skillsData.dungeoneering?.actions).filter((a: any) => a.category !== 'reward')) {
      expect(placesForActivity('skill', `dungeoneering:${a.id}`).length, a.id).toBe(1)
    }
  })

  it('leaves dungeoneering reward actions unmapped (an instant token spend, never location-gated)', () => {
    for (const a of asArray(skillsData.dungeoneering?.actions).filter((a: any) => a.category === 'reward')) {
      expect(placesForActivity('skill', `dungeoneering:${a.id}`), a.id).toEqual([])
    }
  })

  it('grows magic trees at Camlann in addition to wherever the level band placed them', () => {
    const places = placesForActivity('skill', 'woodcutting:magic')
    expect(places).toContain('camlann')
    expect(places.length).toBeGreaterThan(1)
  })

  it('activityLocationLabel names the place(s) for place-varying activities, null for facility skills', () => {
    expect(activityLocationLabel('skill', 'smithing:smith_bronze_dagger')).toBeNull()
    expect(activityLocationLabel('skill', 'woodcutting:magic')).toBe('Ardounne · Camlann')
    const dngLabel = activityLocationLabel('skill', 'dungeoneering:dungeoneering_floor_1')
    expect(typeof dngLabel).toBe('string')
    expect(dngLabel).not.toBe('')
  })

  it('maps every quest to exactly one place', () => {
    for (const q of asArray(questsData)) {
      expect(placesForActivity('quest', q.id).length, `quest ${q.id}`).toBe(1)
    }
  })

  it('maps every slayer master to exactly its home place', () => {
    for (const m of SLAYER_MASTERS) {
      expect(placesForActivity('slayer', m.id), `master ${m.id}`).toEqual([(m as any).placeId])
    }
  })

  it('maps every farm to exactly the world place it names, and only farm places offer farming', () => {
    const farmPlaces = new Set<string>()
    for (const loc of asArray(farmingData.locations)) {
      expect((worldData as any).places[loc.placeId], `farm ${loc.id} placeId ${loc.placeId}`).toBeTruthy()
      expect(placesForActivity('farming', loc.id), `farm ${loc.id}`).toEqual([loc.placeId])
      farmPlaces.add(loc.placeId)
    }
    // No place without a farm offers a farming activity.
    for (const id of Object.keys((worldData as any).places)) {
      const hasFarming = placeActivities(id).some((a: any) => a.kind === 'farming')
      expect(hasFarming, `place ${id} farming`).toBe(farmPlaces.has(id))
    }
  })
})

describe('slayer masters as place activities', () => {
  const statsAt = (levels: Record<string, number>) =>
    Object.fromEntries(Object.entries(levels).map(([s, l]) => [s, { xp: getXPForLevel(l) }]))

  it('derives gating/resume refs from the slayermaster task shape', () => {
    expect(activityRef({ type: 'slayermaster', master: { id: 'turael' } })).toEqual({ kind: 'slayer', ref: 'turael' })
    expect(autoStartFromTask({ type: 'slayermaster', master: { id: 'turael' } })).toEqual({ kind: 'slayer', masterId: 'turael' })
    expect(activityRef({ type: 'slayermaster' })).toBeNull()
    expect(autoStartFromTask({ type: 'slayermaster' })).toBeNull()
  })

  it('describes masters by name with their icon', () => {
    const nieve = SLAYER_MASTERS.find((m) => m.id === 'nieve')!
    const d = describeActivity('slayer', 'nieve')
    expect(d.name).toContain(nieve.name)
    expect(d.icon).toBe(nieve.icon)
    expect(describeActivity('slayer', 'no_such_master').name).toBe('no_such_master')
  })

  it('locks masters by their combat/slayer requirements', () => {
    // duradel gates on slayer 90, vannaka on combat 40, turael on nothing
    expect(activityLockReason('slayer', 'duradel', { stats: statsAt({ slayer: 89 }) })?.reason).toContain('Slayer level 90')
    expect(activityLockReason('slayer', 'duradel', { stats: statsAt({ slayer: 90 }) })).toBeNull()
    expect(activityLockReason('slayer', 'vannaka', { stats: statsAt({}) })?.reason).toContain('combat level 40')
    expect(activityLockReason('slayer', 'turael', { stats: statsAt({}) })).toBeNull()
    expect(activityLockReason('slayer', 'no_such_master', {})?.reason).toBe('Unknown slayer master')
  })
})

describe('facility-bound skills', () => {
  const hasFacility = (id: string, f: string) => (worldData.places[id] as any).facilities?.includes(f)
  const bankPlaces = Object.keys(worldData.places).filter((id) => hasFacility(id, 'bank'))
  const furnacePlaces = Object.keys(worldData.places).filter((id) => hasFacility(id, 'furnace_anvil'))
  const stovePlaces = Object.keys(worldData.places).filter((id) => hasFacility(id, 'stove'))
  const altarPlaces = Object.keys(worldData.places).filter((id) => hasFacility(id, 'altar'))
  const noAltar = Object.keys(worldData.places).filter((id) => !hasFacility(id, 'altar'))
  const noFurnace = Object.keys(worldData.places).filter((id) => !hasFacility(id, 'furnace_anvil'))

  it('places a bank skill (crafting) at every bank place and nowhere else', () => {
    const places = placesForActivity('skill', 'crafting:tan_cowhide')
    expect(places.length).toBeGreaterThan(0)
    expect([...places].sort()).toEqual([...bankPlaces].sort())
  })

  it('places cooking at every stove place and nowhere else', () => {
    const places = placesForActivity('skill', 'cooking:cook_shrimp')
    expect(places.length).toBeGreaterThan(0)
    expect([...places].sort()).toEqual([...stovePlaces].sort())
  })

  it('places prayer at every altar place and nowhere else', () => {
    const places = placesForActivity('skill', 'prayer:bury_bones')
    expect(places.length).toBeGreaterThan(0)
    expect([...places].sort()).toEqual([...altarPlaces].sort())
  })

  it('places smithing only at furnace & anvil places', () => {
    const places = placesForActivity('skill', 'smithing:smelt_bronze')
    expect([...places].sort()).toEqual([...furnacePlaces].sort())
    // a place without a furnace & anvil must NOT offer smithing
    for (const id of noFurnace) expect(places).not.toContain(id)
  })

  it('spreads thieving targets across places instead of offering them all everywhere', () => {
    const npcs = (skillsData as any).thieving.npcs
    for (const n of npcs) {
      const places = placesForActivity('thieving', n.id)
      expect(places.length, `thieving ${n.id}`).toBeGreaterThan(0)
      expect(places.length, `thieving ${n.id} should not be at every bank place`).toBeLessThan(bankPlaces.length)
    }
  })

  it('places the Ardounne Knight only in Ardounne', () => {
    expect(placesForActivity('thieving', 'ardougne_knight')).toEqual(['ardounne'])
  })

  it('does not offer a facility skill at a place without the facility', () => {
    for (const id of noAltar) {
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
    expect(autoStartFromTask({ type: 'farming', location: { id: 'catherby' } })).toEqual({ kind: 'farming', locationId: 'catherby' })
  })

  it('returns null for untracked or empty tasks', () => {
    expect(autoStartFromTask(null)).toBeNull()
    expect(autoStartFromTask({ type: 'pvp' })).toBeNull()
    expect(autoStartFromTask({ type: 'combat' })).toBeNull()
  })
})

describe('isPlaceVaryingSkillRef', () => {
  it('excludes facility-bound skills that are identical at every place that offers them', () => {
    expect(isPlaceVaryingSkillRef('construction:workbench')).toBe(false)
    expect(isPlaceVaryingSkillRef('crafting:cut_gem')).toBe(false)
    expect(isPlaceVaryingSkillRef('smithing:smelt_bronze')).toBe(false)
  })

  it('includes level-banded skills that differ by place', () => {
    expect(isPlaceVaryingSkillRef('mining:copper')).toBe(true)
    expect(isPlaceVaryingSkillRef('woodcutting:oak')).toBe(true)
  })
})

describe('activityLevelRequirement', () => {
  it('returns the skill + level for a levelled skill ref', () => {
    const action = (skillsData as any).mining.actions.find((a: any) => (a.level || 1) > 1)
    expect(activityLevelRequirement('skill', `mining:${action.id}`)).toEqual({ skill: 'mining', level: action.level })
  })

  it('returns null for level-1 refs and kinds without a start-time level lock', () => {
    const lvl1 = (skillsData as any).mining.actions.find((a: any) => (a.level || 1) <= 1)
    expect(activityLevelRequirement('skill', `mining:${lvl1.id}`)).toBeNull()
    expect(activityLevelRequirement('combat', regularMonster.id)).toBeNull() // combatLevel is not a requirement
    expect(activityLevelRequirement('gather', 'collect_sand')).toBeNull()
    expect(activityLevelRequirement('minigame', 'pest_control')).toBeNull()
    expect(activityLevelRequirement('skill', 'not-a-ref')).toBeNull() // no skill:action separator
  })

  it('gates agility / thieving / hunter by their own skill level', () => {
    for (const kind of ['agility', 'thieving', 'hunter'] as const) {
      const list = kind === 'thieving' ? (skillsData as any).thieving.npcs : (skillsData as any)[kind].actions
      const levelled = asArray(list).find((a: any) => (a.level || 1) > 1)
      if (!levelled) continue
      expect(activityLevelRequirement(kind, levelled.id)).toEqual({ skill: kind, level: levelled.level })
    }
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
    expect(describeActivity('farming', 'falador').name).toBe('Faloden Farm') // farm named for its place
    expect(describeActivity('farming', 'no_such_farm').name).toBe('no_such_farm')
  })

  it('describes quests with their complexity (rank as sort level, name as group label)', () => {
    const quest = asArray(questsData)[0]
    const d = describeActivity('quest', quest.id)
    expect(d.name).toBe(quest.name)
    expect(d.complexity).toBe(quest.complexity)
    expect(d.level).toBe(COMPLEXITY_ORDER[quest.complexity])
    expect(activityGroupLabel('quest', quest.id)).toBe(quest.complexity)
    expect(describeActivity('quest', 'no_such_quest').name).toBe('no_such_quest')
  })
})

describe('activityLockReason', () => {
  const statsAt = (levels: Record<string, number>) =>
    Object.fromEntries(Object.entries(levels).map(([s, l]) => [s, { xp: getXPForLevel(l) }]))

  it('locks levelled skill refs below the requirement and unlocks at it', () => {
    const action = (skillsData as any).mining.actions.find((a: any) => (a.level || 1) > 1)
    const ref = `mining:${action.id}`
    const locked = activityLockReason('skill', ref, { stats: statsAt({ mining: action.level - 1 }) })
    expect(locked?.reason).toContain(`Mining level ${action.level}`)
    expect(activityLockReason('skill', ref, { stats: statsAt({ mining: action.level }) })).toBeNull()
  })

  it('locks slayer-gated monsters via the combat requirement checks', () => {
    const gated = asArray(monstersData).find((m: any) => m.slayerRequirement > 1 && !raidBossIds.has(m.id))
    if (!gated) return
    const locked = activityLockReason('combat', gated.id, { stats: statsAt({ slayer: 1 }) })
    expect(locked?.reason).toContain(`Slayer level ${gated.slayerRequirement}`)
    expect(activityLockReason('combat', gated.id, { stats: statsAt({ slayer: gated.slayerRequirement }) })).toBeNull()
  })

  it('marks completed quests done and ineligible quests locked with the reasons', () => {
    const quest = asArray(questsData).find((q: any) => Object.keys(q.skillRequirements || {}).length > 0 && (q.questRequirements || []).length === 0 && !q.questPointRequirement && !q.combatLevelRequirement)
    expect(quest).toBeTruthy()
    expect(activityLockReason('quest', quest.id, { completedQuests: new Set([quest.id]) })).toMatchObject({ completed: true })
    const locked = activityLockReason('quest', quest.id, { stats: statsAt({}), completedQuests: new Set() })
    expect(locked?.reason).toMatch(/^Requires /)
    // Meeting every skill requirement unlocks it.
    const levels = Object.fromEntries(Object.entries(quest.skillRequirements).map(([s, l]) => [s, l]))
    expect(activityLockReason('quest', quest.id, { stats: statsAt(levels as any), completedQuests: new Set() })).toBeNull()
    expect(activityLockReason('quest', 'no_such_quest', {})?.reason).toBe('Unknown quest')
  })

  it('leaves ungated kinds unlocked', () => {
    expect(activityLockReason('gather', 'collect_sand', {})).toBeNull()
    expect(activityLockReason('minigame', 'pest_control', {})).toBeNull()
    const freeMonster = asArray(monstersData).find((m: any) => !m.slayerRequirement && !m.questRequirement && m.id !== 'ashen_crucible' && !raidBossIds.has(m.id))
    expect(activityLockReason('combat', freeMonster.id, { stats: statsAt({}) })).toBeNull()
  })
})
