/**
 * A multi-form boss's form rotation.
 *
 * Its own module because a form change is a decision made ONCE PER SWING, and
 * three runtimes have to agree on when it happens. The solo fight can keep it
 * inside the combat state, but co-op and the open world rebuild a combat session
 * per player per tick — so the roll has to live on the one shared boss record
 * and be pinned onto every session, exactly like the attack clock
 * (roomWideAttacks.js).
 *
 * Left to the sessions, a room of four fought four differently-formed bosses off
 * one health bar: each took a different form's max hit on the "same" swing, each
 * rolled its own accuracy against a different form's defences, and the HUD
 * showed whichever member happened to tick last — so there was no protection
 * prayer a player could read off the screen and set.
 *
 * Pure logic, no imports.
 */

/**
 * A style's own fight-start (or current-form) authored bonus, before any
 * warstrike has touched it — captured once by `prepareMonster`/`prepareAdd`
 * and re-stamped by `applyForm` whenever a form authors its own defences (see
 * `defenceBonusBaseline` on the monster).
 *
 * A warstrike must never grind a style's bonus below zero — that is the
 * player-facing floor — but a boss deliberately authored weak to a style
 * (a negative bonus baked into its data, not caused by any special) is
 * already "below zero" by design, and the special must not heal it back up
 * toward zero on its way to draining something else. So the real floor is
 * per style, per form: zero, unless the style's own baseline started lower,
 * in which case the baseline itself is the floor — the special simply cannot
 * touch it any further.
 */
function defenceBonusFloor(baselineValue) {
  return Math.min(0, baselineValue ?? 0)
}

/**
 * The running total of defence bonus a special attack has ground off this
 * monster (Grondar Godsword's warstrike — "for the rest of the fight").
 *
 * It lives beside `defenceBonus` rather than only inside it because a form
 * change REPLACES that object wholesale with the form's authored numbers.
 * Without the total, every rotation handed 16 of the game's bosses back
 * everything a party had spent its special energy taking away — and on a boss
 * that switches every attack, a warstrike was worth exactly one swing.
 *
 * It lives in the forms module because form changes are the only reason it has
 * to exist: nothing else rebuilds `defenceBonus` mid-fight.
 *
 * The recorded total is the RAW, uncapped damage dealt — "permanently
 * weakens... by the amount of damage dealt" is the whole tooltip, and capping
 * the bookkeeping at whatever one form's floor allowed would let a detour
 * through a low-headroom form quietly erase drain a party earned on a
 * different one. Only the VISIBLE `defenceBonus` value is floor-clamped, and
 * always from the style's own baseline, never by subtracting further off an
 * already-clamped number — so a later form with more headroom still reflects
 * the true total.
 */
export function recordDefenceBonusDrain(monster, amount) {
  if (!monster?.defenceBonus || !(amount > 0)) return
  const drain = { ...(monster.defenceBonusDrain || {}) }
  const baseline = monster.defenceBonusBaseline || monster.defenceBonus
  for (const key of Object.keys(monster.defenceBonus)) {
    drain[key] = (drain[key] || 0) + amount
    const base = baseline[key] ?? monster.defenceBonus[key]
    monster.defenceBonus[key] = Math.max(defenceBonusFloor(base), base - drain[key])
  }
  monster.defenceBonusDrain = drain
}

/** Re-applies the running total over freshly-installed authored numbers. */
export function applyDefenceBonusDrain(monster) {
  const drain = monster?.defenceBonusDrain
  if (!drain || !monster.defenceBonus) return
  const baseline = monster.defenceBonusBaseline || monster.defenceBonus
  for (const [key, amount] of Object.entries(drain)) {
    if (!(key in monster.defenceBonus)) continue
    const base = baseline[key] ?? monster.defenceBonus[key]
    monster.defenceBonus[key] = Math.max(defenceBonusFloor(base), base - amount)
  }
}

/**
 * A new body — a Verzik phase, a double-kill boss's second life — brings its own
 * defences, so the total does not follow it. Nulled rather than deleted: co-op
 * carries this field on the shared boss record and its writer skips `undefined`,
 * so a delete would leave the room holding the drain the new body just shed.
 */
export function clearDefenceBonusDrain(monster) {
  if (monster) monster.defenceBonusDrain = null
}

/** Attacks a boss holds a form for, when it is not switching every attack. */
export function randomFormSwitchThreshold(monster, random = Math.random) {
  const min = monster?.formSwitchMin || 1
  const max = Math.max(min, monster?.formSwitchMax || 5)
  return Math.floor(random() * (max - min + 1)) + min
}

/** True for a boss that actually rotates. */
export function isMultiForm(monster) {
  return !!(monster?.multiForm && monster.forms && Object.keys(monster.forms).length > 0)
}

/**
 * Copies a form's stats onto a monster IN PLACE and returns the form. This is
 * the whole definition of "being in a form" — anything reading a boss's style,
 * bonuses or max hit reads these fields, never `forms` directly.
 */
export function applyForm(monster, formKey) {
  const form = monster?.forms?.[formKey]
  if (!form) return null
  monster.currentForm = formKey
  monster.attackStyle = form.attackStyle
  monster.attackBonus = form.attackBonus ?? monster.attackBonus ?? 0
  monster.strengthBonus = form.strengthBonus ?? monster.strengthBonus ?? 0
  // Falls back like the two above it: a form authored without defences must
  // inherit the boss's own, never zero them — that would be a form the whole
  // room suddenly hits through, from a field nobody thought to write.
  const formDefence = form.defenceBonus
  monster.defenceBonus = { ...(formDefence ?? monster.defenceBonus ?? {}) }
  // Only the authored branch needs the drain put back: the fallback inherits the
  // numbers already carrying it, and subtracting twice would grind the boss down
  // a second time for every rotation it happened to make. Same reasoning for the
  // baseline the floor is measured against — the fallback form has none of its
  // own, so the previous form's baseline (and floor) stays in force.
  if (formDefence) {
    monster.defenceBonusBaseline = { ...monster.defenceBonus }
    applyDefenceBonusDrain(monster)
  }
  monster.formMaxHit = form.maxHit
  // Authored per form, and only ever a hint to the player — but a hint that
  // names the form before last is worse than none.
  if (form.weakness) monster.weakness = form.weakness
  return form
}

/**
 * The next form. Cycles in `formCycleOrder` when authored, otherwise picks at
 * random — which may re-pick the current one, deliberately: a boss that could
 * never repeat a style would be readable a swing ahead.
 */
export function pickNextForm(monster, random = Math.random) {
  const keys = Object.keys(monster?.forms || {})
  if (keys.length <= 1) return monster?.currentForm
  if (Array.isArray(monster.formCycleOrder)) {
    const cycle = monster.formCycleOrder
    return cycle[(cycle.indexOf(monster.currentForm) + 1) % cycle.length]
  }
  return keys[Math.floor(random() * keys.length)]
}

/**
 * One swing's worth of rotation, applied to the shared monster record. Returns
 * the `formChange` event to broadcast, or null when it held its form (or has
 * none). Call this exactly once per swing, from whoever owns the record.
 */
export function advanceSharedForm(monster, random = Math.random) {
  if (!isMultiForm(monster)) return null
  monster.formAttackCount = (monster.formAttackCount || 0) + 1
  if (monster.formAttackCount < (monster.formSwitchThreshold || 3)) return null
  const previousForm = monster.currentForm
  const nextKey = pickNextForm(monster, random)
  const form = applyForm(monster, nextKey)
  if (!form) return null
  monster.formAttackCount = 0
  monster.formSwitchThreshold = monster.randomFormEveryAttack ? 1 : randomFormSwitchThreshold(monster, random)
  return {
    type: 'formChange',
    previousForm,
    currentForm: nextKey,
    displayName: form.displayName || nextKey,
    icon: form.icon || '',
    attackStyle: form.attackStyle,
    weakness: form.weakness,
    immunity: form.immunity,
    monsterName: monster.name,
  }
}

/**
 * The value a boss's attack clock restarts at when it changes form — one cycle
 * of the form it has just moved INTO, so the player gets a beat to answer the
 * new style before it swings again.
 *
 * Read after `applyForm`, and shared by all three runtimes because each owns a
 * different clock: solo restarts `state.monsterAttackTimer`, co-op restarts the
 * room's `boss.attackTimer` (and its members' pinned copies), the world restarts
 * `npc.attackTimer`. Today every form inherits the boss's own `attackSpeed`, so
 * this is the same number the clock already held and the restart changes
 * nothing anywhere — which is exactly why it has to be one expression in one
 * place. Left inline in the solo fight, the first form to carry a cadence of its
 * own would have slowed the boss for a solo player and for nobody else.
 */
export function formChangeAttackTimer(monster) {
  return monster?.attackSpeed || 4
}

/**
 * Copies the shared record's form onto a session's own monster, so every
 * session swings with the form the room is in. Returns whether anything moved.
 */
export function pinFormToSession(sessionMonster, sharedMonster) {
  if (!isMultiForm(sessionMonster) || !sharedMonster?.currentForm) return false
  if (sessionMonster.currentForm === sharedMonster.currentForm) return false
  return !!applyForm(sessionMonster, sharedMonster.currentForm)
}
