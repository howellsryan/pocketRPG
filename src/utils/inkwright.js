import { actionCycleMs } from './actionSprites.js'

// ──────────────────────────────────────────────────────────────────────────
// Inkwright — the skilling figure. One inked-vector character, reused across
// every gathering skill: the tool and the motion change per skill, the figure
// never does. Design record: docs/action-animations.md; checklist: the
// `action-animation` skill.
//
// This is the SECOND presentation on the action-animation foundation, not a
// second timing system. ActionSpriteStage draws a tool glyph in a lane between
// two combatants; a skilling action has one actor working on a resource, and
// the thing the player is waiting for is the resource giving way. So the stage
// differs and the CADENCE LAW does not — every duration here still comes from
// actionSprites.js.
//
// Where skilling genuinely diverges from combat, and why: a combat cycle is ONE
// swing, so a slower weapon means a slower-looking swing. A skilling action is
// several strikes that end in one yield, so a longer action means MORE strikes
// at the same tempo — runeforged ore takes 23 swings to break, not one slow
// one. Tempo is what a player reads as "how hard am I working"; strike count is
// what they read as "how tough is this rock".
//
// Pure logic — no UI imports, no DOM. The component is
// components/InkwrightStage.jsx.
// ──────────────────────────────────────────────────────────────────────────

// The tempo a strike wants to land at. Not a duration — a TARGET the real
// period is solved back from, so strikes divide the action evenly and the last
// one lands exactly on the yield. Real periods across shipped actions come out
// 720-890ms, which is the point: the player feels one working rhythm whatever
// they are mining.
export const TARGET_STRIKE_MS = 800

// A cap, not a curve. Runeforged ore (30 ticks) wants 23 strikes and gets them;
// this only stops an absurd action from remounting the loop hundreds of times.
const MAX_STRIKES = 40

// Motion vocabulary, keyed by the skill it belongs to. `motion` names a
// keyframe family in src/index.css (.ink-fig--<motion>) AND the tool and prop
// the stage draws, because in skilling those are one decision: a pickaxe swings
// at a rock, an axe at a trunk.
//
// Unlike ActionSpriteStage, the tool is DRAWN, not a masked game-icons glyph.
// A glyph in the hand of an inked figure reads as a sticker on a drawing — the
// tool has to share the figure's outline weight to belong to it. That is a
// handful of paths per motion, kept in the stage beside the figure they hang on.
export const INKWRIGHT_MOTIONS = {
  mine: { motion: 'mine', prop: 'rock',  label: 'Mining' },
  chop: { motion: 'chop', prop: 'tree',  label: 'Woodcutting' },
  fish: { motion: 'fish', prop: 'water', label: 'Fishing' },

  // Tier A (docs/skill-animations-proposal.md): same pattern as the three
  // above, wired onto the existing timing law — a motion, a prop, nothing
  // structurally new.
  kindle: { motion: 'kindle', prop: 'logpile',    label: 'Firemaking' },
  cook:   { motion: 'cook',   prop: 'cookfire',   label: 'Cooking' },
  smith:  { motion: 'smith',  prop: 'anvil',      label: 'Smithing' },
  craft:  { motion: 'craft',  prop: 'bench',      label: 'Crafting' },
  fletch: { motion: 'fletch', prop: 'shavehorse', label: 'Fletching' },
  brew:   { motion: 'brew',   prop: 'mortar',     label: 'Herblore' },
  weave:  { motion: 'weave',  prop: 'runealtar',  label: 'Runecrafting' },

  // Prayer is three DIFFERENT acts, picked by the action id's prefix
  // (inkwrightMotionForSkill's second arg) rather than by skill name alone —
  // the only skill in this tier where that's true. They were one shared
  // `commune` gesture first and that was the wrong economy: digging a hole,
  // laying bones on an altar and casting dust to the wind look nothing like
  // each other, so one motion read as none of them.
  prayer_bury:    { motion: 'bury',    prop: 'grave',       pose: 'bury',    label: 'Burying bones' },
  prayer_altar:   { motion: 'offer',   prop: 'gildedAltar', pose: 'altar',   label: 'Praying at the gilded altar' },
  prayer_scatter: { motion: 'scatter', prop: 'dust',        pose: 'scatter', label: 'Scattering gargoyle dust' },

  // Tier E — construction. Smithing's shape (a hammer landing on a fixed
  // point) with the one difference the tier is named for: the workpiece
  // PERSISTS and gains a part per completed action instead of respawning
  // identical, so a build session visibly assembles furniture.
  build: { motion: 'build', prop: 'scaffold', label: 'Building' },

  // Tier G — magic away from combat. One caster, five spells worth telling
  // apart, picked off the action id (magicMotionKey) exactly the way prayer
  // picks its pose. `cast` is one keyframe family shared by three props:
  // point the staff, charge, release — what changes between alchemy,
  // superheating and transmuting is the SPELL and its target, not the body.
  // Enchanting is a sustained channel and cursing is aimed at something
  // that flinches, so those two are motions of their own.
  magic_alch:      { motion: 'cast',    prop: 'alchPedestal',      label: 'Alchemy' },
  magic_smelt:     { motion: 'cast',    prop: 'smeltPedestal',     label: 'Superheating' },
  magic_transmute: { motion: 'cast',    prop: 'transmutePedestal', label: 'Transmuting' },
  magic_enchant:   { motion: 'enchant', prop: 'enchantPedestal',   label: 'Enchanting' },
  magic_hex:       { motion: 'hex',     prop: 'hexDummy',          label: 'Casting' },

  // Tier D — hunter. The one skill whose action is a WAIT, not a strike: a
  // snare is set once and springs once. The beat is therefore a near-miss
  // (the quarry creeps to the bait, the trapper takes up the trigger line,
  // the quarry shies off) and the trap only fires on the payoff — the same
  // shape fishing already ships, where every beat is a full attempt and only
  // the last one lands. One device, five quarries: a snare that hoists a cow
  // is not the same picture as one that hoists a wizard, and the three
  // targets with a shape of their own — a cow, a herbi, the Grim Reaper —
  // are drawn as themselves rather than left to the two generics.
  hunter_beast:  { motion: 'snare', prop: 'snareBeast',  label: 'Hunting' },
  hunter_mark:   { motion: 'snare', prop: 'snareMark',   label: 'Hunting' },
  hunter_cow:    { motion: 'snare', prop: 'snareCow',    label: 'Hunting' },
  hunter_herbi:  { motion: 'snare', prop: 'snareHerbi',  label: 'Hunting' },
  hunter_reaper: { motion: 'snare', prop: 'snareReaper', label: 'Hunting' },

  // Tier C — thieving. One dip per beat, the mark none the wiser, the purse
  // only coming free on the last. Three props because the targets are not one
  // thing: a cake stall is furniture, and an armoured guard is not a farmer.
  thieving_mark:  { motion: 'pickpocket', prop: 'mark',      label: 'Pickpocketing' },
  thieving_guard: { motion: 'pickpocket', prop: 'markGuard', label: 'Pickpocketing' },
  thieving_stall: { motion: 'pickpocket', prop: 'stall',     label: 'Stealing' },

  // Tier F — summoning. A charge, not a blow: both hands push spirit light
  // into the thing floating over the obelisk, and what comes out of it on the
  // payoff is the familiar taking shape.
  infuse: { motion: 'infuse', prop: 'obelisk', label: 'Infusing' },
}

// Skills whose action is a physical strike/gesture at a resource. Every other
// skill keeps the orb until it gets a motion of its own — a row here with no
// keyframes renders a figure holding a tool perfectly still.
const SKILL_MOTIONS = {
  mining: 'mine',
  woodcutting: 'chop',
  fishing: 'fish',
  firemaking: 'kindle',
  cooking: 'cook',
  smithing: 'smith',
  crafting: 'craft',
  fletching: 'fletch',
  herblore: 'brew',
  runecraft: 'weave',
  construction: 'build',
  summoning: 'infuse',
}

// Prayer's three sub-poses share one motion family but pick a different prop
// off the action id's own prefix — the same `startsWith('altar_')` branch
// SkillingScreen already uses for the gilded-altar Construction gate.
function prayerMotionKey(actionId) {
  const id = String(actionId || '')
  if (id.startsWith('altar_')) return 'prayer_altar'
  if (id.startsWith('scatter_')) return 'prayer_scatter'
  return 'prayer_bury'
}

// Magic's five acts, picked off the action id the same way prayer's three
// are. The id is used rather than skills.json's `type` field because the
// caller only ever has an id in hand (inkwrightMotionForSkill's signature),
// and the two agree one-for-one across every shipped spell. An unrecognised
// id falls to the transmute pedestal — every non-combat spell on this screen
// turns one item into another, so that is the honest default for new content
// rather than a guess at a gesture.
function magicMotionKey(actionId) {
  const id = String(actionId || '')
  if (id.startsWith('enchant_')) return 'magic_enchant'
  if (id === 'high_alch') return 'magic_alch'
  if (id === 'superheat') return 'magic_smelt'
  if (id === 'curse' || id === 'stun') return 'magic_hex'
  return 'magic_transmute'
}

// Hunter's quarry, off the action id. Three targets are drawn as THEMSELVES
// because their own silhouette is the whole point of hunting them — a cow, a
// herbi, and the Grim Reaper, who should not be a hooded traveller like the
// merchants. Everything else falls to one of two generics, and the fallback
// is the beast: that is what "hunting" means before the content says
// otherwise. Adding a target means adding a row here (a bespoke prop) or an
// id to HUNTER_HUMANOIDS (a person); both lists are checked by
// tests/inkwright.test.ts against skills.json, and a prop nothing reaches
// fails the build.
const HUNTER_QUARRIES = {
  hunt_cow: 'hunter_cow',
  hunt_herbi: 'hunter_herbi',
  hunt_grim_reaper: 'hunter_reaper',
}
const HUNTER_HUMANOIDS = new Set([
  'hunt_wizard', 'hunt_jeweller', 'hunt_merchant', 'hunt_master_trader',
])

function hunterMotionKey(actionId) {
  const id = String(actionId || '')
  return HUNTER_QUARRIES[id] || (HUNTER_HUMANOIDS.has(id) ? 'hunter_mark' : 'hunter_beast')
}

// Thieving's target, off the NPC id. A stall has no pockets and an armoured
// guard is not a farmer, and those are the only two distinctions the stage
// can actually draw — everyone else is the same mark in the same clothes.
const THIEVING_GUARDS = new Set(['guard', 'knight', 'ardougne_knight'])

function thievingMotionKey(npcId) {
  const id = String(npcId || '')
  if (id.endsWith('_stall')) return 'thieving_stall'
  if (THIEVING_GUARDS.has(id)) return 'thieving_guard'
  return 'thieving_mark'
}

/** The motion key for a skill, or null if it has no figure yet. `actionId` is
 * only consulted for the skills whose pose depends on which action (or which
 * target) is running: prayer, magic, hunter and thieving. */
export function inkwrightMotionForSkill(skill, actionId) {
  const skillKey = String(skill || '').toLowerCase()
  let key
  if (skillKey === 'prayer') key = prayerMotionKey(actionId)
  else if (skillKey === 'magic') key = magicMotionKey(actionId)
  else if (skillKey === 'hunter') key = hunterMotionKey(actionId)
  else if (skillKey === 'thieving') key = thievingMotionKey(actionId)
  else key = SKILL_MOTIONS[skillKey]
  return key ? INKWRIGHT_MOTIONS[key] : null
}

export function hasInkwrightMotion(skill) {
  return !!inkwrightMotionForSkill(skill)
}

/**
 * Everything the stage needs to animate one action, derived from that action's
 * own tick cost.
 *
 * `ticks` must be the EFFECTIVE cost — what the player's tool actually gets —
 * not the action's base cost. SkillingScreen already stores the tool-adjusted
 * action on the session (`getEffectiveToolActionTicks`), so a Rune pickaxe
 * strikes visibly faster than a Bronze one for free. Passing the base cost
 * silently throws that away, which is the whole law.
 *
 * Returns null for a skill with no figure, so callers can fall back to the orb
 * with a single truthiness check.
 */
export function inkwrightPlan(skill, ticks, actionId) {
  const sprite = inkwrightMotionForSkill(skill, actionId)
  if (!sprite) return null

  const cycleMs = actionCycleMs(ticks)
  // Solve the count from the target, then the period back from the count, so
  // an exact whole number of strikes fills the action. Rounding the PERIOD
  // instead leaves a partial strike at the end and the yield lands mid-windup.
  const strikes = Math.max(1, Math.min(MAX_STRIKES, Math.round(cycleMs / TARGET_STRIKE_MS)))
  const strikePeriodMs = Math.round(cycleMs / strikes)

  return {
    ...sprite,
    cycleMs,
    strikes,
    strikePeriodMs,
    // The yield beat overlaps the first strike of the NEXT action rather than
    // reserving a tail of this one: the engine grants the item at progress 1
    // and immediately starts again, so there is no dead time to reserve. The
    // prop breaks, then returns as the next rock.
    payoffMs: Math.min(900, Math.round(strikePeriodMs * 1.1)),
  }
}
