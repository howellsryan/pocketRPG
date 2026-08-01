// Wilderness bot ladder coverage — the world only spawns a bot the player may
// actually attack, which is one inside the ±PVP_LEVEL_BRACKET band
// (templateForCombatLevel in world/server/pvpBots.ts), so every reachable
// combat level (3..126) must have at least one bot template within that band.
// This test fails the moment adding/removing/re-statting a bot opens a stretch
// of the ladder with no opponent in it.

import { describe, it, expect } from 'vitest'
import { combatLevelFromLevels } from '../src/engine/combatLevel.js'
import { PVP_LEVEL_BRACKET } from '../world/shared/pvpArea'
import pvpBots from '../src/data/pvpBots.json' assert { type: 'json' }
import itemsData from '../src/data/items.json' assert { type: 'json' }

// Fresh character (all level 1, HP 10) floors at CB 3; all-99 caps at 126.
const MIN_PLAYER_CB = 3
const MAX_PLAYER_CB = 126

// Compute each bot's combat level exactly the way the world does when it spawns
// one (world/server/pvpBots.ts botTemplateCombatLevel).
function botCombatLevel(template: any): number {
  return combatLevelFromLevels(template.stats)
}

describe('wilderness bot combat-level coverage', () => {
  const botLevels = pvpBots.bots.map((b: any) => ({ id: b.id, cb: botCombatLevel(b) }))

  it('every combat level from 3 to 126 has at least one bot within ±10', () => {
    const gaps: number[] = []
    for (let cb = MIN_PLAYER_CB; cb <= MAX_PLAYER_CB; cb++) {
      const covered = botLevels.some((b) => Math.abs(b.cb - cb) <= PVP_LEVEL_BRACKET)
      if (!covered) gaps.push(cb)
    }
    expect(gaps, `no bot within ±${PVP_LEVEL_BRACKET} of combat level(s): ${gaps.join(', ')}`).toEqual([])
  })

  it('bot combat levels stay inside the playable range', () => {
    for (const bot of botLevels) {
      expect(bot.cb, bot.id).toBeGreaterThanOrEqual(MIN_PLAYER_CB)
      expect(bot.cb, bot.id).toBeLessThanOrEqual(MAX_PLAYER_CB)
    }
  })
})

describe('pvp bot template integrity', () => {
  it('every bot has exactly 28 inventory slots', () => {
    for (const bot of pvpBots.bots) {
      expect(bot.inventory.length, bot.id).toBe(28)
    }
  })

  it('every bot meets the requirements of its own equipment', () => {
    for (const bot of pvpBots.bots) {
      for (const [slot, entry] of Object.entries(bot.equipment as Record<string, any>)) {
        if (!entry) continue
        const item = (itemsData as any)[entry.itemId]
        expect(item, `${bot.id} ${slot} ${entry.itemId}`).toBeDefined()
        for (const [skill, required] of Object.entries(item.requirements || {})) {
          const have = (bot.stats as any)[skill] ?? 1
          expect(have, `${bot.id} ${entry.itemId} needs ${skill} ${required}`).toBeGreaterThanOrEqual(required as number)
        }
      }
    }
  })

  it('bot ids and usernames are unique', () => {
    const ids = pvpBots.bots.map((b: any) => b.id)
    const names = pvpBots.bots.map((b: any) => b.username)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every bot has a valid combat stance and food to survive on', () => {
    const VALID_STANCES = new Set(['accurate', 'aggressive', 'defensive', 'controlled', 'rapid', 'longrange'])
    for (const bot of pvpBots.bots) {
      expect(VALID_STANCES.has(bot.combatStance), `${bot.id} stance ${bot.combatStance}`).toBe(true)
      const hasFood = bot.inventory.some((slot: any) => {
        if (!slot) return false
        const item = (itemsData as any)[slot.itemId]
        return item && (item.heals > 0 || item.healsHP > 0)
      })
      expect(hasFood, `${bot.id} carries no food`).toBe(true)
    }
  })
})
