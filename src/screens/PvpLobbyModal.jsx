import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import Modal from '../components/Modal.jsx'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import { useGame } from '../state/gameState.jsx'
import { usePvp } from '../state/pvpState.jsx'
import { pvpApi } from '../cloud/pvp.js'
import { pushNow } from '../cloud/sync.js'
import { api, getCharacterId } from '../cloud/api.js'
import { pauseTicks } from '../engine/tick.js'
import { formatCompactCoins } from '../utils/formatters.js'

const POLL_MS = 5000   // light enough to be cheap, fast enough to feel live in the lobby
const SAVE_HEARTBEAT_MS = 3000
const LOBBY_PVP_SYNC_BLOCK_KEY = 'pocketrpg_pvp_sync_block'
const COMBAT_STAT_ROWS = [
  ['attack', 'Attack', '⚔️'],
  ['strength', 'Strength', '💪'],
  ['defence', 'Defence', '🛡️'],
  ['hitpoints', 'Hitpoints', '❤️'],
  ['ranged', 'Ranged', '🏹'],
  ['magic', 'Magic', '✨'],
  ['prayer', 'Prayer', '🙏'],
]


function formatLobbyPvpRank(rank) {
  const parsed = Number(rank)
  return Number.isFinite(parsed) && parsed > 0 ? `#${Math.floor(parsed)}` : 'Unranked'
}

function normalizeCombatStats(stats) {
  const out = {}
  for (const [key] of COMBAT_STAT_ROWS) {
    const parsed = Number(stats?.[key])
    out[key] = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1
  }
  return out
}

const BOT_LOOT_TABLE = [
  {
    label: 'Common',
    chance: '70%',
    color: 'var(--color-parchment)',
    items: [{ icon: '🪙', name: '1,000–10,000 Coins' }],
  },
  {
    label: 'Uncommon',
    chance: '28%',
    color: '#7ec87e',
    items: [{ icon: '🪙', name: '10,000–50,000 Coins' }],
  },
  {
    label: 'Rare',
    chance: '2%',
    color: 'var(--color-gold)',
    items: [
      { icon: '⚔️', name: 'Zesta Longsword' },
      { icon: '🧥', name: 'Zesta Vest' },
      { icon: '👖', name: 'Zesta Skirt' },
    ],
  },
]

function BotLootBoxModal({ onClose }) {
  return (
    <Modal title="🎁 Bot Loot Box" onClose={onClose}>
      <p class="mb-4 text-[11px] text-[var(--color-parchment)] opacity-60 leading-relaxed">
        Defeating a bot rewards you with one loot box. Each box rolls the following drop table:
      </p>
      <div class="space-y-2">
        {BOT_LOOT_TABLE.map(tier => (
          <div
            key={tier.label}
            class="rounded-lg border border-[var(--color-void-border)] bg-[var(--color-void-light)] p-3"
          >
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs font-bold" style={{ color: tier.color }}>{tier.label}</span>
              <span class="text-[10px] font-bold opacity-80" style={{ color: tier.color }}>{tier.chance}</span>
            </div>
            <div class="space-y-1">
              {tier.items.map(item => (
                <div key={item.name} class="flex items-center gap-2 text-[11px] text-[var(--color-parchment)]">
                  <span>{item.icon}</span>
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p class="mt-3 text-[10px] text-[var(--color-parchment)] opacity-40 text-center">
        Zesta items are untradeable collection log rewards.
      </p>
    </Modal>
  )
}

function CombatStatsInfoButton({ label, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.()
      }}
      class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--color-gold-dim)] bg-[var(--color-void-light)] text-[10px] font-bold text-[var(--color-gold)]"
    >
      i
    </button>
  )
}

function CombatStatsModal({ title, stats, onClose }) {
  const normalized = normalizeCombatStats(stats)

  return (
    <Modal title={`${title} — Combat Stats`} onClose={onClose}>
      <div class="grid grid-cols-2 gap-2">
        {COMBAT_STAT_ROWS.map(([key, label, icon]) => (
          <div
            key={key}
            class="rounded-lg border border-[var(--color-void-border)] bg-[var(--color-void-light)] px-3 py-2"
          >
            <div class="text-[10px] uppercase tracking-wide text-[var(--color-parchment)] opacity-60">
              {icon} {label}
            </div>
            <div class="mt-1 font-[var(--font-mono)] text-sm font-bold text-[var(--color-gold)]">
              {normalized[key]}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

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
  const { enterMatch } = usePvp()

  const [tab, setTab] = useState('waiting')
  const [myCB, setMyCB] = useState(null)
  const [band, setBand] = useState(null)
  const [waiting, setWaiting] = useState([])
  const [invitations, setInvitations] = useState({ incoming: [], outgoing: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [statsModal, setStatsModal] = useState(null)
  const [lootBoxModal, setLootBoxModal] = useState(false)
  const [joined, setJoined] = useState(false)
  const mounted = useRef(true)
  const pollTimer = useRef(null)
  const launchedMatch = useRef(false)
  const acceptingInvite = useRef(false)
  const lastSavePushAt = useRef(0)

  const pushLobbySnapshot = useCallback(async (force = false) => {
    const now = Date.now()
    if (!force && now - lastSavePushAt.current < SAVE_HEARTBEAT_MS) return
    const snapshot = getSnapshot ? getSnapshot() : null
    if (!snapshot) return
    // touch:true — the match-create guard rejects a save whose updated_at is
    // >15s old, so keep the server's timestamp fresh while we sit in the lobby
    // even when our save content hasn't changed.
    await pushNow(snapshot, { touch: true })
    lastSavePushAt.current = now
  }, [getSnapshot])

  const launchMatch = useCallback((matchId, toastMsg = null) => {
    const parsed = Number(matchId)
    if (!Number.isFinite(parsed) || parsed <= 0 || launchedMatch.current) return
    launchedMatch.current = true
    pauseTicks()
    try { localStorage.removeItem('pocketrpg_activeTask') } catch { /* best-effort */ }
    if (toastMsg) addToast(toastMsg, 'info')
    enterMatch(parsed)
    // Never block match entry on best-effort cleanup calls.
    api.deleteIdle().catch(() => {})
    onClose?.()
  }, [addToast, enterMatch, onClose])

  // We force a synchronous cloud-save push BEFORE joining the waiting
  // room so the server's view of our inventory is fresh. This closes the
  // 60s save-debounce desync window flagged in the planning review.
  const joinAndStartPolling = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await pushLobbySnapshot(true)
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
  }, [addToast, pushLobbySnapshot])

  const refresh = useCallback(async () => {
    if (launchedMatch.current || acceptingInvite.current) return
    try {
      try {
        await pushLobbySnapshot(false)
      } catch {
        // save heartbeat is best-effort; lobby polling should continue
      }
      // One round-trip: the lobby GET heartbeats the waiting-room row (so it
      // isn't GC'd by the 30s sweep), and returns the waiting list, invitations
      // and any active match together — replacing the old listWaiting +
      // listInvitations + joinWaiting trio.
      const res = await pvpApi.lobbyState()
      if (!mounted.current) return
      if (res.active_match_id) {
        await launchMatch(res.active_match_id, 'PvP match ready — entering combat.')
        return
      }
      setMyCB(res.my_combat_level)
      setBand(res.band)
      setWaiting(res.waiting || [])
      setInvitations({
        incoming: res.incoming || [],
        outgoing: res.outgoing || [],
      })
    } catch (err) {
      if (!mounted.current) return
      // Don't spam toasts — only set inline error.
      setError(err.body?.error || err.message)
    }
  }, [launchMatch, pushLobbySnapshot])

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

  // Polling loop — only runs once we've successfully joined. The interval
  // skips while the tab is hidden (no point polling a lobby nobody's looking
  // at); a visibilitychange listener fires an immediate refresh on return so
  // the list is fresh the moment the user comes back.
  useEffect(() => {
    if (!joined) return
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      refresh()
    }
    tick()
    pollTimer.current = setInterval(tick, POLL_MS)
    const onVisible = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
      pollTimer.current = null
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [joined, refresh])

  const handleInvite = async (toCharacterId, username, isBot = false) => {
    setBusy(true)
    try {
      const res = await pvpApi.sendInvitation(toCharacterId)
      // Bots auto-accept: server returns match_id immediately.
      if (res?.auto_accepted && res?.match_id) {
        await launchMatch(res.match_id, `Fighting ${username}!`)
        return
      }
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

  const handleAccept = useCallback(async (inviteId, fromUsername) => {
    setBusy(true)
    acceptingInvite.current = true
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
    try {
      const myCharacterId = Number(getCharacterId())
      // Force a fresh save push BEFORE accepting so the server snapshots
      // our true inventory. Phase 3 server will reject stale saves; we
      // do this proactively so the round-trip succeeds first time.
      await pushLobbySnapshot(true)
      console.log('[PocketRPG][PvP] Accepting invitation:', { inviteId, fromUsername, myCharacterId })
      let res
      try {
        res = await pvpApi.acceptInvitation(inviteId)
      } catch (err) {
        const code = err?.body?.error
        if (code === 'stale_save') {
          console.log('[PocketRPG][PvP] accept stale_save:', err?.body || null)
          const staleCharacters = Array.isArray(err?.body?.forCharacters) ? err.body.forCharacters : []
          const staleNumbers = staleCharacters.map(Number)
          if (!staleNumbers.length || staleNumbers.includes(myCharacterId)) {
            await pushLobbySnapshot(true)
            res = await pvpApi.acceptInvitation(inviteId)
          } else {
            addToast('Opponent save is stale. Ask them to keep the PvP lobby open, then try again.', 'error')
            await refresh()
            return
          }
        } else if (code === 'character_in_active_match') {
          console.log('[PocketRPG][PvP] accept character_in_active_match:', err?.body || null)
          const directId = err?.body?.match_id ?? err?.body?.matchId ?? err?.body?.active_match_id
          let activeId = directId
          if (!activeId) {
            try {
              const invites = await pvpApi.listInvitations()
              activeId = invites?.active_match_id
            } catch { /* best-effort */ }
          }
          if (activeId) {
            await launchMatch(activeId, 'Active PvP match found — entering combat.')
            return
          }
          throw err
        }
        throw err
      }
      console.log('[PocketRPG][PvP] accept response:', res || null)
      if (res.phase1_stub) {
        addToast('PvP accept returned legacy phase1_stub. Cannot enter PvP combat on this deployment.', 'error')
        return
      }
      const acceptedMatchId = res?.match_id ?? res?.matchId ?? res?.match?.id ?? res?.active_match_id
      console.log('[PocketRPG][PvP] accepted match id:', acceptedMatchId)
      if (!acceptedMatchId) {
        addToast('Accept succeeded but no match id was returned. Please retry from invitations.', 'error')
        return
      }
      await launchMatch(acceptedMatchId, `Match accepted vs ${fromUsername}`)
    } catch (err) {
      addToast(err.body?.error || err.message, 'error')
      try { localStorage.removeItem(LOBBY_PVP_SYNC_BLOCK_KEY) } catch { /* best-effort */ }
    } finally {
      acceptingInvite.current = false
      if (mounted.current && joined && !launchedMatch.current && !pollTimer.current) {
        pollTimer.current = setInterval(refresh, POLL_MS)
      }
      if (mounted.current) setBusy(false)
    }
  }, [addToast, joined, launchMatch, pushLobbySnapshot, refresh])

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
  const openStatsModal = (title, stats) => {
    setStatsModal({ title, stats })
  }

  return (
    <Modal title="☠️ PvP — Player vs Player" onClose={onClose}>
      {/* Death warning banner */}
      <div class="mb-3 p-3 rounded-lg bg-[#2a1010] border border-[var(--color-blood)]">
        <div class="text-xs font-bold text-[var(--color-blood-light)] mb-1">⚠️ Risk warning</div>
        <div class="text-[11px] text-[#f5e6c8] leading-snug">
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
            ${tab === 'waiting' ? 'bg-[var(--color-gold-dim)] text-white' : 'bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'}`}
        >
          Waiting Room ({waiting.length})
        </button>
        <button
          onClick={() => setTab('invitations')}
          class={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors relative
            ${tab === 'invitations' ? 'bg-[var(--color-gold-dim)] text-white' : 'bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'}`}
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
              No opponents in your CB band right now. Bots appear when your combat level is within their range.
            </Card>
          )}
          <div class="space-y-1.5">
            {waiting.map(p => {
              const alreadyInvited = !p.is_bot && invitations.outgoing.some(o => o.to_character === p.character_id)
              return (
                <Card key={p.character_id} className="flex items-center justify-between" padding="p-2.5">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1">
                      <div class="truncate text-sm font-semibold text-[var(--color-parchment)]">{p.username}</div>
                      {p.is_bot && (
                        <span class="rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-[var(--color-gold-dim)] text-black">Bot</span>
                      )}
                      <CombatStatsInfoButton
                        label={`View ${p.username} combat stats`}
                        onClick={() => openStatsModal(p.username, p.combat_stats)}
                      />
                    </div>
                    <div class="flex items-center gap-1 text-[10px] text-[var(--color-parchment)] opacity-50">
                      CB {p.combat_level}
                      {p.is_bot ? (
                        <>
                          <span>{' · Loot Box on Win'}</span>
                          <button
                            type="button"
                            aria-label="View loot box rewards"
                            onClick={(e) => { e.stopPropagation(); setLootBoxModal(true) }}
                            class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[11px] opacity-80 hover:opacity-100"
                          >
                            🎁
                          </button>
                        </>
                      ) : ` · Total Risk: ${formatCompactCoins(p.total_shop_value)} · Rank: ${formatLobbyPvpRank(p.pvp_rank)}`}
                    </div>
                  </div>
                  <Button
                    variant={alreadyInvited ? 'secondary' : 'primary'}
                    size="sm"
                    disabled={busy || alreadyInvited}
                    onClick={() => handleInvite(p.character_id, p.username, p.is_bot)}
                  >
                    {alreadyInvited ? 'Invited' : '⚔️ Fight'}
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
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1">
                      <div class="truncate text-sm font-semibold text-[var(--color-parchment)]">{inv.from_username}</div>
                      <CombatStatsInfoButton
                        label={`View ${inv.from_username} combat stats`}
                        onClick={() => openStatsModal(inv.from_username, inv.from_combat_stats)}
                      />
                    </div>
                    <div class="text-[10px] text-[var(--color-parchment)] opacity-50">
                      CB {inv.from_combat_level} · Total Risk: {formatCompactCoins(inv.from_total_shop_value)} · Rank: {formatLobbyPvpRank(inv.from_pvp_rank)}
                    </div>
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
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1">
                      <div class="truncate text-sm font-semibold text-[var(--color-parchment)]">{inv.to_username}</div>
                      <CombatStatsInfoButton
                        label={`View ${inv.to_username} combat stats`}
                        onClick={() => openStatsModal(inv.to_username, inv.to_combat_stats)}
                      />
                    </div>
                    <div class="text-[10px] text-[var(--color-parchment)] opacity-50">
                      CB {inv.to_combat_level} · Total Risk: {formatCompactCoins(inv.to_total_shop_value)} · Rank: {formatLobbyPvpRank(inv.to_pvp_rank)} · waiting for response…
                    </div>
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
      {statsModal && (
        <CombatStatsModal
          title={statsModal.title}
          stats={statsModal.stats}
          onClose={() => setStatsModal(null)}
        />
      )}
      {lootBoxModal && (
        <BotLootBoxModal onClose={() => setLootBoxModal(false)} />
      )}
    </Modal>
  )
}
