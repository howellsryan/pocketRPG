import { describe, expect, it } from 'vitest'
import monstersData from '../src/data/monsters.json'
import worldData from '../src/data/world.json'
import raidsData from '../src/data/raids.json'
import {
  SLAYER_MASTERS,
  RAID_TASK_META,
  buildSlayerTask,
  isEntryEligible,
  meetsEntrySkillAndQuestGates,
  pickSlayerMonster,
} from '../src/engine/slayerMasters.js'

const monsters = monstersData as Record<string, any>
const raids = raidsData as Record<string, any>
const getEntryId = (entry: any) => (typeof entry === 'object' ? entry.id : entry)

// Every monster id that makes up any raid (sub-bosses and the final boss alike)
// — derived structurally from raids.json, not hand-copied, so a new raid or
// roster change can't silently desync this from the source data.
const raidMonsterIds = new Set<string>(
  Object.values(raids).flatMap(raid => Array.isArray(raid?.bosses) ? raid.bosses : [])
)

const druven = SLAYER_MASTERS.find(m => m.id === 'duradel')!
const zulKaar = SLAYER_MASTERS.find(m => m.id === 'zul_kaar')!

describe('Druven requirement drop', () => {
  it('now requires slayer 80 (Zul-Kaar outranks him)', () => {
    expect(druven.slayerReq).toBe(80)
  })

  it('description no longer claims to be the most prestigious master', () => {
    expect(druven.description.toLowerCase()).not.toContain('most prestigious')
    expect(druven.description).toContain('monster tasks')
  })
})

describe('Zul-Kaar slayer master', () => {
  it('exists, is homed at a real world place matching its display location, and requires slayer 85', () => {
    expect(zulKaar).toBeTruthy()
    expect(zulKaar.slayerReq).toBe(85)
    const place = (worldData.places as any)[zulKaar.placeId]
    expect(place, `zul_kaar placeId ${zulKaar.placeId}`).toBeTruthy()
    expect(place.name).toBe(zulKaar.location)
  })

  it('every non-raid boss:true monster appears in the pool directly, kill-count-gated ones included', () => {
    const pooledIds = new Set(zulKaar.monsterPool.map(getEntryId))
    const allBossIds = Object.keys(monsters).filter(id =>
      monsters[id]?.boss === true && !raidMonsterIds.has(id))
    const missing = allBossIds.filter(id => !pooledIds.has(id))
    expect(missing, `boss ids missing from zul_kaar pool: ${missing.join(', ')}`).toEqual([])
  })

  it('offers Zaryth once its four prerequisite bosses are down, and never before', () => {
    const zaryth = zulKaar.monsterPool.find(e => getEntryId(e) === 'zaryth_the_empty_lord')
    expect(zaryth, 'Zaryth missing from the boss-only master\'s pool').toBeTruthy()

    const required = Object.keys(monsters.zaryth_the_empty_lord.killCountRequirement)
    expect(required.length).toBeGreaterThan(0)
    const earned = Object.fromEntries(required.map(id => [id, 1]))
    expect(isEntryEligible(zaryth, 99, [], earned)).toBe(true)

    for (const missingId of required) {
      const short = { ...earned, [missingId]: 0 }
      expect(isEntryEligible(zaryth, 99, [], short), `eligible with no ${missingId} kill`).toBe(false)
    }
  })

  it('the 4 raid-final-bosses are represented as raid-completion proxy entries', () => {
    const pooledIds = new Set(zulKaar.monsterPool.map(getEntryId))
    for (const raidBossId of Object.keys(RAID_TASK_META)) {
      expect(pooledIds.has(raidBossId), `raid proxy ${raidBossId} missing from pool`).toBe(true)
    }
  })

  it('no raid monster is individually assignable — only a full raid clear via RAID_TASK_META, never a bare kill task for any raid sub-boss or final boss', () => {
    const pool = zulKaar.monsterPool
    for (const id of raidMonsterIds) {
      const entry = pool.find(e => getEntryId(e) === id)
      if (RAID_TASK_META[id]) {
        // Final bosses are allowed exactly once, and only as the [2,10] raid-clear proxy.
        expect(entry, `raid-final ${id} missing its raid-clear proxy entry`).toBeTruthy()
        expect((entry as any)?.taskRange, `raid-final ${id} proxy entry must carry the [2,10] taskRange override`).toEqual([2, 10])
      } else {
        // Every other raid sub-boss (e.g. Gorath the Infested) must not be assignable at all.
        expect(entry, `raid sub-boss ${id} must not appear as an individually assignable task`).toBeUndefined()
      }
    }
  })

  it('a raid-completion task displays the raid\'s own name, not its final boss\'s name', () => {
    for (const [bossId, meta] of Object.entries(RAID_TASK_META)) {
      const entry = zulKaar.monsterPool.find(e => getEntryId(e) === bossId)
      const task = buildSlayerTask(zulKaar, bossId, true, { rng: () => 0.5, entry })
      const raidName = (raids as any)[meta.raidId]?.name
      expect(raidName, `raid ${meta.raidId} has no name in raids.json`).toBeTruthy()
      expect(task.monsterName, `task for ${bossId} should show the raid name`).toBe(raidName)
      expect(task.monsterName).not.toBe(monsters[bossId]?.name)
    }
  })

  it('gates the Ashen Crucible behind an Ember Tyrant kill, even though its prerequisite is not in the content', () => {
    const crucible = zulKaar.monsterPool.find(e => getEntryId(e) === 'ashen_crucible')!
    expect(isEntryEligible(crucible, 99, [], {})).toBe(false)
    expect(isEntryEligible(crucible, 99, [], { ember_tyrant: 1 })).toBe(true)
  })

  it('keeps the gates a save can answer separable from the kill-count gate, so a display never asserts a lock it cannot check', () => {
    // The fail-closed default below is an ASSIGNMENT policy. A screen rendering
    // before the counts land must not use it, or it tells a player who has the
    // kills that they do not.
    const zaryth = zulKaar.monsterPool.find(e => getEntryId(e) === 'zaryth_the_empty_lord')!
    expect(meetsEntrySkillAndQuestGates(zaryth, 99, [])).toBe(true)
    expect(isEntryEligible(zaryth, 99, [])).toBe(false)
    // And it still reports the gates it CAN answer.
    const gated = zulKaar.monsterPool.find(e => monsters[getEntryId(e)]?.questRequirement)!
    expect(meetsEntrySkillAndQuestGates(gated, 99, [])).toBe(false)
  })

  it('fails CLOSED on kill-count gates for a caller that cannot see kill counts, rather than assigning a task nothing will start', () => {
    // Kill counts live in D1, never the save (§14), so a caller without them
    // cannot tell an earned boss from an unearned one.
    for (const id of ['zaryth_the_empty_lord', 'ashen_crucible']) {
      const entry = zulKaar.monsterPool.find(e => getEntryId(e) === id)!
      expect(isEntryEligible(entry, 99, []), `${id} offered with no kill counts`).toBe(false)
    }
    const history = new Map<string, string[]>()
    for (let i = 0; i < 300; i++) {
      const pick = pickSlayerMonster(zulKaar, 99, { history })!
      expect(['zaryth_the_empty_lord', 'ashen_crucible']).not.toContain(pick.monsterId)
    }
  })

  it('Ashen Crucible is always a single-kill task, like Ember Tyrant', () => {
    expect(buildSlayerTask(zulKaar, 'ashen_crucible', true, { rng: () => 0.999 }).totalCount).toBe(1)
    expect(buildSlayerTask(zulKaar, 'ember_tyrant', true, { rng: () => 0.999 }).totalCount).toBe(1)
  })

  it('every pool entry is flagged boss:true (Zul-Kaar is boss/raid-only)', () => {
    for (const entry of zulKaar.monsterPool) {
      expect(typeof entry === 'object' && entry.boss === true, `entry ${getEntryId(entry)} is not boss:true`).toBe(true)
    }
  })

  it('pickSlayerMonster only ever returns eligible boss entries from a boss-only pool', () => {
    const history = new Map<string, string[]>()
    // A player who has cleared everything: kill-count gates open, so the whole
    // pool is in play rather than silently minus its gated bosses.
    const bossKillCounts = Object.fromEntries(Object.keys(monsters).map(id => [id, 1]))
    for (let i = 0; i < 200; i++) {
      const pick = pickSlayerMonster(zulKaar, 99, { history, bossKillCounts })
      expect(pick).not.toBeNull()
      expect(pick!.isBoss).toBe(true)
      expect(isEntryEligible(pick!.entry, 99, undefined, bossKillCounts)).toBe(true)
    }
  })
})

describe('buildSlayerTask taskRange override', () => {
  it('rolls totalCount within [2,10] for a RAID_TASK_META-keyed entry override', () => {
    const entry = { id: 'the_great_olm', boss: true, taskRange: [2, 10] }
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const task = buildSlayerTask(zulKaar, entry.id, true, { rng: () => r, entry })
      expect(task.totalCount).toBeGreaterThanOrEqual(2)
      expect(task.totalCount).toBeLessThanOrEqual(10)
    }
  })

  it('a regular boss entry with no override still rolls within the masters bossTaskRange', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const task = buildSlayerTask(zulKaar, 'deepmaw_kraken', true, { rng: () => r })
      expect(task.totalCount).toBeGreaterThanOrEqual(zulKaar.bossTaskRange[0])
      expect(task.totalCount).toBeLessThanOrEqual(zulKaar.bossTaskRange[1])
    }
  })

  it('is purely additive: omitting options.entry leaves existing callers unaffected', () => {
    const withoutEntry = buildSlayerTask(druven, 'nether_demon', false, { rng: () => 0.5 })
    expect(withoutEntry.monsterId).toBe('nether_demon')
    expect(withoutEntry.totalCount).toBeGreaterThanOrEqual(druven.taskRange[0])
    expect(withoutEntry.totalCount).toBeLessThanOrEqual(druven.taskRange[1])
  })
})
