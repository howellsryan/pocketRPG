// Which IndexedDB stores hold unsaved changes, and the claim/restore protocol
// the flush uses.
//
// The flush CLAIMS the flags (reads them and resets them) before it starts
// writing, so a mutation landing mid-write sets its flag again and is picked up
// by the next pass instead of being swallowed by a clear-on-success. A write
// that fails RESTORES what it claimed, so nothing is silently dropped. Both
// halves live here rather than inline in the state layer so the protocol can be
// tested — getting it wrong loses a save with no visible symptom.

export const DIRTY_STORES = Object.freeze(['stats', 'inventory', 'equipment', 'bank', 'player'])

/** A fresh all-clean flag set. */
export function createDirtyFlags() {
  const flags = {}
  for (const store of DIRTY_STORES) flags[store] = false
  return flags
}

/** True when any tracked store is dirty. */
export function hasDirtyFlags(flags) {
  return DIRTY_STORES.some((store) => !!flags?.[store])
}

/**
 * Take ownership of every currently-dirty store: returns what was claimed and
 * clears those flags on `flags` in place. Untracked keys are ignored.
 */
export function claimDirtyFlags(flags) {
  const claimed = createDirtyFlags()
  if (!flags) return claimed
  for (const store of DIRTY_STORES) {
    if (!flags[store]) continue
    claimed[store] = true
    flags[store] = false
  }
  return claimed
}

/**
 * Put a failed claim back. Re-marks only what was claimed, so a store dirtied
 * again while the write was in flight stays dirty either way.
 */
export function restoreDirtyFlags(flags, claimed) {
  if (!flags || !claimed) return flags
  for (const store of DIRTY_STORES) {
    if (claimed[store]) flags[store] = true
  }
  return flags
}
