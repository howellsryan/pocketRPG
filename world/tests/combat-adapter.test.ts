// Test-first (guide STEP 2.3 step 1): pin the real combat engine's contract for
// a Pasture Bull fight WITHOUT the Durable Object, so the adapter can be written
// against verified behaviour — kill signal, HP field, XP awards (§5: 4 XP/dmg to
// the style skill, 1.33 XP/dmg to HP), and loot on death.
import { describe, expect, it } from 'vitest'
import monstersData from '../../src/data/monsters.json'
import itemsData from '../../src/data/items.json'
import { createCombatState, processCombatTick } from '../../src/engine/combat.js'

const bull = (monstersData as Record<string, { hitpoints: number } & Record<string, unknown>>).pasture_bull

function fightToDeath(playerLevels: Record<string, number>) {
  let state = createCombatState(bull, 'melee', 'accurate')
  const maxHP = playerLevels.hitpoints
  let hp = maxHP
  const hitsOnPlayer: number[] = []
  const hitsOnBull: number[] = []
  let deathLoot: { itemId: string; quantity: number }[] | null = null
  let ticks = 0

  while (state.active && ticks < 5000) {
    ticks++
    const playerStats = { ...playerLevels, currentHP: hp, maxHP }
    const { combatState, events } = processCombatTick(state, playerStats, {}, itemsData as object, {}, [], null)
    state = combatState
    for (const ev of events) {
      if (ev.type === 'playerHit') hitsOnBull.push(ev.damage)
      if (ev.type === 'monsterHit') { hitsOnPlayer.push(ev.damage); hp = Math.max(0, hp - ev.damage) }
      if (ev.type === 'monsterDeath') deathLoot = ev.loot
    }
  }
  return { state, ticks, hp, hitsOnPlayer, hitsOnBull, deathLoot }
}

describe('pasture_bull combat via the real engine', () => {
  it('kills the bull; monster HP field is currentHP; combat ends', () => {
    const r = fightToDeath({ attack: 20, strength: 20, defence: 20, ranged: 1, magic: 1, hitpoints: 20 })
    expect(r.ticks).toBeLessThan(5000)
    expect(r.state.active).toBe(false)
    expect(r.state.monster.currentHP).toBe(0)
    expect(r.deathLoot).not.toBeNull()
  })

  it('awards 4 XP/damage to Attack (accurate stance) and HP XP, capped at the bull HP', () => {
    const r = fightToDeath({ attack: 20, strength: 20, defence: 20, ranged: 1, magic: 1, hitpoints: 20 })
    // Total damage dealt is clamped to the bull's 8 HP (no overkill XP).
    const xp = r.state.xpGained as Record<string, number>
    expect(xp.attack).toBe(bull.hitpoints * 4)
    expect(xp.hitpoints).toBeGreaterThan(0)
    expect(xp.strength ?? 0).toBe(0)
  })

  it('drops bones, raw beef and cowhide (all guaranteed) on death', () => {
    const r = fightToDeath({ attack: 40, strength: 40, defence: 40, ranged: 1, magic: 1, hitpoints: 40 })
    const ids = new Set((r.deathLoot ?? []).map((d) => d.itemId))
    expect(ids.has('bones')).toBe(true)
    expect(ids.has('raw_beef')).toBe(true)
    expect(ids.has('cowhide')).toBe(true)
  })

  it('lets the bull land hits back through the same tick flow (retaliation exists)', () => {
    // Weak player so the fight lasts long enough for the bull to swing.
    const r = fightToDeath({ attack: 1, strength: 1, defence: 1, ranged: 1, magic: 1, hitpoints: 20 })
    expect(r.hitsOnPlayer.length).toBeGreaterThan(0)
  })
})
