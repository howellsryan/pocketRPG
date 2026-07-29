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
  monster.defenceBonus = { ...form.defenceBonus }
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
 * Copies the shared record's form onto a session's own monster, so every
 * session swings with the form the room is in. Returns whether anything moved.
 */
export function pinFormToSession(sessionMonster, sharedMonster) {
  if (!isMultiForm(sessionMonster) || !sharedMonster?.currentForm) return false
  if (sessionMonster.currentForm === sharedMonster.currentForm) return false
  return !!applyForm(sessionMonster, sharedMonster.currentForm)
}
