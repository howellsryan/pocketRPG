import { describe, it, expect } from 'vitest'
import { bossEntryFailure, bossHasEntryGate, completedQuestIds, loadBossKillCounts } from '../functions/_lib/game/bossEntry.js'
import { completedQuestsFromSave } from '../src/engine/questGates.js'
import { worldLairMonster, worldLairZone, WORLD_MONSTER_LAIRS } from '../src/engine/worldLairs.js'
import { createCoopMember } from '../src/engine/coopBossEngine.js'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'

/**
 * The server-side boss gate reads a player's progression out of two places, and
 * both were wrong. These are the shapes that actually exist at runtime — a save
 * carries quests under `settings` and carries NO kill counts at all, because
 * saveload.js strips them (they live in the kill_counts table).
 */
const realSave = (settings: Record<string, unknown> = {}, stats: Record<string, unknown> = {}) => ({
  version: 1,
  stats: { slayer: { xp: 13034431 }, ...stats },
  inventory: [],
  equipment: {},
  settings: { completedQuests: [], ...settings },
})

describe('completedQuestsFromSave — where quests actually live', () => {
  it('reads settings.completedQuests', () => {
    expect([...completedQuestsFromSave(realSave({ completedQuests: ['a', 'b'] }))]).toEqual(['a', 'b'])
  })

  it('falls back to the top level for save shapes that predate the split', () => {
    expect([...completedQuestsFromSave({ completedQuests: ['legacy'] })]).toEqual(['legacy'])
  })

  it('accepts the object form a blob deserialises to, keeping only the true keys', () => {
    expect([...completedQuestsFromSave(realSave({ completedQuests: { done: true, skipped: false } }))]).toEqual(['done'])
  })

  it('prefers settings over a stale top-level copy rather than merging them', () => {
    const save = { ...realSave({ completedQuests: ['fresh'] }), completedQuests: ['stale'] }
    expect([...completedQuestsFromSave(save)]).toEqual(['fresh'])
  })

  it('is an empty set for junk, never a throw', () => {
    for (const junk of [null, undefined, {}, { settings: {} }, { settings: { completedQuests: 7 } }]) {
      expect(completedQuestsFromSave(junk as never).size).toBe(0)
    }
  })

  it('is the same function the co-op gate uses', () => {
    expect(completedQuestIds).toBe(completedQuestsFromSave)
  })
})

describe('bossEntryFailure — the gate a crafted request has to pass', () => {
  it('enforces a quest requirement held under settings', () => {
    // Reading completedQuests off the top level saw {} for every real save, so
    // this gate passed for everyone — it never refused anybody.
    expect(bossEntryFailure('corporeal_horror', realSave(), {})).not.toBeNull()
    expect(bossEntryFailure('corporeal_horror', realSave({ completedQuests: ['the_heart_of_shadows'] }), {})).toBeNull()
  })

  it('enforces a kill-count requirement from the counts it is handed', () => {
    expect(bossEntryFailure('ashen_crucible', realSave(), {})).not.toBeNull()
    expect(bossEntryFailure('ashen_crucible', realSave(), { ember_tyrant: 1 })).toBeNull()
  })

  it('does NOT accept kill counts smuggled in on the save blob', () => {
    const save = { ...realSave(), bossKillCounts: { ember_tyrant: 99 } }
    expect(bossEntryFailure('ashen_crucible', save, {})).not.toBeNull()
  })

  it('opens Zaryth exactly when all four generals are on record', () => {
    const generals = ['warlord_grondar', 'commander_zephyra', 'krylth_the_defiler', 'skyrender_kharra']
    const all = Object.fromEntries(generals.map((id) => [id, 1]))
    expect(bossEntryFailure('zaryth_the_empty_lord', realSave(), all)).toBeNull()
    for (const missing of generals) {
      const partial = { ...all }
      delete partial[missing]
      const gate = bossEntryFailure('zaryth_the_empty_lord', realSave(), partial)
      expect(gate, `missing ${missing} should lock`).not.toBeNull()
      expect(gate!.reason).toContain('Zaryth')
    }
  })

  it('enforces the slayer level, read from the save\'s stats', () => {
    const noSlayer = realSave({ completedQuests: ['gorilla_slayer_ii'] }, { slayer: { xp: 0 } })
    expect(bossEntryFailure('hellbound_gorilla', noSlayer, {})?.reason).toMatch(/Slayer level/)
    expect(bossEntryFailure('hellbound_gorilla', realSave({ completedQuests: ['gorilla_slayer_ii'] }), {})).toBeNull()
  })

  it('refuses a boss that does not exist', () => {
    expect(bossEntryFailure('not_a_boss', realSave(), {})).not.toBeNull()
  })
})

describe('loadBossKillCounts — the authoritative table, not the blob', () => {
  const envWith = (rows: unknown) => ({
    DB: {
      prepare: (sql: string) => {
        expect(sql).toContain('kill_counts')
        // Raid counts share the table; a boss gate must not see them.
        expect(sql).toContain("source_type = 'monsters'")
        return { bind: () => ({ all: async () => rows }) }
      },
    },
  })

  it('projects rows into the id → count map the gate expects', async () => {
    const counts = await loadBossKillCounts(
      envWith({ results: [{ source_id: 'ember_tyrant', kill_count: 12 }] }) as never, 1,
    )
    expect(counts).toEqual({ ember_tyrant: 12 })
  })

  it('survives an empty or malformed result without throwing', async () => {
    expect(await loadBossKillCounts(envWith({ results: [] }) as never, 1)).toEqual({})
    expect(await loadBossKillCounts(envWith({}) as never, 1)).toEqual({})
    expect(await loadBossKillCounts(
      envWith({ results: [{ source_id: null, kill_count: 3 }, { source_id: 'x', kill_count: -5 }] }) as never, 1,
    )).toEqual({ x: 0 })
  })
})

describe('worldLairMonster — the inverse the world-entry gate needs', () => {
  it('round-trips every authored lair', () => {
    for (const [monsterId, zone] of Object.entries(WORLD_MONSTER_LAIRS)) {
      expect(worldLairZone(monsterId)).toBe(zone)
      // A shared room answers with one of its occupants, which must be a real one.
      expect(WORLD_MONSTER_LAIRS[worldLairMonster(zone)!]).toBe(zone)
    }
  })

  it('answers with one occupant for a room several monsters share', () => {
    const roost = worldLairMonster('dragon_roost')
    expect(['green_dragon', 'red_dragon', 'black_dragon']).toContain(roost)
  })

  it('is null for a zone that is not a lair', () => {
    expect(worldLairMonster('overworld')).toBeNull()
    expect(worldLairMonster('')).toBeNull()
    expect(worldLairMonster(undefined as never)).toBeNull()
  })

  it('maps Zaryth to its throne', () => {
    expect(worldLairMonster('zaryth_throne')).toBe('zaryth_the_empty_lord')
  })
})

describe('a co-op member carries the quests they actually completed', () => {
  it('reads them from settings, so gated gear stays equippable mid-fight', () => {
    // createCoopMember read the top level, so every member joined with an empty
    // quest list — and the equip intent fails CLOSED, which made quest-gated
    // gear unequippable inside a fight for everyone.
    const member = createCoopMember({
      characterId: 1,
      username: 'p',
      savePayload: {
        stats: {},
        inventory: [],
        equipment: {},
        settings: { completedQuests: ['dragon_slayer'] },
      },
      itemsData,
      now: 0,
    })
    expect(member.completedQuests).toEqual(['dragon_slayer'])
  })
})

describe('skipping the gate work for a lair that has no gate', () => {
  it('answers false only for a monster nothing stands in the way of', () => {
    // Every world lair pays a save read and a kill_counts query to prove its
    // gate — but most of them gate nothing at all (the cow pasture, the fiend
    // pit, the dragon roost), and two D1 round-trips to learn that is waste.
    expect(bossHasEntryGate('zaryth_the_empty_lord'), 'Zaryth gates on four kill counts').toBe(true)
    // Six of the seven shipped lairs gate nothing — Grondar included.
    expect(bossHasEntryGate('warlord_grondar')).toBe(false)
    expect(bossHasEntryGate('pasture_bull')).toBe(false)
    // An unknown id is never waved through — the caller still has to ask.
    expect(bossHasEntryGate('no_such_monster')).toBe(true)
  })

  it('does not skip the Ashen Crucible, whose prerequisite is hardcoded rather than authored', () => {
    // It carries no killCountRequirement field, so a raw field check reads
    // "ungated" and skips the very query that would enforce its Ember Tyrant
    // gate. Unreachable while no lair points at it — and that is exactly how
    // long a wrong answer here stays invisible.
    expect((monstersData as Record<string, any>).ashen_crucible.killCountRequirement).toBeUndefined()
    expect(bossHasEntryGate('ashen_crucible')).toBe(true)
    expect(bossEntryFailure('ashen_crucible', realSave(), {})?.reason)
      .toBe('Defeat Ember Tyrant first to unlock Ashen Crucible')
    expect(bossEntryFailure('ashen_crucible', realSave(), { ember_tyrant: 1 })).toBeNull()
  })

  it('never skips a lair whose monster the gate would actually refuse', () => {
    // Derived, not enumerated: any lair monster carrying a requirement must be
    // answered `true`, so adding a gate to an existing lair cannot silently
    // route around the check.
    for (const monsterId of Object.keys(WORLD_MONSTER_LAIRS)) {
      const monster = (monstersData as Record<string, Record<string, unknown>>)[monsterId]
      const gated = !!(monster.questRequirement || monster.slayerRequirement || monster.killCountRequirement)
        || !!bossEntryFailure(monsterId, realSave(), {})
      expect(bossHasEntryGate(monsterId), `${monsterId}`).toBe(gated)
    }
  })
})
