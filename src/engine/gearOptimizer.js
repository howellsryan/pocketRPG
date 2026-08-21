/**
 * Best-DPS loadout search over a pool of items.
 *
 * Answers three questions the helper is asked, all with the same machinery:
 * what is the best setup from gear the player OWNS, what it would be with gear
 * they don't, and what either becomes at higher levels. Scoring is
 * `dpsCalculator.js` — the analytical twin of the live fight — so a
 * recommendation can never rank gear by maths the fight doesn't use.
 *
 * The search is greedy per slot, which is exact for additive offence bonuses
 * and wrong for exactly one thing: a set bonus that only pays once every piece
 * is worn. Full set kits are therefore offered as whole-loadout candidates on
 * top of the greedy result — the same correction `scripts/gear-benchmark.cjs`
 * makes, and the reason a Void or Kodai build is reachable at all.
 *
 * It runs inside a Worker request, so the cost is bounded in two places: each
 * slot's candidates are cut to the offensive Pareto frontier, and the weapon
 * pool is cut to a shortlist scored against a fixed reference kit. Both prune
 * options that cannot win, never options that merely look weak.
 *
 * Pure logic, no UI imports.
 */

import { EQUIPMENT_SLOTS } from '../utils/constants.js'
import { getXPForLevel } from './experience.js'
import { checkEquipRequirements } from './equipment.js'
import { COMBAT_SETS } from './combatSetBonuses.js'
import { estimateDpsVsTargets, STANCES_BY_STYLE, loadoutBlockedReason } from './dpsCalculator.js'

// Filled from the weapon slot outward: the weapon decides two-handedness, the
// ammo kind and the magic-damage multiplier every other pick is scored under.
const GEAR_SLOTS = EQUIPMENT_SLOTS.filter((s) => s !== 'weapon')

// Weapons carried into the full per-slot search. Ranked first against a fixed
// kit, which orders weapons reliably because armour contributes the same
// bonuses whatever weapon swings — the shortlist only has to be wide enough to
// survive the interactions that ordering misses (a 2H losing its shield slot, a
// staff multiplying worn magic damage, a set that requires a named weapon).
const WEAPON_SHORTLIST = 8
const GREEDY_PASSES = 2

/** Combat skills a DPS answer can move. */
export const DPS_SKILLS = ['attack', 'strength', 'ranged', 'magic']

function itemLevels(levels) {
  // checkEquipRequirements reads XP, so requirement gates stay the engine's
  // rather than a level comparison re-written here.
  const stats = {}
  for (const [skill, level] of Object.entries(levels || {})) {
    stats[skill] = { xp: getXPForLevel(Math.max(1, Math.min(99, Math.floor(level)))) }
  }
  return stats
}

function styleAttackBonus(item, style) {
  const a = item?.attackBonus || {}
  if (style === 'magic') return a.magic || 0
  if (style === 'ranged') return a.ranged || 0
  return Math.max(a.stab || 0, a.slash || 0, a.crush || 0)
}

function styleDamageBonus(item, style) {
  const o = item?.otherBonus || {}
  if (style === 'magic') return o.magicDamage || 0
  if (style === 'ranged') return (o.rangedStrength || 0) + (o.rangedDamage || 0) * 10
  return (o.meleeStrength || 0) + (o.meleeDamage || 0) * 10
}

function weaponStyleOf(weapon) {
  const s = weapon?.attackStyle
  if (s === 'ranged') return 'ranged'
  if (s === 'magic') return 'magic'
  if (s) return 'melee'
  return null
}

/**
 * Items whose offence for this style is beaten on every axis by another
 * candidate in the same slot. A dominated item cannot win any loadout, so
 * dropping it is exact — unlike a "top N by score" cut, which would throw away
 * the accuracy piece that pairs with a high-damage weapon.
 *
 * Slayer-task and set bonuses are carried as extra axes: a helm that only pays
 * on task, or a piece of a full set, must survive a comparison against a
 * plainly stronger item or the set can never be assembled.
 */
function pruneDominated(items, style, setItemIds, keepIds) {
  const axes = items.map((it) => ({
    it,
    a: styleAttackBonus(it, style),
    d: styleDamageBonus(it, style),
    s: (it.otherBonus?.slayerTaskAccuracyPercent || 0) + (it.otherBonus?.slayerTaskDamagePercent || 0),
    // Only items that can SUBSTITUTE for each other may dominate each other. A
    // bolt is not a worse arrow, it is a different ammunition: comparing the
    // two let one high-strength bolt prune every arrow in the game, which left
    // arrow-firing bows with nothing to shoot and handed the ranged slot to
    // whichever bow needed no ammo at all.
    group: it.ammoKind || '',
    keep: setItemIds.has(it.id) || keepIds.has(it.id) || !!it.magicDamageMultiplier || !!it.spellRuneDamage,
  }))
  return axes.filter((x) => {
    if (x.keep) return true
    // Nothing offensive to offer: the slot is better left empty than searched.
    if (x.a <= 0 && x.d <= 0 && x.s <= 0) return false
    return !axes.some((y) => y.it.id !== x.it.id && !y.keep && y.group === x.group
      && y.a >= x.a && y.d >= x.d && y.s >= x.s
      && (y.a > x.a || y.d > x.d || y.s > x.s))
  }).map((x) => x.it)
}

function equipmentFrom(weapon, gear) {
  const equipment = {}
  if (weapon) equipment.weapon = { itemId: weapon.id, _twoHanded: !!weapon.twoHanded }
  for (const [slot, item] of Object.entries(gear)) {
    if (item) equipment[slot] = { itemId: item.id, quantity: slot === 'ammo' ? item._quantity || 1 : 1 }
  }
  return equipment
}

/**
 * Candidate items per slot, filtered to what this character may actually wear:
 * in the pool, equippable, and past the item's own skill and quest gates.
 */
function buildCandidates({ pool, itemsData, style, levels, completedQuests, ownedQuantities }) {
  const stats = itemLevels(levels)
  const setItemIds = new Set(COMBAT_SETS.flatMap((set) => Object.values(set.slots || {}).flat()))
  const bySlot = {}
  const weapons = []

  for (const id of pool) {
    const raw = itemsData[id]
    if (!raw?.slot) continue
    if (checkEquipRequirements(raw, stats, completedQuests)) continue
    const item = { ...raw, id, _quantity: ownedQuantities?.get(id) ?? 1 }
    if (item.slot === 'weapon') {
      if (weaponStyleOf(item) === style) weapons.push(item)
      continue
    }
    ;(bySlot[item.slot] ||= []).push(item)
  }

  // Ammo a weapon names outright survives the prune whatever its stats: it is
  // the only thing that weapon can fire.
  const keepIds = new Set(weapons.flatMap((w) => w.requiredAmmoIds || (w.requiredAmmoId ? [w.requiredAmmoId] : [])))
  for (const slot of GEAR_SLOTS) {
    bySlot[slot] = pruneDominated(bySlot[slot] || [], style, setItemIds, keepIds)
  }
  return { weapons, bySlot }
}

/**
 * A slot's item only counts when the weapon can use it: ammo must match the
 * weapon's ammo kind, and a two-handed weapon leaves no shield slot.
 */
function slotUsable(slot, item, weapon) {
  if (slot === 'shield' && weapon?.twoHanded) return false
  if (slot === 'ammo') {
    if (!weapon?.ammoType) return false
    if (item.ammoKind !== weapon.ammoType) return false
    const required = weapon.requiredAmmoIds || (weapon.requiredAmmoId ? [weapon.requiredAmmoId] : [])
    if (required.length && !required.includes(item.id)) return false
  }
  return true
}

function fillGreedy({ weapon, bySlot, score, passes = GREEDY_PASSES }) {
  const gear = {}
  for (let pass = 0; pass < passes; pass++) {
    for (const slot of GEAR_SLOTS) {
      const candidates = (bySlot[slot] || []).filter((it) => slotUsable(slot, it, weapon))
      if (!candidates.length) { delete gear[slot]; continue }
      let best = gear[slot] || null
      let bestScore = score(weapon, gear)
      for (const item of candidates) {
        if (item === gear[slot]) continue
        const s = score(weapon, { ...gear, [slot]: item })
        if (s > bestScore) { bestScore = s; best = item }
      }
      if (best) gear[slot] = best
      else delete gear[slot]
    }
  }
  return gear
}

/**
 * Best loadout for one style. Returns null when the pool cannot field the
 * style at all (no weapon, or no ammo for the bows it has).
 */
export function optimiseStyle({
  style,
  pool,
  itemsData,
  spellsData,
  levels,
  requirementLevels = levels,
  completedQuests = [],
  targets,
  slayerTask = null,
  monsterId = null,
  ownedQuantities = null,
  spellFilter = null,
  prayerMagicDamagePercent = 0,
}) {
  // `levels` are what the swings are SCORED with (prayer-boosted); gates are
  // read from `requirementLevels`, the character's real ones. Gating on the
  // boosted numbers would hand a 90-Strength player gear that needs 95, on the
  // strength of a prayer that unlocks nothing.
  const { weapons, bySlot } = buildCandidates({ pool, itemsData, style, levels: requirementLevels, completedQuests, ownedQuantities })
  if (!weapons.length) return null

  const spells = style === 'magic'
    ? Object.values(spellsData || {}).filter((s) => Number(s.baseDamage) > 0
      && (s.levelReq || 1) <= requirementLevels.magic
      && (!spellFilter || spellFilter(s)))
    : [null]

  const score = (weapon, gear, opts) => {
    const equipment = equipmentFrom(weapon, gear)
    if (loadoutBlockedReason({ style, equipment, itemsData, spell: opts?.spell })) return 0
    return estimateDpsVsTargets(targets, {
      style, stance: opts?.stance ?? null, spell: opts?.spell ?? null,
      levels, equipment, itemsData, slayerTask, monsterId, prayerMagicDamagePercent,
    }).dps
  }

  // Shortlist weapons against one fixed kit so the expensive per-slot fill runs
  // only for the handful that could plausibly win.
  const referenceGear = {}
  for (const slot of GEAR_SLOTS) {
    // Ammo is left out — it depends on the weapon, and each candidate weapon
    // is given its own best compatible ammo below.
    if (slot === 'ammo') continue
    const best = [...(bySlot[slot] || [])]
      .sort((a, b) => (styleAttackBonus(b, style) + styleDamageBonus(b, style)) - (styleAttackBonus(a, style) + styleDamageBonus(a, style)))[0]
    if (best) referenceGear[slot] = best
  }
  const defaultStance = STANCES_BY_STYLE[style][0]
  const defaultSpell = spells.reduce((best, s) => (!best || (s?.baseDamage || 0) > (best.baseDamage || 0) ? s : best), null)
  const shortlist = weapons
    .map((weapon) => {
      const gear = { ...referenceGear }
      if (weapon.twoHanded) delete gear.shield
      // A bow scored with no ammo scores zero and would never make the cut, so
      // the shortlist pass gives it the best compatible ammo it owns.
      if (weapon.ammoType) {
        const ammo = (bySlot.ammo || []).filter((it) => slotUsable('ammo', it, weapon))
          .sort((a, b) => styleDamageBonus(b, style) - styleDamageBonus(a, style))[0]
        if (ammo) gear.ammo = ammo
        else delete gear.ammo
      } else delete gear.ammo
      return { weapon, s: score(weapon, gear, { stance: defaultStance, spell: defaultSpell }) }
    })
    .filter((w) => w.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, WEAPON_SHORTLIST)
    .map((w) => w.weapon)

  if (!shortlist.length) return null

  // Whole-loadout candidates for each full set the pool can assemble — greedy
  // per-slot filling can never discover a bonus that only pays on the last piece.
  const setKits = COMBAT_SETS
    .map((set) => ({
      set,
      picks: Object.entries(set.slots || {}).map(([slot, aliases]) => {
        const id = aliases.find((a) => (bySlot[slot] || []).some((it) => it.id === a))
        return id ? { slot, item: (bySlot[slot] || []).find((it) => it.id === id) } : null
      }),
    }))
    .filter((kit) => kit.picks.every(Boolean))

  let best = null
  const consider = (weapon, gear, opts) => {
    const dps = score(weapon, gear, opts)
    if (dps > 0 && (!best || dps > best.dps)) best = { dps, weapon, gear: { ...gear }, ...opts }
  }

  for (const weapon of shortlist) {
    for (const stance of STANCES_BY_STYLE[style]) {
      // A powered staff casts no spell; every other magic weapon needs one.
      const spellChoices = style === 'magic' && !weapon.poweredStaff ? spells : [null]
      for (const spell of spellChoices) {
        if (style === 'magic' && !weapon.poweredStaff && !spell) continue
        const opts = { stance, spell }
        const gear = fillGreedy({ weapon, bySlot, score: (w, g) => score(w, g, opts) })
        consider(weapon, gear, opts)
        for (const kit of setKits) {
          if (kit.set.requiredWeapons && !kit.set.requiredWeapons.includes(weapon.id)) continue
          const kitted = { ...gear }
          for (const pick of kit.picks) kitted[pick.slot] = pick.item
          if (weapon.twoHanded) delete kitted.shield
          consider(weapon, kitted, opts)
        }
      }
    }
  }

  if (!best) return null
  const equipment = equipmentFrom(best.weapon, best.gear)
  const detail = estimateDpsVsTargets(targets, {
    style, stance: best.stance, spell: best.spell,
    levels, equipment, itemsData, slayerTask, monsterId, prayerMagicDamagePercent,
  })
  return {
    style,
    stance: best.stance,
    spell: best.spell ? { id: best.spell.id, name: best.spell.name } : null,
    // The full spell definition (baseDamage, runeReq) the scorers need; the
    // trimmed `spell` above is what the payload carries.
    _spell: best.spell || null,
    equipment,
    items: Object.fromEntries(Object.entries(equipment).map(([slot, e]) => [slot, { itemId: e.itemId, name: itemsData[e.itemId]?.name || e.itemId }])),
    dps: detail.dps,
    maxHit: detail.maxHit,
    accuracy: detail.accuracy,
    attackSpeedTicks: detail.attackSpeedTicks,
    immuneShare: detail.immuneShare || 0,
  }
}

/** Best across every style the pool can field, plus each style's own best. */
export function optimiseAllStyles(params) {
  const byStyle = {}
  for (const style of params.styles || ['melee', 'ranged', 'magic']) {
    const result = optimiseStyle({ ...params, style })
    if (result) byStyle[style] = result
  }
  const best = Object.values(byStyle).sort((a, b) => b.dps - a.dps)[0] || null
  return { byStyle, best }
}

/**
 * Slot-by-slot difference between two loadouts, as the swaps a player would
 * actually make. Each entry carries the DPS the swap alone is worth, measured
 * against the `from` loadout — so "the amulet is worth 12%" is a claim about
 * that one change, not about the whole rebuild.
 */
export function loadoutSwaps({ from, to, itemsData, targets, levels, slayerTask = null, monsterId = null, prayerMagicDamagePercent = 0 }) {
  if (!to) return []
  const swaps = []
  // A per-swap gain is only meaningful within one style — pricing a ranged
  // helm against a melee loadout measures the style change, not the swap. A
  // cross-style recommendation lists the kit with no per-item gains.
  const comparable = !!from && from.style === to.style
  const spell = to._spell || to.spell
  const baseParams = { style: to.style, stance: to.stance, levels, itemsData, slayerTask, monsterId, spell, prayerMagicDamagePercent }
  const baseline = comparable ? estimateDpsVsTargets(targets, { ...baseParams, equipment: from.equipment }).dps : 0

  for (const slot of EQUIPMENT_SLOTS) {
    const fromId = from?.equipment?.[slot]?.itemId || null
    const toId = to.equipment?.[slot]?.itemId || null
    if (fromId === toId) continue
    let gain = null
    if (comparable && baseline > 0) {
      const stepped = { ...from.equipment }
      if (toId) stepped[slot] = { ...to.equipment[slot] }
      else delete stepped[slot]
      // A two-handed weapon takes the shield with it, so price the pair.
      if (slot === 'weapon' && itemsData[toId]?.twoHanded) delete stepped.shield
      const dps = estimateDpsVsTargets(targets, { ...baseParams, equipment: stepped }).dps
      gain = (dps - baseline) / baseline
    }
    swaps.push({
      slot,
      from: fromId ? { itemId: fromId, name: itemsData[fromId]?.name || fromId } : null,
      to: toId ? { itemId: toId, name: itemsData[toId]?.name || toId } : null,
      dpsGainPercent: gain == null ? null : Math.round(gain * 1000) / 10,
    })
  }
  return swaps.sort((a, b) => (b.dpsGainPercent ?? -1) - (a.dpsGainPercent ?? -1))
}

/**
 * What another N levels in each combat skill would be worth, holding the
 * loadout fixed. Levels are the one upgrade a player always has access to, so
 * "+6.4% from 10 Strength levels" is often the honest answer to "how do I hit
 * harder" when the gear is already best-in-slot.
 */
export function levelUplift({ loadout, targets, levels, itemsData, steps = [1, 5, 10], slayerTask = null, monsterId = null, maxLevel = 99, boost = (lv) => lv, prayerMagicDamagePercent = 0 }) {
  if (!loadout) return []
  const spell = loadout._spell || loadout.spell
  // `levels` are the character's RAW levels — the ladder a player climbs — and
  // `boost` re-applies whatever prayer the loadout was chosen under. Handed
  // boosted levels instead, a 90 under Piety reads as 110 and every skill is
  // silently "already maxed".
  const scoreAt = (raw) => estimateDpsVsTargets(targets, {
    style: loadout.style, stance: loadout.stance, spell,
    levels: boost(raw), equipment: loadout.equipment, itemsData, slayerTask, monsterId, prayerMagicDamagePercent,
  }).dps
  const base = scoreAt(levels)
  if (!(base > 0)) return []

  const out = []
  for (const skill of DPS_SKILLS) {
    const current = levels[skill] || 1
    if (current >= maxLevel) continue
    const entries = []
    for (const step of steps) {
      const to = Math.min(maxLevel, current + step)
      if (to === current) continue
      const dps = scoreAt({ ...levels, [skill]: to })
      entries.push({ toLevel: to, dpsGainPercent: Math.round(((dps - base) / base) * 1000) / 10 })
    }
    const meaningful = entries.filter((e) => e.dpsGainPercent > 0)
    if (meaningful.length) out.push({ skill, currentLevel: current, steps: meaningful })
  }
  return out.sort((a, b) => (b.steps.at(-1)?.dpsGainPercent || 0) - (a.steps.at(-1)?.dpsGainPercent || 0))
}
