/**
 * Summoning — pure logic shared by the Summoning skill screen, the live combat
 * engine, and the idle engine. No UI imports.
 *
 * Two crafting steps and one combat use:
 *   - Make a pouch:  charm + secondary + empty pouch → 1 <creature> pouch
 *   - Infuse scrolls: 1 pouch                        → SCROLLS_PER_POUCH scrolls
 *   - Summon:        1 pouch consumed in a live fight spawns the creature for
 *                    SUMMON_DURATION_TICKS; each of its attacks spends 1 scroll.
 *
 * The two crafting steps are tick-based skilling actions (one product every
 * CRAFT_ACTION_TICKS ticks) that grant per-creature `pouchXp`/`scrollXp`;
 * summoning in a live fight grants `summonXp`. See CLAUDE.md §4 (this file is
 * the source of truth for the Summoning creature registry and its combat rolls).
 */

import summoningData from '../data/summoning.json'
import { maxAttackRoll, maxDefenceRoll, hitChance, rollDamage } from './formulas.js'
import { countItem } from './inventory.js'

export const SUMMON_DURATION_TICKS = 100 // 60s at TICK_MS = 600
export const SUMMON_ATTACK_TICKS = 4     // creature swings every 4 ticks (2.4s)
export const SCROLLS_PER_POUCH = 10
export const CHARM_DROP_CHANCE = 0.05    // flat per-kill chance of a tier charm
export const CRAFT_ACTION_TICKS = 2      // one pouch/scroll batch every 2 ticks
export const EMPTY_POUCH_ID = 'empty_pouch'

export const SUMMONING_CREATURES = summoningData.creatures

const CREATURE_BY_ID = Object.fromEntries(SUMMONING_CREATURES.map((c) => [c.id, c]))
const CREATURE_BY_POUCH = Object.fromEntries(SUMMONING_CREATURES.map((c) => [c.pouch, c]))
const CREATURE_BY_SCROLL = Object.fromEntries(SUMMONING_CREATURES.map((c) => [c.scroll, c]))

export function getSummoningCreature(id) {
  return CREATURE_BY_ID[id] || null
}

export function creatureForPouch(pouchId) {
  return CREATURE_BY_POUCH[pouchId] || null
}

export function creatureForScroll(scrollId) {
  return CREATURE_BY_SCROLL[scrollId] || null
}

/** Creatures the player can summon/craft at a given Summoning level. */
export function getUnlockedCreatures(summoningLevel) {
  const lvl = Number(summoningLevel) || 1
  return SUMMONING_CREATURES.filter((c) => lvl >= c.level)
}

// ── Crafting recipes ────────────────────────────────────────────────────────

/** charm + secondary + empty pouch → 1 pouch. Shaped like skills.json actions. */
export function getPouchRecipe(creature) {
  if (!creature) return null
  return {
    product: creature.pouch,
    productQty: 1,
    xp: creature.pouchXp || 0,
    materials: { [creature.charm]: 1, [creature.secondary]: 1, [EMPTY_POUCH_ID]: 1 },
  }
}

/** 1 pouch → SCROLLS_PER_POUCH scrolls. */
export function getScrollRecipe(creature) {
  if (!creature) return null
  return {
    product: creature.scroll,
    productQty: SCROLLS_PER_POUCH,
    xp: creature.scrollXp || 0,
    materials: { [creature.pouch]: 1 },
  }
}

const bankQty = (bank, id) => bank?.[id]?.quantity || 0

/** Times a recipe can run given inventory + bank stock (materials combined). */
export function craftableTimes(recipe, inventory, bank) {
  if (!recipe) return 0
  let max = Infinity
  for (const [id, per] of Object.entries(recipe.materials)) {
    max = Math.min(max, Math.floor((countItem(inventory, id) + bankQty(bank, id)) / per))
  }
  return max === Infinity ? 0 : max
}

// ── Charm drops (universal, combat-level tiered) ─────────────────────────────
// Mirrors getMonsterSeedDrops: injected into every monster's drop roll without
// bloating monsters.json. Bosses / raid bosses are excluded (their loot is
// server-authoritative, §14) — same carve-out as seed drops.

export function charmForCombatLevel(combatLevel) {
  const cl = Number(combatLevel) || 0
  if (cl <= 0) return null
  if (cl <= 50) return 'green_charm'
  if (cl <= 100) return 'red_charm'
  return 'blue_charm'
}

/** Charm drop entries for a monster, shaped like normal drops. */
export function getMonsterCharmDrops(monster) {
  if (!monster || monster.boss === true || monster.raidBoss === true) return []
  // Opt-out (mirrors seed drops' noSeedDrops) for monsters that want fully
  // deterministic authored loot.
  if (monster.noCharmDrops === true) return []
  const charm = charmForCombatLevel(monster.combatLevel)
  if (!charm) return []
  return [{ itemId: charm, quantity: 1, chance: CHARM_DROP_CHANCE }]
}

// ── Combat roll ──────────────────────────────────────────────────────────────
// The summoned creature swings at the player's target using the same
// accuracy/damage maths a player does (formulas.js). maxHit is fixed per
// creature; `hits` independent swings resolve per attack (Steel Titan = 3).

/** Accuracy the creature would have against a monster this tick. */
export function summonHitChance(creature, monster) {
  const style = creature.attackStyle || 'crush'
  const atkRoll = maxAttackRoll(creature.attackLevel, creature.attackBonus)
  const defRoll = maxDefenceRoll(monster?.stats?.defence || 0, monster?.defenceBonus?.[style] || 0)
  return hitChance(atkRoll, defRoll)
}

/**
 * Roll one creature attack. Returns { damage, hits, accuracy } where `hits` is
 * a per-swing damage array (length === creature.hits). Damage rolls use
 * formulas.rollDamage (Math.random), matching the PvE engine.
 */
export function rollSummonAttack(creature, monster) {
  const accuracy = summonHitChance(creature, monster)
  const n = Math.max(1, creature.hits || 1)
  const hits = []
  for (let i = 0; i < n; i++) hits.push(rollDamage(accuracy, creature.maxHit))
  return { damage: hits.reduce((a, b) => a + b, 0), hits, accuracy }
}

// ── Summon state (lives on combatState.summon) ───────────────────────────────

export function createSummonState(creatureId) {
  return { creatureId, ticksLeft: SUMMON_DURATION_TICKS, attackTimer: SUMMON_ATTACK_TICKS }
}
