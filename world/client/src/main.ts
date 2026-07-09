import {
  exchangeHandoff,
  getStoredSession,
  isViewportTooNarrow,
  parseHandoffFromHash,
  pocketRpgUrl,
} from './auth'
import { showLoginRequired, showViewportBlock, showWelcome } from './ui'

function checkViewport(): boolean {
  if (isViewportTooNarrow(screen.width, window.innerWidth)) {
    showViewportBlock()
    return false
  }
  return true
}

async function boot(): Promise<void> {
  if (!checkViewport()) return

  const handoff = parseHandoffFromHash(window.location.hash)
  if (handoff) {
    history.replaceState(null, '', window.location.pathname + window.location.search)
    try {
      const session = await exchangeHandoff(handoff)
      showWelcome(session.character.name)
      return
    } catch {
      showLoginRequired(pocketRpgUrl())
      return
    }
  }

  const stored = getStoredSession()
  if (stored) {
    showWelcome(stored.character.name)
    return
  }

  showLoginRequired(pocketRpgUrl())
}

window.addEventListener('resize', checkViewport)

boot()
