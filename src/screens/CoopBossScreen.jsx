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
import CoopRaidLobby from '../components/CoopRaidLobby.jsx'
import CoopChatPanel from '../components/CoopChatPanel.jsx'
import QuickPrayerConfigModal from '../components/QuickPrayerConfigModal.jsx'
import { CombatFightHead, CombatHPBlock, CombatPrayerBlock } from '../components/CombatHud.jsx'
import { CombatMonsterInfoSheet } from './CombatMobileSheets.jsx'
import { useGame } from '../state/gameState.jsx'
import { openCoopFeed } from '../cloud/coopFeed.js'
import { splatsFromCoopEvents, HIT_SPLAT_DURATION_MS } from '../utils/hitSplats.js'
import { swingsFromCoopEvents, playerCombatSprite, monsterCombatSprite } from '../utils/actionSprites.js'
import { useActionSwings } from '../hooks/useActionSwings.js'
import InkwrightCombatStage from '../components/InkwrightCombatStage.jsx'
import { xpDropsFromCombatEvents, emitXpDrops } from '../utils/xpDrops.js'
import { shapeLootForModal, lootRowsForModal } from '../utils/lootModal.js'
import { emitKillReveal } from '../utils/rewardReveal.js'
import { coopIntentEcho, coopKillOutcome, coopLootBasisHP, describeCoopActionRefusal, describeCoopEquipRefusal, foughtThisKill, isRaidPayingBoss } from '../engine/coopBossEngine.js'
import { coopRaidSummary, raidProgress } from '../engine/coopRaidEngine.js'
import { appendChatLines, chatLinesFromCoopEvents } from '../utils/coopChat.js'
import { getMonsterArt, getStyleArt } from '../utils/combatArt.js'
import { HardModeTag } from '../components/HardMode.jsx'
import { hasEpicLootDrop } from '../utils/itemValue.js'
import { getLevelFromXP } from '../engine/experience.js'
import { canAffordSpecialAttack } from '../engine/specialAttackEnergy.js'
import { bossAddsOf } from '../engine/bossAdds.js'
import itemsData from '../data/items.json'
import prayersData from '../data/prayers.json'
import monstersData from '../data/monsters.json'

/**
 * Live view of a server-run co-op boss fight. Deliberately renders the same HUD
 * as the solo fight (CombatScreen's mobile layout, via components/CombatHud) —
 * the only difference a player should feel is that the swings come from the
 * server. The client renders only: every hit is resolved server-side and
 * arrives on the room's own beat, and actions are queued as intents.
 *
 * The transport is cloud/coopFeed.js — a WebSocket the room pushes to, falling
 * back to polling where a socket cannot be had. This screen sees beats either
 * way and must not care which.
 */
export default function CoopBossScreen({ sessionId, characterId, onExit, onRejoin, onDeath, addToast }) {
  const { stats, quickPrayers, updateQuickPrayers, activeCombatSpell, updateActiveCombatSpell, revertOneLifeMode, recordGameEvent, combatAnimations } = useGame()
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [bossSplats, setBossSplats] = useState([])
  const [addSplats, setAddSplats] = useState([])
  const [playerSplats, setPlayerSplats] = useState([])
  // Latest swing per side for the sprite stage — see CombatScreen, same shape.
  const { swings, pushSwings } = useActionSwings()
  const [showSpellModal, setShowSpellModal] = useState(false)
  const [showQuickPrayerConfig, setShowQuickPrayerConfig] = useState(false)
  const [showMonsterInfo, setShowMonsterInfo] = useState(false)
  const [lootModal, setLootModal] = useState(null)
  // Cleared by the poll that reports the raid running, so a double-tap on Start
  // cannot queue two starts (the second is refused server-side either way).
  const [startingRaid, setStartingRaid] = useState(false)
  const [chatLog, setChatLog] = useState([])
  // What this player's hard-mode death cost them, from the death event.
  const [itemsLost, setItemsLost] = useState([])
  // The room let this player go while they were away and the screen is waiting
  // to be put back in a fight. Distinct from the first-join spinner only in
  // what it says, because it is not the player's first arrival.
  const [rejoining, setRejoining] = useState(false)
  // What the last tap should have done, rendered over the room's record until
  // the beat it was stamped for comes back. `tick` is null until the intent is
  // acknowledged; `at` is the escape hatch for a request that never answers.
  const [echo, setEcho] = useState(null)
  // The same trick for the lobby's Ready button, which is a member field rather
  // than a combat one: a button that waits a beat and a round trip to light up
  // gets pressed twice.
  const [readyEcho, setReadyEcho] = useState(null)
  const chatIdRef = useRef(0)
  // The live connection to the room. It owns the tick it last saw, so nothing
  // is missed across a reconnect or a transport switch.
  const feedRef = useRef(null)
  const splatTimersRef = useRef(new Set())
  const leavingRef = useRef(false)

  const me = state?.members?.[String(characterId)] || null
  // The room's record with the last tap laid over it. Everything reads this, so
  // a queued prayer or spec looks the way the player left it rather than
  // flicking back for the beat it takes the room to agree.
  const combatState = { ...(me?.combat || {}), ...(echo?.patch || {}) }
  const boss = state?.boss || null
  const monster = monstersData?.[state?.bossId] || null
  const bossName = monster?.name || 'Boss'
  const memberCount = state ? Object.keys(state.members || {}).length : 0
  // A boss may field several at once. Only ONE HP bar is drawn — a stack of
  // four would push the fight itself off a phone screen — and it follows the one
  // this member is actually hitting.
  const addsOnField = bossAddsOf(boss).filter((add) => add && add.currentHP > 0)
  const onBoss = typeof combatState?.addTargetIndex !== 'number'
  const activeAdd = (!onBoss && bossAddsOf(boss)[combatState.addTargetIndex]) || addsOnField[0] || null
  const spriteAdd = (!onBoss && bossAddsOf(boss)[combatState.addTargetIndex]) || null
  // A raid party runs in this same screen: the lobby replaces the HUD until the
  // host sets off, and the fight after that is the co-op boss fight with a run
  // counter on it. Keeping both here is what makes the group raid feel like the
  // group boss it is built on.
  const raid = raidProgress(state, monstersData)
  const inLobby = state?.phase === 'lobby'


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

  const onBeat = useCallback(({ state: nextState, events }) => {
    const at = Date.now()
    if (nextState) {
      setState(nextState)
      if (nextState.phase !== 'lobby') setStartingRaid(false)
      // The room has now spoken for the beat the tap was stamped for, so its
      // answer replaces the echo — including a refusal, which un-does it.
      // Time is the backstop for an intent that was never acknowledged.
      const tick = Number(nextState.tick) || 0
      setEcho((prev) => {
        if (!prev) return prev
        if (prev.tick != null && tick >= prev.tick) return null
        return at - prev.at > 3000 ? null : prev
      })
      setReadyEcho((prev) => {
        if (!prev) return prev
        const mine = nextState.members?.[String(characterId)]
        return (!!mine?.ready === prev.value || at - prev.at > 3000) ? null : prev
      })
    }
    if (!events?.length) return

    emitXpDrops(xpDropsFromCombatEvents(events, characterId))

    const chat = chatLinesFromCoopEvents(events, chatIdRef.current)
    if (chat.lines.length > 0) {
      chatIdRef.current = chat.nextId
      setChatLog((prev) => appendChatLines(prev, chat.lines))
    }

    const tickSplats = splatsFromCoopEvents(events, characterId)
    pushSplats(setBossSplats, tickSplats.boss)
    pushSplats(setAddSplats, tickSplats.add)
    pushSplats(setPlayerSplats, tickSplats.player)

    // Only THIS member's swings move the stage: every member's events arrive on
    // the shared ring, and a full room would otherwise lunge eight times a tick.
    // The stage follows whichever enemy this member is hitting, exactly as the
    // solo screen does (§20) — so the swings it animates have to be routed the
    // same way, or a hit on a sentinel flashes the boss's emblem over an HP bar
    // that never moves. Read off THIS beat's state, not a ref written during
    // render: the beat callback runs before the render it causes, so a rendered
    // ref lags a beat and drops both swings on every target switch.
    const beatTarget = nextState?.members?.[String(characterId)]?.combat?.addTargetIndex
    pushSwings(swingsFromCoopEvents(events, characterId, { showingAdd: typeof beatTarget === 'number' }))
    // Run-shaped events: everybody in the party sees these, not just the
    // member they name.
    for (const ev of events) {
      if (ev.type === 'raidBossAdvance') addToast?.(`⚔️ ${ev.bossName} — boss ${ev.bossIndex + 1}/${ev.totalBosses}`, 'info')
      else if (ev.type === 'raidWiped') addToast?.('Your party was wiped out. Back to the lobby.', 'error')
      // A group kill feeds the same daily tasks a solo one does. The room has no
      // idea what today's tasks are — the idle client owns them — so it names
      // who fought the kill and each client credits its own. Gated on that list
      // so a member who sat the fight out in the lobby is not paid for it.
      else if (ev.type === 'bossDefeated' || ev.type === 'raidBossDefeated') {
        // A raid pays its boss kill on the final boss and nowhere else, which is
        // where solo fires its one (isRaidPayingBoss).
        if (ev.type === 'raidBossDefeated' && !isRaidPayingBoss(ev)) continue
        if (foughtThisKill(ev, characterId)) recordGameEvent?.({ kind: 'boss_kill', monsterId: ev.bossId })
      } else if (ev.type === 'raidComplete') {
        if (foughtThisKill(ev, characterId)) recordGameEvent?.({ kind: 'raid_complete', raidId: ev.raidId })
      }
    }
    for (const ev of events) {
      if (Number(ev.characterId) !== Number(characterId)) continue
      // A refused equip is resolved a tick later on the server, so without this
      // the tap just looks ignored.
      if (ev.type === 'equipRefused') addToast?.(describeCoopEquipRefusal(ev), 'error')
      else if (ev.type === 'actionRefused') addToast?.(describeCoopActionRefusal(ev), 'error')
      // The room already flipped the flag in D1; this mirrors it into the
      // local player state and toasts it in the same voice as an idle
      // death. The endpoint answers "not one-life" now, which the retry
      // helper reads as an already-committed revert.
      else if (ev.type === 'oneLifeEnded') {
        void revertOneLifeMode().then(({ ok, isIronman }) => {
          addToast?.(ok
            ? (isIronman ? 'One-life protection lost — you are now a standard Ironman.' : 'One-life protection lost — you are now a standard account.')
            : 'Connection issue confirming your account change — will retry on your next death.', 'error')
        })
      }
      // The tally of a hard-mode death rides the event and nothing else, so it
      // is kept here for the death modal below to report.
      else if (ev.type === 'memberDeath' && Array.isArray(ev.itemsLost) && ev.itemsLost.length > 0) {
        setItemsLost(ev.itemsLost)
      }
      else if (ev.type === 'slayerCredit' && ev.completed) {
        addToast?.(`\u{1F480} Slayer Task #${ev.totalTasks} Completed - ${(ev.pointsEarned || 0).toLocaleString()} points.`, 'levelup')
        recordGameEvent?.({ kind: 'slayer_task_complete' })
      }
    }
    // Read names off the beat, not the render closure — this callback is
    // captured once for the life of the session, so anything from render is
    // stale by the time a kill lands. The kill arrives as an event on the
    // room's own beat, so the winner sees their loot whether or not they were
    // looking at the moment the boss died.
    for (const ev of events) {
      if (ev.type !== 'killSettled') continue
      const raidCleared = events.find((e) => e.type === 'raidComplete')
      const killedName = raidCleared?.raidName || monstersData?.[nextState?.bossId]?.name || 'The boss'
      const outcome = coopKillOutcome(ev, characterId)
      if (outcome.kind === 'loot') {
        // Only a raid completion still earns the full-screen modal (CLAUDE.md
        // §6) — an ordinary boss kill announces itself as a reward-reveal card,
        // same as solo, so the group fight carries on instead of stopping dead
        // on a modal every kill.
        if (raidCleared) {
          setLootModal({ monsterName: killedName, loot: outcome.loot, killCount: outcome.killCount })
        } else {
          emitKillReveal(nextState?.bossId, killedName, outcome.loot)
        }
      } else if (outcome.kind === 'diverged') {
        // Never about the damage share — the player who found this had cleared
        // the threshold five times over. Their save was written from somewhere
        // else mid-fight, so the room's copy of it went stale and it can no
        // longer grant anything. The room lets them go on the next beat, which
        // the feed turns into a rejoin, so say that rather than "leave and
        // rejoin" at a player who did nothing wrong.
        addToast?.('Another tab or device changed your save, so this drop could not be granted. Putting you back in the fight…', 'error')
      } else if (outcome.kind === 'failed') {
        addToast?.(`${killedName} defeated, but the loot could not be granted. Leave and rejoin.`, 'error')
      } else {
        addToast?.(
          `${killedName} defeated — you did not deal enough damage for a drop.`
          + (outcome.winners > 0 ? ` ${outcome.winners} ${outcome.winners === 1 ? 'player' : 'players'} looted it.` : ''),
          'info',
        )
      }
    }
  }, [characterId, addToast, revertOneLifeMode])

  useEffect(() => {
    const feed = openCoopFeed({
      sessionId,
      onTick: onBeat,
      onStatus: setError,
      // Being let go while your screen was locked is not an error to read, it
      // is a fight to get back into. Falling back to the picker is the caller's
      // job if the rejoin itself fails.
      onLost: () => {
        setState(null)
        setError(null)
        setRejoining(true)
        onRejoin?.()
      },
      onFatal: setError,
    })
    feedRef.current = feed
    return () => {
      feedRef.current = null
      feed.close()
    }
    // Re-opening on a new `onBeat` identity would drop the socket every render;
    // the session is what actually scopes this connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const send = async (action) => {
    // Computed against the echoed view, not the room's: tapping the same prayer
    // twice before either beat lands has to read as on-then-off.
    const patch = coopIntentEcho(combatState, action, prayersData)
    const at = Date.now()
    if (patch) setEcho((prev) => ({ patch: { ...(prev?.patch || {}), ...patch }, tick: null, at }))
    try {
      const res = await feedRef.current?.send(action)
      // The tick the room stamped it for — the beat whose state supersedes this.
      if (patch) {
        setEcho((prev) => (prev && prev.at === at ? { ...prev, tick: Number(res?.tick_number) || null } : prev))
      }
    } catch (err) {
      // A refused action un-does its echo now, rather than leaving the button
      // showing something that did not happen until the poll's backstop.
      if (patch) setEcho((prev) => (prev && prev.at === at ? null : prev))
      if (action?.type === 'set_ready') setReadyEcho(null)
      addToast?.(err.message || 'Action failed', 'error')
    }
  }

  const sendChat = async (text) => {
    try {
      await feedRef.current?.send({ type: 'chat', text })
    } catch (err) {
      addToast?.(err.status === 429 ? 'Slow down — too many messages.' : (err.message || 'Message not sent'), 'error')
    }
  }

  // Leaving the fight is the back arrow, exactly as it is in a solo fight.
  // Releasing the session is CombatScreen's job (it owns the session id, so it
  // is also what releases it when the player navigates away instead) — this
  // just drops the connection and hands over. Closing the socket is itself the
  // fastest signal the room gets that this player has gone.
  const handleLeave = () => {
    if (leavingRef.current) return
    leavingRef.current = true
    feedRef.current?.close()
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
            <div class="text-sm text-[var(--color-parchment)] opacity-70">
              {rejoining ? 'You were away — getting you back in…' : 'Joining the fight…'}
            </div>
          </>
        )}
      </div>
    )
  }

  // Built before the lobby branch below and rendered by BOTH: clearing a raid
  // settles the loot and puts the party back in its lobby on the same tick, so
  // a modal rendered only by the fight view is set and never seen. Raid-only
  // now — an ordinary boss kill announces via emitKillReveal instead (above).
  const lootModalNode = lootModal ? (() => {
    const { hero, heroItem, rest, total } = shapeLootForModal(lootModal.loot, itemsData)
    return (
      <LootResultModal
        theme={hasEpicLootDrop(lootModal.loot, itemsData) ? 'purple' : 'gold'}
        kind="loot"
        eyebrow="Raid Complete"
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
        primaryAction={{ label: 'Back to Lobby', onClick: () => setLootModal(null) }}
        onClose={() => setLootModal(null)}
      >
        {(lootModal.loot?.length ?? 0) === 0 && (
          <div class="text-center text-[12px] text-[var(--color-parchment)] opacity-70 py-4" style={{ position: 'relative', zIndex: 4 }}>
            No drops this time — the kill still counts.
          </div>
        )}
      </LootResultModal>
    )
  })() : null

  // Built before the lobby branch and rendered by BOTH, for the same reason the
  // loot modal above is: a wipe returns the party to its lobby on the very tick
  // the last member died, so a death rendered only by the fight view is the one
  // death nobody is ever told about.
  const deathModalNode = me?.status === 'dead' ? (
    <LootResultModal
      theme="blood"
      kind="progress"
      icon="💀"
      eyebrow={`Slain by ${bossName}`}
      title="Defeated"
      // The room already emptied the pack (the member record is the
      // authority until the write-back), so this only reports it. Derived
      // from the death EVENT because only that carries the tally — a
      // reload falls back to the plain modal rather than an empty list.
      sub={state?.hardMode
        ? (itemsLost.length > 0
          ? 'Hard Mode — everything tradeable you carried and wore is gone. Untradeables stayed with you. Reclaim it from Grim Reaper in Settings.'
          : 'Hard Mode — everything tradeable you carried and wore is gone. Untradeables stayed with you.')
        : undefined}
      loot={itemsLost.length > 0 ? lootRowsForModal(shapeLootForModal(itemsLost, itemsData).valued, itemsData) : undefined}
      lootTitle={itemsLost.length > 0 ? 'Lost Forever' : undefined}
      lootSigned="-"
      primaryAction={{ label: 'Continue', onClick: handleLeave }}
      onClose={handleLeave}
    />
  ) : null

  if (inLobby && raid) {
    const summary = coopRaidSummary(raid.raidId, monstersData)
    return (
      <div class="forge-shell h-full flex flex-col p-4">
        <BackLink onClick={handleLeave} className="mb-3" />
        <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar">
          <CoopRaidLobby
            state={state}
            characterId={characterId}
            itemsData={itemsData}
            raidName={summary?.name || raid.name}
            bossNames={summary?.bossNames || []}
            starting={startingRaid}
            onLeave={handleLeave}
            ready={readyEcho ? readyEcho.value : !!me?.ready}
            onReady={(value) => {
              setReadyEcho({ value, at: Date.now() })
              send({ type: 'set_ready', value })
            }}
            onStart={() => {
              setStartingRaid(true)
              send({ type: 'start_raid' })
            }}
          />
          {error && <div class="text-[11px] text-[var(--color-blood-light)] text-center">{error}</div>}
        </div>
        {/* The party waits here, so this is exactly where it needs to talk —
            same band as the fight, so nothing moves when the run starts. */}
        <CoopChatPanel messages={chatLog} onSend={sendChat} />
        {lootModalNode}
        {deathModalNode}
      </div>
    )
  }

  const mArt = getMonsterArt(monster || { id: state.bossId, name: bossName })
  const form = monster?.multiForm && boss?.monster?.currentForm && monster.forms?.[boss.monster.currentForm]
    ? monster.forms[boss.monster.currentForm]
    : null
  // The info sheet's live view of the boss: the authored record overlaid with
  // the room's mutable fields (MUTABLE_MONSTER_FIELDS in coopBossEngine.js —
  // currentForm, stats, defenceBonus, defenceBonusDrain, baseDefenceLevel and
  // the rest), so a Dragon Warhammer smash or a Grondar Godsword warstrike
  // landed by ANY member shows up here exactly as it does in solo, not just on
  // the shared HP bar.
  const liveMonster = monster
    ? { ...monster, ...(boss?.monster || {}), currentHP: boss?.currentHP ?? 0, hitpoints: boss?.maxHP ?? monster.hitpoints }
    : null
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
  const coopPlayerSprite = playerCombatSprite(me?.equipment, itemsData, { combatType: combatState?.combatType, stance: combatState?.stance })
  const coopStageTarget = spriteAdd || liveMonster
  const coopStageArt = spriteAdd ? getMonsterArt(spriteAdd) : mArt
  const coopMonsterSprite = monsterCombatSprite(coopStageTarget)
  // Same add-vs-boss split as the splat streams above: whichever the stage is
  // actually showing is what its mini HP bar and on-body splats must track.
  const coopStageSplats = spriteAdd ? addSplats : bossSplats

  return (
    <div class="forge-shell h-full flex flex-col p-4">
      <BackLink onClick={handleLeave} className="mb-3" />

      <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar">
        <CombatFightHead
          icon={mArt.icon}
          accent={mArt.accent}
          name={bossName}
          nameColor={getStyleArt(form ? form.attackStyle : monster?.attackStyle).color}
          sub={raid
            ? `Boss ${raid.position}/${raid.total} \u00B7 ${memberCount} ${memberCount === 1 ? 'raider' : 'raiders'}`
            : `${memberCount} ${memberCount === 1 ? 'player' : 'players'} in this fight`}
          meta={<CoopLootShare member={me} maxHP={coopLootBasisHP(state)} />}
          combatLevel={monster?.combatLevel}
          aside={state?.hardMode ? <HardModeTag /> : null}
          onInfo={() => setShowMonsterInfo(true)}
        />

        {/* §20: the group fight looks like the solo fight, so the stage sits in
            the same place with the same timing law — read off THIS member's
            weapon and the boss's current form. The classic screen turns it off
            here for the same reason it does solo. */}
        {combatAnimations && <InkwrightCombatStage
          actor={{ ...coopPlayerSprite, accent: getStyleArt(coopPlayerSprite.motion).color }}
          target={{
            icon: coopStageArt.icon,
            accent: coopStageArt.accent,
            sprite: coopMonsterSprite,
            dying: (coopStageTarget?.currentHP ?? 1) <= 0,
          }}
          actorSwing={swings.player}
          targetSwing={swings.monster}
          actorHp={{ current: me?.hp ?? 0, max: me?.maxHP ?? 1 }}
          targetHp={{ current: coopStageTarget?.currentHP ?? 0, max: coopStageTarget?.hitpoints ?? 1 }}
          actorSplats={playerSplats}
          targetSplats={coopStageSplats}
          showCorners
          actorPrayer={typeof combatState?.maxPrayerPoints === 'number' ? { current: combatState.prayerPoints, max: combatState.maxPrayerPoints } : null}
          label={`You versus ${coopStageTarget?.name || bossName}`}
        />}

        {combatAnimations ? (
          <div class="mb-2 flex justify-end">
            <ActivePotionBadges activePotions={combatState?.activePotions} itemsData={itemsData} />
          </div>
        ) : (
          <>
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
          </>
        )}

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
              <button class={'cb-slot' + (onBoss ? ' is-active' : '')} onClick={() => send({ type: 'target_add', value: false })}>
                <span class="cb-slot__name">{bossName}</span>
                <span class="cb-slot__tag">{onBoss ? 'Attacking' : 'Attack'}</span>
                {onBoss && <span class="cb-slot__ring" />}
              </button>
              {bossAddsOf(boss).map((add, index) => {
                if (!add || add.currentHP <= 0) return null
                const on = !onBoss && index === combatState.addTargetIndex
                return (
                  <button key={add.instanceId} class={'cb-slot' + (on ? ' is-active' : '')} onClick={() => send({ type: 'target_add', value: index })}>
                    <span class="cb-slot__name">{add.name}</span>
                    <span class="cb-slot__tag">{on ? 'Attacking' : `${Math.max(0, Math.round(add.currentHP))} HP`}</span>
                    {on && <span class="cb-slot__ring" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Prayer pool reads from the stage's top-left corner
            (showCorners/actorPrayer above) unless the stage is off. */}
        {!combatAnimations && typeof combatState?.maxPrayerPoints === 'number' && (
          <CombatPrayerBlock current={combatState.prayerPoints} max={combatState.maxPrayerPoints} />
        )}

        {boss?.respawnCountdown > 0 && (
          <div class="cb-respawn">
            <span class="cb-respawn__label">
              {raid ? `${raid.nextBossName || 'Next boss'} arrives in` : `Next ${bossName} in`}
            </span>
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

      {/* Outside the scroller: chat is the one thing that must not scroll away
          mid-fight, and shut it costs a single row. */}
      <CoopChatPanel messages={chatLog} onSend={sendChat} />

      {lootModalNode}

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
              <GameIcon iconKey="cancel" color="var(--text-soft)" size={16} />
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
      {deathModalNode}

      {showMonsterInfo && liveMonster && (
        <CombatMonsterInfoSheet
          monster={liveMonster}
          itemsData={itemsData}
          onClose={() => setShowMonsterInfo(false)}
        />
      )}
    </div>
  )
}
