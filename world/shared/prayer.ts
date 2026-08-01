// Prayer session state + toggle rules for world combat. Pure so it's testable
// outside the DO (world/tests/prayer.test.ts). The DRAIN and damage-reduction
// maths live in the real engine (src/engine/combat.js via prayerDrain.js) — this
// module only owns the session pool seed and the on/off toggle validation,
// mirroring CombatScreen.handlePrayer (§4: one protection prayer + one combat
// prayer, pool starts full per session, empty pool blocks turning a prayer on).
import prayersData from '../../src/data/prayers.json'
import { getMaxPrayerPoints } from '../../src/engine/prayerDrain.js'
import { prayerSkill } from '../../src/utils/prayerIcons.js'

type PrayerDef = {
  id: string
  name: string
  level: number
  bonusType: string
  style?: string
  damageReductionPercent?: number
}
const prayers = prayersData as unknown as Record<string, PrayerDef>

/** The prayer fields carried on a player's world session and copied onto the
 * engine combat state at fight start / back off it after each tick. */
export type PrayerSession = {
  prayerPoints: number
  maxPrayerPoints: number
  prayerDrainAccumulator: number
  activeProtectionPrayer: string | null
  activeCombatPrayer: string | null
}

/** Full pool at the player's Prayer level, no prayers active — the per-session
 * starting state (§4: "Pool starts full per session"). */
export function seedPrayer(prayerLevel: number): PrayerSession {
  const max = getMaxPrayerPoints(prayerLevel)
  return {
    prayerPoints: max,
    maxPrayerPoints: max,
    prayerDrainAccumulator: 0,
    activeProtectionPrayer: null,
    activeCombatPrayer: null,
  }
}

export type OverheadStyle = 'melee' | 'ranged' | 'magic'

/** The damage style a protection prayer blocks, for the overhead icon other
 * players read off your head. Taken from the prayer's own `style` field rather
 * than its id, so a new protection prayer needs no code here; anything that is
 * not a protection prayer (or is off) has no overhead. */
export function protectionOverhead(prayerId: string | null): OverheadStyle | null {
  const prayer = prayerId ? prayers[prayerId] : null
  if (!prayer || prayer.bonusType !== 'protection') return null
  const style = prayer.style
  return style === 'melee' || style === 'ranged' || style === 'magic' ? style : null
}

/**
 * Damage a protection prayer takes off an incoming PvP swing of `attackStyle`,
 * as a whole number of hitpoints. Mirrors src/engine/combat.js's private
 * protectionPrayerMatches + reduction (a melee prayer answers stab/slash/crush;
 * everything else matches on the style name), because the Wilderness is the one
 * place PvP protection prayers are live and the two must agree — a player who
 * prays melee against a scimitar in a boss fight and takes full damage from the
 * same scimitar in a duel has been lied to by one of them.
 *
 * Pure, and returns 0 for every "no protection" case, so callers subtract
 * unconditionally.
 */
export function protectionReduction(prayerId: string | null, attackStyle: string | null | undefined, damage: number): number {
  const prayer = prayerId ? prayers[prayerId] : null
  if (!prayer || prayer.bonusType !== 'protection' || !attackStyle) return 0
  const percent = Number(prayer.damageReductionPercent)
  if (!Number.isFinite(percent) || percent <= 0) return 0
  const matches = prayer.style === 'melee'
    ? attackStyle === 'stab' || attackStyle === 'slash' || attackStyle === 'crush' || attackStyle === 'melee'
    : prayer.style === attackStyle
  if (!matches) return 0
  return Math.floor(Math.max(0, damage) * percent / 100)
}

export type PrayerCategory = 'protection' | 'combat'
// `skill` is the id of the skill whose crest icon represents the prayer (from
// the game's shared prayerSkill() — combat prayers show the boosted stat,
// protection prayers the blocked style). The HUD renders that skill's icon.
export type PrayerView = { id: string; name: string; level: number; skill: string | null; category: PrayerCategory }

/** Splits every prayer the player's Prayer level unlocks into the two HUD
 * sections — protection prayers and combat (stat-boost) prayers — each tagged
 * with its skill icon, highest-level first. Locked prayers are omitted. */
export function categorisePrayers(prayerLevel: number): { protection: PrayerView[]; combat: PrayerView[] } {
  const protection: PrayerView[] = []
  const combat: PrayerView[] = []
  for (const p of Object.values(prayers).sort((a, b) => b.level - a.level)) {
    if (p.level > prayerLevel) continue
    const category: PrayerCategory = p.bonusType === 'protection' ? 'protection' : 'combat'
    const view: PrayerView = { id: p.id, name: p.name, level: p.level, skill: prayerSkill(p), category }
    ;(category === 'protection' ? protection : combat).push(view)
  }
  return { protection, combat }
}

export type PrayerToggleResult =
  | { ok: true; session: PrayerSession; active: boolean; prayerId: string }
  | { ok: false; reason: 'unknown' | 'level' | 'empty'; required?: number }

/** Toggles one prayer on/off against a session, returning the next session (the
 * input is never mutated). Protection-type prayers occupy the single protection
 * slot; everything else the single combat slot — selecting a second replaces the
 * first. Turning a prayer ON with an empty pool is refused; turning OFF always
 * works. */
export function resolvePrayerToggle(session: PrayerSession, prayerId: string, prayerLevel: number): PrayerToggleResult {
  const prayer = prayers[prayerId]
  if (!prayer) return { ok: false, reason: 'unknown' }
  if (prayerLevel < prayer.level) return { ok: false, reason: 'level', required: prayer.level }
  const isProtection = prayer.bonusType === 'protection'
  const current = isProtection ? session.activeProtectionPrayer : session.activeCombatPrayer
  const turningOn = current !== prayerId
  if (turningOn && session.prayerPoints <= 0) return { ok: false, reason: 'empty' }
  const next: PrayerSession = { ...session }
  if (isProtection) next.activeProtectionPrayer = turningOn ? prayerId : null
  else next.activeCombatPrayer = turningOn ? prayerId : null
  return { ok: true, session: next, active: turningOn, prayerId }
}
