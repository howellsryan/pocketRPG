/**
 * A monster's max hit — the single source of truth for both the fight and every
 * surface that reports it.
 *
 * combat.js used to inline this and the info modal re-derived its own number
 * from the monster's stats, so the two disagreed on every boss that authors a
 * max hit: the modal advertised 209 for a boss whose hardest form hits 60, and
 * 122 for one that hits 55. The modal's derivation was wrong twice over — it
 * dropped the +8 the fight adds to the damage stat, and for magic monsters it
 * called the spell helper, which returns the magic LEVEL when handed one.
 *
 * Pure logic, no UI imports.
 */

/** The style whose damage stat applies, given the attacker's current style. */
function damageStatFor(stats, attackStyle) {
  if (!stats) return 1
  if (attackStyle === 'ranged') return stats.ranged ?? stats.strength ?? 1
  if (attackStyle === 'magic') return stats.magic ?? stats.strength ?? 1
  return stats.strength ?? 1
}

/**
 * Precedence, highest first:
 *   1. the live form's authored maxHit (a multi-form boss mid-fight carries
 *      `formMaxHit`; a definition straight out of monsters.json does not)
 *   2. the monster's own authored maxHit
 *   3. derived from the damage stat matching the attack style
 *
 * `attackStyle` defaults to the monster's own — pass it explicitly for a
 * prepared attacker whose style rotates per attack.
 */
export function monsterMaxHit(monster, attackStyle = monster?.attackStyle) {
  if (!monster) return 0
  if (monster.formMaxHit != null) return monster.formMaxHit
  if (monster.maxHit != null) return monster.maxHit
  const stat = damageStatFor(monster.stats, attackStyle)
  return Math.floor(0.5 + (stat + 8) * ((monster.strengthBonus || 0) + 64) / 640)
}

/**
 * The span a monster can hit for across every form it rotates through, for the
 * info surfaces. A single-form monster returns the same number twice; a boss
 * that switches style returns the weakest and hardest of its forms, because a
 * player choosing to fight it needs the worst case, not the opening one.
 */
export function monsterMaxHitRange(monster) {
  if (!monster) return { min: 0, max: 0 }
  const forms = monster.multiForm && monster.forms ? Object.values(monster.forms) : []
  // A form without its own maxHit inherits the monster's derivation, which is
  // still style-dependent — resolve each form as the fight would.
  const hits = forms.map((form) => monsterMaxHit(
    { ...monster, ...form, formMaxHit: form?.maxHit, stats: monster.stats },
    form?.attackStyle ?? monster.attackStyle,
  ))
  if (!hits.length) {
    const only = monsterMaxHit(monster)
    return { min: only, max: only }
  }
  return { min: Math.min(...hits), max: Math.max(...hits) }
}

/** The range as a label: "35–60", or just "60" when every form matches. */
export function monsterMaxHitLabel(monster) {
  const { min, max } = monsterMaxHitRange(monster)
  return min === max ? String(max) : `${min}–${max}`
}
