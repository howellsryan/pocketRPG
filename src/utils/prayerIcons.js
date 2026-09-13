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
      : ['melee', 'stab', 'slash', 'crush'].includes(attackStyle)
        ? 'melee'
        : null
  if (!style) return null
  return Object.values(prayersData || {}).find((prayer) =>
    prayer?.bonusType === 'protection' && prayer?.style === style
  ) || null
}

function normalizeProtectionStyle(attackStyle) {
  if (attackStyle === 'magic') return 'magic'
  if (attackStyle === 'ranged') return 'ranged'
  if (attackStyle === 'melee' || attackStyle === 'stab' || attackStyle === 'slash' || attackStyle === 'crush') return 'melee'
  return null
}

function enemyProtectionStyle(enemy) {
  if (!enemy) return null
  const form = enemy.multiForm && enemy.currentForm ? enemy.forms?.[enemy.currentForm] : null
  if (form?.attackStyle) return normalizeProtectionStyle(form.attackStyle)

  // attackStyles means the engine chooses at swing-time. A single protection
  // group is still predictable; mixed groups are not, so never show a false
  // flick recommendation before the RNG has happened.
  if (Array.isArray(enemy.attackStyles) && enemy.attackStyles.length > 0) {
    const styles = [...new Set(enemy.attackStyles.map(normalizeProtectionStyle).filter(Boolean))]
    return styles.length === 1 ? styles[0] : null
  }
  return normalizeProtectionStyle(enemy.attackStyle)
}

function ticksUntilEnemyAttack(timer, includeReady = false) {
  const value = Math.floor(Number(timer))
  return Number.isFinite(value) ? Math.max(includeReady ? 0 : 1, value) : Number.MAX_SAFE_INTEGER
}

/**
 * Presentation-only next incoming protection cue shared by every 2D combat
 * screen. It reads the same attack timers the fight engine exposes.
 *
 * staggered is true for Sunspire, where an add already waiting at timer zero
 * keeps its queued turn; otherwise equal due timers resolve primary then adds
 * in spawn order. Ordinary boss/add fights may attack simultaneously; if
 * two equally-next enemies need different prayers we return null rather than
 * lie with one icon.
 */
export function nextProtectionPrayerThreat({
  primary = null,
  primaryAttackTimer = null,
  adds = [],
  staggered = false,
} = {}) {
  const candidates = []
  const primaryStyle = enemyProtectionStyle(primary)
  const primaryMaxHit = primary?.multiForm && primary?.currentForm
    ? (primary.forms?.[primary.currentForm]?.maxHit ?? primary.formMaxHit ?? primary.maxHit)
    : primary?.maxHit
  if (primary?.currentHP > 0 && primaryMaxHit !== 0 && primaryStyle) {
    candidates.push({
      monsterId: primary.id,
      monsterName: primary.name || primary.id,
      style: primaryStyle,
      ticksUntil: ticksUntilEnemyAttack(primaryAttackTimer, staggered),
      fromAdd: false,
      order: -1,
    })
  }

  for (let index = 0; index < (Array.isArray(adds) ? adds.length : 0); index++) {
    const add = adds[index]
    const style = enemyProtectionStyle(add)
    if (!add || add.currentHP <= 0 || add.maxHit === 0 || !style) continue
    candidates.push({
      monsterId: add.id,
      monsterName: add.name || add.id,
      style,
      ticksUntil: ticksUntilEnemyAttack(add.attackTimer, staggered),
      fromAdd: true,
      order: index,
    })
  }

  if (staggered) {
    const queuedAdd = candidates.find((candidate) => candidate.fromAdd && candidate.ticksUntil === 0)
    if (queuedAdd) return queuedAdd
  }

  candidates.sort((a, b) =>
    a.ticksUntil - b.ticksUntil
    || Number(a.fromAdd) - Number(b.fromAdd)
    || a.order - b.order
  )
  const first = candidates[0]
  if (!first) return null

  if (!staggered) {
    const equallyNext = candidates.filter((candidate) => candidate.ticksUntil === first.ticksUntil)
    if (new Set(equallyNext.map((candidate) => candidate.style)).size > 1) return null
  }
  return first
}
