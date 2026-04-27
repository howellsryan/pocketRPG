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

const POLL_VISIBLE_MS = 600
const POLL_HIDDEN_MS = 1500
const NO_POLL_WARNING_MS = 5000

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
  const [busy, setBusy] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const [endModal, setEndModal] = useState(null)
  const [hiddenMode, setHiddenMode] = useState(document.hidden)
  const [staleWarning, setStaleWarning] = useState(false)

  const selfId = useMemo(() => parseInt(getCharacterId(), 10), [])
  const pollTimer = useRef(null)
  const mounted = useRef(true)
  const lastPollOkAt = useRef(0)
  const latestTick = useRef(0)

  const pair = useMemo(() => {
    if (!state?.combatants) return { self: null, opp: null }
    const combatants = Object.values(state.combatants)
    const self = combatants.find(c => Number(c.characterId) === selfId) || null
    const opp = combatants.find(c => Number(c.characterId) !== selfId) || null
    return { self, opp }
  }, [state, selfId])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [])

  useEffect(() => {
    const onVisibility = () => setHiddenMode(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const refreshFromServer = async () => {
    const res = await pvpApi.getMatch(matchId, latestTick.current)
    if (!mounted.current) return
    setMatchMeta(res.match)
    if (res.state_changed && res.state) {
      setState(res.state)
      latestTick.current = res.state.tick || 0
    }
    lastPollOkAt.current = Date.now()
    setStaleWarning(false)
  }

  const runTick = async () => {
    try {
      if (pendingAction) {
        await pvpApi.postIntent(matchId, latestTick.current, pendingAction)
        setPendingAction(null)
      }
      const tickRes = await pvpApi.tickMatch(matchId)
      if (!mounted.current) return

      if (tickRes.state) {
        setState(tickRes.state)
        latestTick.current = tickRes.state.tick || latestTick.current
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
        if (pollTimer.current) clearInterval(pollTimer.current)
      }
    } catch (err) {
      if (!mounted.current) return
      const msg = err.body?.error || err.message
      if (msg === 'match_not_found' || msg === 'match_not_active') {
        addToast?.('Match has ended.', 'info')
        await onExit?.()
        return
      }
      if (Date.now() - lastPollOkAt.current > NO_POLL_WARNING_MS) {
        setStaleWarning(true)
      }
    }
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        await refreshFromServer()
        if (!active || !mounted.current) return
        pollTimer.current = setInterval(runTick, hiddenMode ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)
      } catch (err) {
        addToast?.(err.body?.error || err.message, 'error')
        await onExit?.()
      }
    })()

    return () => {
      active = false
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [matchId, hiddenMode])

  const recentLines = (state?.recentEvents || []).slice(-6).map((evt) => prettifyEvent(evt, selfId)).filter(Boolean)

  const queueAction = (action) => {
    setPendingAction(action)
    setBusy(true)
    setTimeout(() => setBusy(false), 220)
  }

  const foodSlots = (pair.self?.inventory || [])
    .map((slot, idx) => ({ slot, idx }))
    .filter(({ slot }) => slot && itemsData[slot.itemId]?.heal)
    .slice(0, 4)

  return (
    <div class="p-3 space-y-3">
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
            onClick={async () => {
              try {
                await pvpApi.forfeitMatch(matchId)
                addToast?.('Forfeit queued. Resolving...', 'info')
              } catch (err) {
                addToast?.(err.body?.error || err.message, 'error')
              }
            }}
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
