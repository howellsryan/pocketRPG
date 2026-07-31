import { describe, expect, it } from 'vitest'
import monstersData from '../src/data/monsters.json'
import worldData from '../src/data/world.json'
import raidsData from '../src/data/raids.json'
import {
  SLAYER_MASTERS,
  RAID_TASK_META,
  buildSlayerTask,
  isEntryEligible,
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

  // Bosses gated on other bosses' kill counts are deliberately absent: this
  // pool's eligibility check reads slayer level and quests only, so assigning
  // one would hand out a task the combat gate refuses to start.
  it('every non-raid boss:true monster without a kill-count gate appears in the pool directly', () => {
    const pooledIds = new Set(zulKaar.monsterPool.map(getEntryId))
    const allBossIds = Object.keys(monsters).filter(id =>
      monsters[id]?.boss === true && !raidMonsterIds.has(id) && !(monsters[id] as any)?.killCountRequirement)
    const missing = allBossIds.filter(id => !pooledIds.has(id))
    expect(missing, `boss ids missing from zul_kaar pool: ${missing.join(', ')}`).toEqual([])
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
    for (let i = 0; i < 200; i++) {
      const pick = pickSlayerMonster(zulKaar, 99, { history })
      expect(pick).not.toBeNull()
      expect(pick!.isBoss).toBe(true)
      expect(isEntryEligible(pick!.entry, 99)).toBe(true)
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
