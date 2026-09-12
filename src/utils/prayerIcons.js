/**
 * The skill whose icon best represents a prayer, so every prayer surface
 * (combat screen panel + modal, PvP, idle setup, and the open-world HUD)
 * draws prayers with the game's real skill crest art instead of ad-hoc emoji:
 *   - combat (stat-boost) prayers  → the stat they boost
 *       attack · strength · defence · ranged · magic
 *   - protection prayers           → the style they block
 *       melee → defence (shield), ranged → ranged, magic → magic
 *
 * Returns a skill id (an SKILL_ART key) or null when nothing maps — callers
 * render it via <SkillIcon skill={…}/> (or the world HUD's icon lookup) and
 * fall back to the prayer's own glyph on null.
 */
export function prayerSkill(prayer) {
  if (!prayer) return null

  if (prayer.bonusType === 'protection') {
    if (prayer.style === 'ranged') return 'ranged'
    if (prayer.style === 'magic') return 'magic'
    return 'defence' // melee protection reads as a shield
  }

  if (prayer.bonusType === 'stat') return prayer.stat || null

  if (prayer.bonusType === 'multi_stat' && prayer.stats) {
    const s = prayer.stats
    if (s.magic != null) return 'magic'
    if (s.ranged != null || s.ranged_strength != null) return 'ranged'
    if (s.strength != null) return 'strength'
    if (s.attack != null) return 'attack'
    if (s.defence != null) return 'defence'
  }

  return null
}


/**
 * Resolve the actual protection-prayer definition for an incoming attack style.
 * The compact combat threat cue uses this instead of inventing its own glyph,
 * so Protect from Magic/Ranged/Melee always renders from the exact same visual
 * mapping as the prayer buttons themselves.
 */
export function protectionPrayerForAttackStyle(attackStyle, prayersData) {
  const style = attackStyle === 'magic'
    ? 'magic'
    : attackStyle === 'ranged'
      ? 'ranged'
      : 'melee'
  return Object.values(prayersData || {}).find((prayer) =>
    prayer?.bonusType === 'protection' && prayer?.style === style
  ) || null
}
