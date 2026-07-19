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

export type PrayerCategory = 'protection' | 'combat'
// `skill` is the id of the skill whose crest icon represents the prayer (from
// the game's shared prayerSkill() — combat prayers show the boosted stat,
// protection prayers the blocked style). The HUD renders that skill's icon.
export type PrayerView = { id: string; name: string; level: number; skill: string | null; category: PrayerCategory }

/** Splits every prayer the player's Prayer level unlocks into the two HUD
 * sections — protection prayers and combat (stat-boost) prayers — each tagged
 * with its skill icon, level-ascending. Locked prayers are omitted. */
export function categorisePrayers(prayerLevel: number): { protection: PrayerView[]; combat: PrayerView[] } {
  const protection: PrayerView[] = []
  const combat: PrayerView[] = []
  for (const p of Object.values(prayers).sort((a, b) => a.level - b.level)) {
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
