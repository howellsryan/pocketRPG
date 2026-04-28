import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import Card from '../components/Card.jsx'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'
import HPBar from '../components/HPBar.jsx'
import ItemSlot from '../components/ItemSlot.jsx'
import Modal from '../components/Modal.jsx'
import { pvpApi } from '../cloud/pvp.js'
import itemsData from '../data/items.json'
import { getCharacterId } from '../cloud/api.js'
import { normalizePvpState } from '../engine/pvpState.js'

const POLL_VISIBLE_MS = 600
const POLL_HIDDEN_MS = 1500
const NO_POLL_WARNING_MS = 5000
const MATCH_BOOT_GRACE_MS = 8000
const MATCH_BOOT_RETRY_MS = 500

function prettifyEvent(evt, selfId) {
  if (!evt) return null
  if (evt.type === 'attack') {
    const mine = evt.attackerCharacterId === selfId
    return `${mine ? 'You' : 'Opponent'} hit ${evt.damage} ${evt.hit ? '✓' : '✗'}`
  }
  if (evt.type === 'eat') {
    return `${evt.characterId === selfId ? 'You' : 'Opponent'} ate +${evt.heal}`
  }
  if (evt.type === 'drink') return `${evt.characterId === selfId ? 'You' : 'Opponent'} drank a potion`
  if (evt.type === 'forfeit') return `${evt.characterId === selfId ? 'You' : 'Opponent'} forfeited`
  return evt.type
}

export default function PvpCombatScreen({ matchId, onExit, addToast }) {
  const [state, setState] = useState(null)
  const [matchMeta, setMatchMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [bootstrapError, setBootstrapError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const [endModal, setEndModal] = useState(null)
  const [hiddenMode, setHiddenMode] = useState(document.hidden)
  const [staleWarning, setStaleWarning] = useState(false)

  const selfId = useMemo(() => parseInt(getCharacterId(), 10), [])
  const pollTimer = useRef(null)
  const mounted = useRef(true)
  const tickInFlight = useRef(false)
  const pendingActionRef = useRef(null)
  const lastPollOkAt = useRef(0)
  const latestTick = useRef(0)
  const fatalNotified = useRef(false)

  useEffect(() => {
    pendingActionRef.current = pendingAction
  }, [pendingAction])

  const toArray = (value) => {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== 'object') return []
    return Object.values(value)
  }

  const pair = useMemo(() => {
    if (!state?.combatants) return { self: null, opp: null }
    const combatants = toArray(state.combatants)
    const getId = (c) => Number(c?.characterId ?? c?.character_id)
    const self = combatants.find(c => getId(c) === selfId) || null
    const opp = combatants.find(c => getId(c) !== selfId) || null
    return { self, opp }
  }, [state, selfId])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [])

  useEffect(() => {
    const onVisibility = () => setHiddenMode(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const notifyFatalOnce = (message, err = null) => {
    if (fatalNotified.current) return
    fatalNotified.current = true
    if (message) addToast?.(message, 'error')
    if (err) console.error('[PocketRPG] PvP fatal screen error:', err)
  }

  const confirmNoActiveMatch = async () => {
    try {
      const invites = await pvpApi.listInvitations()
      const activeMatchId = Number(invites?.active_match_id)
      if (Number.isFinite(activeMatchId) && activeMatchId > 0) {
        return false
      }
    } catch {
      return false
    }
    return true
  }

  const refreshFromServer = async () => {
    const sinceTick = latestTick.current > 0 ? latestTick.current : null
    setBootstrapError(null)
    const res = await pvpApi.getMatch(matchId, sinceTick)
    if (!mounted.current) return
    setMatchMeta(res?.match || null)
    if (res.state_changed && res.state) {
      const normalizedState = normalizePvpState(res.state)
      if (normalizedState) {
        setState(normalizedState)
        latestTick.current = normalizedState.tick || 0
      }
    } else if (res?.match?.current_tick != null) {
      latestTick.current = Number(res.match.current_tick) || latestTick.current
    }
    lastPollOkAt.current = Date.now()
    setStaleWarning(false)
    setLoading(false)
  }

  const handleForfeit = async () => {
    try {
      await pvpApi.forfeitMatch(matchId)
      addToast?.('Forfeit queued. Resolving...', 'info')
      setBootstrapError(null)
    } catch (err) {
      const code = err?.body?.error || err?.message
      if (code === 'match_not_found' || code === 'match_not_active') {
        const noActiveMatch = await confirmNoActiveMatch()
        if (noActiveMatch) {
          addToast?.('Match already ended.', 'info')
          await onExit?.()
          return
        }
        setBootstrapError('Forfeit failed because the match state changed. Retry or reconnect.')
        return
      }
      addToast?.(err.body?.error || err.message, 'error')
    }
  }

  const runTick = async () => {
    if (tickInFlight.current) return
    tickInFlight.current = true
    try {
      const action = pendingActionRef.current
      if (action) {
        await pvpApi.postIntent(matchId, latestTick.current, action)
        pendingActionRef.current = null
        setPendingAction(null)
      }
      const tickRes = await pvpApi.tickMatch(matchId)
      if (!mounted.current) return

      if (tickRes.state) {
        const normalizedState = normalizePvpState(tickRes.state)
        if (normalizedState) {
          setState(normalizedState)
          latestTick.current = normalizedState.tick || latestTick.current
        }
      }
      lastPollOkAt.current = Date.now()
      setStaleWarning(false)

      if (tickRes.terminal) {
        const youWon = Number(tickRes.terminal.winner) === selfId
        setEndModal({
          youWon,
          reason: tickRes.terminal.reason,
          loot: tickRes.loot || { added: [], dropped: [], droppedValue: 0 },
        })
        if (pollTimer.current) clearTimeout(pollTimer.current)
      }
    } catch (err) {
      if (!mounted.current) return
      const msg = err.body?.error || err.message
      if (msg === 'match_not_found' || msg === 'match_not_active') {
        console.warn('[PocketRPG][PvP] tickMatch reported inactive match; checking server active_match_id before exit:', err?.body || null)
        const noActiveMatch = await confirmNoActiveMatch()
        if (noActiveMatch) {
          addToast?.('Match has ended.', 'info')
          await onExit?.()
          return
        }
        setBootstrapError('Server still reports an active PvP match. Retry to reconnect.')
        setLoading(false)
        return
      }
      if (Date.now() - lastPollOkAt.current > NO_POLL_WARNING_MS) {
        setStaleWarning(true)
      }
    } finally {
      tickInFlight.current = false
    }
  }

  useEffect(() => {
    let active = true
    let pollMs = hiddenMode ? POLL_HIDDEN_MS : POLL_VISIBLE_MS
    const bootDeadline = Date.now() + MATCH_BOOT_GRACE_MS

    const scheduleNext = () => {
      if (!active || !mounted.current) return
      pollTimer.current = setTimeout(async () => {
        await runTick()
        scheduleNext()
      }, pollMs)
    }

    ;(async () => {
      console.log('[PocketRPG][PvP] PvpCombatScreen mount with match id:', matchId)
      while (active && mounted.current) {
        try {
          await refreshFromServer()
          if (!active || !mounted.current) return
          pollMs = hiddenMode ? POLL_HIDDEN_MS : POLL_VISIBLE_MS
          scheduleNext()
          return
        } catch (err) {
          const code = err?.body?.error || err?.message
          const transientBootError = (code === 'match_not_found' || code === 'match_not_active') && Date.now() < bootDeadline
          if (transientBootError) {
            await new Promise(resolve => setTimeout(resolve, MATCH_BOOT_RETRY_MS))
            continue
          }
          console.error('[PocketRPG][PvP] getMatch bootstrap failure:', err?.body || err)
          setLoading(false)
          let recoveryMessage = code || 'Failed to load PvP match'
          if (code === 'match_not_found' || code === 'match_not_active') {
            const noActiveMatch = await confirmNoActiveMatch()
            if (noActiveMatch) {
              addToast?.('Match has ended.', 'info')
              await onExit?.()
              return
            }
            recoveryMessage = 'Server still reports an active PvP match. Retry to reconnect.'
          }
          setBootstrapError(recoveryMessage)
          console.log('[PocketRPG][PvP] entering recovery mode instead of exiting PvE fallback')
          notifyFatalOnce(recoveryMessage, err)
          return
        }
      }
    })()

    return () => {
      active = false
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [matchId, hiddenMode])

  const safeRecentEvents = Array.isArray(state?.recentEvents) ? state.recentEvents : []
  const recentLines = safeRecentEvents.slice(-6).map((evt) => prettifyEvent(evt, selfId)).filter(Boolean)

  const queueAction = (action) => {
    setPendingAction(action)
    setBusy(true)
    setTimeout(() => setBusy(false), 220)
  }

  const foodSlots = toArray(pair.self?.inventory)
    .map((slot, idx) => ({ slot, idx }))
    .filter(({ slot }) => slot && itemsData[slot.itemId]?.heal)
    .slice(0, 4)

  return (
    <div class="p-3 space-y-3">
      {loading && (
        <Card className="border-[var(--color-gold-dim)] bg-[var(--color-void-light)]">
          <div class="text-[11px] text-[var(--color-gold)]">Connecting to PvP match…</div>
        </Card>
      )}

      {bootstrapError && (
        <Card className="border-[var(--color-blood)] bg-[#2a1010]">
          <div class="text-xs font-semibold text-[var(--color-blood-light)]">PvP connection error</div>
          <div class="text-[11px] text-[var(--color-parchment)] opacity-80 mt-1">{bootstrapError}</div>
          <div class="flex flex-wrap gap-2 mt-3">
            <Button variant="primary" size="sm" onClick={() => { setLoading(true); refreshFromServer().catch((err) => {
              console.error('[PocketRPG][PvP] recovery retry failed:', err?.body || err)
              const msg = err?.body?.error || err?.message || 'Retry failed'
              setBootstrapError(msg)
              setLoading(false)
            }) }}>Retry</Button>
            <Button variant="secondary" size="sm" onClick={() => { setLoading(true); refreshFromServer().catch((err) => {
              console.error('[PocketRPG][PvP] recovery reconnect failed:', err?.body || err)
              const msg = err?.body?.error || err?.message || 'Reconnect failed'
              setBootstrapError(msg)
              setLoading(false)
            }) }}>Reconnect</Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!matchId}
              onClick={handleForfeit}
            >
              Forfeit
            </Button>
          </div>
        </Card>
      )}

      {hiddenMode && (
        <Card className="border-[var(--color-gold-dim)] bg-[var(--color-void-light)]">
          <div class="text-[11px] text-[var(--color-gold)]">⚠️ Keep this tab open for smooth PvP updates.</div>
        </Card>
      )}

      {staleWarning && (
        <Card className="border-[var(--color-blood)] bg-[#2a1010]">
          <div class="text-[11px] text-[var(--color-blood-light)]">No successful sync for 5s. You may desync — consider forfeiting if this persists.</div>
        </Card>
      )}

      <Card>
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="text-xs text-[var(--color-parchment)] opacity-60">Opponent</div>
            <div class="text-sm font-semibold text-[var(--color-parchment)]">{pair.opp?.username || '...'}</div>
          </div>
          <div class="text-[10px] font-[var(--font-mono)] text-[var(--color-gold)]">Tick {state?.tick ?? matchMeta?.current_tick ?? 0}</div>
        </div>
        <HPBar current={pair.opp?.hp || 0} max={pair.opp?.maxHP || 1} label="Opponent HP" />
      </Card>

      <Card>
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="text-xs text-[var(--color-parchment)] opacity-60">You</div>
            <div class="text-sm font-semibold text-[var(--color-parchment)]">{pair.self?.username || '...'}</div>
          </div>
          <div class="text-[11px] text-[var(--color-gold)]">⚡ {pair.self?.specialAttackEnergy ?? 0}%</div>
        </div>
        <HPBar current={pair.self?.hp || 0} max={pair.self?.maxHP || 1} label="Your HP" />
        <div class="grid grid-cols-2 gap-2 mt-3">
          <Button
            variant="primary"
            size="md"
            disabled={busy || (pair.self?.specialAttackEnergy ?? 0) < 25}
            onClick={() => queueAction({ type: 'queue_special' })}
          >
            ⚡ Special Attack
          </Button>
          <Button
            variant="danger"
            size="md"
            disabled={busy}
            onClick={handleForfeit}
          >
            🏳️ Forfeit
          </Button>
        </div>
      </Card>

      <Card>
        <div class="text-xs font-semibold text-[var(--color-gold)] mb-2">Quick Eat</div>
        <div class="flex gap-2 flex-wrap">
          {foodSlots.length === 0 && <div class="text-[11px] text-[var(--color-parchment)] opacity-60">No food in inventory.</div>}
          {foodSlots.map(({ slot, idx }) => (
            <div key={`${slot.itemId}-${idx}`} onClick={() => queueAction({ type: 'eat', inventorySlot: idx })}>
              <ItemSlot slot={slot} size="small" />
            </div>
          ))}
        </div>
      </Card>

      <Panel>
        <div class="text-xs font-semibold text-[var(--color-gold)] mb-1">Recent actions</div>
        <div class="space-y-1 max-h-24 overflow-y-auto">
          {recentLines.length === 0 && <div class="text-[11px] text-[var(--color-parchment)] opacity-60">Waiting for first swing…</div>}
          {recentLines.map((line, i) => (
            <div key={i} class="text-[11px] text-[var(--color-parchment)] opacity-80">• {line}</div>
          ))}
        </div>
      </Panel>

      {endModal && (
        <Modal title={endModal.youWon ? '🏆 Victory' : '☠️ Defeat'} onClose={onExit}>
          <div class="space-y-3">
            <div class="text-sm text-[var(--color-parchment)]">
              {endModal.youWon ? 'You won the duel.' : 'You were defeated.'} ({endModal.reason})
            </div>
            <Card>
              <div class="text-xs font-semibold text-[var(--color-gold)] mb-2">Loot transferred to winner</div>
              <div class="text-[11px] text-[var(--color-parchment)] opacity-80">Added: {endModal.loot.added?.length || 0} item stacks</div>
              <div class="text-[11px] text-[var(--color-parchment)] opacity-80">Dropped (bank full): {endModal.loot.dropped?.length || 0}</div>
              <div class="text-[11px] text-[var(--color-parchment)] opacity-80">Dropped value: {Math.floor((endModal.loot.droppedValue || 0) / 1000000)}M gp</div>
            </Card>
            <Button variant="primary" className="w-full" onClick={async () => { await onExit?.() }}>Return to PvE</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
