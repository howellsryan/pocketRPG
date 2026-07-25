import { useEffect, useRef, useState, useCallback } from 'preact/hooks'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import HPBar from '../components/HPBar.jsx'
import CombatQuickActions from '../components/CombatQuickActions.jsx'
import { coopApi } from '../cloud/coop.js'
import itemsData from '../data/items.json'
import prayersData from '../data/prayers.json'
import monstersData from '../data/monsters.json'

const COOP_POLL_MS = 600
// The server rejects a tick that arrives early anyway, so a failed poll just
// backs off rather than hammering.
const COOP_ERROR_BACKOFF_MS = 2000

function coopDamageShare(damage, total) {
  if (!(total > 0)) return 0
  return Math.round((damage / total) * 100)
}

/**
 * Live view of a server-run co-op boss fight. The client renders only — every
 * swing is resolved server-side and arrives through the tick poll, and player
 * actions are queued as intents rather than applied locally.
 */
export default function CoopBossScreen({ sessionId, characterId, onExit, addToast }) {
  const [state, setState] = useState(null)
  const [events, setEvents] = useState([])
  const [error, setError] = useState(null)
  const [leaving, setLeaving] = useState(false)
  const [killSummary, setKillSummary] = useState(null)
  const pollTimer = useRef(null)
  const stoppedRef = useRef(false)

  const me = state?.members?.[String(characterId)] || null
  const boss = state?.boss || null
  const bossName = monstersData?.[state?.bossId]?.name || 'Boss'
  const members = state ? Object.values(state.members || {}) : []
  const totalDamage = members.reduce((sum, m) => sum + (m.damage || 0), 0)
  const isTarget = state?.targetCharId === String(characterId)

  const poll = useCallback(async () => {
    if (stoppedRef.current) return
    try {
      const res = await coopApi.tick(sessionId)
      if (stoppedRef.current) return
      if (res.state) setState(res.state)
      if (res.events?.length) setEvents((prev) => [...prev, ...res.events].slice(-60))
      // Read names off the response, not the render closure — this callback is
      // captured once for the life of the session, so anything from render is
      // stale by the time a kill lands.
      if (res.kill) {
        setKillSummary(res.kill)
        const owner = res.kill.ownerCharacterId
        if (owner === characterId) {
          const granted = res.kill.settlement?.granted || []
          addToast?.(granted.length > 0 ? `${bossName} defeated — loot is yours!` : `${bossName} defeated!`, 'success')
        } else {
          const winner = res.state?.members?.[String(owner)]
          addToast?.(`${bossName} defeated — loot went to ${winner?.username || 'the top attacker'}.`, 'info')
        }
      }
      if (res.events?.some((e) => e.type === 'bossRespawned')) setKillSummary(null)
      setError(null)
      pollTimer.current = setTimeout(poll, COOP_POLL_MS)
    } catch (err) {
      if (stoppedRef.current) return
      if (err.status === 403 || err.status === 404 || err.status === 409) {
        setError(err.message || 'This fight has ended.')
        return
      }
      setError(err.message || 'Connection problem — retrying…')
      pollTimer.current = setTimeout(poll, COOP_ERROR_BACKOFF_MS)
    }
  }, [sessionId, characterId, bossName, addToast])

  useEffect(() => {
    stoppedRef.current = false
    poll()
    return () => {
      stoppedRef.current = true
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
    // Re-running on every `poll` identity change would restart the loop each
    // tick; the session is what actually scopes this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const send = async (action) => {
    try {
      await coopApi.sendAction(sessionId, action)
    } catch (err) {
      addToast?.(err.message || 'Action failed', 'error')
    }
  }

  const handleLeave = async () => {
    setLeaving(true)
    stoppedRef.current = true
    if (pollTimer.current) clearTimeout(pollTimer.current)
    try {
      await coopApi.leave(sessionId)
    } catch (err) {
      addToast?.(err.message || 'Could not leave cleanly', 'error')
    }
    onExit?.()
  }

  if (!state) {
    return (
      <div class="h-full flex flex-col items-center justify-center gap-3">
        {error ? (
          <>
            <div class="text-sm text-[var(--color-blood-light)]">{error}</div>
            <Button variant="secondary" onClick={onExit}>Back</Button>
          </>
        ) : (
          <>
            <div class="w-8 h-8 border-2 border-[var(--color-gold)] border-t-transparent rounded-full animate-spin" />
            <div class="text-sm text-[var(--color-parchment)] opacity-70">Joining the fight…</div>
          </>
        )}
      </div>
    )
  }

  return (
    <div class="h-full flex flex-col gap-3 p-3 overflow-y-auto">
      <div class="flex items-center justify-between gap-2">
        <div>
          <div class="text-base font-semibold text-[var(--color-parchment)]">{bossName}</div>
          <div class="text-[10px] text-[var(--color-parchment)] opacity-60">
            {members.length} {members.length === 1 ? 'player' : 'players'} · tick {state.tick}
          </div>
        </div>
        <Button variant="danger" size="sm" onClick={handleLeave} disabled={leaving}>
          {leaving ? 'Leaving…' : 'Leave'}
        </Button>
      </div>

      <Card>
        <HPBar current={boss?.currentHP ?? 0} max={boss?.maxHP ?? 1} label={bossName} size="large" />
        {boss?.add && (
          <div class="mt-2">
            <HPBar current={boss.add.currentHP} max={boss.add.hitpoints} label={boss.add.name} />
            <Button
              variant={me?.combat?.addTargeted ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => send({ type: 'target_add', value: !me?.combat?.addTargeted })}
            >
              {me?.combat?.addTargeted ? 'Attacking add' : 'Attack add'}
            </Button>
          </div>
        )}
        {boss?.respawnCountdown > 0 && (
          <div class="mt-2 text-[11px] text-[var(--color-gold)] text-center">
            Defeated — respawning…
          </div>
        )}
      </Card>

      <Card>
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-parchment)] opacity-60 mb-2">
          Damage — loot goes to the top
        </div>
        <div class="space-y-1.5">
          {[...members].sort((a, b) => b.damage - a.damage).map((m, idx) => {
            const isMe = m.characterId === characterId
            const targeted = state.targetCharId === String(m.characterId)
            return (
              <div key={m.characterId} class="flex items-center gap-2">
                <span class={`text-[11px] w-4 ${idx === 0 ? 'text-[var(--color-gold)]' : 'text-[var(--color-parchment)] opacity-50'}`}>
                  {idx + 1}
                </span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class={`text-xs truncate ${isMe ? 'text-[var(--color-gold)] font-semibold' : 'text-[var(--color-parchment)]'}`}>
                      {m.username}{isMe ? ' (you)' : ''}
                    </span>
                    {targeted && <span class="text-[9px] bg-[var(--color-blood)] text-white px-1 rounded">TARGET</span>}
                    {m.status === 'dead' && <span class="text-[9px] text-[var(--color-blood-light)]">DEAD</span>}
                  </div>
                  <div class="h-1 bg-[#222] rounded-full overflow-hidden mt-0.5">
                    <div
                      class="h-full rounded-full"
                      style={{ width: `${coopDamageShare(m.damage, totalDamage)}%`, backgroundColor: idx === 0 ? 'var(--color-gold)' : 'var(--color-void-lighter)' }}
                    />
                  </div>
                </div>
                <span class="text-[11px] font-[var(--font-mono)] text-[var(--color-parchment)] w-14 text-right">
                  {(m.damage || 0).toLocaleString()}
                </span>
              </div>
            )
          })}
        </div>
      </Card>

      {me && (
        <Card>
          <HPBar current={me.hp} max={me.maxHP} label={isTarget ? 'You — the boss is on you' : 'You'} />
          <div class="flex items-center gap-3 mt-2 text-[10px] text-[var(--color-parchment)]">
            <span>Prayer {me.combat.prayerPoints}/{me.combat.maxPrayerPoints}</span>
            <span>Special {me.combat.specialAttackEnergy}%</span>
            <span class="opacity-60">{me.combat.stance}</span>
          </div>
          <div class="flex gap-2 mt-2 flex-wrap">
            <Button
              variant={me.combat.specialAttackQueued ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => send({ type: 'queue_special' })}
              disabled={me.status !== 'alive'}
            >
              ⚡ Special
            </Button>
            {['accurate', 'aggressive', 'defensive'].map((stance) => (
              <Button
                key={stance}
                variant={me.combat.stance === stance ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => send({ type: 'change_stance', stance })}
                disabled={me.status !== 'alive'}
              >
                {stance[0].toUpperCase() + stance.slice(1)}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {me?.status === 'dead' && (
        <Card>
          <div class="text-center text-sm text-[var(--color-blood-light)] mb-2">
            You were defeated. Your progress is saved when you leave.
          </div>
          <Button variant="primary" onClick={handleLeave} disabled={leaving}>Leave fight</Button>
        </Card>
      )}

      {me?.status === 'alive' && (
        <CombatQuickActions
          inventory={me.inventory}
          itemsData={itemsData}
          onEat={(entry) => send({ type: 'eat', inventorySlot: entry.slotIdx })}
          onPotion={(entry) => send({ type: 'drink_potion', inventorySlot: entry.slotIdx })}
          isPotionActive={(itemId) => !!me.combat.activePotions?.[itemId]}
          prayersData={prayersData}
        />
      )}

      {killSummary && (
        <Card>
          <div class="text-sm text-[var(--color-gold)] font-semibold text-center">
            {bossName} defeated
          </div>
          <div class="text-[11px] text-[var(--color-parchment)] text-center mt-1">
            Loot to {state.members?.[String(killSummary.ownerCharacterId)]?.username || 'the top attacker'}
          </div>
        </Card>
      )}

      {error && (
        <div class="text-[11px] text-[var(--color-blood-light)] text-center">{error}</div>
      )}

      <div class="text-[10px] text-[var(--color-parchment)] opacity-40 text-center">
        {events.filter((e) => e.type === 'playerHit' || e.type === 'specialHit').slice(-1).map((e) => (
          <span key={e.tick}>last hit {e.damage ?? e.totalDamage ?? 0}</span>
        ))}
      </div>
    </div>
  )
}
