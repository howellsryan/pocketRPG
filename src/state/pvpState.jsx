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

export function PvpProvider({ children }) {
  const [phase, setPhase] = useState('idle')
  const [activeMatchId, setActiveMatchId] = useState(null)

  const openLobby = useCallback(() => setPhase('waiting'), [])
  const closeLobby = useCallback(() => {
    setPhase('idle')
    setActiveMatchId(null)
  }, [])
  const enterMatch = useCallback((matchId) => {
    setPhase('in_match')
    setActiveMatchId(matchId)
  }, [])
  const leaveMatch = useCallback(() => {
    setPhase('idle')
    setActiveMatchId(null)
  }, [])

  const value = {
    phase,
    activeMatchId,
    openLobby,
    closeLobby,
    enterMatch,
    leaveMatch,
    setPhase,
  }

  return <PvpContext.Provider value={value}>{children}</PvpContext.Provider>
}

export function usePvp() {
  const ctx = useContext(PvpContext)
  if (!ctx) throw new Error('usePvp must be used inside PvpProvider')
  return ctx
}
