import { useEffect, useRef, useState, useCallback } from 'preact/hooks'
import BackLink from '../components/BackLink.jsx'
import GameIcon from '../components/GameIcon.jsx'
import Modal from '../components/Modal.jsx'
import HPBar from '../components/HPBar.jsx'
import { HitSplatLayer } from '../components/HitSplat.jsx'
import LootResultModal from '../components/LootResultModal.jsx'
import SpellSelectGrid from '../components/SpellSelectGrid.jsx'
import ActivePotionBadges from '../components/ActivePotionBadges.jsx'
import CombatQuickActions from '../components/CombatQuickActions.jsx'
import { CombatFightHead, CombatHPBlock, CombatPrayerBlock } from '../components/CombatHud.jsx'
import { useGame } from '../state/gameState.jsx'
import { coopApi } from '../cloud/coop.js'
import { splatsFromCoopEvents, HIT_SPLAT_DURATION_MS } from '../utils/hitSplats.js'
import { getMonsterArt, getStyleArt } from '../utils/combatArt.js'
import { getLevelFromXP } from '../engine/experience.js'
import { canAffordSpecialAttack } from '../engine/specialAttackEnergy.js'
import itemsData from '../data/items.json'
import prayersData from '../data/prayers.json'
import monstersData from '../data/monsters.json'

const COOP_POLL_MS = 600
// The server rejects a tick that arrives early anyway, so a failed poll just
// backs off rather than hammering.
const COOP_ERROR_BACKOFF_MS = 2000

/**
 * Live view of a server-run co-op boss fight. Deliberately renders the same HUD
 * as the solo fight (CombatScreen's mobile layout, via components/CombatHud) —
 * the only difference a player should feel is that the swings come from the
 * server. The client renders only: every hit is resolved server-side and
 * arrives through the tick poll, and actions are queued as intents.
 */
export default function CoopBossScreen({ sessionId, characterId, onExit, addToast }) {
  const { stats, quickPrayers, activeCombatSpell, updateActiveCombatSpell } = useGame()
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [bossSplats, setBossSplats] = useState([])
  const [addSplats, setAddSplats] = useState([])
  const [playerSplats, setPlayerSplats] = useState([])
  const [showSpellModal, setShowSpellModal] = useState(false)
  const pollTimer = useRef(null)
  const stoppedRef = useRef(false)
  const splatTimersRef = useRef(new Set())
  const leavingRef = useRef(false)

  const me = state?.members?.[String(characterId)] || null
  const boss = state?.boss || null
  const monster = monstersData?.[state?.bossId] || null
  const bossName = monster?.name || 'Boss'
  const memberCount = state ? Object.keys(state.members || {}).length : 0
  const activeAdd = boss?.add && boss.add.currentHP > 0 ? boss.add : null

  const pushSplats = (setter, splats) => {
    if (!splats.length) return
    setter((prev) => [...prev, ...splats])
    const ids = new Set(splats.map((s) => s.id))
    const timer = setTimeout(() => {
      splatTimersRef.current.delete(timer)
      setter((prev) => prev.filter((s) => !ids.has(s.id)))
    }, HIT_SPLAT_DURATION_MS)
    splatTimersRef.current.add(timer)
  }

  useEffect(() => () => {
    for (const t of splatTimersRef.current) clearTimeout(t)
    splatTimersRef.current.clear()
  }, [])

  const poll = useCallback(async () => {
    if (stoppedRef.current) return
    try {
      const res = await coopApi.tick(sessionId)
      if (stoppedRef.current) return
      if (res.state) setState(res.state)
      if (res.events?.length) {
        const tickSplats = splatsFromCoopEvents(res.events, characterId)
        pushSplats(setBossSplats, tickSplats.boss)
        pushSplats(setAddSplats, tickSplats.add)
        pushSplats(setPlayerSplats, tickSplats.player)
      }
      // Read names off the response, not the render closure — this callback is
      // captured once for the life of the session, so anything from render is
      // stale by the time a kill lands.
      if (res.kill) {
        const owner = res.kill.ownerCharacterId
        const killedName = monstersData?.[res.state?.bossId]?.name || 'The boss'
        if (Number(owner) === Number(characterId)) {
          const granted = res.kill.settlement?.granted || []
          addToast?.(granted.length > 0 ? `${killedName} defeated — loot is yours!` : `${killedName} defeated!`, 'success')
        } else {
          const winner = res.state?.members?.[String(owner)]
          addToast?.(`${killedName} defeated — loot went to ${winner?.username || 'the top attacker'}.`, 'info')
        }
      }
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
  }, [sessionId, characterId, addToast])

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

  // Leaving the fight is the back arrow, exactly as it is in a solo fight.
  const handleLeave = async () => {
    if (leavingRef.current) return
    leavingRef.current = true
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
            <BackLink onClick={onExit} />
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

  const mArt = getMonsterArt(monster || { id: state.bossId, name: bossName })
  const form = monster?.multiForm && boss?.monster?.currentForm && monster.forms?.[boss.monster.currentForm]
    ? monster.forms[boss.monster.currentForm]
    : null
  const combatState = me?.combat
  const weaponEntry = me?.equipment?.weapon
  const weapon = weaponEntry ? itemsData[weaponEntry.itemId] : null
  const hasSpec = !!weapon?.specialAttack
  const energy = combatState?.specialAttackEnergy || 0
  const canSpec = hasSpec && canAffordSpecialAttack(weapon.specialAttack, energy) && me?.status === 'alive'
  const specQueued = !!combatState?.specialAttackQueued
  const isMagic = weapon?.attackStyle === 'magic'

  return (
    <div class="forge-shell h-full flex flex-col p-4">
      <BackLink onClick={handleLeave} className="mb-3" />

      <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar">
        <CombatFightHead
          icon={mArt.icon}
          accent={mArt.accent}
          name={bossName}
          nameColor={getStyleArt(form ? form.attackStyle : monster?.attackStyle).color}
          sub={`${memberCount} ${memberCount === 1 ? 'player' : 'players'} in this fight`}
          combatLevel={monster?.combatLevel}
        />

        <CombatHPBlock
          label="Enemy Hitpoints"
          current={boss?.currentHP ?? 0}
          max={boss?.maxHP ?? 1}
          splats={bossSplats}
        />

        <CombatHPBlock
          label="Your Hitpoints"
          current={me?.hp ?? 0}
          max={me?.maxHP ?? 1}
          splats={playerSplats}
          valueColor="#7ce88a"
          right={<ActivePotionBadges activePotions={combatState?.activePotions} itemsData={itemsData} />}
        />

        {activeAdd && (
          <div class="cb-qa" style={{ marginBottom: 12 }}>
            <div class="cb-hplabel">
              <span>{activeAdd.icon} {activeAdd.name}</span>
              <span class="cb-hplabel__v">{Math.max(0, Math.round(activeAdd.currentHP))}/{activeAdd.hitpoints}</span>
            </div>
            <div class="relative mb-2">
              <HPBar current={Math.max(0, activeAdd.currentHP)} max={activeAdd.hitpoints} size="large" />
              <HitSplatLayer splats={addSplats} />
            </div>
            <div class="cb-qa__grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
              <button
                class={'cb-slot' + (combatState?.addTargeted ? '' : ' is-active')}
                onClick={() => send({ type: 'target_add', value: false })}
              >
                <span class="cb-slot__name">{bossName}</span>
                <span class="cb-slot__tag">{combatState?.addTargeted ? 'Attack' : 'Attacking'}</span>
                {!combatState?.addTargeted && <span class="cb-slot__ring" />}
              </button>
              <button
                class={'cb-slot' + (combatState?.addTargeted ? ' is-active' : '')}
                onClick={() => send({ type: 'target_add', value: true })}
              >
                <span class="cb-slot__name">{activeAdd.name}</span>
                <span class="cb-slot__tag">{combatState?.addTargeted ? 'Attacking' : 'Attack'}</span>
                {combatState?.addTargeted && <span class="cb-slot__ring" />}
              </button>
            </div>
          </div>
        )}

        {typeof combatState?.maxPrayerPoints === 'number' && (
          <CombatPrayerBlock current={combatState.prayerPoints} max={combatState.maxPrayerPoints} />
        )}

        {boss?.respawnCountdown > 0 && (
          <div class="mb-3 text-[11px] text-[var(--color-gold)] text-center">
            Defeated — the next one is on its way…
          </div>
        )}

        {me?.status === 'alive' && (
          <CombatQuickActions
            inventory={me.inventory}
            itemsData={itemsData}
            onEat={(entry) => send({ type: 'eat', inventorySlot: entry.slotIdx })}
            onPotion={(entry) => send({ type: 'drink_potion', inventorySlot: entry.slotIdx })}
            onEquip={() => addToast?.('Gear cannot be swapped during a group boss fight.', 'info')}
            isPotionActive={(item) => Object.keys(combatState?.activePotions || {}).some(pid => itemsData[pid]?.effect === item.effect)}
            quickPrayers={quickPrayers}
            prayersData={prayersData}
            prayerLevel={getLevelFromXP(stats?.prayer?.xp || 0)}
            onPrayer={(prayerId) => send({ type: 'toggle_prayer', prayerId })}
            isPrayerActive={(prayerId) => combatState?.activeProtectionPrayer === prayerId || combatState?.activeCombatPrayer === prayerId}
          />
        )}

        {me?.status === 'alive' && (
          <div class="cb-actions cb-actions--two" style={{ marginTop: 12, marginBottom: 12 }}>
            <button
              class={'cb-act' + (specQueued ? ' is-on' : '')}
              disabled={!canSpec && !specQueued}
              onClick={canSpec ? () => send({ type: 'queue_special' }) : undefined}
            >
              <GameIcon iconKey="lightning_arc" color="currentColor" size={18} />
              <span>Special{hasSpec ? ` ${energy}%` : ''}</span>
            </button>
            <button class="cb-act" disabled={!isMagic} onClick={isMagic ? () => setShowSpellModal(true) : undefined}>
              <GameIcon iconKey="crystal_ball" color="currentColor" size={18} />
              <span>Cast Spell</span>
            </button>
          </div>
        )}

        {error && (
          <div class="text-[11px] text-[var(--color-blood-light)] text-center">{error}</div>
        )}
      </div>

      {showSpellModal && (
        <Modal onClose={() => setShowSpellModal(false)}>
          <div class="cb-prayhead">
            <h3>Spells</h3>
            <button onClick={() => setShowSpellModal(false)} class="cb-x" aria-label="Close">
              <GameIcon iconKey="cancel" color="var(--fm-ink-soft)" size={16} />
            </button>
          </div>
          <div class="max-h-96 overflow-y-auto">
            <SpellSelectGrid
              magicLevel={getLevelFromXP(stats?.magic?.xp || 0)}
              activeSpellId={combatState?.spellId || activeCombatSpell?.id || null}
              onSelect={(spell) => {
                updateActiveCombatSpell({ id: spell.id, name: spell.name, baseDamage: spell.baseDamage })
                send({ type: 'change_combat_spell', spellId: spell.id })
                addToast?.(`Spell changed to ${spell.name}`, 'info')
                setShowSpellModal(false)
              }}
            />
          </div>
        </Modal>
      )}

      {/* Derived from the member's status rather than the death event, so a
          reload or a dropped poll still shows it. A dead member stays dead for
          the life of the session — respawning the boss does not revive them. */}
      {me?.status === 'dead' && (
        <LootResultModal
          theme="blood"
          kind="progress"
          icon="💀"
          eyebrow={`Slain by ${bossName}`}
          title="Defeated"
          primaryAction={{ label: 'Continue', onClick: handleLeave }}
          onClose={handleLeave}
        />
      )}
    </div>
  )
}
