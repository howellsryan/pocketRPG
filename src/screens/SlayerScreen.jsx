import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import SkillEmblem from '../components/SkillEmblem.jsx'
import GameIcon from '../components/GameIcon.jsx'
import { MultiStyleChip } from './CombatMobileSheets.jsx'
import { getMonsterArt, getCategoryArt, getMonsterAttackStyles } from '../utils/combatArt.js'
import { getLevelFromXP } from '../engine/experience.js'
import monstersData from '../data/monsters.json'
import raidsData from '../data/raids.json'
import questsData from '../data/quests.json'
import { requestCriticalPushSave } from '../cloud/sync.js'
import { DAGANNOTH_KINGS_TASK_ID, SLAYER_TASK_SKIP_POINT_COST } from '../engine/slayerTasks.js'
import { SLAYER_MASTERS, RAID_TASK_META, resolveTaskMonsterIds, pickSlayerMonster, buildSlayerTask, meetsEntrySkillAndQuestGates } from '../engine/slayerMasters.js'
import { unmetKillCountRequirement } from '../engine/combatRequirements.js'
import { api, getToken, getCharacterId, CREDITS_UPDATED_EVENT } from '../cloud/api.js'
import { CRITICAL_SAVE_REASONS } from '../cloud/criticalSavePolicy.js'
import { SCREENS } from '../utils/constants.js'

// PocketRPG combat level formula
function getPlayerCombatLevel(stats) {
  const atk = getLevelFromXP(stats.attack?.xp || 0)
  const str = getLevelFromXP(stats.strength?.xp || 0)
  const def = getLevelFromXP(stats.defence?.xp || 0)
  const hp = getLevelFromXP(stats.hitpoints?.xp || 0)
  const prayer = getLevelFromXP(stats.prayer?.xp || 0)
  const ranged = getLevelFromXP(stats.ranged?.xp || 0)
  const magic = getLevelFromXP(stats.magic?.xp || 0)

  const base = Math.floor((def + hp + Math.floor(prayer / 2)) / 4)
  const melee = Math.floor((atk + str) * 13 / 40)
  const rangedCB = Math.floor(Math.floor(ranged * 3 / 2) * 13 / 40)
  const magicCB = Math.floor(Math.floor(magic * 3 / 2) * 13 / 40)
  return base + Math.max(melee, rangedCB, magicCB)
}

// Resolve a master's monster-pool entry into display info for the info sheet.
// Composite tasks (e.g. Nagadoth Kings) resolve to several monsters; we surface
// the highest combat level / slayer requirement among them and use the first
// resolved monster for art + attack-style derivation.
// `bossKillCounts` is null until the server's counts land. This path only
// DISPLAYS a lock, so it must not answer a question it cannot yet check: it
// judges the slayer/quest gates on their own and leaves the kill-count gate
// unstated until the fetch resolves. isEntryEligible's fail-closed default is
// for assignment, and would tell a player who has the kills that they do not.
function getTaskInfo(entry, slayerLevel, completedQuests, bossKillCounts) {
  const id = typeof entry === 'object' ? entry.id : entry
  const isBoss = typeof entry === 'object' && !!entry.boss
  const resolvedIds = resolveTaskMonsterIds(id)
  const resolved = resolvedIds.map(mid => monstersData[mid]).filter(Boolean)
  const lead = resolved[0] || null
  const raidMeta = RAID_TASK_META[id]
  const name = id === DAGANNOTH_KINGS_TASK_ID
    ? 'Nagadoth Kings'
    : raidMeta
      ? (raidsData[raidMeta.raidId]?.name || id.replace(/_/g, ' '))
      : (monstersData[id]?.name || id.replace(/_/g, ' '))
  const combatLevel = resolved.length ? Math.max(...resolved.map(m => m.combatLevel || 0)) : 0
  const slayerReq = resolved.length ? Math.max(...resolved.map(m => m.slayerRequirement || 0)) : 0
  const questReq = resolved.map(m => m.questRequirement).find(Boolean) || null
  const unmetKill = bossKillCounts
    ? (resolvedIds
      .map(mid => unmetKillCountRequirement({ ...monstersData[mid], id: mid }, bossKillCounts))
      .find(Boolean) || null)
    : null
  return {
    id, isBoss, name, combatLevel, slayerReq, questReq, unmetKill,
    monster: lead,
    art: getMonsterArt(lead || { id }),
    eligible: meetsEntrySkillAndQuestGates(entry, slayerLevel, completedQuests) && !unmetKill,
  }
}

// One task row in the slayer-master info sheet, styled like the combat
// bestiary's chamber rows. Eligible tasks are full-opacity; tasks gated by the
// player's Slayer level, an unfinished quest or an unearned kill-count
// prerequisite are dimmed and show what is missing.
function SlayerTaskRow({ entry, slayerLevel, completedQuests, bossKillCounts }) {
  const { name, combatLevel, slayerReq, questReq, unmetKill, monster, art, eligible } = getTaskInfo(entry, slayerLevel, completedQuests, bossKillCounts)
  const questName = questReq ? (questsData.find(q => q.id === questReq)?.name || questReq.replace(/_/g, ' ')) : null
  const killName = unmetKill
    ? `${monstersData[unmetKill.requiredId]?.name || unmetKill.requiredId.replace(/_/g, ' ')}${unmetKill.needed === 1 ? '' : ` ×${unmetKill.needed}`}`
    : null
  return (
    <div class={'cb-room' + (eligible ? ' is-clear' : '')}>
      <div class="cb-room__icon">
        <SkillEmblem iconKey={art.icon} accent={art.accent} size={32} glow={eligible ? 1 : 0.5} />
      </div>
      <div class="cb-room__body">
        <div class="cb-room__name">{name}</div>
        <div class="cb-room__boss">
          CB {combatLevel}{slayerReq > 0 ? ` · Slayer ${slayerReq}` : ''}{questName ? ` · ${questName}` : ''}{killName ? ` · Defeat ${killName}` : ''}
        </div>
      </div>
      <div class="cb-room__right">
        <MultiStyleChip chip={getMonsterAttackStyles(monster)} />
      </div>
    </div>
  )
}

// Slide-up bestiary sheet for a slayer master — every monster + boss it can
// assign, grouped into Monsters and Bosses, matching the combat info design.
function SlayerMasterInfoSheet({ master, slayerLevel, completedQuests, bossKillCounts, onClose }) {
  const art = getCategoryArt('slayer')
  const pool = master.monsterPool || []
  const keyOf = e => (typeof e === 'object' ? e.id : e)
  const monsters = pool.filter(e => !(typeof e === 'object' && e.boss))
  const bosses = pool.filter(e => typeof e === 'object' && !!e.boss)
  return (
    <div class="cb-overlay" onClick={onClose}>
      <div class="cb-sheet" onClick={e => e.stopPropagation()}>
        <div class="cb-sheet__grab" />
        <div class="cb-sheet__hero">
          <div class="cb-sheet__emblem">
            <div class="cb-sheet__glow" style={{ background: `radial-gradient(circle, ${art.accent}8c, transparent 64%)` }} />
            <SkillEmblem iconKey={art.icon} accent={art.accent} size={56} glow={1.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 class="cb-sheet__name">{master.name}</h2>
            <div class="cb-sheet__sub">{master.location}</div>
          </div>
          <button class="cb-x" onClick={onClose} aria-label="Close"><GameIcon iconKey="cancel" color="var(--text-soft)" size={16} /></button>
        </div>
        <div class="cb-sheet__scroll">
          <p class="cb-idledesc" style={{ margin: '0 2px 8px' }}>
            {master.description} Greyed-out tasks are still locked — each row names what it wants from you.
          </p>
          {monsters.length > 0 && (
            <>
              <div class="cb-sheet__sec">Monsters</div>
              <div class="cb-rooms">
                {monsters.map(e => <SlayerTaskRow key={keyOf(e)} entry={e} slayerLevel={slayerLevel} completedQuests={completedQuests} bossKillCounts={bossKillCounts} />)}
              </div>
            </>
          )}
          {bosses.length > 0 && (
            <>
              <div class="cb-sheet__sec">Bosses</div>
              <div class="cb-rooms">
                {bosses.map(e => <SlayerTaskRow key={keyOf(e)} entry={e} slayerLevel={slayerLevel} completedQuests={completedQuests} bossKillCounts={bossKillCounts} />)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// `initialMasterId` (from App via SkillingScreen): assign a task from that
// master on mount — set when the player picked the master from a place on the
// world map, or just arrived at one after a travel prompt (resumeAutoStart).
export default function SlayerScreen({ onBack, onNavigate, initialMasterId }) {
  const { stats, slayerTask, setSlayerTask, slayerPoints, updateSlayerPoints, addToast, getSnapshot, slayerTasksCompleted, slayerPerks, completedQuests, bossKillCounts, killCountsLoaded, requestActivityStart } = useGame()
  // Kill counts are server-owned and land a fetch after the rest of the state;
  // null until then, which makes isEntryEligible fail closed on the bosses gated
  // by them rather than assign a task nothing will start.
  const gateKillCounts = killCountsLoaded ? bossKillCounts : null

  const [infoMaster, setInfoMaster] = useState(null)

  const combatLevel = getPlayerCombatLevel(stats)
  const slayerLevel = getLevelFromXP(stats.slayer?.xp || 0)


  const handleGetTask = (master) => {
    if (slayerTask) {
      addToast('Complete your current task first!', 'error')
      return
    }
    if (combatLevel < master.combatReq) {
      addToast(`Need combat level ${master.combatReq} (you are ${combatLevel})`, 'error')
      return
    }
    if (slayerLevel < master.slayerReq) {
      addToast(`Need slayer level ${master.slayerReq} (you have ${slayerLevel})`, 'error')
      return
    }
    // Masters live at world places: getting a task is a place action. Away from
    // the master's settlement this opens the standard travel prompt; arrival
    // re-enters this screen with initialMasterId and assigns then.
    if (!requestActivityStart({ type: 'slayermaster', master: { id: master.id } })) return

    // Evenly distributed pick across the master's eligible monsters — gated by
    // both slayer level and any quest requirement so the player can always fight
    // what they're assigned.
    const pick = pickSlayerMonster(master, slayerLevel, { completedQuests, bossKillCounts: gateKillCounts })
    if (!pick) {
      addToast('No tasks available — raise your slayer level (or finish required quests) for this master.', 'error')
      return
    }

    assignTask(master, pick.monsterId, pick.isBoss)
  }

  // Auto-assign when routed here with a master (place action / travel arrival).
  const hasAutoAssigned = useRef(false)
  useEffect(() => {
    if (!initialMasterId || hasAutoAssigned.current) return
    hasAutoAssigned.current = true
    const master = SLAYER_MASTERS.find(m => m.id === initialMasterId)
    if (master) handleGetTask(master)
  }, [initialMasterId])

  const assignTask = (master, monsterId, isBoss) => {
    const quantityMultiplier = slayerPerks?.doubleQuantity ? 2 : 1
    const task = buildSlayerTask(master, monsterId, isBoss, { quantityMultiplier })
    setSlayerTask(task)
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
    addToast(`💀 Task: Kill ${task.totalCount} ${task.monsterName}`, 'info')
  }

  const handleCancelTask = () => {
    const skipCost = SLAYER_TASK_SKIP_POINT_COST
    if (slayerPoints < skipCost) {
      addToast(`Need ${skipCost} slayer points to skip a task.`, 'error')
      return
    }
    setSlayerTask(null)
    updateSlayerPoints(slayerPoints - skipCost)
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
    addToast(`Task skipped for ${skipCost} slayer points.`, 'info')
  }

  const handleSkipWithCredit = async () => {
    if (!getToken() || !getCharacterId()) {
      addToast('Credit skip requires a cloud account.', 'error')
      return
    }
    try {
      const res = await api.slayerSkip()
      const remaining = Number(res?.credits_remaining)
      if (Number.isFinite(remaining)) {
        window.dispatchEvent(new CustomEvent(CREDITS_UPDATED_EVENT, { detail: { credits_remaining: remaining } }))
      }
      setSlayerTask(null)
      requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
      addToast('Task skipped for 1 credit.', 'info')
    } catch (err) {
      if (err?.status === 402) addToast('Not enough credits to skip.', 'error')
      else addToast(err?.message || 'Failed to skip task.', 'error')
    }
  }

  const progressPct = slayerTask
    ? Math.round((1 - slayerTask.monstersRemaining / slayerTask.totalCount) * 100)
    : 0

  // Same resolution as getTaskInfo's `lead` monster: a composite task (e.g.
  // Nagadoth Kings) has no single monsters.json row, so its icon falls back to
  // the category default via getMonsterArt(null).
  const currentTaskMonster = slayerTask
    ? resolveTaskMonsterIds(slayerTask.monsterId).map(mid => monstersData[mid]).find(Boolean) || null
    : null
  const currentTaskArt = slayerTask ? getMonsterArt(currentTaskMonster) : null

  const handleSlayTask = () => {
    if (!slayerTask || !onNavigate) return
    const candidateIds = resolveTaskMonsterIds(slayerTask.monsterId)
    const targetId = candidateIds.find(id => monstersData[id]) || candidateIds[0]
    if (!targetId || !monstersData[targetId]) {
      addToast('Could not find target monster', 'error')
      return
    }
    // Raid-completion proxy tasks (RAID_TASK_META): the assigned "monster" is a
    // raid's final boss, never independently placed/fightable — the task can
    // only be worked by entering the full raid, same flow as a raid entrance
    // elsewhere on the world map (fakeTaskFor('raid', ...) in WorldMapScreen).
    const raidMeta = RAID_TASK_META[targetId]
    if (raidMeta) {
      if (requestActivityStart({ type: 'raid', raid: { id: raidMeta.raidId } })) {
        onNavigate(SCREENS.COMBAT, { raidId: raidMeta.raidId })
      }
      return
    }
    // Travel to the monster's place first when it lives elsewhere (standard
    // travel confirmation; combat auto-starts on arrival). Already there →
    // straight into combat.
    if (requestActivityStart({ type: 'combat', monster: { id: targetId } })) {
      onNavigate(SCREENS.COMBAT, { monsterId: targetId })
    }
  }

  return (
    <>
    <div class="forge-shell h-full overflow-y-auto p-4">
      <SkillScreenHeader
        skill="slayer"
        title="Slayer"
        xp={stats.slayer?.xp || 0}
        level={slayerLevel}
        onBack={onBack}
        right={(
          <div class="text-right flex-shrink-0">
            <div class="text-[13px] font-bold font-[var(--font-mono)] text-[var(--color-gold)]">{slayerPoints.toLocaleString()} pts</div>
            <div class="text-[11px] font-semibold text-[var(--color-parchment)] opacity-40">CB {combatLevel}</div>
          </div>
        )}
      />

      {/* Current task banner */}
      {slayerTask ? (
        <div class="mb-4 rounded-2xl p-3.5 bg-gradient-to-b from-[rgba(212,160,23,0.08)] to-[rgba(212,160,23,0.03)] border-[1.5px] border-[rgba(212,160,23,0.42)]">
          <div class="flex items-center justify-between mb-2.5">
            <div class="text-[9.5px] text-[var(--color-gold)] uppercase font-bold tracking-[0.14em]">⚔️ Current Task</div>
            {onNavigate && (
              <button
                onClick={handleSlayTask}
                class="fm-btn fm-btn--brass fm-btn--sm text-[11px] uppercase tracking-wider min-w-[64px]"
              >
                ⚔️ Slay
              </button>
            )}
          </div>
          <div class="flex items-center gap-3 mb-2.5">
            <div class="w-[46px] h-[46px] flex-shrink-0 rounded-xl flex items-center justify-center bg-[rgba(212,160,23,0.08)] border border-[rgba(212,160,23,0.22)]">
              <SkillEmblem iconKey={currentTaskArt.icon} accent={currentTaskArt.accent} size={32} glow={0.8} />
            </div>
            <div class="min-w-0">
              <div class="text-[16px] font-semibold text-[var(--color-parchment)]">{slayerTask.monsterName}</div>
              <div class="text-[12px] text-[var(--color-parchment)] opacity-45 mt-0.5">
                {slayerTask.monstersRemaining} / {slayerTask.totalCount} remaining
                {slayerTask.pointsOnComplete > 0 && ` · +${slayerTask.pointsOnComplete} pts on complete`}
              </div>
            </div>
          </div>
          <div class="h-2 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden mb-2">
            <div
              class="h-full rounded-full transition-all bg-gradient-to-r from-[var(--color-gold-dim)] to-[var(--color-gold-light)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold text-[var(--color-gold)]">{progressPct}% complete</span>
            <div class="flex items-center gap-3">
              <button onClick={handleCancelTask} class="text-[11px] text-[var(--color-parchment)] opacity-40 underline">
                Skip (-{SLAYER_TASK_SKIP_POINT_COST} pts)
              </button>
              <button onClick={handleSkipWithCredit} class="text-[11px] text-[var(--color-parchment)] opacity-40 underline">
                Skip (-1 credit)
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div class="mb-4 rounded-2xl p-3.5 text-center bg-[var(--color-void-light)] border border-[var(--color-void-border)]">
          <div class="text-[12px] text-[var(--color-parchment)] opacity-50">No active task — select a master below to get one.</div>
        </div>
      )}

      {/* Slayer masters — each lives at a world place; getting a task away from
          it opens the standard travel prompt */}
      <SectionHeader className="mb-2.5">Slayer Masters</SectionHeader>
      <div class="text-[11px] text-[var(--color-parchment)] opacity-50 mb-2.5">
        Masters assign tasks at their home settlement — visit them (or tap to travel there).
      </div>
      <div class="flex flex-col gap-2.5">
        {SLAYER_MASTERS.map(master => {
          const meetsReq = combatLevel >= master.combatReq && slayerLevel >= master.slayerReq
          return (
            <div key={master.id} class="flex gap-2 items-center">
              <div class="flex-1 min-w-0">
                <SkillActionRow
                  icon={<GameIcon iconKey={master.iconKey} color="var(--color-gold)" size={30} />}
                  title={master.name}
                  meta={<>📍 {master.location}</>}
                  chip={<>{master.pointsPerTask} pts</>}
                  disabled={!meetsReq || !!slayerTask}
                  onClick={() => handleGetTask(master)}
                />
              </div>
              <button
                onClick={() => setInfoMaster(master)}
                aria-label="Slayer master tasks info"
                class="flex-shrink-0 w-11 h-11 rounded-full border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-gold)] text-[15px] font-bold flex items-center justify-center active:opacity-70"
                title="View assignable tasks"
              >
                ⓘ
              </button>
            </div>
          )
        })}
      </div>

      {/* Slayer unlocks + perks (point-purchased) moved to the Character Unlocks screen. */}

    </div>

    {/* Master task info — slide-up bestiary sheet (matches combat info design) */}
    {infoMaster && (
      <SlayerMasterInfoSheet
        master={infoMaster}
        slayerLevel={slayerLevel}
        completedQuests={completedQuests}
        bossKillCounts={gateKillCounts}
        onClose={() => setInfoMaster(null)}
      />
    )}
    </>
  )
}
