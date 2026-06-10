import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import EquipmentPaperdoll from '../components/EquipmentPaperdoll.jsx'
import Card from '../components/Card.jsx'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'
import ItemSlot from '../components/ItemSlot.jsx'
import Modal from '../components/Modal.jsx'
import LootResultModal, { MatchupHpStrip, LootResultRow } from '../components/LootResultModal.jsx'
import { pvpApi } from '../cloud/pvp.js'
import itemsData from '../data/items.json'
import prayersData from '../data/prayers.json'
import { getCharacterId } from '../cloud/api.js'
import { normalizePvpState } from '../engine/pvpState.js'
import { isPvpFoodItem } from '../engine/pvpFood.js'
import { isEpicLootValue } from '../utils/itemValue.js'
import { getEquippedPvpSpecialAttack, getPvpSpecialAttackLabel, hasEnoughPvpSpecialEnergy } from '../engine/pvpSpecialAttacks.js'
import { isPvpCombatPotion } from '../engine/pvpPotions.js'
import { calculatePvpRiskValues } from '../engine/pvpRisk.js'
import { formatCompactCoins } from '../utils/formatters.js'
import { getPrayerStyleIcon } from '../utils/prayerIcons.js'
import { splatsFromPvpEvents, HIT_SPLAT_DURATION_MS } from '../utils/hitSplats.js'
import { HitSplatLayer } from '../components/HitSplat.jsx'

const POLL_VISIBLE_MS = 600
const POLL_HIDDEN_MS = 1500
const NO_POLL_WARNING_MS = 5000
const MATCH_BOOT_GRACE_MS = 8000
const MATCH_BOOT_RETRY_MS = 500
const PVP_SCREEN_PROTECTION_PRAYER_IDS = new Set(['protection_from_magic', 'protection_from_missiles', 'protection_from_melee'])
const EQUIPMENT_DISPLAY_SLOTS = ['weapon', 'shield', 'head', 'body', 'legs', 'gloves', 'boots', 'cape', 'neck', 'ring', 'ammo']

function getCombatantTotalRisk(combatant) {
  const risk = calculatePvpRiskValues({
    inventory: combatant?.inventory,
    equipment: combatant?.equipment,
    itemsData,
  })
  return Math.max(0, Number(risk.totalShopValue || 0) || 0)
}

function formatPvpRank(combatant) {
  const rank = Number(combatant?.pvpRank ?? combatant?.pvp_rank)
  return Number.isFinite(rank) && rank > 0 ? `#${Math.floor(rank)}` : 'No Rank'
}

function CompactHpBadge({ label, combatant, align = 'left', splats = null }) {
  const current = Math.max(0, Number(combatant?.hp ?? combatant?.currentHP ?? 0) || 0)
  const max = Math.max(1, Number(combatant?.maxHP ?? 1) || 1)
  const pct = Math.max(0, Math.min(100, (current / max) * 100))
  const totalRisk = getCombatantTotalRisk(combatant)
  const rankLabel = formatPvpRank(combatant)

  return (
    <div class={`relative min-w-0 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <HitSplatLayer splats={splats} />
      <div class="text-[10px] uppercase tracking-wide text-[var(--color-parchment)] opacity-60">{label}</div>
      <div class="text-sm font-semibold text-[var(--color-parchment)] truncate">{combatant?.username || '...'}</div>
      <div class="text-[11px] font-[var(--font-mono)] text-[var(--color-gold)]">HP {current}/{max}</div>
      <div class="text-[10px] text-[var(--color-parchment)] opacity-70">
        Total Risk: <span class="text-[var(--color-gold)]">{formatCompactCoins(totalRisk)}</span>
        {' · '}
        Rank: <span class="text-[var(--color-gold)]">{rankLabel}</span>
      </div>
      <div class="h-1.5 rounded bg-[var(--color-void)] overflow-hidden mt-1">
        <div class="h-full bg-[var(--color-blood-light)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function EquipmentMiniPanel({ title, combatant, align = 'left', onUnequipSlot = null }) {
  const equipment = combatant?.equipment || {}
  const equipped = EQUIPMENT_DISPLAY_SLOTS
    .map((slot) => ({ slot, entry: equipment?.[slot], item: equipment?.[slot] ? itemsData[equipment[slot].itemId] : null }))
    .filter(({ entry }) => !!entry)
  const weapon = equipment?.weapon ? itemsData[equipment.weapon.itemId] : null

  return (
    <Card className="p-2">
      <div class={`text-[10px] uppercase tracking-wide text-[var(--color-gold)] mb-1 ${align === 'right' ? 'text-right' : ''}`}>
        {title}
      </div>
      <div class={`text-[11px] text-[var(--color-parchment)] opacity-80 mb-2 truncate ${align === 'right' ? 'text-right' : ''}`}>
        Weapon: {weapon?.name || 'None'}
      </div>
      <div class={`flex gap-1 flex-wrap ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        {equipped.length === 0 && (
          <span class="text-[10px] text-[var(--color-parchment)] opacity-50">No gear equipped</span>
        )}
        {equipped.slice(0, 8).map(({ slot, entry, item }) => (
          <span
            key={`${slot}-${entry.itemId}`}
            title={`${slot}: ${item?.name || entry.itemId}`}
            class="inline-flex max-w-full items-center rounded border border-[var(--color-gold-dim)] bg-[var(--color-void-light)] px-1.5 py-0.5 text-[10px] text-[var(--color-parchment)] gap-1"
          >
            <span class="inline-flex max-w-full items-center gap-1 align-middle">
              <span class="shrink-0">{item?.icon || '▫️'}</span>
              <span class="truncate">{item?.name || entry.itemId}</span>
            </span>
            {onUnequipSlot && (
              <button
                type="button"
                onClick={() => onUnequipSlot(slot)}
                class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] leading-none text-[var(--color-parchment)] opacity-70 hover:opacity-100 active:opacity-100"
                title={`Unequip ${item?.name || entry.itemId}`}
                aria-label={`Unequip ${item?.name || entry.itemId}`}
              >
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
    </Card>
  )
}

function getLootQuantity(entry) {
  const qty = Number(entry?.quantity)
  if (!Number.isFinite(qty) || qty <= 0) return 1
  return Math.floor(qty)
}

function getLootGroupKey(entry) {
  return `${entry?.itemId || 'unknown'}::${entry?.charges ?? ''}`
}

function aggregateLootEntries(entries = []) {
  const grouped = new Map()

  for (const entry of entries || []) {
    if (!entry?.itemId) continue

    const key = getLootGroupKey(entry)
    const qty = getLootQuantity(entry)
    const existing = grouped.get(key)

    if (existing) {
      existing.quantity += qty
      continue
    }

    grouped.set(key, {
      ...entry,
      quantity: qty,
    })
  }

  return [...grouped.values()]
}

function formatLootEntry(entry) {
  const itemId = entry?.itemId
  const item = itemsData?.[itemId]
  const qty = getLootQuantity(entry)
  const name = item?.name || itemId || 'Unknown item'
  const charges = entry?.charges != null ? ` (${formatCompactCoins(entry.charges)} charges)` : ''

  if (itemId === 'coins') {
    return `${formatCompactCoins(qty)} coins`
  }

  return `${formatCompactCoins(qty)}x ${name}${charges}`
}

function getLootIcon(entry) {
  return itemsData?.[entry?.itemId]?.icon || '▫️'
}

function getEndLootTotal(loot) {
  const value = Number(loot?.totalRiskValue ?? loot?.bankedValue ?? loot?.addedValue ?? 0)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

function formatHitList(hits, totalDamage) {
  const clean = Array.isArray(hits) && hits.length > 0 ? hits : [totalDamage || 0]
  return clean.map((hit) => {
    const value = Math.max(0, Math.floor(Number(hit) || 0))
    return value > 0 ? String(value) : 'miss'
  }).join(' + ')
}

function prettifyEvent(evt, selfId) {
  if (!evt) return null
  if (evt.type === 'attack') {
    const mine = evt.attackerCharacterId === selfId
    const actor = mine ? 'You' : 'Opponent'
    const totalDamage = Math.max(0, Math.floor(Number(evt.totalDamage ?? evt.damage ?? evt.specialAttack?.totalDamage ?? 0) || 0))
    if (evt.special || evt.specialAttack) {
      const specType = evt.specialAttack?.type || evt.specType || 'special'
      const label = evt.specialAttack?.label || getPvpSpecialAttackLabel(specType)
      const hits = evt.specialAttack?.hits || evt.hits || [totalDamage]
      return `${actor} used ${label}: ${formatHitList(hits, totalDamage)} (total ${totalDamage})`
    }
    return `${actor} hit ${evt.damage} ${evt.hit ? '✓' : '✗'}`
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
  const [actionPanel, setActionPanel] = useState(null)
  const [endModal, setEndModal] = useState(null)
  const [hiddenMode, setHiddenMode] = useState(() => (
    typeof document !== 'undefined' ? document.hidden : false
  ))
  const [isDesktopLayout, setIsDesktopLayout] = useState(false)
  const [staleWarning, setStaleWarning] = useState(false)
  const [specialQueuedOverride, setSpecialQueuedOverride] = useState(null)
  const [prayerQueuedOverride, setPrayerQueuedOverride] = useState(undefined)
  const [selfSplats, setSelfSplats] = useState([])
  const [oppSplats, setOppSplats] = useState([])

  const selfId = useMemo(() => parseInt(getCharacterId(), 10), [])
  const pollTimer = useRef(null)
  const mounted = useRef(true)
  const tickInFlight = useRef(false)
  const pendingActionRef = useRef(null)
  const lastPollOkAt = useRef(0)
  const latestTick = useRef(0)
  const fatalNotified = useRef(false)
  const terminalHandledRef = useRef(false)
  const endModalOpenRef = useRef(false)
  const prayerOverrideTimer = useRef(null)
  const splatTimersRef = useRef(new Set())
  const lastSplatTickRef = useRef(null)

  useEffect(() => {
    pendingActionRef.current = pendingAction
  }, [pendingAction])

  useEffect(() => {
    endModalOpenRef.current = !!endModal
  }, [endModal])

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

  // Hit splats — floating damage markers over the HP badges. The engine tags
  // recentEvents with the tick they landed on, so each state update splats
  // only the events newer than the last seen tick (tick responses carry
  // events only for whichever player's call advanced the match).
  const pushSplats = (setter, splats) => {
    if (!splats.length) return
    setter(prev => [...prev, ...splats])
    const ids = new Set(splats.map(s => s.id))
    const timer = setTimeout(() => {
      splatTimersRef.current.delete(timer)
      setter(prev => prev.filter(s => !ids.has(s.id)))
    }, HIT_SPLAT_DURATION_MS)
    splatTimersRef.current.add(timer)
  }

  const ingestSplats = (normalizedState) => {
    const tick = normalizedState?.tick || 0
    if (lastSplatTickRef.current === null) {
      // First state after mount: don't replay the recent-event history.
      lastSplatTickRef.current = tick
      return
    }
    if (tick <= lastSplatTickRef.current) return
    const fresh = (normalizedState.recentEvents || []).filter(
      (ev) => Number(ev?.tick) > lastSplatTickRef.current,
    )
    lastSplatTickRef.current = tick
    const { self, opp } = splatsFromPvpEvents(fresh, selfId)
    pushSplats(setSelfSplats, self)
    pushSplats(setOppSplats, opp)
  }

  const serverSpecialQueued = !!pair.self?.specialAttackQueued
  const specialVisuallyQueued = specialQueuedOverride !== null
    ? specialQueuedOverride
    : serverSpecialQueued

  const serverActivePrayerId = pair.self?.activeCombatPrayer || null
  const visuallyActivePrayerId = prayerQueuedOverride !== undefined
    ? prayerQueuedOverride
    : serverActivePrayerId

  useEffect(() => {
    if (specialQueuedOverride === null) return
    if (serverSpecialQueued === specialQueuedOverride) {
      setSpecialQueuedOverride(null)
    }
  }, [serverSpecialQueued, specialQueuedOverride])

  useEffect(() => {
    if (prayerQueuedOverride === undefined) return

    if (serverActivePrayerId === prayerQueuedOverride) {
      setPrayerQueuedOverride(undefined)
      if (prayerOverrideTimer.current) {
        clearTimeout(prayerOverrideTimer.current)
        prayerOverrideTimer.current = null
      }
    }
  }, [serverActivePrayerId, prayerQueuedOverride])

  useEffect(() => {
    mounted.current = true
    terminalHandledRef.current = false
    endModalOpenRef.current = false
    return () => {
      mounted.current = false
      if (pollTimer.current) clearTimeout(pollTimer.current)
      if (prayerOverrideTimer.current) clearTimeout(prayerOverrideTimer.current)
      for (const t of splatTimersRef.current) clearTimeout(t)
      splatTimersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const onVisibility = () => setHiddenMode(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const checkDesktop = () => {
      const width = window.innerWidth || 0
      const height = window.innerHeight || 0
      setIsDesktopLayout(width >= 1250 && height >= 600)
    }
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
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


  const buildEndModalFromResponse = (res) => {
    const summary = res?.end_summary || (res?.terminal ? {
      terminal: res.terminal,
      loot: res.loot || null,
      writebackOk: res.terminal_writeback !== false,
      endedAt: res.ended_at,
    } : null)
    const terminal = summary?.terminal
    if (!terminal) return null
    const youWon = Number(terminal.winner) === selfId
    const writebackOk = summary.writebackOk !== false && res?.terminal_writeback !== false
    return { youWon, reason: terminal.reason || 'death', writebackOk, loot: writebackOk ? (summary.loot || res?.loot || { added: [], dropped: [], droppedValue: 0, bankedValue: 0, addedValue: 0, totalRiskValue: 0 }) : null }
  }

  const openEndModalFromResponse = (res) => {
    const modal = buildEndModalFromResponse(res)
    if (!modal) return false
    terminalHandledRef.current = true
    setEndModal(modal)
    setLoading(false)
    setBootstrapError(null)
    setStaleWarning(false)
    if (pollTimer.current) clearTimeout(pollTimer.current)
    return true
  }

  const recoverCompletedMatch = async () => {
    try {
      const res = await pvpApi.getMatch(matchId, null)
      if (!mounted.current) return false
      setMatchMeta(res?.match || null)
      if (res?.state) {
        const normalizedState = normalizePvpState(res.state)
        if (normalizedState) {
          setState(normalizedState)
          latestTick.current = normalizedState.tick || latestTick.current
        }
      }
      return openEndModalFromResponse(res)
    } catch (err) {
      console.warn('[PocketRPG][PvP] completed match recovery failed:', err?.body || err)
      return false
    }
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
        ingestSplats(normalizedState)
      }
    } else if (res?.match?.current_tick != null) {
      latestTick.current = Number(res.match.current_tick) || latestTick.current
    }
    lastPollOkAt.current = Date.now()
    setStaleWarning(false)
    setLoading(false)
    if (openEndModalFromResponse(res)) return
  }

  const runTick = async () => {
    if (terminalHandledRef.current) return false
    if (tickInFlight.current) return true
    tickInFlight.current = true
    try {
      if (terminalHandledRef.current) return false
      const action = pendingActionRef.current
      if (action) {
        await pvpApi.postIntent(matchId, latestTick.current, action)
        pendingActionRef.current = null
        setPendingAction(null)
      }
      const tickRes = await pvpApi.tickMatch(matchId)
      if (!mounted.current) return false

      if (tickRes.state) {
        const normalizedState = normalizePvpState(tickRes.state)
        if (normalizedState) {
          setState(normalizedState)
          latestTick.current = normalizedState.tick || latestTick.current
          ingestSplats(normalizedState)
        }
      }
      lastPollOkAt.current = Date.now()
      setStaleWarning(false)

      if (tickRes.terminal) {
        if (!openEndModalFromResponse(tickRes)) {
          terminalHandledRef.current = true
        const youWon = Number(tickRes.terminal.winner) === selfId
        const writebackOk = tickRes.terminal_writeback !== false
        if (!writebackOk) {
          console.error('[PocketRPG][PvP] terminal writeback failed', tickRes)
        }
        setEndModal({
          youWon,
          reason: tickRes.terminal.reason,
          writebackOk,
          loot: writebackOk ? (tickRes.loot || { added: [], dropped: [], droppedValue: 0, bankedValue: 0, totalRiskValue: 0 }) : null,
        })
        if (pollTimer.current) clearTimeout(pollTimer.current)
        }
        return false
      }
      return true
    } catch (err) {
      if (!mounted.current) return false
      const msg = err.body?.error || err.message
      if ((msg === 'match_not_found' || msg === 'match_not_active') && (terminalHandledRef.current || endModalOpenRef.current)) {
        return false
      }
      if (msg === 'match_not_found' || msg === 'match_not_active') {
        const recovered = await recoverCompletedMatch()
        if (recovered) return false
        console.warn('[PocketRPG][PvP] tickMatch reported inactive match; checking server active_match_id before exit:', err?.body || null)
        const noActiveMatch = await confirmNoActiveMatch()
        if (noActiveMatch) {
          addToast?.('Match has ended.', 'info')
          await onExit?.()
          return false
        }
        setBootstrapError('Server still reports an active PvP match. Retry to reconnect.')
        setLoading(false)
        return false
      }
      if (Date.now() - lastPollOkAt.current > NO_POLL_WARNING_MS) {
        setStaleWarning(true)
      }
      return true
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
        const shouldContinue = await runTick()
        if (shouldContinue !== false) scheduleNext()
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
            const recovered = await recoverCompletedMatch()
            if (recovered) return
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

  const queueAction = (action, options = {}) => {
    const { showBusy = true, runImmediately = true } = options
    if (terminalHandledRef.current || endModalOpenRef.current) return

    pendingActionRef.current = action
    setPendingAction(action)

    if (showBusy) {
      setBusy(true)
      setTimeout(() => {
        if (mounted.current) setBusy(false)
      }, 220)
    }

    if (runImmediately) {
      setTimeout(() => {
        if (!terminalHandledRef.current && !endModalOpenRef.current && !tickInFlight.current) runTick()
      }, 0)
    }
  }

  const playerPrayerLevel = Number(pair.self?.stats?.prayer || 1)
  const availablePrayers = Object.values(prayersData || {})
    .filter((prayer) => prayer && prayer.bonusType !== 'protection' && !PVP_SCREEN_PROTECTION_PRAYER_IDS.has(prayer.id))
    .sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0))

  const foodSlots = toArray(pair.self?.inventory)
    .map((slot, idx) => ({ slot, idx, item: slot ? itemsData?.[slot.itemId] : null }))
    .filter(({ slot, item }) => slot && item && isPvpFoodItem(item))
    .slice(0, 8)

  const potionSlots = toArray(pair.self?.inventory)
    .map((slot, idx) => ({ slot, idx, item: slot ? itemsData?.[slot.itemId] : null }))
    .filter(({ slot, item }) => slot && item && isPvpCombatPotion(item))
    .slice(0, 8)

  const equippableSlots = toArray(pair.self?.inventory)
    .map((slot, idx) => ({ slot, idx, item: slot ? itemsData?.[slot.itemId] : null }))
    .filter(({ slot, item }) => slot && item?.slot)

  const equippedSlots = Object.entries(pair.self?.equipment || {})
    .filter(([, entry]) => !!entry)
    .map(([slot, entry]) => ({ slot, entry, item: itemsData?.[entry.itemId] }))
  const hasGearActions = equippableSlots.length > 0 || equippedSlots.length > 0
  const mobilePrayers = availablePrayers.filter((prayer) => playerPrayerLevel >= (prayer.level || 1))

  const equippedSpecial = getEquippedPvpSpecialAttack(pair.self, itemsData)
  const specialReady = hasEnoughPvpSpecialEnergy(pair.self, itemsData)
  const specialEnergy = Math.max(0, Math.floor(Number(pair.self?.specialAttackEnergy ?? 0) || 0))
  const specialCost = equippedSpecial?.energyCost ?? null

  const setTemporaryPrayerOverride = (nextPrayerId) => {
    setPrayerQueuedOverride(nextPrayerId)

    if (prayerOverrideTimer.current) {
      clearTimeout(prayerOverrideTimer.current)
    }

    // If the server rejects or drops the intent, do not leave the UI permanently
    // optimistic. The next poll will restore the server-backed state.
    prayerOverrideTimer.current = setTimeout(() => {
      if (mounted.current) {
        setPrayerQueuedOverride(undefined)
      }
      prayerOverrideTimer.current = null
    }, 4500)
  }

  const queuePrayerToggle = (prayerId) => {
    if (terminalHandledRef.current || endModalOpenRef.current) return

    const currentVisualPrayerId = visuallyActivePrayerId || null
    const nextPrayerId = currentVisualPrayerId === prayerId ? null : prayerId
    const intent = { type: 'toggle_prayer', prayerId }

    setTemporaryPrayerOverride(nextPrayerId)

    // If the user taps the same prayer twice before the intent leaves the
    // browser, cancel the pending toggle and keep the server state unchanged.
    if (
      pendingActionRef.current?.type === 'toggle_prayer' &&
      pendingActionRef.current.prayerId === prayerId &&
      !tickInFlight.current &&
      nextPrayerId === serverActivePrayerId
    ) {
      pendingActionRef.current = null
      setPendingAction(null)
      return
    }

    // If the user changes their mind before the previous prayer intent is sent,
    // replace it with the latest requested prayer instead of sending stale UX.
    if (pendingActionRef.current?.type === 'toggle_prayer' && !tickInFlight.current) {
      pendingActionRef.current = intent
      setPendingAction(intent)
      setTimeout(() => {
        if (!terminalHandledRef.current && !endModalOpenRef.current && !tickInFlight.current) {
          runTick()
        }
      }, 0)
      return
    }

    queueAction(intent, { showBusy: false })
  }

  const toggleSpecialAttack = () => {
    if (terminalHandledRef.current || endModalOpenRef.current) return

    const nextQueued = !specialVisuallyQueued
    setSpecialQueuedOverride(nextQueued)

    // If the user double-taps before the intent has left the browser, cancel
    // the local pending intent and keep this as a pure UI toggle.
    if (pendingActionRef.current?.type === 'queue_special' && !tickInFlight.current) {
      pendingActionRef.current = null
      setPendingAction(null)
      return
    }

    queueAction({ type: 'queue_special' }, { showBusy: false })
  }

  const toggleActionPanel = (panel) => {
    setActionPanel((current) => (current === panel ? null : panel))
  }

  const queueGearEquip = (inventorySlot) => {
    if (terminalHandledRef.current || endModalOpenRef.current) return
    queueAction({ type: 'equip', inventorySlot }, { showBusy: false })
    setActionPanel(null)
  }

  const queueGearUnequip = (equipmentSlot) => {
    if (terminalHandledRef.current || endModalOpenRef.current) return
    queueAction({ type: 'unequip', equipmentSlot }, { showBusy: false })
    setActionPanel(null)
  }
  const endTotalRiskValue = getEndLootTotal(endModal?.loot)
  const endTotalRiskLabel = `${formatCompactCoins(endTotalRiskValue)} gp`
  const wonLootRows = aggregateLootEntries(endModal?.loot?.added || [])

  const handleCloseEndModal = async () => {
    setEndModal(null)
    await onExit?.()
  }

  return (
    <div
      class="h-full min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3 pb-24 md:max-w-6xl md:mx-auto md:px-6"
      style={{ maxHeight: 'calc(100vh - 72px)' }}
    >
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
          </div>
        </Card>
      )}

      {staleWarning && (
        <Card className="border-[var(--color-blood)] bg-[#2a1010]">
          <div class="text-[11px] text-[var(--color-blood-light)]">No successful sync for 5s. You may desync — keep this tab open and reconnect if this persists.</div>
        </Card>
      )}

      {isDesktopLayout ? (
        <div class="grid grid-cols-[minmax(220px,1fr)_minmax(0,1.4fr)_minmax(220px,1fr)] gap-4 items-start">
          <div class="space-y-2">
            <Card className="bg-[var(--color-void-dark)]">
              <CompactHpBadge label="You" combatant={pair.self} align="left" splats={selfSplats} />
            </Card>
            <Card>
              <div class="flex items-center justify-between mb-2">
                <div class="text-[10px] uppercase tracking-wide text-[var(--color-gold)]">Your gear</div>
                <button
                  type="button"
                  onClick={toggleSpecialAttack}
                  disabled={busy || (!specialVisuallyQueued && !specialReady)}
                  aria-pressed={specialVisuallyQueued}
                  aria-label="Special attack"
                  title={equippedSpecial ? (specialVisuallyQueued ? `Special attack queued. Tap again to cancel. (${specialEnergy}%)` : `Special attack — energy: ${specialEnergy}/${specialCost}`) : 'No special attack available'}
                  class={`inline-flex items-center justify-center rounded text-base leading-none transition-colors disabled:opacity-40 p-1 ${
                    specialVisuallyQueued
                      ? '!bg-[var(--color-gold)] !text-[var(--color-void-dark)]'
                      : 'text-[var(--color-gold)] hover:bg-[var(--color-void-light)]'
                  }`}
                >
                  ⚡
                </button>
              </div>
              <EquipmentPaperdoll equipment={pair.self?.equipment || {}} itemsData={itemsData} onSelect={(slotName) => queueGearUnequip(slotName)} size="mdFixed" asCard={false} />
            </Card>
          </div>

          <div class="space-y-3">
            <Card>
              <div class="flex items-center justify-between mb-2 px-1">
                <div class="text-[10px] uppercase tracking-wider text-[var(--color-gold-dim)] opacity-60">Inventory</div>
              </div>
              <div class="grid grid-cols-4 gap-2 justify-items-center">
                {toArray(pair.self?.inventory).map((slot, idx) => {
                  const item = slot ? itemsData?.[slot.itemId] : null
                  let onClick
                  if (slot && item) {
                    if (item.slot) onClick = () => queueGearEquip(idx)
                    else if (isPvpFoodItem(item)) onClick = () => queueAction({ type: 'eat', inventorySlot: idx }, { showBusy: false })
                    else if (isPvpCombatPotion(item)) onClick = () => queueAction({ type: 'drink_potion', inventorySlot: idx }, { showBusy: false })
                  }
                  return (
                    <div key={`inv-${idx}`} onClick={onClick}>
                      <ItemSlot slot={slot} size="small" />
                    </div>
                  )
                })}
              </div>
            </Card>
            <Card>
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-gold-dim)] opacity-60 mb-1.5 px-1">Prayers</div>
              <div class="grid grid-cols-6 gap-1">
                {availablePrayers.map((prayer) => {
                  const active = visuallyActivePrayerId === prayer.id
                  const canUse = playerPrayerLevel >= (prayer.level || 1)
                  const styled = getPrayerStyleIcon(prayer)
                  return (
                    <button
                      key={prayer.id}
                      type="button"
                      onClick={() => canUse && queuePrayerToggle(prayer.id)}
                      disabled={!canUse}
                      aria-pressed={active}
                      title={`${prayer.name} · Lv ${prayer.level}${prayer.description ? `\n${prayer.description}` : ''}`}
                      class={`px-1 py-1 rounded-md border text-center transition-colors ${
                        active
                          ? 'bg-[#2a3a1a] border-[var(--color-gold)]'
                          : canUse
                            ? 'bg-[#1a2a1a] border-[#2a4a2a] active:bg-[#2a3a2a]'
                            : 'bg-[#111] border-[#1a1a1a] opacity-30 cursor-default'
                      }`}
                    >
                      {styled ? (
                        <div class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] leading-none whitespace-nowrap">
                          +{styled.boostPercent}% {styled.icon}
                        </div>
                      ) : (
                        <div class="text-[12px] leading-none">{prayer.icon || '✨'}</div>
                      )}
                      <div class="text-[8px] text-[var(--color-gold-dim)] opacity-70 mt-0.5">Lv {prayer.level}</div>
                    </button>
                  )
                })}
              </div>
            </Card>
          </div>

          <div class="space-y-2">
            <Card className="bg-[var(--color-void-dark)]">
              <CompactHpBadge label="Opponent" combatant={pair.opp} align="right" splats={oppSplats} />
            </Card>
            <Card>
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-gold)] mb-2 text-right">Opponent gear</div>
              <EquipmentPaperdoll equipment={pair.opp?.equipment || {}} itemsData={itemsData} size="mdFixed" asCard={false} />
            </Card>
          </div>
        </div>
      ) : (
        <>
          {hiddenMode && (
            <Card className="border-[var(--color-gold-dim)] bg-[var(--color-void-light)]">
              <div class="text-[11px] text-[var(--color-gold)]">⚠️ Keep this tab open for smooth PvP updates.</div>
            </Card>
          )}

          <Card className="bg-[var(--color-void-dark)]">
            <div class="grid grid-cols-2 gap-3 items-start">
              <CompactHpBadge label="Opponent" combatant={pair.opp} align="left" splats={oppSplats} />
              <CompactHpBadge label="You" combatant={pair.self} align="right" splats={selfSplats} />
            </div>
            <div class="mt-2 text-center text-[10px] font-[var(--font-mono)] text-[var(--color-gold)]">
              Tick {state?.tick ?? matchMeta?.current_tick ?? 0}
            </div>
          </Card>

          <div class="grid grid-cols-2 gap-2">
            <EquipmentMiniPanel title="Opponent gear" combatant={pair.opp} align="left" />
            <EquipmentMiniPanel title="Your gear" combatant={pair.self} align="right" onUnequipSlot={queueGearUnequip} />
          </div>

          <Card>
            <div class="text-xs font-semibold text-[var(--color-gold)] mb-2">Quick Actions</div>
            <div class="flex gap-2 flex-wrap">
              {foodSlots.length === 0 && <div class="text-[11px] text-[var(--color-parchment)] opacity-60">No food in inventory.</div>}
              {foodSlots.map(({ slot, idx }) => (
                <div key={`${slot.itemId}-${idx}`} onClick={() => queueAction({ type: 'eat', inventorySlot: idx })}>
                  <ItemSlot slot={slot} size="small" />
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div class="text-xs font-semibold text-[var(--color-gold)] mb-2">Combat actions</div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Button
                variant={specialVisuallyQueued ? 'primary' : 'secondary'}
                size="md"
                className={`w-full ${specialVisuallyQueued ? '!bg-[var(--color-gold)] !text-[var(--color-void-dark)] !border-[var(--color-gold)]' : ''}`}
                disabled={busy || (!specialVisuallyQueued && !specialReady)}
                aria-pressed={specialVisuallyQueued}
                title={equippedSpecial ? (specialVisuallyQueued ? 'Special attack queued. Tap again to cancel.' : `Special attack energy: ${specialEnergy}/${specialCost}`) : 'No special attack available'}
                onClick={toggleSpecialAttack}
              >
                <span class={specialVisuallyQueued ? 'mr-1' : 'text-[var(--color-gold)] mr-1'}>⚡</span>
                Spec{specialCost != null ? ` ${specialEnergy}%` : ''}
              </Button>
              <Button
                variant={actionPanel === 'prayer' || visuallyActivePrayerId ? 'primary' : 'secondary'}
                size="md"
                className={`w-full transition-none ${
                  visuallyActivePrayerId
                    ? '!border-[var(--color-gold)] !bg-[var(--color-gold)] !text-[var(--color-void-dark)]'
                    : ''
                }`}
                aria-pressed={!!visuallyActivePrayerId}
                onClick={() => toggleActionPanel('prayer')}
              >
                🙏 Prayer
              </Button>
              <Button
                variant={actionPanel === 'potion' ? 'primary' : 'secondary'}
                size="md"
                className="w-full"
                disabled={busy || potionSlots.length === 0}
                onClick={() => toggleActionPanel('potion')}
              >
                🧪 Potion
              </Button>
              <Button
                variant={actionPanel === 'gear' ? 'primary' : 'secondary'}
                size="md"
                className="w-full"
                disabled={busy || !hasGearActions}
                onClick={() => toggleActionPanel('gear')}
              >
                ⚙️ Gear
              </Button>
            </div>

            {actionPanel === 'prayer' && (
              <div class="mt-3">
                {mobilePrayers.length === 0 ? (
                  <div class="text-[11px] text-[var(--color-parchment)] opacity-60">No PvP-usable prayers unlocked.</div>
                ) : (
                  <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {mobilePrayers.map((prayer) => {
                      const active = visuallyActivePrayerId === prayer.id
                      return (
                        <Button
                          key={prayer.id}
                          variant={active ? 'primary' : 'secondary'}
                          size="md"
                          className={`min-h-11 w-full justify-center px-1 text-center text-[10px] leading-tight transition-none ${
                            active
                              ? '!border-[var(--color-gold)] !bg-[var(--color-gold)] !text-[var(--color-void-dark)]'
                              : ''
                          }`}
                          aria-pressed={active}
                          onClick={() => queuePrayerToggle(prayer.id)}
                        >
                          <span class="block truncate">{prayer.icon || '✨'} {prayer.name}</span>
                        </Button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {actionPanel === 'potion' && (
              <div class="mt-3">
                {potionSlots.length === 0 ? (
                  <div class="text-[11px] text-[var(--color-parchment)] opacity-60">No PvP potions in inventory.</div>
                ) : (
                  <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {potionSlots.map(({ slot, idx, item }) => (
                      <Button
                        key={`${slot.itemId}-${idx}`}
                        variant="secondary"
                        size="md"
                        className="min-h-11 w-full justify-center px-1 text-center text-[10px] leading-tight"
                        onClick={() => queueAction({ type: 'drink_potion', inventorySlot: idx }, { showBusy: false })}
                      >
                        <span class="block truncate">{item?.icon || '🧪'} {item?.name || slot.itemId}</span>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          {actionPanel === 'gear' && (
            <Modal onClose={() => setActionPanel(null)}>
              <div class="flex items-center justify-between mb-3">
                <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">
                  Gear
                </h3>
                <button
                  onClick={() => setActionPanel(null)}
                  class="w-6 h-6 flex items-center justify-center rounded-lg bg-[#222] text-[var(--color-parchment)] hover:bg-[#333] active:bg-[#444] transition-colors"
                  title="Close"
                >
                  ✕
                </button>
              </div>

              <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mb-3">
                Equip an item from your inventory or unequip current gear. Gear changes are queued and apply on the next PvP tick.
              </div>

              <div class="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                <div>
                  <div class="text-[10px] uppercase tracking-wide text-[var(--color-gold)] mb-2">
                    Inventory gear
                  </div>

                  {equippableSlots.length === 0 ? (
                    <div class="text-[11px] text-[var(--color-parchment)] opacity-50">
                      No equippable items in inventory.
                    </div>
                  ) : (
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {equippableSlots.map(({ slot, idx, item }) => (
                        <button
                          key={`inventory-gear-${idx}-${slot.itemId}`}
                          onClick={() => queueGearEquip(idx)}
                          class="w-full p-3 rounded-lg border bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222] transition-colors text-left"
                        >
                          <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-2 min-w-0">
                              <ItemSlot slot={slot} size="small" />
                              <div class="min-w-0">
                                <div class="text-sm font-semibold text-[var(--color-parchment)] truncate">
                                  {item?.name || slot.itemId}
                                </div>
                                <div class="text-[10px] text-[var(--color-parchment)] opacity-60 capitalize">
                                  {item?.slot || 'gear'}
                                  {(slot.quantity || 0) > 1 ? ` · x${slot.quantity}` : ''}
                                </div>
                              </div>
                            </div>
                            <span class="text-[10px] text-[var(--color-gold)] shrink-0">
                              Equip
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Modal>
          )}

          <Panel>
            <div class="text-xs font-semibold text-[var(--color-gold)] mb-1">Recent actions</div>
            <div class="space-y-1 max-h-24 overflow-y-auto">
              {recentLines.length === 0 && <div class="text-[11px] text-[var(--color-parchment)] opacity-60">Waiting for first swing…</div>}
              {recentLines.map((line, i) => (
                <div key={i} class="text-[11px] text-[var(--color-parchment)] opacity-80">• {line}</div>
              ))}
            </div>
          </Panel>
        </>
      )}

      {endModal && (() => {
        const youWon = endModal.youWon
        const oppName = pair.opp?.username || 'Opponent'
        const selfName = pair.self?.username || 'You'

        // Build loot rows for the shared component
        const pvpLootEntries = youWon
          ? aggregateLootEntries(endModal.loot?.added || [])
          : aggregateLootEntries(endModal.loot?.dropped || [])

        const pvpLootRows = pvpLootEntries.map((entry) => ({
          key: getLootGroupKey(entry),
          item: itemsData?.[entry.itemId] || null,
          name: itemsData?.[entry.itemId]?.name || entry.itemId || 'Unknown item',
          quantity: getLootQuantity(entry),
          lost: !youWon,
        }))

        const pvpLootTotal = youWon
          ? Number(endModal.loot?.addedValue ?? 0)
          : Number(endModal.loot?.droppedValue ?? endModal.loot?.totalRiskValue ?? 0)

        const selfRisk = getCombatantTotalRisk(pair.self)
        const oppRisk = getCombatantTotalRisk(pair.opp)
        const selfRank = formatPvpRank(pair.self)
        const oppRank = formatPvpRank(pair.opp)

        return (
          <LootResultModal
            theme={youWon ? (isEpicLootValue(pvpLootTotal) ? 'purple' : 'gold') : 'blood'}
            icon={youWon ? '🏆' : '💀'}
            title={youWon ? 'Victorious' : 'Defeated'}
            subtitle={youWon
              ? `${oppName} has fallen before you`
              : `${oppName} has slain you`}
            loot={endModal.writebackOk && pvpLootRows.length > 0 ? pvpLootRows : null}
            lootTitle={youWon ? '✦ Loot Plundered' : 'Items Lost'}
            lootTotal={pvpLootTotal}
            lootSigned={youWon ? '+' : '-'}
            primaryAction={{ label: 'Return to PvE', onClick: handleCloseEndModal }}
            onClose={handleCloseEndModal}
          >
            {/* Writeback warning */}
            {!endModal.writebackOk && (
              <div class="mx-4 mb-3 rounded-2xl border border-[var(--color-blood)] bg-[#2a1010] p-3 text-sm text-[var(--color-parchment)]">
                <div class="font-semibold text-[var(--color-blood-light)]">PvP result saved with a warning</div>
                <div class="mt-1 text-xs opacity-80">
                  The match ended, but the reward writeback did not complete. Please refresh before starting another PvP match.
                </div>
              </div>
            )}

            {/* Both-fighter HP strip */}
            <MatchupHpStrip
              self={youWon ? pair.self : { ...pair.self, hp: 0 }}
              opp={youWon ? { ...pair.opp, hp: 0 } : pair.opp}
              selfRisk={selfRisk}
              oppRisk={oppRisk}
              selfRank={selfRank}
              oppRank={oppRank}
            />
          </LootResultModal>
        )
      })()}
    </div>
  )
}
