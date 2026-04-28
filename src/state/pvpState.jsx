// Lightweight context for PvP UI state. The lobby modal owns its own
// fetch lifecycle — this context is just the "phase" indicator and the
// active match id once we have one (Phase 3+).
//
// Phases:
//   'idle'      — lobby modal closed, no PvP activity
//   'waiting'   — lobby modal open, character has joined waiting room
//   'inviting'  — outgoing invite sent, awaiting response
//   'invited'   — incoming invite to display (not used yet — modal polls)
//   'in_match'  — active match (Phase 3+)
//
// We deliberately don't track the full waiting list / invite list here;
// those belong to the modal where they'll re-render on poll. Keeping the
// context tiny avoids unnecessary re-renders elsewhere in the tree.

import { createContext } from 'preact'
import { useState, useContext, useCallback } from 'preact/hooks'

const PvpContext = createContext(null)
const PVP_MATCH_KEY = 'pocketrpg_pvp_active_match_id'
const PVP_SYNC_BLOCK_KEY = 'pocketrpg_pvp_sync_block'

function readBootMatchId() {
  try {
    const raw = localStorage.getItem(PVP_MATCH_KEY)
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}

function writePvpLocalState(matchId) {
  try {
    if (Number.isFinite(matchId) && matchId > 0) {
      localStorage.setItem(PVP_MATCH_KEY, String(matchId))
      localStorage.setItem(PVP_SYNC_BLOCK_KEY, '1')
    } else {
      localStorage.removeItem(PVP_MATCH_KEY)
      localStorage.removeItem(PVP_SYNC_BLOCK_KEY)
    }
  } catch {
    // localStorage can fail in private mode; state still lives in-memory.
  }
}

export function PvpProvider({ children }) {
  const bootMatchId = readBootMatchId()
  const [phase, setPhase] = useState(bootMatchId ? 'in_match' : 'idle')
  const [activeMatchId, setActiveMatchId] = useState(bootMatchId)
  const [reconnectBlockedUntil, setReconnectBlockedUntil] = useState(0)

  const openLobby = useCallback(() => {
    writePvpLocalState(null)
    setPhase('waiting')
  }, [])
  const closeLobby = useCallback(() => {
    writePvpLocalState(null)
    setPhase('idle')
    setActiveMatchId(null)
  }, [])
  const enterMatch = useCallback((matchId) => {
    writePvpLocalState(matchId)
    setPhase('in_match')
    setActiveMatchId(matchId)
  }, [])
  const leaveMatch = useCallback(() => {
    writePvpLocalState(null)
    setPhase('idle')
    setActiveMatchId(null)
  }, [])
  const blockReconnectFor = useCallback((ms = 0) => {
    const parsed = Number(ms)
    const safeMs = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
    if (safeMs <= 0) {
      setReconnectBlockedUntil(0)
      return
    }
    setReconnectBlockedUntil(Date.now() + safeMs)
  }, [])
  const canAutoReconnect = reconnectBlockedUntil <= Date.now()

  const value = {
    phase,
    activeMatchId,
    openLobby,
    closeLobby,
    enterMatch,
    leaveMatch,
    blockReconnectFor,
    canAutoReconnect,
    setPhase,
  }

  return <PvpContext.Provider value={value}>{children}</PvpContext.Provider>
}

export function usePvp() {
  const ctx = useContext(PvpContext)
  if (!ctx) throw new Error('usePvp must be used inside PvpProvider')
  return ctx
}
