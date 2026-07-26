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
import CoopLootShare from '../components/CoopLootShare.jsx'
import QuickPrayerConfigModal from '../components/QuickPrayerConfigModal.jsx'
import { CombatFightHead, CombatHPBlock, CombatPrayerBlock } from '../components/CombatHud.jsx'
import { useGame } from '../state/gameState.jsx'
import { coopApi } from '../cloud/coop.js'
import { splatsFromCoopEvents, HIT_SPLAT_DURATION_MS } from '../utils/hitSplats.js'
import { xpDropsFromCombatEvents, emitXpDrops } from '../utils/xpDrops.js'
import { shapeLootForModal, lootRowsForModal } from '../utils/lootModal.js'
import { describeCoopActionRefusal, describeCoopEquipRefusal } from '../engine/coopBossEngine.js'
import { getMonsterArt, getStyleArt } from '../utils/combatArt.js'
import { hasEpicLootDrop } from '../utils/itemValue.js'
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
export default function CoopBossScreen({ sessionId, characterId, onExit, onDeath, addToast }) {
  const { stats, quickPrayers, updateQuickPrayers, activeCombatSpell, updateActiveCombatSpell } = useGame()
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [bossSplats, setBossSplats] = useState([])
  const [addSplats, setAddSplats] = useState([])
  const [playerSplats, setPlayerSplats] = useState([])
  const [showSpellModal, setShowSpellModal] = useState(false)
  const [showQuickPrayerConfig, setShowQuickPrayerConfig] = useState(false)
  const [lootModal, setLootModal] = useState(null)
  const pollTimer = useRef(null)
  const stoppedRef = useRef(false)
  const splatTimersRef = useRef(new Set())
  const leavingRef = useRef(false)
  // Last tick this client has rendered. The room replays everything after it,
  // so nothing is missed between polls — under the old transport a member only
  // saw the ticks their own request happened to advance, roughly one in eight.
  const sinceTickRef = useRef(null)

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

  // Dying in a group fight has to cost exactly what dying to the same boss
  // alone costs — one-life protection included. Without this the safest place
  // in the game to fight a boss was in a group.
  const deathReportedRef = useRef(false)
  useEffect(() => {
    if (me?.status !== 'dead' || deathReportedRef.current) return
    deathReportedRef.current = true
    onDeath?.()
  }, [me?.status, onDeath])

  const poll = useCallback(async () => {
    if (stoppedRef.current) return
    try {
      const res = await coopApi.tick(sessionId, sinceTickRef.current ?? undefined)
      if (stoppedRef.current) return
      if (res.state) setState(res.state)
      if (Number.isFinite(res.current_tick)) sinceTickRef.current = res.current_tick
      if (res.events?.length) {
        emitXpDrops(xpDropsFromCombatEvents(res.events, characterId))

        const tickSplats = splatsFromCoopEvents(res.events, characterId)
        pushSplats(setBossSplats, tickSplats.boss)
        pushSplats(setAddSplats, tickSplats.add)
        pushSplats(setPlayerSplats, tickSplats.player)
        // A refused equip is resolved a tick later on the server, so without
        // this the tap just looks ignored.
        for (const ev of res.events) {
          if (Number(ev.characterId) !== Number(characterId)) continue
          if (ev.type === 'equipRefused') addToast?.(describeCoopEquipRefusal(ev), 'error')
          else if (ev.type === 'actionRefused') addToast?.(describeCoopActionRefusal(ev), 'error')
          else if (ev.type === 'slayerCredit' && ev.completed) {
            addToast?.(`\u{1F480} Slayer Task #${ev.totalTasks} Completed - ${(ev.pointsEarned || 0).toLocaleString()} points.`, 'levelup')
          }
        }
        // Read names off the response, not the render closure — this callback
        // is captured once for the life of the session, so anything from render
        // is stale by the time a kill lands. The kill arrives as an event in
        // the replayed stream, so the winner sees their own loot modal whether
        // or not their poll was the one in flight when the boss died.
        for (const ev of res.events) {
          if (ev.type !== 'killSettled') continue
          const killedName = monstersData?.[res.state?.bossId]?.name || 'The boss'
          // Every member past the damage threshold is paid, so the event carries
          // a list. `settlements` is absent only while a client runs ahead of the
          // Worker; fall back to the single-winner fields it used to send.
          const settlements = ev.settlements
            ?? (ev.ownerCharacterId != null
              ? [{ characterId: ev.ownerCharacterId, granted: ev.granted, killCount: ev.killCount, diverged: ev.diverged }]
              : [])
          const mine = settlements.find((s) => Number(s.characterId) === Number(characterId))
          if (mine?.diverged) {
            // The server refused to grant because something else wrote this
            // save mid-fight. Showing the usual modal would read as a dry kill.
            addToast?.('Your loot could not be granted — something else changed your save. Leave and rejoin.', 'error')
          } else if (mine?.failed) {
            // The grant threw server-side. An empty loot modal here would read
            // as an unlucky kill and hide the outage completely.
            addToast?.(`${killedName} defeated, but the loot could not be granted. Leave and rejoin.`, 'error')
          } else if (mine) {
            setLootModal({ monsterName: killedName, loot: mine.granted || [], killCount: mine.killCount ?? null })
          } else {
            const paid = settlements.length
            addToast?.(
              `${killedName} defeated — you did not deal enough damage for a drop.`
              + (paid > 0 ? ` ${paid} ${paid === 1 ? 'player' : 'players'} looted it.` : ''),
              'info',
            )
          }
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
  // Releasing the session is CombatScreen's job (it owns the session id, so it
  // is also what releases it when the player navigates away instead) — this
  // just stops polling and hands over.
  const handleLeave = () => {
    if (leavingRef.current) return
    leavingRef.current = true
    stoppedRef.current = true
    if (pollTimer.current) clearTimeout(pollTimer.current)
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
  // The room's copy is authoritative for the length of the fight — it is what
  // gets written back — so the bar renders from it and falls back to the local
  // setting only until the first poll lands.
  const activeQuickPrayers = Array.isArray(me?.quickPrayers) ? me.quickPrayers : quickPrayers
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
          meta={<CoopLootShare member={me} maxHP={boss?.maxHP ?? 0} />}
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
          <div class="cb-respawn">
            <span class="cb-respawn__label">Next {bossName} in</span>
            <span class="cb-respawn__v">{Math.ceil(boss.respawnCountdown * 0.6)}s</span>
          </div>
        )}

        {me?.status === 'alive' && (
          <CombatQuickActions
            inventory={me.inventory}
            itemsData={itemsData}
            onEat={(entry) => send({ type: 'eat', inventorySlot: entry.slotIdx })}
            onPotion={(entry) => send({ type: 'drink_potion', inventorySlot: entry.slotIdx })}
            onEquip={(entry) => send({ type: 'equip', inventorySlot: entry.slotIdx })}
            isPotionActive={(item) => Object.keys(combatState?.activePotions || {}).some(pid => itemsData[pid]?.effect === item.effect)}
            quickPrayers={activeQuickPrayers}
            prayersData={prayersData}
            prayerLevel={getLevelFromXP(stats?.prayer?.xp || 0)}
            onPrayer={(prayerId) => send({ type: 'toggle_prayer', prayerId })}
            isPrayerActive={(prayerId) => combatState?.activeProtectionPrayer === prayerId || combatState?.activeCombatPrayer === prayerId}
            onEditPrayers={() => setShowQuickPrayerConfig(true)}
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

      {lootModal && (() => {
        const { hero, heroItem, rest, total } = shapeLootForModal(lootModal.loot, itemsData)
        return (
          <LootResultModal
            theme={hasEpicLootDrop(lootModal.loot, itemsData) ? 'purple' : 'gold'}
            kind="loot"
            eyebrow="Boss Defeated"
            title={lootModal.monsterName}
            sub={lootModal.killCount ? `Kill ${lootModal.killCount.toLocaleString()}` : undefined}
            heroItem={heroItem}
            heroName={hero ? (heroItem?.name || hero.itemId) : null}
            heroQuantity={hero ? hero.quantity : null}
            heroGp={hero ? hero.totalGp : 0}
            heroUnitGp={hero ? hero.unitGp : 0}
            loot={rest.length > 0 ? lootRowsForModal(rest, itemsData) : null}
            lootTitle="Loot Secured"
            lootTotal={total}
            primaryAction={{ label: 'Keep Fighting', onClick: () => setLootModal(null) }}
            onClose={() => setLootModal(null)}
          >
            {(lootModal.loot?.length ?? 0) === 0 && (
              <div class="text-center text-[12px] text-[var(--color-parchment)] opacity-70 py-4" style={{ position: 'relative', zIndex: 4 }}>
                No drops this time — the kill still counts.
              </div>
            )}
          </LootResultModal>
        )
      })()}

      {showQuickPrayerConfig && (
        <QuickPrayerConfigModal
          prayerLevel={getLevelFromXP(stats?.prayer?.xp || 0)}
          selected={activeQuickPrayers}
          onChange={(prayerIds) => {
            updateQuickPrayers(prayerIds)
            // The co-op lock refuses this character's own save while the room
            // owns it, so the local write alone is undone by the pull on exit.
            // The room carries the edit and writes it back with everything else.
            send({ type: 'set_quick_prayers', prayerIds })
          }}
          onClose={() => setShowQuickPrayerConfig(false)}
        />
      )}

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
