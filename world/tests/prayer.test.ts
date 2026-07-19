// Item 7 (P1): prayer session seed + toggle rules. Pure — the drain/protection
// maths are the engine's (covered by combat-prayer.test.ts); this proves the
// slotting + validation that gate a toggle before it reaches the engine.
import { describe, expect, it } from 'vitest'
import { seedPrayer, resolvePrayerToggle, type PrayerSession } from '../shared/prayer'

describe('seedPrayer', () => {
  it('starts a full pool at the Prayer level with no prayers active', () => {
    expect(seedPrayer(43)).toEqual({
      prayerPoints: 43,
      maxPrayerPoints: 43,
      prayerDrainAccumulator: 0,
      activeProtectionPrayer: null,
      activeCombatPrayer: null,
    })
  })
  it('floors a pool of at least 1 for a level-1 prayer', () => {
    expect(seedPrayer(1).maxPrayerPoints).toBe(1)
  })
})

describe('resolvePrayerToggle', () => {
  const full = (): PrayerSession => seedPrayer(70)

  it('rejects an unknown prayer id', () => {
    expect(resolvePrayerToggle(full(), 'not_a_prayer', 70)).toEqual({ ok: false, reason: 'unknown' })
  })

  it('rejects a prayer above the player Prayer level, reporting the requirement', () => {
    // Protect from Melee needs level 43.
    expect(resolvePrayerToggle(seedPrayer(40), 'protection_from_melee', 40)).toEqual({
      ok: false,
      reason: 'level',
      required: 43,
    })
  })

  it('rejects turning a prayer ON with an empty pool but still allows turning one OFF', () => {
    const empty: PrayerSession = { ...full(), prayerPoints: 0, activeCombatPrayer: 'piety' }
    expect(resolvePrayerToggle(empty, 'ultimate_strength', 70)).toEqual({ ok: false, reason: 'empty' })
    // Toggling the already-on prayer off is fine even at 0 points.
    const off = resolvePrayerToggle(empty, 'piety', 70)
    expect(off).toMatchObject({ ok: true, active: false })
  })

  it('puts a protection prayer in the protection slot and a stat prayer in the combat slot, independently', () => {
    const a = resolvePrayerToggle(full(), 'protection_from_melee', 70)
    expect(a).toMatchObject({ ok: true, active: true })
    if (!a.ok) throw new Error('expected ok')
    expect(a.session.activeProtectionPrayer).toBe('protection_from_melee')
    expect(a.session.activeCombatPrayer).toBeNull()
    const b = resolvePrayerToggle(a.session, 'piety', 70)
    if (!b.ok) throw new Error('expected ok')
    expect(b.session.activeProtectionPrayer).toBe('protection_from_melee')
    expect(b.session.activeCombatPrayer).toBe('piety')
  })

  it('selecting a second prayer of the same category replaces the first', () => {
    const a = resolvePrayerToggle(full(), 'burst_of_strength', 70)
    if (!a.ok) throw new Error('expected ok')
    const b = resolvePrayerToggle(a.session, 'ultimate_strength', 70)
    if (!b.ok) throw new Error('expected ok')
    expect(b.session.activeCombatPrayer).toBe('ultimate_strength')
  })

  it('does not mutate the input session', () => {
    const s = full()
    resolvePrayerToggle(s, 'piety', 70)
    expect(s.activeCombatPrayer).toBeNull()
  })
})
