import { describe, expect, it } from 'vitest'
import monstersData from '../src/data/monsters.json'
import worldData from '../src/data/world.json'
import {
  SLAYER_MASTERS,
  RAID_TASK_META,
  buildSlayerTask,
  isEntryEligible,
  pickSlayerMonster,
} from '../src/engine/slayerMasters.js'

const monsters = monstersData as Record<string, any>
const getEntryId = (entry: any) => (typeof entry === 'object' ? entry.id : entry)

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

  it('every boss:true monster appears in the pool, either directly or via RAID_TASK_META', () => {
    const pooledIds = new Set(zulKaar.monsterPool.map(getEntryId))
    const allBossIds = Object.keys(monsters).filter(id => monsters[id]?.boss === true)
    const missing = allBossIds.filter(id => !pooledIds.has(id) && !RAID_TASK_META[id])
    expect(missing, `boss ids missing from zul_kaar pool: ${missing.join(', ')}`).toEqual([])
    // The 4 raid-final-bosses are represented as proxy entries, not left out entirely.
    for (const raidBossId of Object.keys(RAID_TASK_META)) {
      expect(pooledIds.has(raidBossId), `raid proxy ${raidBossId} missing from pool`).toBe(true)
    }
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
