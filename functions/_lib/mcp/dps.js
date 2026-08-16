/**
 * The `analyze_dps` tool's payload: turn a save into a gear recommendation.
 *
 * Read-only — it computes, grants nothing and writes nothing, so it needs no
 * save lock and no audit row. All of the maths is `src/engine/dpsCalculator.js`
 * + `gearOptimizer.js`; this file only decides what a player is ALLOWED to be
 * recommended (gear they own, levels they have, quests they've done) and
 * compresses the answer.
 *
 * Compression is load bearing, not tidiness: chat truncates a tool result at
 * CHAT_MAX_TOOL_RESULT_CHARS (6000), and a payload cut mid-JSON is a payload
 * the model reads wrong. Hence `include` — upgrades and level projections are
 * opt-in, so the default answer always fits.
 */

import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import spellsData from '../../../src/data/spells.json' assert { type: 'json' }
import prayersData from '../../../src/data/prayers.json' assert { type: 'json' }
import { getLevelFromXP } from '../../../src/engine/experience.js'
import { combatLevelFromStats } from '../../../src/engine/combatLevel.js'
import { resolveMagicSpell } from '../../../src/engine/equipment.js'
import { applyPrayerBonuses } from '../../../src/engine/combat.js'
import { completedQuestsFromSave } from '../../../src/engine/questGates.js'
import { hasRequiredRunes } from '../../../src/engine/runes.js'
import { getPurchaseRestriction, isOrderBookItem } from '../../../src/engine/storeRules.js'
import { isCollectionLogLineageItem } from '../collectionLog.js'
import { ALL_SKILLS, MAX_TOTAL_LEVEL } from '../../../src/utils/constants.js'
import {
  COMBAT_STYLES, DPS_MODEL_NOTES, estimateDpsVsTargets, monsterTargets,
  referenceTarget, timeToKill,
} from '../../../src/engine/dpsCalculator.js'
import { optimiseStyle, loadoutSwaps, levelUplift, DPS_SKILLS } from '../../../src/engine/gearOptimizer.js'
import { bossFightHitpoints } from '../../../src/engine/coopRaidEngine.js'
import { getMonster, itemSources } from './reference.js'

function round(n, dp = 2) {
  const f = 10 ** dp
  return Math.round((Number(n) || 0) * f) / f
}

/**
 * EVERY skill, not just the combat ones. Equip requirements are checked against
 * this map, and plenty of combat gear is gated on a skill that never enters a
 * damage formula — the Arcane Necklace needs Dungeoneering 65, chaotic weapons
 * and slayer gear need Slayer, gathering tools need Woodcutting or Mining. Hand
 * `checkEquipRequirements` a combat-only map and every one of those reads as
 * level 1, so the item is silently dropped from the search however high the
 * player has actually trained it.
 */
function levelsFromSave(state) {
  const levels = {}
  for (const skill of ALL_SKILLS) levels[skill] = getLevelFromXP(Number(state?.stats?.[skill]?.xp || 0))
  return levels
}

/**
 * Everything the character could put on: worn gear, the pack and the bank.
 * Quantities come along because ammo with none left cannot be fired.
 */
function ownedPool(state) {
  const quantities = new Map()
  const add = (itemId, qty) => {
    if (!itemId) return
    quantities.set(itemId, (quantities.get(itemId) || 0) + (Number(qty) || 1))
  }
  for (const entry of Object.values(state?.equipment || {})) if (entry) add(entry.itemId ?? entry.id, entry.quantity ?? 1)
  for (const slot of state?.inventory || []) if (slot) add(slot.itemId ?? slot.id, slot.quantity ?? 1)
  for (const [itemId, entry] of Object.entries(state?.bank || {})) {
    add(itemId, typeof entry === 'number' ? entry : entry?.quantity ?? 1)
  }
  return { pool: new Set(quantities.keys()), quantities }
}

/** Every equippable item in the game — the "what could it be" pool. */
function fullPool() {
  return new Set(Object.entries(itemsData).filter(([, it]) => it?.slot).map(([id]) => id))
}

/**
 * Can this account get hold of this item, and how?
 *
 * Composed from the funnels that already police buying, never restated:
 * `getPurchaseRestriction` for the shop (already account-mode aware),
 * `isOrderBookItem` for what trades player-to-player, and the two account gates
 * the trading post itself enforces — Ironman is refused outright
 * (`functions/api/trading-post/list.js`), and a Grindman may not BUY a
 * collection-log unique or anything built from one, because buying the amulet
 * of fury is buying the onyx.
 *
 * Note the shop and the order book disagree on purpose: a boss unique is
 * refused by `getPurchaseRestriction` yet is perfectly buyable player-to-player,
 * so the two are asked separately rather than one gating the other.
 */
export function itemAcquisition(item, { isIronman = false, isOneLife = false, isGrindman = false, slayerStoreUnlocks = null, isMaxed = false } = {}) {
  if (!item) return { acquirable: false, via: null }
  // The Max Cape's gate is a total-level check enforced in /api/purchase, not an
  // equip requirement, so nothing else in the search would catch it.
  if (item.isMaxCape && !isMaxed) return { acquirable: false, via: null }
  const modes = {
    isIronman,
    isOneLife,
    isGrindman,
    allowSlayerStorePurchase: !!slayerStoreUnlocks?.includes?.(item.id),
  }
  if (getPurchaseRestriction(item, modes).allowed) {
    return { acquirable: true, via: 'shop', cost: Math.floor(Number(item.shopValue) || 0) }
  }
  if (isOrderBookItem(item) && !isIronman && !(isGrindman && isCollectionLogLineageItem(item.id))) {
    return { acquirable: true, via: 'trading_post', cost: Math.floor(Number(item.shopValue) || 0) }
  }
  return { acquirable: false, via: null }
}

/**
 * Gear the character owns PLUS everything the account is allowed to buy. This
 * is the honest pool for "what's my best setup": a normal account is one
 * trading-post trip from most of the game, and answering only from the bank
 * hides a 12-gp stack of arrows behind a Fletching level they never needed.
 */
function acquirablePool(owned, modes, coins) {
  const pool = new Set(owned)
  const via = new Map()
  for (const [id, item] of Object.entries(itemsData)) {
    if (!item?.slot || pool.has(id)) continue
    const acquisition = itemAcquisition({ ...item, id }, modes)
    if (!acquisition.acquirable) continue
    // Priced out of the answer. "Best setup" has to be something they can go
    // and do — a 100m bow recommended to a player holding 500k buries the
    // twelve-gold stack of arrows that would actually help today. The
    // unaffordable gear is still reachable through `include:['upgrades']`,
    // which is the long-term chase rather than the current setup.
    if (acquisition.cost > coins) continue
    pool.add(id)
    via.set(id, acquisition)
  }
  return { pool, via }
}

/** Maxed — the Max Cape's own gate, summed the way /api/purchase sums it. */
function isMaxedAccount(state) {
  const total = ALL_SKILLS.reduce((sum, skill) => sum + getLevelFromXP(Number(state?.stats?.[skill]?.xp || 0)), 0)
  return total >= MAX_TOTAL_LEVEL
}

/** What the account may do, in the words an answer needs. */
function accountSummary({ isIronman, isOneLife, isGrindman }) {
  const mode = isGrindman ? 'grindman' : isIronman ? (isOneLife ? 'ironman_onelife' : 'ironman') : 'standard'
  if (isIronman) {
    return {
      mode,
      canUseTradingPost: false,
      note: 'Ironman: no trading post. Only General Store stock, quest shops, skill capes and unlocked slayer gear can be bought — everything else must be earned.',
    }
  }
  if (isGrindman) {
    return {
      mode,
      canUseTradingPost: true,
      note: 'Grindman: can buy on the trading post, except collection-log uniques and anything built from one — those have to drop.',
    }
  }
  return { mode, canUseTradingPost: true }
}

/**
 * The best combat prayer this character can switch on for a style, and the
 * levels it produces. Boosts run through the engine's own applyPrayerBonuses,
 * so a prayer's effect here is the one the fight applies.
 */
function bestPrayerFor(style, levels) {
  const wanted = style === 'melee' ? ['attack', 'strength'] : style === 'ranged' ? ['ranged'] : ['magic']
  let best = null
  let bestBoost = 0
  for (const prayer of Object.values(prayersData)) {
    if (prayer.bonusType === 'protection') continue
    if ((prayer.level || 1) > (levels.prayer || 1)) continue
    const stats = prayer.bonusType === 'multi_stat' ? prayer.stats || {} : { [prayer.stat]: prayer.boostPercent }
    const boost = wanted.reduce((s, stat) => s + (Number(stats[stat]) || 0), 0)
    if (boost > bestBoost) { bestBoost = boost; best = prayer }
  }
  return best
}

function boostedLevels(levels, prayer) {
  if (!prayer) return levels
  return applyPrayerBonuses({ ...levels }, prayer.id, prayersData)
}

/** Worn gear read back as a loadout the scorers accept. */
function currentLoadout(state, itemsLookup = itemsData) {
  const equipment = {}
  for (const [slot, entry] of Object.entries(state?.equipment || {})) {
    if (entry?.itemId || entry?.id) {
      equipment[slot] = { itemId: entry.itemId ?? entry.id, quantity: entry.quantity ?? 1, charges: entry.charges }
    }
  }
  // Resolved through the engine's own funnel, because a staff with no spell
  // selected does not splash — combat.js swings it as melee. Reading the raw
  // weapon type would report the player's live setup as zero damage.
  const { combatType, needsSpell, spell } = resolveMagicSpell(
    equipment, itemsLookup, state?.settings?.activeCombatSpell || null, spellsData,
  )
  return {
    style: needsSpell ? 'melee' : combatType,
    stance: state?.settings?.combatStance || 'accurate',
    spell: spell ? { id: spell.id, name: spell.name } : null,
    _spell: spell,
    equipment,
  }
}

function describeLoadout(loadout, extra = {}) {
  return {
    style: loadout.style,
    stance: loadout.stance,
    ...(loadout.spell ? { spell: loadout.spell.name } : {}),
    gear: Object.fromEntries(Object.entries(loadout.equipment)
      .map(([slot, e]) => [slot, itemsData[e.itemId]?.name || e.itemId])),
    ...extra,
  }
}

/**
 * The target the analysis is measured against, and the notes an answer needs
 * to be honest about it. A named monster contributes every form it rotates
 * through; an unnamed one contributes the average monster at this combat level.
 */
function resolveTarget(monsterId, combatLevel) {
  if (!monsterId) {
    const ref = referenceTarget(monstersData, combatLevel)
    return { targets: ref.targets, monster: null, label: ref.name, sampleSize: ref.sampleSize }
  }
  const monster = getMonster(monsterId)
  if (!monster) throw new Error(`No monster with id '${monsterId}'. Find one with list_monsters.`)
  return {
    targets: monsterTargets({ ...monster, id: monsterId }),
    monster,
    label: monster.name || monsterId,
    // Health the fight actually removes, not the opening bar: a phased boss
    // adds every phase and a double-kill boss counts twice. Reading
    // `monster.hitpoints` would quote a time-to-kill for a fraction of the fight.
    fightHitpoints: bossFightHitpoints({ ...monster, id: monsterId }, monstersData),
  }
}

/**
 * Defensive read on a named monster: what it hits for, in which style, and so
 * which protection prayer to run. A "best setup" answer that only covers
 * offence sends the player in with the wrong prayer.
 */
function targetThreat(monster, targets) {
  if (!monster) return null
  const styles = [...new Set(targets.map((t) => t.attackStyle).filter(Boolean))]
  const protection = { magic: 'Protect from Magic', ranged: 'Protect from Missiles' }
  const worst = targets.reduce((a, b) => ((b.maxHit || 0) > (a.maxHit || 0) ? b : a), targets[0])
  return {
    maxHit: worst?.maxHit ?? 0,
    attackStyles: styles,
    protectionPrayer: styles.length === 1
      ? (protection[styles[0]] || 'Protect from Melee')
      : 'switches style — watch the wind-up',
  }
}

/** Where an item comes from, trimmed to the few rows an answer can use. */
function briefSources(itemId) {
  const src = itemSources(itemId)
  if (!src) return undefined
  const out = {}
  if (src.monsters) out.monsters = src.monsters.slice(0, 3).map((m) => m.monster || m.name || m)
  for (const key of ['clues', 'raids', 'skills', 'combines', 'shop']) if (src[key]) out[key] = src[key]
  return Object.keys(out).length ? out : undefined
}

function upgradeList({ ownedBest, openBest, targets, levels, slayerTask, monsterId, limit = 5 }) {
  const swaps = loadoutSwaps({ from: ownedBest, to: openBest, itemsData, targets, levels, slayerTask, monsterId })
  return swaps
    .filter((s) => s.to && s.to.itemId !== s.from?.itemId)
    .slice(0, limit)
    .map((s) => ({
      slot: s.slot,
      item: s.to.name,
      itemId: s.to.itemId,
      replaces: s.from?.name || 'nothing',
      ...(s.dpsGainPercent == null ? {} : { dpsGainPercent: s.dpsGainPercent }),
      requirements: itemsData[s.to.itemId]?.requirements || null,
      sources: briefSources(s.to.itemId),
    }))
}

/**
 * @param {object} state - decoded save
 * @param {object} opts - style ('melee'|'ranged'|'magic'|'all'), monster_id,
 *   gear_scope ('owned'|'all'), include (['upgrades','levels']), at_level
 */
export function analyzeDps(state, {
  style = 'all',
  monsterId = null,
  gearScope = 'owned',
  include = [],
  atLevel = null,
  accountModes = null,
} = {}) {
  // The characters row is the server's own account identity (§14); the save's
  // mirror is the fallback for a direct call.
  const modes = accountModes || {
    isIronman: state?.player?.is_ironman === true,
    isOneLife: state?.player?.is_one_life === true,
    isGrindman: state?.player?.is_grindman === true,
  }
  const levels = levelsFromSave(state)
  const combatLevel = combatLevelFromStats(state?.stats || {})
  const completedQuests = completedQuestsFromSave(state)
  const slayerTask = state?.settings?.slayerTask || null
  const { targets, monster, label, sampleSize, fightHitpoints } = resolveTarget(monsterId, combatLevel)
  const styles = style === 'all' ? COMBAT_STYLES : [style]
  for (const s of styles) {
    if (!COMBAT_STYLES.includes(s)) throw new Error(`Unknown combat style '${s}'. Use melee, ranged, magic or all.`)
  }
  const { pool: owned, quantities } = ownedPool(state)
  const wants = new Set(include)

  // A spell the character has no runes for is not a setup they can run today.
  const inventory = (state?.inventory || []).filter(Boolean)
  const bank = state?.bank || {}
  const ownsRunesFor = (spell) => hasRequiredRunes(spell?.runeReq, inventory, bank, state?.equipment || {}, itemsData)

  const baseSearch = {
    itemsData, spellsData, completedQuests, targets, slayerTask, monsterId,
  }

  const analysis = { styles: {} }
  for (const s of styles) {
    const prayer = bestPrayerFor(s, levels)
    const searchLevels = boostedLevels(levels, prayer)
    const ownedBest = optimiseStyle({
      ...baseSearch, style: s, pool: owned, levels: searchLevels, requirementLevels: levels,
      ownedQuantities: quantities, spellFilter: ownsRunesFor,
    })
    if (!ownedBest) {
      analysis.styles[s] = { available: false, reason: `No usable ${s} weapon owned (or no ammo for the ones you have).` }
      continue
    }
    const entry = {
      dps: round(ownedBest.dps),
      maxHit: ownedBest.maxHit,
      accuracy: round(ownedBest.accuracy * 100, 1),
      attackSpeedTicks: ownedBest.attackSpeedTicks,
      prayer: prayer ? prayer.name : null,
      ...describeLoadout(ownedBest),
    }
    if (monster) entry.timeToKillSeconds = round(timeToKill(fightHitpoints, ownedBest.dps), 1)
    // A boss that is immune to this style in some of its forms (Hellbound
    // Gorilla, Nylocas) does not just deal less damage — it takes NONE for that
    // share of the fight, which is the whole reason to switch styles mid-kill.
    if (ownedBest.immuneShare > 0) {
      entry.immuneFormShare = round(ownedBest.immuneShare * 100, 0)
      entry.immuneNote = `Immune to ${s} in ${round(ownedBest.immuneShare * 100, 0)}% of its forms — switch style when it changes.`
    }
    analysis.styles[s] = entry
    analysis.styles[s]._loadout = ownedBest
    analysis.styles[s]._levels = searchLevels
  }

  const ranked = Object.entries(analysis.styles)
    .filter(([, v]) => v._loadout)
    .sort((a, b) => b[1]._loadout.dps - a[1]._loadout.dps)
  const bestStyle = ranked[0]?.[0] || null
  const bestEntry = ranked[0]?.[1] || null

  // The same search over gear the account could go and BUY. Run unconditionally
  // because it is the honest answer for most accounts: a stack of arrows sitting
  // on the trading post is not a future upgrade, it is the setup they should be
  // using today. It collapses to nothing for an Ironman, whose acquirable pool
  // is barely wider than their bank.
  const coins = Math.floor(Number(state?.coins) || 0)
  const { pool: buyable, via: acquiredVia } = acquirablePool(owned, {
    ...modes,
    isMaxed: isMaxedAccount(state),
    // Slayer reward gear already bought with slayer points sells for coins —
    // omit this and gear the character has earned the right to buy reads as
    // unobtainable, Ironmen included.
    slayerStoreUnlocks: state?.settings?.slayerStoreUnlocks || null,
  }, coins)
  let bestBuy = null
  if (buyable.size > owned.size) {
    for (const s of styles) {
      const searchLevels = boostedLevels(levels, bestPrayerFor(s, levels))
      const loadout = optimiseStyle({
        ...baseSearch, style: s, pool: buyable, levels: searchLevels, requirementLevels: levels,
        ownedQuantities: quantities, spellFilter: ownsRunesFor,
      })
      if (loadout && (!bestBuy || loadout.dps > bestBuy.loadout.dps)) bestBuy = { style: s, loadout, searchLevels }
    }
  }

  const current = currentLoadout(state)
  const currentDps = current.equipment.weapon
    ? estimateDpsVsTargets(targets, {
      style: current.style, stance: current.stance, spell: current._spell,
      levels: boostedLevels(levels, bestPrayerFor(current.style, levels)),
      equipment: current.equipment, itemsData, slayerTask, monsterId,
    })
    : { dps: 0, maxHit: 0, accuracy: 0 }

  const out = {
    target: {
      name: label,
      ...(monster
        ? {
          monsterId,
          hitpoints: fightHitpoints,
          defenceLevel: monster.stats?.defence ?? null,
          magicLevel: monster.stats?.magic ?? null,
          defenceBonus: targets.length === 1 ? targets[0].defenceBonus : 'varies by form',
          forms: targets.length > 1 ? targets.map((t) => t.formKey) : undefined,
          threat: targetThreat(monster, targets),
        }
        : { basis: `average of ${sampleSize} monsters near combat level ${combatLevel}` }),
    },
    // Slayer and Dungeoneering are here because they GATE combat gear (chaotic
    // weapons, slayer helms, the Arcane Necklace) without entering any damage
    // formula — without them the helper cannot say why a piece is locked.
    playerLevels: Object.fromEntries(DPS_SKILLS.concat('prayer', 'slayer', 'dungeoneering').map((k) => [k, levels[k]])),
    current: {
      ...describeLoadout(current),
      dps: round(currentDps.dps),
      maxHit: currentDps.maxHit,
      accuracy: round((currentDps.accuracy || 0) * 100, 1),
    },
    bestOwned: bestStyle
      ? {
        style: bestStyle,
        dps: bestEntry.dps,
        improvementPercent: currentDps.dps > 0
          ? round(((bestEntry._loadout.dps - currentDps.dps) / currentDps.dps) * 100, 1)
          : null,
        swaps: loadoutSwaps({
          from: current, to: bestEntry._loadout, itemsData, targets,
          levels: bestEntry._levels, slayerTask, monsterId,
        }).filter((s) => s.to || s.from).slice(0, 8)
          .map((s) => ({ slot: s.slot, wear: s.to?.name || '(nothing)', instead: s.from?.name || '(empty)' })),
      }
      : null,
    account: accountSummary(modes),
    byStyle: Object.fromEntries(Object.entries(analysis.styles).map(([k, v]) => {
      const { _loadout, _levels, style: _style, ...rest } = v
      return [k, rest]
    })),
    notes: [...DPS_MODEL_NOTES],
  }

  if (slayerTask?.monsterId && monsterId && slayerTask.monsterId === monsterId) {
    out.notes.unshift('Slayer-task gear bonuses are included — this monster is your current task.')
  }

  // Only worth reporting when the shopping trip actually beats the wardrobe.
  const ownedBestDps = bestEntry?._loadout?.dps || 0
  if (bestBuy && bestBuy.loadout.dps > ownedBestDps * 1.001) {
    const buy = loadoutSwaps({
      from: bestEntry?._loadout?.style === bestBuy.style ? bestEntry._loadout : null,
      to: bestBuy.loadout, itemsData, targets, levels: bestBuy.searchLevels, slayerTask, monsterId,
    })
      .filter((s) => s.to && !owned.has(s.to.itemId))
      .slice(0, 6)
      .map((s) => {
        const acquisition = acquiredVia.get(s.to.itemId)
        return {
          slot: s.slot,
          item: s.to.name,
          itemId: s.to.itemId,
          via: acquisition?.via === 'shop' ? 'General Store' : 'Trading Post',
          roughCost: acquisition?.cost ?? 0,
          // Ammo and other stackables are priced per unit, and a bow gets
          // through hundreds — quoting one arrow's price as the bill would be
          // an order of magnitude out.
          ...(itemsData[s.to.itemId]?.stackable ? { costIsPerUnit: true } : {}),
          ...(s.dpsGainPercent == null ? {} : { dpsGainPercent: s.dpsGainPercent }),
        }
      })
    const roughTotalCost = buy.reduce((sum, b) => sum + b.roughCost, 0)
    out.bestBuyable = {
      style: bestBuy.style,
      dps: round(bestBuy.loadout.dps),
      gainOverOwnedPercent: ownedBestDps > 0
        ? round(((bestBuy.loadout.dps - ownedBestDps) / ownedBestDps) * 100, 1)
        : null,
      coins,
      roughTotalCost,
      // Each piece is affordable on its own — the pool is filtered on that —
      // but the bill for all of them may not be.
      ...(roughTotalCost > coins ? { affordAllPieces: false } : {}),
      buy,
      ...describeLoadout(bestBuy.loadout),
    }
    out.notes.push('bestBuyable only contains gear they can afford right now. Costs are shop value — a rough guide, per unit where costIsPerUnit is set (ammo is bought by the hundred); Trading Post prices are player-set, so call search_market for a real quote.')
  }

  // ── Opt-in extras ──

  if (wants.has('upgrades') || gearScope === 'all') {
    // Every requested style is searched, not just the one their current gear
    // favours: new gear can flip the answer, and "you'd be better off on magic"
    // is exactly what this question is asking. Only the winner is itemised,
    // because three annotated shopping lists do not fit the payload budget.
    const open = []
    for (const s of styles) {
      const searchLevels = boostedLevels(levels, bestPrayerFor(s, levels))
      const loadout = optimiseStyle({ ...baseSearch, style: s, pool: fullPool(), levels: searchLevels, requirementLevels: levels })
      if (loadout) open.push({ style: s, loadout, searchLevels })
    }
    open.sort((a, b) => b.loadout.dps - a.loadout.dps)
    const top = open[0]
    if (top) {
      const ownedBest = analysis.styles[top.style]?._loadout || null
      out.upgrades = {
        style: top.style,
        dps: round(top.loadout.dps),
        dpsByStyle: Object.fromEntries(open.map((o) => [o.style, round(o.loadout.dps)])),
        gainOverOwnedPercent: ownedBest && ownedBest.dps > 0
          ? round(((top.loadout.dps - ownedBest.dps) / ownedBest.dps) * 100, 1)
          : null,
        items: upgradeList({ ownedBest, openBest: top.loadout, targets, levels: top.searchLevels, slayerTask, monsterId }),
      }
      out.notes.push('Upgrades are the best gear in the game they already meet the requirements for — not gear that needs higher levels.')
    }
  }

  if (wants.has('levels') || atLevel) {
    const loadout = bestEntry?._loadout || null
    if (wants.has('levels')) {
      out.levelGains = levelUplift({
        loadout, targets, levels, itemsData, slayerTask, monsterId,
        boost: (raw) => boostedLevels(raw, bestPrayerFor(bestStyle || 'melee', raw)),
      })
    }
    if (atLevel) {
      const raised = { ...levels }
      for (const skill of DPS_SKILLS) raised[skill] = Math.max(raised[skill], Math.min(99, Math.floor(atLevel)))
      const prayer = bestPrayerFor(bestStyle || 'melee', raised)
      const at = optimiseStyle({
        ...baseSearch, style: bestStyle || 'melee', pool: gearScope === 'all' ? fullPool() : owned,
        levels: boostedLevels(raised, prayer), requirementLevels: raised,
        ownedQuantities: gearScope === 'all' ? null : quantities,
        spellFilter: gearScope === 'all' ? null : ownsRunesFor,
      })
      if (at) {
        out.atLevel = {
          level: Math.min(99, Math.floor(atLevel)),
          style: at.style,
          dps: round(at.dps),
          gainPercent: bestEntry ? round(((at.dps - bestEntry._loadout.dps) / bestEntry._loadout.dps) * 100, 1) : null,
          ...describeLoadout(at),
        }
      }
    }
  }

  return out
}
