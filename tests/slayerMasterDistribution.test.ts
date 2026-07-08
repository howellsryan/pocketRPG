import { describe, it, expect } from 'vitest'
import monstersData from '../src/data/monsters.json'
import worldData from '../src/data/world.json'
import {
  SLAYER_MASTERS,
  resolveTaskMonsterIds,
  isEntryEligible,
  pickSlayerMonster,
} from '../src/engine/slayerMasters.js'

const monsters = monstersData as Record<string, any>

const getEntryId = (entry: any) => (typeof entry === 'object' ? entry.id : entry)

// Every assignable monster: not a boss and not a raid boss.
const assignableIds = Object.entries(monsters)
  .filter(([, m]: [string, any]) => !m.boss && !m.raidBoss)
  .map(([id]) => id)

// All monster ids referenced by any master pool (excluding composite task ids).
const pooledMonsterIds = new Set<string>()
for (const master of SLAYER_MASTERS) {
  for (const entry of master.monsterPool) {
    resolveTaskMonsterIds(getEntryId(entry)).forEach(id => pooledMonsterIds.add(id))
  }
}

describe('Slayer master monster coverage', () => {
  it('includes every non-boss, non-raid monster on at least one master', () => {
    const missing = assignableIds.filter(id => !pooledMonsterIds.has(id))
    expect(missing, `unassigned monsters: ${missing.join(', ')}`).toEqual([])
  })

  it('includes every Slayer-gated monster on at least one master', () => {
    // Any monster that requires a Slayer level to fight must be assignable as a
    // task somewhere — including boss-flagged slayer monsters (e.g. Hellbound
    // Gorilla), which the non-boss coverage check above deliberately skips. Raid
    // bosses are excluded: they're killed via the raid flow, not slayer tasks.
    const slayerGated = Object.entries(monsters)
      .filter(([, m]: [string, any]) => (m.slayerRequirement || 0) > 0 && !m.raidBoss)
      .map(([id]) => id)
    const missing = slayerGated.filter(id => !pooledMonsterIds.has(id))
    expect(missing, `unassigned slayer monsters: ${missing.join(', ')}`).toEqual([])
  })

  it('never assigns a boss or raid monster as a plain (non-boss) task', () => {
    for (const master of SLAYER_MASTERS) {
      for (const entry of master.monsterPool) {
        const id = getEntryId(entry)
        const isBossEntry = typeof entry === 'object' && !!entry.boss
        if (isBossEntry) continue
        for (const resolved of resolveTaskMonsterIds(id)) {
          const m = monsters[resolved]
          // composite/boss task ids may not exist directly in monsters.json
          if (!m) continue
          expect(m.raidBoss, `${resolved} is a raid boss assigned as a normal task`).not.toBe(true)
          expect(m.boss, `${resolved} is a boss assigned as a normal task`).not.toBe(true)
        }
      }
    }
  })

  it('orders masters with non-decreasing combat/slayer gating', () => {
    // Each successive master should be gated at least as high as the previous.
    for (let i = 1; i < SLAYER_MASTERS.length; i++) {
      const prev = SLAYER_MASTERS[i - 1]
      const cur = SLAYER_MASTERS[i]
      const prevGate = prev.combatReq + prev.slayerReq
      const curGate = cur.combatReq + cur.slayerReq
      expect(curGate).toBeGreaterThanOrEqual(prevGate)
    }
  })

  it('homes every master at a real world place whose name matches its display location', () => {
    for (const master of SLAYER_MASTERS) {
      const place = (worldData.places as any)[(master as any).placeId]
      expect(place, `master ${master.id} placeId ${(master as any).placeId}`).toBeTruthy()
      expect(place.name).toBe((master as any).location)
    }
  })

  it('places monsters on masters appropriate to their tier (low-level on Torvak)', () => {
    const torvak = SLAYER_MASTERS.find(m => m.id === 'turael')!
    for (const entry of torvak.monsterPool) {
      const id = getEntryId(entry)
      // The starter master should not require slayer levels or assign high-combat monsters.
      const m = monsters[id]
      expect(m).toBeDefined()
      expect(m.combatLevel).toBeLessThanOrEqual(40)
    }
  })
})

describe('quest-gated task eligibility', () => {
  // Monsters carrying a questRequirement that also live in a master pool.
  const questGated = Object.entries(monsters)
    .filter(([, m]: [string, any]) => m.questRequirement && pooledMonsterIds.has((m as any).id || ''))
    .map(([id, m]: [string, any]) => [id, m.questRequirement]) as [string, string][]

  it('has at least one quest-gated pool monster to guard', () => {
    expect(questGated.length).toBeGreaterThan(0)
  })

  it('treats a quest-gated monster as ineligible without the quest, eligible with it', () => {
    for (const [id, questId] of questGated) {
      const lvl = (monsters[id].slayerRequirement || 0) + 0
      expect(isEntryEligible(id, lvl, new Set())).toBe(false)
      expect(isEntryEligible(id, lvl, new Set([questId]))).toBe(true)
    }
  })

  it('skips quest gating entirely when completedQuests is omitted (back-compat)', () => {
    for (const [id] of questGated) {
      expect(isEntryEligible(id, monsters[id].slayerRequirement || 1)).toBe(true)
    }
  })

  it('pickSlayerMonster never assigns a quest-gated task without the quest', () => {
    const druven = SLAYER_MASTERS.find(m => m.id === 'duradel')!
    const gatedIds = new Set(questGated.map(([id]) => id))
    const history = new Map<string, string[]>()
    for (let i = 0; i < 300; i++) {
      const pick = pickSlayerMonster(druven, 99, { history, completedQuests: new Set() })
      if (!pick) continue
      expect(gatedIds.has(pick.monsterId)).toBe(false)
    }
  })
})

describe('pickSlayerMonster eligibility', () => {
  it('only returns monsters whose slayer requirement is met', () => {
    const druven = SLAYER_MASTERS.find(m => m.id === 'duradel')!
    const history = new Map<string, string[]>()
    // A slayer-90 player can be eligible for everything except the >90 requirement gate.
    for (let i = 0; i < 200; i++) {
      const pick = pickSlayerMonster(druven, 90, { history })
      expect(pick).not.toBeNull()
      expect(isEntryEligible(pick!.entry, 90)).toBe(true)
    }
  })

  it('returns null when no pool monster is eligible', () => {
    // Synthetic master whose every monster is gated above the player's level.
    // (nightfang_beast requires slayer 90, marshscale_shaman requires 80.)
    const gatedMaster: any = {
      id: 'test_gated',
      monsterPool: ['nightfang_beast', 'marshscale_shaman'],
    }
    const pick = pickSlayerMonster(gatedMaster, 1, { history: new Map() })
    expect(pick).toBeNull()
  })
})

describe('pickSlayerMonster even distribution', () => {
  it('cycles through every eligible monster before repeating any', () => {
    const valdrin = SLAYER_MASTERS.find(m => m.id === 'vannaka')!
    const slayerLevel = 99
    const eligible = valdrin.monsterPool.filter(e => isEntryEligible(e, slayerLevel))
    const history = new Map<string, string[]>()

    // Force a deterministic "always pick first available" rng.
    const rng = () => 0
    const seen = new Set<string>()
    let lastId: string | null = null
    for (let i = 0; i < eligible.length; i++) {
      const pick = pickSlayerMonster(valdrin, slayerLevel, { history, rng })!
      expect(pick.monsterId).not.toBe(lastId) // no immediate repeat
      seen.add(pick.monsterId)
      lastId = pick.monsterId
    }
    // Over one full cycle every eligible monster appears exactly once.
    expect(seen.size).toBe(eligible.length)
  })

  it('spreads assignments roughly evenly over many rolls', () => {
    const caelira = SLAYER_MASTERS.find(m => m.id === 'chaeldar')!
    const slayerLevel = 99
    const eligible = caelira.monsterPool.filter(e => isEntryEligible(e, slayerLevel))
    const history = new Map<string, string[]>()

    let seed = 12345
    const rng = () => {
      // simple deterministic LCG for repeatable test runs
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    const counts = new Map<string, number>()
    const rolls = eligible.length * 50
    for (let i = 0; i < rolls; i++) {
      const pick = pickSlayerMonster(caelira, slayerLevel, { history, rng })!
      counts.set(pick.monsterId, (counts.get(pick.monsterId) || 0) + 1)
    }

    // Every eligible monster should have been assigned.
    expect(counts.size).toBe(eligible.length)
    // No monster should dominate: with even cycling, each lands within a tight band.
    const expected = rolls / eligible.length
    for (const count of counts.values()) {
      expect(count).toBeGreaterThanOrEqual(expected * 0.5)
      expect(count).toBeLessThanOrEqual(expected * 1.5)
    }
  })
})
