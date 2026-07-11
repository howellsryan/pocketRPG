import { describe, it, expect } from 'vitest'
import pool from '../src/data/dailyTasks.json'
import monstersData from '../src/data/monsters.json'
import itemsData from '../src/data/items.json'
import raidsData from '../src/data/raids.json'
import gameIcons from '../src/data/gameIcons.json'
import bespokeIcons from '../src/data/bespokeIcons.json'
import { MONSTER_ART, getMonsterArt } from '../src/utils/combatArt.js'

const TIERS = ['Novice', 'Intermediate', 'Experienced', 'Master', 'Grandmaster']

describe('dailyTasks.json pool integrity', () => {
  it('has at least 1 task per tier', () => {
    for (const tier of TIERS) {
      const count = pool.filter(t => t.tier === tier).length
      expect(count, `tier ${tier}`).toBeGreaterThanOrEqual(1)
    }
  })

  it('has at least 12 tasks per tier', () => {
    for (const tier of TIERS) {
      const count = pool.filter(t => t.tier === tier).length
      expect(count, `tier ${tier} has fewer than 12`).toBeGreaterThanOrEqual(12)
    }
  })

  it('has unique ids', () => {
    const ids = pool.map(t => t.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('every monsterId resolves in monsters.json', () => {
    const monsterTriggers = pool.filter(t => t.trigger?.monsterId && t.trigger.monsterId !== 'any')
    for (const task of monsterTriggers) {
      expect(monstersData, `${task.id}: monsterId "${task.trigger.monsterId}" not in monsters.json`)
        .toHaveProperty(task.trigger.monsterId)
    }
  })

  it('every itemId resolves in items.json', () => {
    const itemTriggers = pool.filter(t => t.trigger?.itemId)
    for (const task of itemTriggers) {
      expect(itemsData, `${task.id}: itemId "${task.trigger.itemId}" not in items.json`)
        .toHaveProperty(task.trigger.itemId)
    }
  })

  it('every task has a valid trigger type', () => {
    const validTypes = new Set([
      'monster_kill', 'boss_kill', 'raid_complete',
      'skill_produce', 'skill_gather', 'skill_xp',
      'clue_complete', 'minigame_complete', 'quest_complete', 'slayer_task_complete',
      'hunter_hunt',
    ])
    for (const task of pool) {
      expect(validTypes, `${task.id}: unknown trigger type "${task.trigger?.type}"`)
        .toContain(task.trigger?.type)
    }
  })

  it('target is a positive integer', () => {
    for (const task of pool) {
      const t = task.trigger?.target ?? 1
      expect(Number.isInteger(t) && t > 0, `${task.id}: target "${t}" not positive integer`).toBe(true)
    }
  })

  // Kill tasks render their icon via getMonsterArt (DailyTasksModal); every
  // targeted monster needs a curated MONSTER_ART entry with a real glyph, or
  // the modal falls back to the 📦 default.
  it('every kill task monster has combat art with a real glyph', () => {
    const killTasks = pool.filter(t => t.trigger?.type === 'monster_kill' || t.trigger?.type === 'boss_kill')
    for (const task of killTasks) {
      const id = task.trigger.monsterId
      expect(MONSTER_ART, `${task.id}: monsterId "${id}" has no MONSTER_ART entry`).toHaveProperty(id)
      const art = getMonsterArt({ id })
      const hasGlyph = art.icon in gameIcons || art.icon in bespokeIcons
      expect(hasGlyph, `${task.id}: art icon "${art.icon}" not in gameIcons/bespokeIcons`).toBe(true)
    }
  })

  // Non-kill tasks render `icon` directly as a GameIcon glyph key.
  it('every non-kill task icon resolves to a glyph', () => {
    const rest = pool.filter(t => t.trigger?.type !== 'monster_kill' && t.trigger?.type !== 'boss_kill')
    for (const task of rest) {
      const hasGlyph = task.icon in gameIcons || task.icon in bespokeIcons
      expect(hasGlyph, `${task.id}: icon "${task.icon}" not in gameIcons/bespokeIcons`).toBe(true)
    }
  })

  it('no boss_kill task targets a raid boss', () => {
    const raidBossIds = new Set(
      Object.values(raidsData as Record<string, { bosses: string[] }>).flatMap(r => r.bosses)
    )
    const bossKillTasks = pool.filter(t => t.trigger?.type === 'boss_kill')
    for (const task of bossKillTasks) {
      expect(
        raidBossIds.has(task.trigger.monsterId),
        `${task.id}: monsterId "${task.trigger.monsterId}" is a raid boss — use raid_complete instead`
      ).toBe(false)
    }
  })
})
