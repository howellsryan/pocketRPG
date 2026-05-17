// Shared One-Life death helpers. Used by direct combat death (CombatScreen)
// and by idle/skip death (App, gameState). Best-effort on each step — we
// always fall through to clearAuth so the player is forced back to auth.
import { api, clearAuth, getToken, setLocalCharacterId } from '../cloud/api.js'
import { closeDB } from '../db/database.js'
import { wipeLocalSave } from '../db/saveload.js'

export async function performOneLifeReset() {
  if (getToken()) {
    try {
      await api.resetOneLife()
    } catch (err) {
      console.error('Failed one-life reset endpoint, falling back to legacy delete flow:', err)
      try { await api.deleteSave() } catch (deleteErr) { console.error('Failed to delete cloud save:', deleteErr) }
      try { await api.deleteIdle() } catch (deleteErr) { console.error('Failed to delete cloud idle state:', deleteErr) }
    }
  }
  try {
    closeDB()
    await wipeLocalSave()
  } catch (err) { console.error('Failed to wipe local save:', err) }
  try {
    localStorage.removeItem('pocketrpg_activeCombatSpell')
    localStorage.removeItem('pocketrpg_offline_mode')
    setLocalCharacterId(null)
  } catch { /* ignore */ }
  clearAuth()
}

// Trigger the visible One-Life death flow. The server-side wipe runs FIRST
// — only after the cloud account is gone do we surface the toast and
// redirect — so a browser refresh during the confirmation can't cancel the
// death.
export async function triggerOneLifeDeath(addToast) {
  await performOneLifeReset()
  if (addToast) addToast('You died — account wiped.', 'error')
  setTimeout(() => {
    window.location.href = '/'
  }, 1500)
}
