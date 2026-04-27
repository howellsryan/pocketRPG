import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import Modal from '../components/Modal.jsx'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import { useGame } from '../state/gameState.jsx'
import { usePvp } from '../state/pvpState.jsx'
import { pvpApi } from '../cloud/pvp.js'
import { pushNow } from '../cloud/sync.js'
import { api } from '../cloud/api.js'
import { pauseTicks } from '../engine/tick.js'

const POLL_MS = 2500   // light enough to be cheap, fast enough to feel live in the lobby

// PvP Lobby Modal — Phase 1 surface.
// Two tabs: Waiting Room (CB-filtered list of opponents) and Invitations
// (incoming + outgoing pending). Joining the lobby tab posts to the
// waiting room and heartbeats every POLL_MS; closing the modal leaves it.
//
// The "Accept" path is currently a Phase 1 stub on the server — it
// returns a phase1_stub flag, and we surface that as a toast rather than
// transitioning into combat.
export default function PvpLobbyModal({ onClose, getSnapshot }) {
  const { addToast, isIronman, isOneLife } = useGame()
  const { closeLobby, enterMatch } = usePvp()

  const [tab, setTab] = useState('waiting')
  const [myCB, setMyCB] = useState(null)
  const [band, setBand] = useState(null)
  const [waiting, setWaiting] = useState([])
  const [invitations, setInvitations] = useState({ incoming: [], outgoing: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [joined, setJoined] = useState(false)
  const mounted = useRef(true)
  const pollTimer = useRef(null)

  // We force a synchronous cloud-save push BEFORE joining the waiting
  // room so the server's view of our inventory is fresh. This closes the
  // 60s save-debounce desync window flagged in the planning review.
  const joinAndStartPolling = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const snapshot = getSnapshot ? getSnapshot() : null
      if (snapshot) await pushNow(snapshot)
      const res = await pvpApi.joinWaiting()
      if (!mounted.current) return
      setJoined(true)
      setMyCB(res.combat_level)
      addToast(`Entered PvP lobby (CB ${res.combat_level})`, 'info')
    } catch (err) {
      if (!mounted.current) return
      setError(err.body?.error || err.message)
      addToast(`Couldn't join lobby: ${err.body?.error || err.message}`, 'error')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [addToast, getSnapshot])

  const refresh = useCallback(async () => {
    try {
      const [waitingRes, invitesRes] = await Promise.all([
        pvpApi.listWaiting(),
        pvpApi.listInvitations(),
      ])
      if (!mounted.current) return
      setMyCB(waitingRes.my_combat_level)
      setBand(waitingRes.band)
      setWaiting(waitingRes.waiting || [])
      setInvitations({
        incoming: invitesRes.incoming || [],
        outgoing: invitesRes.outgoing || [],
      })
      // Heartbeat the waiting room while we're joined so the row doesn't
      // get GC'd by the server's 30s sweep.
      if (joined) {
        try { await pvpApi.joinWaiting() } catch { /* heartbeat is best-effort */ }
      }
    } catch (err) {
      if (!mounted.current) return
      // Don't spam toasts — only set inline error.
      setError(err.body?.error || err.message)
    }
  }, [joined])

  // Boot: ironman / one-life accounts should never have reached this
  // modal but defend in depth — close immediately if they did.
  useEffect(() => {
    if (isIronman || isOneLife) {
      addToast('PvP is not available for Ironman or One-Life accounts.', 'error')
      onClose?.()
      return
    }
    mounted.current = true
    joinAndStartPolling()
    return () => {
      mounted.current = false
      // Best-effort leave on unmount. If the network call dies the 30s
      // sweep will GC the row anyway.
      pvpApi.leaveWaiting().catch(() => {})
    }
  }, [])

  // Polling loop — only runs once we've successfully joined.
  useEffect(() => {
    if (!joined) return
    refresh()
    pollTimer.current = setInterval(refresh, POLL_MS)
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [joined, refresh])

  const handleInvite = async (toCharacterId, username) => {
    setBusy(true)
    try {
      await pvpApi.sendInvitation(toCharacterId)
      addToast(`Invitation sent to ${username}`, 'info')
      await refresh()
    } catch (err) {
      const code = err.body?.error
      const msg = code === 'invite_already_pending' ? 'Invite already sent'
                : code === 'cb_band_mismatch'      ? 'Combat level out of range'
                : code === 'target_not_in_waiting_room' ? `${username} left the lobby`
                : err.body?.error || err.message
      addToast(msg, 'error')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const handleAccept = async (inviteId, fromUsername) => {
    setBusy(true)
    try {
      // Force a fresh save push BEFORE accepting so the server snapshots
      // our true inventory. Phase 3 server will reject stale saves; we
      // do this proactively so the round-trip succeeds first time.
      const snapshot = getSnapshot ? getSnapshot() : null
      if (snapshot) await pushNow(snapshot)
      let res
      try {
        res = await pvpApi.acceptInvitation(inviteId)
      } catch (err) {
        if (err?.body?.error === 'stale_save') {
          if (snapshot) await pushNow(snapshot)
          res = await pvpApi.acceptInvitation(inviteId)
        } else {
          throw err
        }
      }
      if (res.phase1_stub) {
        addToast('PvP combat coming soon — match accepted but no fight will start yet.', 'info')
        // Phase 1 stub: just clean up and close.
        closeLobby()
        onClose?.()
        return
      }
      pauseTicks()
      try { await api.deleteIdle() } catch { /* best-effort */ }
      try { localStorage.removeItem('pocketrpg_activeTask') } catch { /* best-effort */ }
      addToast(`Match accepted vs ${fromUsername}`, 'info')
      enterMatch(res.match_id)
      onClose?.()
    } catch (err) {
      addToast(err.body?.error || err.message, 'error')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const handleDecline = async (inviteId) => {
    setBusy(true)
    try {
      await pvpApi.declineInvitation(inviteId)
      addToast('Invitation declined', 'info')
      await refresh()
    } catch (err) {
      addToast(err.body?.error || err.message, 'error')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const handleCancel = async (inviteId) => {
    setBusy(true)
    try {
      await pvpApi.cancelInvitation(inviteId)
      await refresh()
    } catch (err) {
      addToast(err.body?.error || err.message, 'error')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const incomingCount = invitations.incoming.length

  return (
    <Modal title="☠️ PvP — Player vs Player" onClose={onClose}>
      {/* Death warning banner */}
      <div class="mb-3 p-3 rounded-lg bg-[#2a1010] border border-[var(--color-blood)]">
        <div class="text-xs font-bold text-[var(--color-blood-light)] mb-1">⚠️ Risk warning</div>
        <div class="text-[11px] text-[var(--color-parchment)] leading-snug">
          On death, your entire <b>tradeable</b> inventory and equipped gear are sent to your opponent.
          Untradeable items stay with you. <b>Forfeit counts as a loss</b> — you'll still drop your loot.
        </div>
      </div>

      {/* Lobby header */}
      <div class="flex items-center justify-between mb-3">
        <div class="text-[11px] text-[var(--color-parchment)] opacity-70">
          {myCB != null ? (
            <>Your CB: <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{myCB}</span>
              {band && <> · Visible: <span class="font-[var(--font-mono)]">{band.lo}–{band.hi}</span></>}
            </>
          ) : 'Connecting…'}
        </div>
        <div class="flex items-center gap-1">
          <span class={`w-2 h-2 rounded-full ${joined ? 'bg-green-500' : 'bg-yellow-500'}`} />
          <span class="text-[10px] text-[var(--color-parchment)] opacity-50">
            {joined ? 'In lobby' : 'Joining…'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div class="flex gap-1 mb-3">
        <button
          onClick={() => setTab('waiting')}
          class={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors
            ${tab === 'waiting' ? 'bg-[var(--color-gold-dim)] text-white' : 'bg-[#1a1a1a] text-[var(--color-parchment)] opacity-60'}`}
        >
          Waiting Room ({waiting.length})
        </button>
        <button
          onClick={() => setTab('invitations')}
          class={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors relative
            ${tab === 'invitations' ? 'bg-[var(--color-gold-dim)] text-white' : 'bg-[#1a1a1a] text-[var(--color-parchment)] opacity-60'}`}
        >
          Invitations ({incomingCount + invitations.outgoing.length})
          {incomingCount > 0 && (
            <span class="absolute -top-1 -right-1 bg-[var(--color-blood)] text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {incomingCount}
            </span>
          )}
        </button>
      </div>

      {/* Waiting Room tab */}
      {tab === 'waiting' && (
        <div>
          <SectionHeader size="sm" className="mb-2">Available opponents (CB ±10)</SectionHeader>
          {waiting.length === 0 && (
            <Card className="text-center text-[11px] text-[var(--color-parchment)] opacity-50 py-6">
              No one in your CB band right now. Wait for someone to join, or come back later.
            </Card>
          )}
          <div class="space-y-1.5">
            {waiting.map(p => {
              const alreadyInvited = invitations.outgoing.some(o => o.to_character === p.character_id)
              return (
                <Card key={p.character_id} className="flex items-center justify-between" padding="p-2.5">
                  <div>
                    <div class="text-sm font-semibold text-[var(--color-parchment)]">{p.username}</div>
                    <div class="text-[10px] text-[var(--color-parchment)] opacity-50">CB {p.combat_level}</div>
                  </div>
                  <Button
                    variant={alreadyInvited ? 'secondary' : 'primary'}
                    size="sm"
                    disabled={busy || alreadyInvited}
                    onClick={() => handleInvite(p.character_id, p.username)}
                  >
                    {alreadyInvited ? 'Invited' : '⚔️ Invite'}
                  </Button>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* Invitations tab */}
      {tab === 'invitations' && (
        <div class="space-y-4">
          <div>
            <SectionHeader size="sm" className="mb-2">Incoming</SectionHeader>
            {invitations.incoming.length === 0 && (
              <Card className="text-center text-[11px] text-[var(--color-parchment)] opacity-50 py-4">
                No incoming invitations.
              </Card>
            )}
            <div class="space-y-1.5">
              {invitations.incoming.map(inv => (
                <Card key={inv.id} className="flex items-center justify-between" padding="p-2.5">
                  <div>
                    <div class="text-sm font-semibold text-[var(--color-parchment)]">{inv.from_username}</div>
                    <div class="text-[10px] text-[var(--color-parchment)] opacity-50">CB {inv.from_combat_level}</div>
                  </div>
                  <div class="flex gap-1.5">
                    <Button variant="success" size="sm" disabled={busy}
                      onClick={() => handleAccept(inv.id, inv.from_username)}>
                      Accept
                    </Button>
                    <Button variant="danger" size="sm" disabled={busy}
                      onClick={() => handleDecline(inv.id)}>
                      Decline
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <div>
            <SectionHeader size="sm" className="mb-2">Outgoing</SectionHeader>
            {invitations.outgoing.length === 0 && (
              <Card className="text-center text-[11px] text-[var(--color-parchment)] opacity-50 py-4">
                No outgoing invitations.
              </Card>
            )}
            <div class="space-y-1.5">
              {invitations.outgoing.map(inv => (
                <Card key={inv.id} className="flex items-center justify-between" padding="p-2.5">
                  <div>
                    <div class="text-sm font-semibold text-[var(--color-parchment)]">{inv.to_username}</div>
                    <div class="text-[10px] text-[var(--color-parchment)] opacity-50">CB {inv.to_combat_level} · waiting for response…</div>
                  </div>
                  <Button variant="ghost" size="sm" disabled={busy}
                    onClick={() => handleCancel(inv.id)}>
                    Cancel
                  </Button>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div class="mt-3 text-[10px] text-[var(--color-blood-light)] opacity-70 text-center">
          {error}
        </div>
      )}
    </Modal>
  )
}
