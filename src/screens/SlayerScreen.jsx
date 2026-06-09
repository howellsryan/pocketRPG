import { useGame } from '../state/gameState.jsx'
import SkillIcon from '../components/SkillIcon.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import monstersData from '../data/monsters.json'
import itemsData from '../data/items.json'
import { SLAYER_UNLOCKS, getSlayerUnlockPurchaseState, ownsItem } from '../engine/slayerUnlocks.js'
import { requestCriticalPushSave } from '../cloud/sync.js'
import { DAGANNOTH_KINGS_TASK_ID, SLAYER_TASK_SKIP_POINT_COST } from '../engine/slayerTasks.js'
import { SLAYER_MASTERS, resolveTaskMonsterIds, pickSlayerMonster, buildSlayerTask } from '../engine/slayerMasters.js'
import { api, getToken, getCharacterId, CREDITS_UPDATED_EVENT } from '../cloud/api.js'
import { applyCloudSave } from '../cloud/sync.js'
import { CRITICAL_SAVE_REASONS } from '../cloud/criticalSavePolicy.js'
import { recordCollectionLogDrop } from '../cloud/collectionLog.js'
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

const SLAYER_MONSTER_ICONS = {
  field_chicken: '🐔', cave_goblin: '👺', pasture_bull: '🐄', arcane_adept: '🧙',
  stoneback_crab: '🦀', duneback_crab: '🦀', umbral_adept: '🧙‍♂️',
  broodfang_spider: '🕷️', highland_giant: '👊', briar_giant: '🌿',
  green_dragon: '🐉', red_dragon: '🐉', lesser_fiend: '👿', nether_demon: '😈',
  warlord_grondar: '👹', commander_zephyra: '🌟', krylth_the_defiler: '🔥', skyrender_kharra: '🦅',
  [DAGANNOTH_KINGS_TASK_ID]: '👑',
  nagadoth_rex: '🦖', nagadoth_prime: '👹', nagadoth_supreme: '🏹', ember_tyrant: '🔥',
  sanguine_veld: '🩸', nether_wraith: '👻', bone_wyvern: '🐲', cinder_devil: '💨',
  deepmaw_kraken: '🦑', wailing_banshee: '👻', warped_spectre: '👁️', ash_wyrm: '🐍',
  astral_warrior: '⚔️', astral_ranger: '🏹', astral_mage: '🔮', runestone_gargoyle: '🗿',
  vicious_black_dragon: '🐉', nightfang_beast: '🦇', threefang_cerberus: '🐺', ashen_hydra: '🐲',
  dustpaw_rat: '🐀', bogling_sprite: '✨', frostbite_imp: '❄️', marshfen_toad: '🐸',
  cinderpaw_cub: '🐅', glaive_skeleton: '💀', mirebound_husk: '🪦', verdant_stalker: '🏹',
  stoneglare_basilisk: '🦎', embertongue_lizard: '🦎', hollow_reaver: '⚰️',
  briarheart_treant: '🌳', frostmaw_direwolf: '🐺', pyreclaw_demon: '👹',
  wraithgale_specter: '👻', bloodmoon_stalker: '🌙', ironfang_drake: '🐲',
  shadeglass_golem: '🗿', tidereaper_crab: '🦀',
  voidweave_stalker: '🕸️', drakthul_wyrmling: '🐉', bonelight_pyromancer: '🔥',
  cinderfang_reaver: '🗡️', ashen_marauder: '⚒️',
  sovrathar_the_ashen_sovereign: '👑',
  marshscale_shaman: '🦎', crazy_archaeologist: '🏺', adamant_dragon: '🐲', rune_dragon: '🐲',
}

export default function SlayerScreen({ onBack, onNavigate }) {
  const { stats, slayerTask, setSlayerTask, slayerPoints, updateSlayerPoints, addToast, bank, inventory, addToBank, getSnapshot, slayerTasksCompleted, loadGame, slayerPerks, updateSlayerPerk } = useGame()

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

    // Evenly distributed pick across the master's eligible monsters.
    const pick = pickSlayerMonster(master, slayerLevel)
    if (!pick) {
      addToast('No tasks available — raise your slayer level for this master.', 'error')
      return
    }

    assignTask(master, pick.monsterId, pick.isBoss)
  }

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

  const handleUnlock = async (unlock) => {
    const item = itemsData[unlock.itemId]
    const purchaseState = getSlayerUnlockPurchaseState({ unlock, item, slayerPoints, bank, inventory })
    if (!purchaseState.allowed) {
      addToast(purchaseState.message || 'Unable to purchase unlock', 'error')
      return
    }
    if (getToken() && getCharacterId()) {
      try {
        const res = await api.completeSlayer('slayer', { actionNonce: `slayer:${unlock.itemId}:${Date.now()}`, rewards: [{ itemId: unlock.itemId, quantity: 1 }], slayerPoints: -unlock.cost })
        if (res?.save?.save_data) await applyCloudSave(JSON.parse(res.save.save_data), res.save.updatedAt, res.save.save_revision)
        await loadGame()
        addToast(`🎉 Purchased ${item.name} — sent to bank`, 'info')
        return
      } catch (e) {
        addToast(`Unlock claim failed: ${e?.message || 'server_error'}`, 'error')
        return
      }
    }
    updateSlayerPoints(slayerPoints - unlock.cost)
    addToBank(unlock.itemId, 1)
    recordCollectionLogDrop({ itemId: unlock.itemId, sourceType: 'skilling', sourceId: 'slayer' })
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.PURCHASE)
    addToast(`🎉 Purchased ${item.name} — sent to bank`, 'info')
  }

  const progressPct = slayerTask
    ? Math.round((1 - slayerTask.monstersRemaining / slayerTask.totalCount) * 100)
    : 0

  const handleSlayTask = () => {
    if (!slayerTask || !onNavigate) return
    const candidateIds = resolveTaskMonsterIds(slayerTask.monsterId)
    const targetId = candidateIds.find(id => monstersData[id]) || candidateIds[0]
    if (!targetId || !monstersData[targetId]) {
      addToast('Could not find target monster', 'error')
      return
    }
    onNavigate(SCREENS.COMBAT, { monsterId: targetId })
  }

  return (
    <div class="h-full overflow-y-auto p-4">
      {/* Back button */}
      <button onClick={onBack}
        class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1">
        ← Skills
      </button>

      {/* Header */}
      <h2 class="flex items-center gap-2 font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] mb-0.5">
        <SkillIcon skill="slayer" size={18} /> Slayer
      </h2>
      <p class="text-xs text-[var(--color-parchment)] opacity-40 mb-3">
        Level {slayerLevel} · Combat {combatLevel} · {slayerPoints.toLocaleString()} points · {slayerTasksCompleted.toLocaleString()} tasks completed
      </p>

      {/* Current task banner */}
      {slayerTask ? (
        <div class="mb-4 bg-[#1a1a08] border border-[#3a3a10] rounded-xl p-3">
          <div class="flex items-center justify-between mb-2">
            <div class="text-[10px] text-yellow-400 uppercase font-bold tracking-wider">⚔️ Current Task</div>
            {onNavigate && (
              <button
                onClick={handleSlayTask}
                class="px-3 py-1.5 rounded-lg bg-yellow-600 text-black text-[11px] font-bold uppercase tracking-wider active:bg-yellow-700 min-h-[36px] min-w-[64px]"
              >
                ⚔️ Slay
              </button>
            )}
          </div>
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xl">{SLAYER_MONSTER_ICONS[slayerTask.monsterId] || '👹'}</span>
            <div>
              <div class="text-sm font-bold text-[var(--color-parchment)]">{slayerTask.monsterName}</div>
              <div class="text-[10px] text-[var(--color-parchment)] opacity-50">
                {slayerTask.monstersRemaining} / {slayerTask.totalCount} remaining
                {slayerTask.pointsOnComplete > 0 && ` · +${slayerTask.pointsOnComplete} pts on complete`}
              </div>
            </div>
          </div>
          {/* Progress bar */}
          <div class="h-2 rounded-full bg-[#333] overflow-hidden mb-2">
            <div
              class="h-full rounded-full transition-all"
              style={{ width: `${progressPct}%`, background: '#eab308' }}
            />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-yellow-400">{progressPct}% complete</span>
            <div class="flex items-center gap-3">
              <button
                onClick={handleCancelTask}
                class="text-[10px] text-[var(--color-parchment)] opacity-40 underline"
              >
                Skip (-{SLAYER_TASK_SKIP_POINT_COST} points)
              </button>
              <button
                onClick={handleSkipWithCredit}
                class="text-[10px] text-[var(--color-parchment)] opacity-40 underline"
              >
                Skip (-1 credit)
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div class="mb-3 bg-[#111] rounded-xl p-3 text-center">
          <div class="text-[11px] text-[var(--color-parchment)] opacity-50">No active task — select a master below to get one.</div>
        </div>
      )}

      {/* Slayer masters */}
      <div class="text-[10px] text-[var(--color-parchment)] opacity-50 uppercase font-bold tracking-wider mb-2">
        Slayer Masters
      </div>
      <div class="space-y-2">
        {SLAYER_MASTERS.map(master => {
          const meetsCombat = combatLevel >= master.combatReq
          const meetsSlayer = slayerLevel >= master.slayerReq
          const meetsReq = meetsCombat && meetsSlayer
          return (
            <button
              key={master.id}
              onClick={() => meetsReq && handleGetTask(master)}
              disabled={!meetsReq || !!slayerTask}
              class={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors text-left
                ${meetsReq && !slayerTask
                  ? 'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'
                  : 'bg-[#111] border-[#1a1a1a] opacity-40'}`}
            >
              <div class="flex items-center gap-3 min-w-0">
                <span class="text-2xl flex-shrink-0">{master.icon}</span>
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-[var(--color-parchment)]">{master.name}</div>
                  <div class="text-[10px] text-[var(--color-parchment)] opacity-50">{master.location}</div>
                  <div class="text-[9px] text-[var(--color-parchment)] opacity-35 mt-0.5 leading-tight">{master.description}</div>
                </div>
              </div>
              <div class="text-right flex-shrink-0 ml-3 space-y-0.5">
                <div class="text-[10px] font-[var(--font-mono)] text-[var(--color-gold)]">
                  {master.pointsPerTask} pts
                </div>
                {master.combatReq > 0 && (
                  <div class={`text-[9px] font-semibold ${meetsCombat ? 'text-[var(--color-hp-green)]' : 'text-[var(--color-blood-light)]'}`}>
                    CB {master.combatReq}
                  </div>
                )}
                {master.slayerReq > 0 && (
                  <div class={`text-[9px] font-semibold ${meetsSlayer ? 'text-[var(--color-hp-green)]' : 'text-[var(--color-blood-light)]'}`}>
                    Slay {master.slayerReq}
                  </div>
                )}
                {master.combatReq === 0 && (
                  <div class="text-[9px] text-[var(--color-hp-green)]">No req</div>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Unlocks — purchasable with slayer points */}
      <div class="mt-5 mb-2 text-[10px] text-[var(--color-parchment)] opacity-50 uppercase font-bold tracking-wider">
        Unlocks
      </div>
      <div class="space-y-2">
        {SLAYER_UNLOCKS.map(unlock => {
          const item = itemsData[unlock.itemId]
          if (!item) return null
          const owned = ownsItem({ itemId: unlock.itemId, bank, inventory })
          const canAfford = slayerPoints >= unlock.cost
          const disabled = owned || !canAfford
          return (
            <button
              key={unlock.itemId}
              onClick={() => !disabled && handleUnlock(unlock)}
              disabled={disabled}
              class={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors text-left
                ${!disabled
                  ? 'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'
                  : 'bg-[#111] border-[#1a1a1a] opacity-50'}`}
            >
              <div class="flex items-center gap-3 min-w-0">
                <span class="text-2xl flex-shrink-0">{item.icon || '🎁'}</span>
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-[var(--color-parchment)]">{item.name}</div>
                  <div class="text-[9px] text-[var(--color-parchment)] opacity-50 mt-0.5 leading-tight">
                    {unlock.description}
                  </div>
                  {item.requirements?.slayer > 0 && (
                    <div class="text-[9px] text-[var(--color-parchment)] opacity-40 mt-0.5">
                      Requires Slayer {item.requirements.slayer} to wear
                    </div>
                  )}
                </div>
              </div>
              <div class="text-right flex-shrink-0 ml-3 space-y-0.5">
                {owned ? (
                  <div class="text-[10px] font-bold text-[var(--color-hp-green)]">Owned</div>
                ) : (
                  <>
                    <div class={`text-[11px] font-[var(--font-mono)] font-bold ${canAfford ? 'text-[var(--color-gold)]' : 'text-[var(--color-blood-light)]'}`}>
                      {unlock.cost.toLocaleString()} pts
                    </div>
                    <div class="text-[9px] text-[var(--color-parchment)] opacity-40">
                      {canAfford ? 'Buy' : 'Locked'}
                    </div>
                  </>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Perks — point-purchased, non-item bonuses */}
      <div class="mt-5 mb-2 text-[10px] text-[var(--color-parchment)] opacity-50 uppercase font-bold tracking-wider">
        Perks
      </div>
      <div class="space-y-2">
        {(() => {
          const perkOwned = slayerPerks?.doubleQuantity === true
          const cost = 250
          const canAfford = slayerPoints >= cost
          const disabled = perkOwned || !canAfford
          return (
            <button
              onClick={() => {
                if (disabled) return
                updateSlayerPoints(slayerPoints - cost)
                updateSlayerPerk('doubleQuantity', true)
                requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
                addToast('🗡️ Slayer Multitask unlocked!', 'info')
              }}
              disabled={disabled}
              class={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors text-left
                ${!disabled
                  ? 'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'
                  : 'bg-[#111] border-[#1a1a1a] opacity-50'}`}
            >
              <div class="flex items-center gap-3 min-w-0">
                <span class="text-2xl flex-shrink-0">🗡️</span>
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-[var(--color-parchment)]">Slayer Multitask</div>
                  <div class="text-[9px] text-[var(--color-parchment)] opacity-50 mt-0.5 leading-tight">
                    Doubles the number of monsters assigned by your Slayer Master.
                  </div>
                </div>
              </div>
              <div class="text-right flex-shrink-0 ml-3 space-y-0.5">
                {perkOwned ? (
                  <div class="text-[10px] font-bold text-[var(--color-hp-green)]">Active</div>
                ) : (
                  <>
                    <div class={`text-[11px] font-[var(--font-mono)] font-bold ${canAfford ? 'text-[var(--color-gold)]' : 'text-[var(--color-blood-light)]'}`}>
                      {cost.toLocaleString()} pts
                    </div>
                    <div class="text-[9px] text-[var(--color-parchment)] opacity-40">
                      {canAfford ? 'Buy' : 'Locked'}
                    </div>
                  </>
                )}
              </div>
            </button>
          )
        })()}
      </div>
    </div>
  )
}
