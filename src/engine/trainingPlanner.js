/**
 * "How many bones to 77 Prayer?" — answered from the game's own tables instead
 * of by a language model doing arithmetic in prose.
 *
 * Pure logic, no UI imports. Read-only: it grants nothing and mutates nothing,
 * so it needs no save lock and no audit row.
 *
 * Three things make this worth a module rather than a prompt. (1) The best
 * option at a level is NOT the obvious one — Prayer's `scatter_gargoyle_dust`
 * (125 XP) beats `altar_big_bones` (52 XP) from level 20, and a model asked for
 * "bones" skips it because dust is not a bone. (2) Some options are gated
 * outside the skill (a gilded altar needs Construction 75), so an ungated
 * ladder recommends training the player cannot do. (3) The account type moves
 * every number: a Grindman banks half XP, so the honest answer to the same
 * question is roughly double. Any one of those silently doubles or halves the
 * answer, and none of them are visible in the result.
 *
 * The walk is bounded: it advances one SEGMENT per iteration (a run of levels
 * sharing one best action), not one action, so planning 1→99 costs a handful of
 * iterations rather than millions. Cooking is the exception — burn chance moves
 * with every level — so a burn-prone action steps level by level, still ≤99.
 */

import skillsData from '../data/skills.json'
import itemsData from '../data/items.json'
import { getXPForLevel, getLevelFromXP } from './experience.js'
import { GRINDMAN_MULTIPLIERS } from './grindman.js'
import { burnChance, getEffectiveToolActionTicks } from './skilling.js'
import { getPickpocketTicks } from './thieving.js'
import { BUILDING_ACTIONS } from './construction.js'
import { MAX_LEVEL, MAX_XP, TICK_DURATION } from '../utils/constants.js'

/** Gilded-altar offerings need a house to put the altar in. */
export const GILDED_ALTAR_CONSTRUCTION_LEVEL = 75

/** Which key holds a skill's trainable options; they are not all `actions`. */
const ACTION_KEYS = ['actions', 'courses', 'npcs', 'options']

/**
 * Ladders that do not live in skills.json. Construction is trained by building
 * with planks (`BUILDING_ACTIONS`, its own module and a live `train_construction`
 * intent) — and it is the skill the gilded-altar gate sends Prayer planners to,
 * so leaving it unplannable made the helper refuse the follow-up question it had
 * just prompted. Same field shape, so nothing downstream needs to care.
 */
const EXTERNAL_LADDERS = {
  construction: { name: 'Construction', actions: () => BUILDING_ACTIONS },
}

/**
 * Requirements a training option carries that live OUTSIDE its own skill.
 * Keyed by a predicate over the action id, because that is how the live
 * training path gates them (functions/_lib/mcp/intents.js).
 */
const EXTERNAL_GATES = [
  {
    match: (action) => action.id.startsWith('altar_'),
    skill: 'construction',
    level: GILDED_ALTAR_CONSTRUCTION_LEVEL,
    reason: (lvl) => `needs a gilded altar (Construction ${GILDED_ALTAR_CONSTRUCTION_LEVEL}, you are ${lvl})`,
  },
]

// Lazy, never a top-level initializer reading skillsData: the single-file build
// concatenates modules in order, and an eval-time read of another module's
// binding lands in its temporal dead zone (CLAUDE.md §12).
let plannableIds = null
export function plannableSkillIds() {
  if (!plannableIds) {
    const ids = [...Object.keys(skillsData), ...Object.keys(EXTERNAL_LADDERS)]
    plannableIds = [...new Set(ids)].filter((id) => actionsFor(id).length > 0)
  }
  return plannableIds
}

function actionsFor(skillId) {
  const external = EXTERNAL_LADDERS[skillId]
  if (external) return external.actions()
  const skill = skillsData[skillId]
  if (!skill) return []
  const key = ACTION_KEYS.find((k) => Array.isArray(skill[k]) && skill[k].length)
  return key ? skill[key] : []
}

function skillNameOf(skillId) {
  return EXTERNAL_LADDERS[skillId]?.name || skillsData[skillId]?.name || skillId
}

function itemName(id) {
  return itemsData[id]?.name || id
}

/**
 * Everything an action consumes. Magic declares its runes as `runeReq` rather
 * than `materials`, so reading one field listed a Magic plan as costing
 * nothing at all — and left `fewest_items` with no materials to count.
 */
function materialsOf(action) {
  return { ...(action.materials || {}), ...(action.runeReq || {}) }
}

function materialUnits(action) {
  return Object.values(materialsOf(action)).reduce((sum, qty) => sum + (Number(qty) || 0), 0)
}

/**
 * How long one action takes. Not `action.ticks`: thieving npcs carry
 * `pickpocketTicks` (and default to 4) so every one of them read as a single
 * tick, quoting 15 hours to 99 and ranking the slowest npc top. Tools are
 * applied too — a dragon axe is most of woodcutting's real speed.
 */
function ticksOf(action, ctx, level) {
  const base = ctx.skillId === 'thieving'
    ? getPickpocketTicks(action)
    : Math.max(1, Number(action.ticks) || 1)
  // Always through the engine's own tool model, even with no gear: working a
  // pickaxe-less mine really is NO_TOOL_ACTION_TICK_MULTIPLIER slower, so
  // quoting the raw tick count would halve every toolless estimate.
  const gear = ctx.gear || {}
  // The level the player will BE during this segment, not the one they start
  // at: a tool is gated on the skill it speeds up, so a frozen starting level
  // never credits an axe the plan itself unlocks on the way to 99.
  const stats = { ...(gear.stats || {}), [ctx.skillId]: { xp: getXPForLevel(level) } }
  const ticks = getEffectiveToolActionTicks(ctx.skillId, base, gear.equipment || {}, itemsData, stats, gear.inventory || [], action)
  return Math.max(1, Number(ticks) || base)
}

/**
 * XP per unit of the thing being optimised. `fastest` ranks by XP per tick
 * (real time); `fewest_items` ranks by XP per material consumed. They agree
 * only when every option costs the same ticks and materials — true for Prayer,
 * false for most production skills, which is why the objective is explicit
 * rather than assumed.
 */
function scoreAction(action, effectiveXp, ctx, level) {
  if (ctx.objective === 'fewest_items') {
    const units = materialUnits(action)
    return units > 0 ? effectiveXp / units : Infinity
  }
  return effectiveXp / ticksOf(action, ctx, level)
}

/**
 * XP one action actually banks at this level, before the account cut. A cook
 * that burns eats the raw fish and pays nothing, so its expected XP is the
 * listed value scaled by the chance it survives.
 */
function effectiveXpAt(action, level) {
  const base = Math.max(0, Number(action.xp) || 0)
  return base * (1 - burnChance(level, action))
}

/**
 * Options this character may actually train right now, plus why each rejected
 * one was rejected. The rejections are half the answer: "94 Gargoyle Dust, or
 * 224 big bones' worth less if you had Construction 75" is a better answer than
 * a number on its own.
 */
function partitionByGates(actions, levels) {
  const usable = []
  const blocked = []
  for (const action of actions) {
    const gate = EXTERNAL_GATES.find((g) => g.match(action))
    const have = gate ? Math.max(1, Number(levels?.[gate.skill]) || 1) : 0
    if (gate && have < gate.level) {
      blocked.push({ actionId: action.id, name: action.name, reason: gate.reason(have) })
    } else {
      usable.push(action)
    }
  }
  return { usable, blocked }
}

/** Does the player hold every material this action consumes? */
function suppliedBy(action, owned) {
  const materials = Object.keys(materialsOf(action))
  if (!materials.length) return false
  return materials.every((itemId) => (Number(owned?.[itemId]) || 0) > 0)
}

/**
 * `owned` breaks EXACT ties only, never outranks a better option. Burying
 * nagadoth bones and scattering gargoyle dust both pay 125 XP over 3 ticks, so
 * with nothing to separate them the planner used to send a player with 1,200
 * bones in the bank out to buy dust instead. A tie is the one place "use what
 * you already have" is free.
 */
function bestAt(actions, level, ctx) {
  let best = null
  let bestScore = -Infinity
  let bestSpeed = -Infinity
  for (const action of actions) {
    if ((Number(action.level) || 1) > level) continue
    const xp = effectiveXpAt(action, level)
    if (!(xp > 0)) continue
    const score = scoreAction(action, xp, ctx, level)
    const speed = xp / ticksOf(action, ctx, level)
    if (!best) {
      best = action
      bestScore = score
      bestSpeed = speed
      continue
    }
    // Speed settles a tie before `owned` does, and it is what makes
    // `fewest_items` usable on a gathering skill at all: every option there
    // consumes nothing, so they all score Infinity and the objective has
    // nothing left to say — without this the first-listed (worst) action won
    // the whole run, costing a million shrimps for 99 Fishing.
    let better = score > bestScore
    if (!better && score === bestScore) {
      better = speed > bestSpeed || (speed === bestSpeed && suppliedBy(action, ctx.owned) && !suppliedBy(best, ctx.owned))
    }
    if (better) {
      best = action
      bestScore = score
      bestSpeed = speed
    }
  }
  return best
}

/**
 * The next level above `level` at which the best option stops being `current`.
 *
 * Asks bestAt rather than re-deriving its comparison, so the two can never
 * disagree — an earlier version scored candidates itself and missed every
 * change bestAt makes on a TIE, stranding the walk on one action for the whole
 * run. Only levels where something unlocks can change the ranking, so this
 * scans those rather than all 99.
 */
function nextChangeLevel(actions, level, current, ctx) {
  const unlocks = [...new Set(actions.map((a) => Number(a.level) || 1))]
    .filter((l) => l > level)
    .sort((a, b) => a - b)
  for (const candidate of unlocks) {
    const best = bestAt(actions, candidate, ctx)
    if (best && best.id !== current.id) return candidate
  }
  return Infinity
}

function addMaterials(into, action, count) {
  for (const [itemId, per] of Object.entries(materialsOf(action))) {
    const qty = (Number(per) || 0) * count
    if (qty > 0) into.set(itemId, (into.get(itemId) || 0) + qty)
  }
}

function materialList(map, owned) {
  return [...map.entries()].map(([itemId, quantity]) => {
    const have = Math.max(0, Math.floor(Number(owned?.[itemId]) || 0))
    return {
      itemId,
      name: itemName(itemId),
      quantity,
      owned: have,
      short: Math.max(0, quantity - have),
    }
  })
}

/**
 * Plan the cheapest route from a skill's current XP to a target level.
 *
 * @param {object} opts
 * @param {string} opts.skillId
 * @param {number} opts.currentXp        the skill's XP now
 * @param {number} opts.targetLevel      1-99
 * @param {Record<string, number>} [opts.levels]  every skill's level, for gates
 *   outside the trained skill. A missing skill reads as level 1, so pass them
 *   all or a gated option is wrongly excluded.
 * @param {Record<string, number>} [opts.owned]   itemId -> quantity held
 * @param {'fastest'|'fewest_items'} [opts.objective]
 * @param {boolean} [opts.isGrindman]    halves every gain, per GRINDMAN_MULTIPLIERS
 * @param {{equipment?: object, inventory?: any[], stats?: object}} [opts.gear]
 *   worn/carried kit, so tool speed-ups count toward the time estimate. Omit and
 *   the plan quotes untooled ticks.
 * @returns {object} plan payload, or `{ error }` when the skill has no ladder
 */
export function planTraining({
  skillId,
  currentXp = 0,
  targetLevel,
  levels = {},
  owned = {},
  objective = 'fastest',
  isGrindman = false,
  gear = null,
} = {}) {
  if (!skillsData[skillId] && !EXTERNAL_LADDERS[skillId]) {
    return { error: 'UNKNOWN_SKILL', message: `No skill '${skillId}'. Plannable skills: ${plannableSkillIds().join(', ')}.` }
  }
  const skill = { name: skillNameOf(skillId) }
  const all = actionsFor(skillId)
  if (!all.length) {
    return {
      error: 'NO_LADDER',
      message:
        `${skill.name} is not trained by repeating an action, so there is nothing to count. ` +
        `Plannable skills: ${plannableSkillIds().join(', ')}.`,
    }
  }

  const startXp = Math.max(0, Math.min(Math.floor(Number(currentXp) || 0), MAX_XP))
  const startLevel = getLevelFromXP(startXp)
  const target = Math.max(1, Math.min(Math.floor(Number(targetLevel) || 0), MAX_LEVEL))
  const targetXp = getXPForLevel(target)
  const mult = isGrindman ? GRINDMAN_MULTIPLIERS.xp : 1

  if (startXp >= targetXp) {
    return {
      skill: skill.name,
      skillId,
      objective,
      accountXpMultiplier: mult,
      from: { level: startLevel, xp: startXp },
      to: { level: target, xp: targetXp },
      xpNeeded: 0,
      alreadyThere: true,
      segments: [],
      totals: { actions: 0, ticks: 0, hours: 0, materials: [] },
      blockedOptions: [],
    }
  }

  const { usable, blocked } = partitionByGates(all, levels)
  const ctx = { skillId, objective, owned, gear }
  const segments = []
  const totalMaterials = new Map()
  let xp = startXp
  let totalActions = 0
  let totalTicks = 0
  let sawBurn = false

  // One iteration per segment; a burn-prone action narrows a segment to a
  // single level, so the bound is levels-walked, never actions-performed.
  for (let guard = 0; xp < targetXp && guard < 2 * MAX_LEVEL; guard++) {
    const level = getLevelFromXP(xp)
    const action = bestAt(usable, level, ctx)
    if (!action) {
      // Not every skill's ladder starts at level 1 — Magic's lowest option is
      // level 7, because the levels below it come from casting in combat. Say
      // where the ladder begins rather than just that nothing matched.
      const starts = usable.reduce((min, a) => Math.min(min, Number(a.level) || 1), Infinity)
      return {
        error: 'NO_OPTION',
        message:
          (Number.isFinite(starts)
            ? `Nothing trains ${skill.name} below level ${starts} — reach ${starts} another way first (you are ${level}).`
            : `Nothing trains ${skill.name} at level ${level}.`) +
          (blocked.length ? ` Locked options that would: ${blocked.map((b) => `${b.name} ${b.reason}`).join('; ')}.` : ''),
        blockedOptions: blocked,
      }
    }
    // Any AVAILABLE burning option, not just the chosen one: burn decays with
    // every level, so a burning rival can overtake a flat one between unlocks
    // and the ranking has to be re-checked each level until none of them burn.
    const burning = usable.some((a) => (Number(a.level) || 1) <= level && burnChance(level, a) > 0)
    if (burning) sawBurn = true
    const changesAt = nextChangeLevel(usable, level, action, ctx)
    const segEndLevel = Math.min(target, changesAt, burning ? level + 1 : MAX_LEVEL)
    const segEndXp = getXPForLevel(segEndLevel)
    const needed = segEndXp - xp

    const perAction = effectiveXpAt(action, level) * mult
    if (!(perAction > 0)) {
      return { error: 'NO_PROGRESS', message: `${action.name} banks no XP for this account at level ${level}.` }
    }
    const count = Math.ceil(needed / perAction)
    // Mirrors bankXp: the account cut floors the BATCH, not each action, so a
    // run of N is worth floor(N * xp * mult) and not N * floor(xp * mult).
    const banked = Math.floor(count * effectiveXpAt(action, level) * mult)
    const ticks = count * ticksOf(action, ctx, level)

    const segMaterials = new Map()
    addMaterials(segMaterials, action, count)
    addMaterials(totalMaterials, action, count)

    const last = segments[segments.length - 1]
    if (last && last.actionId === action.id) {
      // Burn stepping splits one action across many levels; report it once.
      last.toLevel = segEndLevel
      last.actions += count
      last.xpGained += banked
      last.ticks += ticks
      for (const [itemId, qty] of segMaterials) last.materials[itemId] = (last.materials[itemId] || 0) + qty
    } else {
      segments.push({
        actionId: action.id,
        name: action.name,
        fromLevel: level,
        toLevel: segEndLevel,
        actions: count,
        xpGained: banked,
        ticks,
        materials: Object.fromEntries(segMaterials),
      })
    }

    totalActions += count
    totalTicks += ticks
    xp += banked
  }

  // Derived after the merge, never captured at the segment's first level: a
  // burn-stepped run spans levels whose XP per action differs, and quoting the
  // first one contradicts the segment's own xpGained / actions.
  for (const seg of segments) {
    seg.xpEach = seg.actions > 0 ? Math.round((seg.xpGained / seg.actions) * 100) / 100 : 0
  }

  // Only options that would actually BEAT what the plan settled on. Listing
  // every locked option called `altar_bones` (17 XP) faster training than the
  // Gargoyle Dust (125 XP) the plan already uses, and the helper repeats it.
  const worthUnlocking = blocked.filter((b) => {
    const action = all.find((a) => a.id === b.actionId)
    if (!action) return false
    const at = Math.max(startLevel, Number(action.level) || 1)
    if (at > target) return false
    const rival = bestAt(usable, at, ctx)
    if (!rival) return true
    return scoreAction(action, effectiveXpAt(action, at), ctx, at) > scoreAction(rival, effectiveXpAt(rival, at), ctx, at)
  })

  const notes = []
  if (mult !== 1) notes.push("Grindman: every gain is halved, so this is about double a normal account's count.")
  if (sawBurn) {
    notes.push('Counts are expected values — burnt food is consumed but pays no XP, so a real run varies either side of this.')
  }
  if (worthUnlocking.length) {
    notes.push(`Locked options that would beat this plan: ${worthUnlocking.map((b) => `${b.name} (${b.reason})`).join('; ')}.`)
  }

  return {
    skill: skill.name,
    skillId,
    objective,
    accountXpMultiplier: mult,
    from: { level: startLevel, xp: startXp },
    to: { level: target, xp: targetXp },
    xpNeeded: targetXp - startXp,
    segments,
    totals: {
      actions: totalActions,
      ticks: totalTicks,
      hours: Math.round((totalTicks * TICK_DURATION) / 360_000) / 10,
      materials: materialList(totalMaterials, owned),
    },
    blockedOptions: worthUnlocking,
    notes,
  }
}

/**
 * Shed detail until the serialised plan fits a caller's budget.
 *
 * The MCP result is hard-sliced at `CHAT_MAX_TOOL_RESULT_CHARS`, and a payload
 * cut mid-JSON is one the model reads WRONG rather than reads short — so this
 * drops whole fields in a fixed order instead of letting the string be
 * truncated. Herblore 1→99 is the widest plan (13 segments, 26 materials).
 *
 * Best effort, not a guarantee: `totals` is never shed because it IS the
 * answer, so a budget smaller than the totals alone returns the irreducible
 * core rather than a broken payload. Callers pick a budget above that floor.
 */
export function compactTrainingPlan(plan, maxChars, serialise = JSON.stringify) {
  if (!plan || plan.error) return plan
  const size = (p) => serialise(p).length
  if (size(plan) <= maxChars) return plan
  const omitted = []

  let out = { ...plan, segments: plan.segments.map(({ materials, ...rest }) => rest) }
  omitted.push('the per-segment material split (totals still list every material)')
  if (size(out) <= maxChars) return withOmissionNote(out, omitted)

  out = { ...out, segments: out.segments.map(({ ticks, xpEach, ...rest }) => rest) }
  omitted.push('per-segment ticks and XP-per-action')
  if (size(out) <= maxChars) return withOmissionNote(out, omitted)

  // Last resort: the early segments of a long plan are the short ones.
  out = { ...out, segments: out.segments.slice(-6) }
  omitted.push('all but the last 6 segments')
  return withOmissionNote(out, omitted)
}

function withOmissionNote(plan, omitted) {
  return { ...plan, notes: [...(plan.notes || []), `Trimmed to fit: omitted ${omitted.join(', ')}.`] }
}
