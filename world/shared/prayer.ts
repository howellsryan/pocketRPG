// Prayer session state + toggle rules for world combat. Pure so it's testable
// outside the DO (world/tests/prayer.test.ts). The DRAIN and damage-reduction
// maths live in the real engine (src/engine/combat.js via prayerDrain.js) — this
// module only owns the session pool seed and the on/off toggle validation,
// mirroring CombatScreen.handlePrayer (§4: one protection prayer + one combat
// prayer, pool starts full per session, empty pool blocks turning a prayer on).
import prayersData from '../../src/data/prayers.json'
import { getMaxPrayerPoints } from '../../src/engine/prayerDrain.js'

type PrayerDef = {
  id: string
  name: string
  level: number
  bonusType: string
  icon: string
  stat?: string
  stats?: Record<string, number>
  style?: string
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

// Prayer icons for the HUD, matching the PocketRPG game's icon vocabulary
// (src/utils/prayerIcons.js): a combat prayer shows the stat it boosts, a
// protection prayer the damage type it blocks — so same-stat tiers read
// consistently instead of the ad-hoc per-prayer emoji they used to carry.
const STAT_ICON: Record<string, string> = { attack: '⚔️', strength: '💪', defence: '🛡️', ranged: '🏹', magic: '🔮' }
const PROTECT_ICON: Record<string, string> = { magic: '🔮', ranged: '🏹', melee: '🛡️' }

/** The combat stat a prayer headlines, or null. Multi-stat prayers pick their
 * primary style (magic → ranged → melee) the same way the game's icon does. */
function combatStatKey(prayer: PrayerDef): string | null {
  if (prayer.bonusType === 'stat') return prayer.stat ?? null
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

/** The correct icon for a prayer: protection → damage type blocked, combat →
 * stat boosted. Falls back to the prayer's own emoji for anything unmapped. */
export function prayerIcon(prayer: PrayerDef): string {
  if (prayer.bonusType === 'protection') return PROTECT_ICON[prayer.style ?? ''] ?? prayer.icon
  const key = combatStatKey(prayer)
  return (key && STAT_ICON[key]) || prayer.icon
}

export type PrayerCategory = 'protection' | 'combat'
export type PrayerView = { id: string; name: string; level: number; icon: string; category: PrayerCategory }

/** Splits every prayer the player's Prayer level unlocks into the two HUD
 * sections — protection prayers and combat (stat-boost) prayers — each with its
 * correct icon, level-ascending. Locked prayers are omitted. */
export function categorisePrayers(prayerLevel: number): { protection: PrayerView[]; combat: PrayerView[] } {
  const protection: PrayerView[] = []
  const combat: PrayerView[] = []
  for (const p of Object.values(prayers).sort((a, b) => a.level - b.level)) {
    if (p.level > prayerLevel) continue
    const category: PrayerCategory = p.bonusType === 'protection' ? 'protection' : 'combat'
    const view: PrayerView = { id: p.id, name: p.name, level: p.level, icon: prayerIcon(p), category }
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
