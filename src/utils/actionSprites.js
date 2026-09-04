import { getAttackSpeed, getAttackStyle } from '../engine/equipment.js'
import { getItemIconTint } from './itemIcons.js'

// ──────────────────────────────────────────────────────────────────────────
// Action sprite animations — the shared foundation for "show me the action",
// combat first, every skill next. Full model + the per-skill rollout recipe:
// docs/action-animations.md; the authoring checklist is the `action-animation`
// skill.
//
// ONE LAW, and it is the whole point of this module: an action's animation is
// timed off THAT ACTION'S OWN CADENCE, never a constant. A 4-tick scimitar
// swings visibly faster than a 7-tick godsword because its cycle is shorter;
// the same arithmetic will pace a Rune pickaxe against a Bronze one. Anything
// that hard-codes a duration has stopped telling the player the truth about
// what they equipped.
//
// This module is pure logic — no UI imports, no DOM — and outlived its first
// renderer: combat originally drew the SPRITE AS A TOOL GLYPH (a game-icons.net
// key masked through skillEmblemMask(), in the now-deleted
// components/ActionSpriteStage.jsx). The current renderer is
// components/InkwrightCombatStage.jsx, a drawn inked-vector figure armed per
// style — but the timing law, the ACTION_SPRITES table and the event→swing
// mapping below are exactly what that renderer runs on too, unchanged. Note
// the table still carries `tool` (the old glyph key, e.g. 'sword'/'bow'/'staff')
// alongside `motion` ('melee'/'ranged'/'magic') — InkwrightCombatStage must
// read `.motion`, never `.tool`.
// ──────────────────────────────────────────────────────────────────────────

/** The game's tick, in ms (CLAUDE.md §1/§6). Local rather than imported: the
 * engine's tick constants are per-module today, and this file must stay
 * import-light so it can be read by any surface. */
export const ACTION_TICK_MS = 600

// A one-shot motion must finish inside its own cycle or two swings overlap and
// the stage reads as noise, and it must stay long enough to be seen at all.
//
// The motion is a SHRINKING FRACTION of a longer cycle, not a fixed one. A
// straight percentage was the first attempt and it is wrong twice over: a
// godsword's swing would run 3.5x a dagger's, which is not what a slow weapon
// looks like (the *gap* between swings already says "slow"), and once the cap
// bound it every weapon of 3 ticks and up animated identically — the exact
// thing this module exists to prevent. A shallow slope off a fixed base keeps
// the motion strictly monotonic in the cycle across everything shipped
// (weapons 3-9 ticks, monsters 2-8), so a faster weapon is always visibly
// faster. The clamps are safety rails for absurd inputs, not part of the
// curve — if a new action ever binds SWING_MAX_MS, re-tune the slope rather
// than letting two different cadences animate the same.
const SWING_BASE_MS = 200
const SWING_PER_CYCLE = 0.11
const SWING_MIN_MS = 240
export const SWING_MAX_MS = 1000

/**
 * How long one full action cycle takes: the cadence the player actually feels.
 * `ticks` is the weapon's attackSpeed, or a skilling action's tick cost.
 */
export function actionCycleMs(ticks, tickMs = ACTION_TICK_MS) {
  const t = Math.max(1, Math.floor(Number(ticks) || 0) || 1)
  return t * (Number(tickMs) > 0 ? Number(tickMs) : ACTION_TICK_MS)
}

/**
 * Duration of the single swing/strike motion inside a cycle. Scales with the
 * cycle — this is what makes a fast weapon LOOK fast — then clamps to the
 * legible window above. Always shorter than the cycle it came from, so the
 * next swing never lands on top of the last one.
 */
export function swingDurationMs(cycleMs) {
  const cycle = Number(cycleMs) > 0 ? Number(cycleMs) : actionCycleMs(4)
  const scaled = Math.round(SWING_BASE_MS + cycle * SWING_PER_CYCLE)
  return Math.min(SWING_MAX_MS, Math.max(SWING_MIN_MS, scaled))
}

// Motion vocabulary. `motion` names a keyframe family in src/index.css
// (.as-tool--<motion>); `projectile` is the glyph that flies actor→target, or
// null for a motion that connects in melee range. Adding a skill means adding a
// row here and its keyframes there — nothing else in this file changes.
export const ACTION_SPRITES = {
  melee:  { motion: 'melee',  tool: 'sword', projectile: null,          label: 'Melee'  },
  ranged: { motion: 'ranged', tool: 'bow',   projectile: 'arrow',       label: 'Ranged' },
  magic:  { motion: 'magic',  tool: 'staff', projectile: 'magic_swirl', label: 'Magic'  },
}

/** Normalise any attack-style key (stab/slash/crush and the three groups) to a
 * sprite key. Mirrors combatArt.js's own styleGroup, kept separate so this
 * module stays free of the combat-art data tables. */
export function spriteStyleKey(style) {
  if (style === 'ranged') return 'ranged'
  if (style === 'magic') return 'magic'
  return 'melee'
}

export function actionSpriteFor(style) {
  return ACTION_SPRITES[spriteStyleKey(style)]
}

// Twelve hand-drawn weapon shapes InkwrightCombatStage's CombatTool draws,
// authored in utils/weaponShapes.js, replacing the one-shape-per-motion
// default (plain sword / longbow / staff).
// This is the SECOND swing at "the weapon should look like the weapon", after
// embedding the actual bespoke inventory icon in the hand (reverted — the icon
// set mixes authoring conventions with no single anchor that lands all 151 of
// them correctly, and a mace-shaped icon anchored wrong is far more obviously
// broken than a style mismatch ever was). This version draws ONE shape per
// TYPE, not per item, so there is a small fixed set to get right instead of
// 151 individual ones, and every item within a type is told apart only by its
// tint (`weaponTint` below) — a bronze scimitar and a dragon scimitar are the
// same silhouette in different colours, same as the real weapons in the
// Armoury. `WEAPON_ICON_TYPES` order matters only for readability below.
// `shortbow` and `dagger` are the same drawings as `longbow` and `sword` at
// half size (utils/weaponShapes.js) rather than shapes of their own — a
// shortbow IS a small longbow and a dagger IS a small sword, so declaring
// them as copies keeps one profile to get right per family.
export const WEAPON_ICON_TYPES = [
  'sword', 'dagger', 'scimitar', 'rapier', 'godsword', 'maul', 'mace',
  'longbow', 'shortbow', 'crossbow', 'staff', 'wand',
]

// Substring rules run BEFORE the mechanical fallback because the item's own
// NAME is more specific than its stats — "dragon_battleaxe" is coded
// attackStyle:'crush' for balance reasons but reads unambiguously as a maul
// shape. Order matters: 'crossbow' must be checked before the bare 'bow'
// pattern (a crossbow id also contains "bow"), and the 'bow' pattern itself
// excludes "bowyer" (bowyers_knife is a stab dagger, not a bow) via the
// negative lookahead — a plain substring match misclassified it.
const NAME_TYPE_RULES = [
  [/crossbow/, 'crossbow'],
  // Before every bow pattern: "bowyers_knife" is a stab dagger whose id
  // contains "bow", and it is the reason the bare bow pattern below carries a
  // negative lookahead at all. That lookahead stays as a second line of
  // defence — this rule only wins while it is ordered ahead of it.
  [/dagger|knife/, 'dagger'],
  [/godsword/, 'godsword'],
  [/maul/, 'maul'],
  [/flail/, 'mace'],
  [/mace/, 'mace'],
  [/warhammer|hammers?(?:_|$)/, 'mace'],
  [/scimitar/, 'scimitar'],
  [/rapier/, 'rapier'],
  [/wand/, 'wand'],
  [/staff|stave/, 'staff'],
  // Shortbow before the bare bow pattern, same ordering reason as crossbow —
  // every shortbow id also contains "bow". A bow that is neither by name
  // (bow_of_faerdhinen, shardglass_bow, 2nd_age_bow) draws as a longbow,
  // which is also where the mechanical fallback below sends an unmatched
  // ranged weapon.
  [/shortbow/, 'shortbow'],
  [/bow(?!yer)/, 'longbow'],
]

/**
 * Classifies an equipped weapon item into one of `WEAPON_ICON_TYPES`, for
 * InkwrightCombatStage's CombatTool to pick a shape. Pure — reads only `id`,
 * `weaponClass`, `attackStyle`, `twoHanded` and `ammoType` off the item, so it
 * needs no DOM and no bespoke-icon data. Unmatched items (tools misfiled into
 * the weapon slot, reskins with no on-brand name) fall back by mechanics:
 * magic to staff, ranged to crossbow only when it actually fires bolts (else
 * longbow), crush to maul/mace by two-handedness, everything else
 * (slash/stab/unset) to godsword/sword by two-handedness — a two-handed reach
 * weapon reads closer to a godsword's big swing than a one-handed sword's.
 *
 * The fallback never reaches `dagger` or `shortbow`: both are the SMALL
 * member of their family, and guessing "small" from stats alone would shrink
 * every unnamed stab weapon. They are claimed by name or not at all.
 */
export function weaponIconTypeFor(item) {
  if (!item) return null
  // Spear-class weapons are thrusting weapons. Reuse the rapier combat shape
  // deliberately so they inherit its existing `.is-lunge` stab animation
  // instead of falling through to the two-handed godsword smash.
  if (item.weaponClass === 'spear') return 'rapier'
  const id = String(item.id || '')
  for (const [pattern, type] of NAME_TYPE_RULES) {
    if (pattern.test(id)) return type
  }
  if (item.attackStyle === 'magic') return 'staff'
  if (item.attackStyle === 'ranged') return item.ammoType === 'bolt' ? 'crossbow' : 'longbow'
  if (item.attackStyle === 'crush') return item.twoHanded ? 'maul' : 'mace'
  return item.twoHanded ? 'godsword' : 'sword'
}

// godsword/maul play a heavier two-handed smash instead of the standard
// one-handed swing (InkwrightCombatStage's `.is-smash` keyframe variant) —
// a set, not a third `motion`, because `motion` drives the whole event/
// timing/co-op contract above and neither of these weapons changes how a
// swing is TIMED, only how it LOOKS.
const SMASH_WEAPON_TYPES = new Set(['godsword', 'maul'])
export function isSmashWeaponType(weaponIconType) {
  return SMASH_WEAPON_TYPES.has(weaponIconType)
}

// A rapier lunges/thrusts instead of swinging — a fencer's attack travels
// along the blade's own axis, not in an arc — so it gets its own `.is-lunge`
// keyframe variant the same way godsword/maul get `.is-smash`: an ADDITIONAL
// class, not a fourth motion, since only the LOOK changes. Spear-class weapons
// are classified to this same combat type above so every spear shares the stab.
const LUNGE_WEAPON_TYPES = new Set(['rapier'])
export function isLungeWeaponType(weaponIconType) {
  return LUNGE_WEAPON_TYPES.has(weaponIconType)
}

/**
 * The player's side of the stage: which tool glyph is shown and how fast it
 * moves, read from what is actually equipped. Unarmed falls through to
 * getAttackSpeed/getAttackStyle's own defaults (4 ticks, crush → sword).
 *
 * Two things the weapon alone does not tell you, and both are on the combat
 * state:
 *   - `combatType` is the style the fight actually RESOLVES with, and it is not
 *     always the weapon's: an equipped staff with no spell selected fights
 *     melee (`needsSpell ? 'melee' : weaponCombatType`), so reading
 *     `attackStyle` animated spellcasting over a crush swing.
 *   - `stance` — combat.js shortens a ranged swing by a tick on Rapid
 *     (`speed = max(1, speed - 1)`, six sites). Rapid is a speed stance, so
 *     ignoring it animated the one choice made specifically to be faster at
 *     exactly the cadence of Accurate.
 * Both fall back to the weapon when absent.
 */
export function playerCombatSprite(equipment, itemsData, { combatType = null, stance = null } = {}) {
  const equip = equipment || {}
  const items = itemsData || {}
  const style = combatType || getAttackStyle(equip, items)
  let speed = getAttackSpeed(equip, items)
  if (stance === 'rapid' && spriteStyleKey(style) === 'ranged') speed = Math.max(1, speed - 1)
  const cycleMs = actionCycleMs(speed)
  const weaponItem = equip.weapon?.itemId ? items[equip.weapon.itemId] : null
  return {
    ...actionSpriteFor(style),
    speedTicks: speed,
    cycleMs,
    swingMs: swingDurationMs(cycleMs),
    weaponIconType: weaponIconTypeFor(weaponItem),
    weaponTint: weaponItem ? getItemIconTint(weaponItem) : null,
  }
}

/**
 * The monster's side. A multi-form boss's CURRENT FORM decides both style and
 * (where the form overrides it) speed — reading the top-level `attackStyle`
 * is the bug CLAUDE.md §4 already records for the world, where it left Zaryth
 * permanently ranged while its melee and magic clips never played.
 */
export function monsterCombatSprite(monster) {
  if (!monster) return { ...ACTION_SPRITES.melee, speedTicks: 4, cycleMs: actionCycleMs(4), swingMs: swingDurationMs(actionCycleMs(4)) }
  const form = monster.multiForm && monster.currentForm ? monster.forms?.[monster.currentForm] : null
  const style = form?.attackStyle || monster.attackStyle
  const speed = Math.max(1, Math.floor(Number(form?.attackSpeed || monster.attackSpeed) || 4))
  const cycleMs = actionCycleMs(speed)
  return {
    ...actionSpriteFor(style),
    speedTicks: speed,
    cycleMs,
    swingMs: swingDurationMs(cycleMs),
  }
}

// Event types that mean "this side swung this tick". A miss is still a swing —
// the motion happened, the splat is just a 0 — and a multi-hit special is ONE
// swing, not one per hit, so these are membership tests and never counters.
//
// `immuneHit` is in the player's set because combat.js emits it INSTEAD of
// `playerHit` against an immune form and still resets the attack timer: the
// player swung and it was blocked. Left out, a whole immune phase read as the
// player standing there doing nothing.
const PLAYER_SWING_EVENTS = new Set(['playerHit', 'specialHit', 'immuneHit'])
// `dragonfireBlocked` is the anti-dragon-shield branch of a dragonfire swing —
// combat.js emits it INSTEAD of `dragonfireHit` and still resets the timer, so
// leaving it out froze the dragon for the ~33% of its swings the shield stops,
// which is precisely the swings the player wore the shield to see stopped.
const MONSTER_SWING_EVENTS = new Set(['monsterHit', 'monsterMiss', 'dragonfireHit', 'dragonfireBlocked'])

// Is this swing about the entity the stage is showing? A boss and its adds
// share one event stream, separated only by a flag — `fromAdd` on what the add
// throws (combat.js `resolveEnemySwing`), `toAdd` on what the player lands on it
// — while the stage follows whichever enemy the player is targeting. Both
// directions need the check: unfiltered, the boss's swing animates on the add's
// mark at the add's speed, and a hit on the add flashes the boss's emblem over
// an HP bar that never moves.
function swingSourceMatches(ev, showingAdd) {
  // A blocked hit carries no routing flag at all, so it belongs to whichever
  // enemy is on screen rather than being dropped by a flag it never had.
  if (ev.type === 'immuneHit') return true
  const aboutAdd = PLAYER_SWING_EVENTS.has(ev.type) ? !!ev.toAdd : !!ev.fromAdd
  return aboutAdd === !!showingAdd
}

let swingSeq = 0

/** A swing token. The `id` changes on every swing so the renderer can restart a
 * CSS animation by key; `hit` is false for a miss so the target's recoil can be
 * withheld without withholding the attacker's motion. */
function makeSwing(side, hit) {
  swingSeq += 1
  return { id: swingSeq, side, hit }
}

// How long the actor's hand-to-mouth gesture (eating food, drinking a potion
// or brew) plays. Unlike a swing this has no equipment-driven cadence to
// scale off — nothing in the data models an "eating speed" — so a fixed
// flourish is the correct answer here, not a law violation; the monster
// death collapse (index.css `inkcMonsterDeath`, 900ms) is the same kind of
// deliberately-fixed one-shot.
export const EAT_ANIM_MS = 640

/** A consume token, same shape/purpose as a swing token (`id` changes so the
 * renderer can restart the CSS animation by key) but with no side/hit — it
 * is always the actor's own gesture, never the target's, and always plays
 * regardless of outcome. Shares the swing sequence counter so ids never
 * collide with a genuine swing's. */
export function makeConsumeToken() {
  swingSeq += 1
  return { id: swingSeq }
}

/**
 * Map one PvE tick's events to at most one swing per side. Returns
 * { player, monster } — either a swing token or null.
 *
 * Deliberately shaped like splatsFromCombatEvents (utils/hitSplats.js): same
 * event stream, same call site, so the two can never disagree about whether a
 * tick contained a swing.
 */
export function swingsFromCombatEvents(events, { showingAdd = false } = {}) {
  let player = null
  let monster = null
  for (const ev of events || []) {
    if (!ev) continue
    if (!player && PLAYER_SWING_EVENTS.has(ev.type) && swingSourceMatches(ev, showingAdd)) {
      const hits = ev.type === 'specialHit' ? (ev.hits || []) : [ev.damage]
      player = makeSwing('player', ev.type !== 'immuneHit' && hits.some(h => Number(h) > 0))
    } else if (!monster && MONSTER_SWING_EVENTS.has(ev.type) && swingSourceMatches(ev, showingAdd)) {
      monster = makeSwing('monster', Number(ev.damage) > 0)
    }
  }
  return { player, monster }
}

/**
 * Co-op form. Every member's events arrive tagged with the characterId whose
 * session produced them (§20), so the viewer's own swings drive their tool and
 * only a boss swing that actually reached THEM drives the incoming motion —
 * otherwise a full room makes the boss lunge eight times a tick.
 */
export function swingsFromCoopEvents(events, selfCharacterId, { showingAdd = false } = {}) {
  const selfId = Number(selfCharacterId)
  let player = null
  let monster = null
  for (const ev of events || []) {
    if (!ev || Number(ev.characterId) !== selfId) continue
    if (!player && PLAYER_SWING_EVENTS.has(ev.type) && swingSourceMatches(ev, showingAdd)) {
      const hits = ev.type === 'specialHit' ? (ev.hits || []) : [ev.damage]
      player = makeSwing('player', ev.type !== 'immuneHit' && hits.some(h => Number(h) > 0))
    // `roomWide` because a room-wide attacker damages EVERY member while only
    // one of them is its `isTarget`: gated on the target alone, everybody else
    // watched their health drop with the boss standing perfectly still.
    } else if (!monster && (ev.isTarget || ev.roomWide) && MONSTER_SWING_EVENTS.has(ev.type) && swingSourceMatches(ev, showingAdd)) {
      monster = makeSwing('monster', Number(ev.damage) > 0)
    }
  }
  return { player, monster }
}
