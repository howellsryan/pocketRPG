import { useGame } from '../state/gameState.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import monstersData from '../data/monsters.json'
import itemsData from '../data/items.json'
import { SLAYER_UNLOCKS, getSlayerUnlockPurchaseState } from '../engine/slayerUnlocks.js'
import { requestCriticalPushSave } from '../cloud/sync.js'
import { DAGANNOTH_KINGS_TASK_ID } from '../engine/slayerTasks.js'
import { api, getToken, getCharacterId, CREDITS_UPDATED_EVENT } from '../cloud/api.js'
import { applyCloudSave } from '../cloud/sync.js'
import { CRITICAL_SAVE_REASONS } from '../cloud/criticalSavePolicy.js'
import { recordCollectionLogDrop } from '../cloud/collectionLog.js'
import { SCREENS } from '../utils/constants.js'

// PocketRPG slayer masters — requirements and monster pools from PocketRPG design references
const SLAYER_MASTERS = [
  {
    id: 'turael',
    name: 'Torvak',
    location: 'Brighthome',
    icon: '👴',
    combatReq: 0,
    slayerReq: 0,
    pointsPerTask: 0,
    description: 'Assigns the easiest slayer tasks. No requirements.',
    taskRange: [50, 120],
    monsterPool: [
      'field_chicken', 'cave_goblin', 'pasture_bull', 'arcane_adept',
      'stoneback_crab', 'duneback_crab', 'umbral_adept',
      'dustpaw_rat', 'bogling_sprite',
    ],
  },
  {
    id: 'mazchna',
    name: 'Morven',
    location: 'Duskmire',
    icon: '🧙',
    combatReq: 20,
    slayerReq: 0,
    pointsPerTask: 2,
    description: 'Assigns medium-low level monsters. Requires combat 20.',
    taskRange: [60, 130],
    monsterPool: [
      'umbral_adept', 'broodfang_spider', 'highland_giant', 'briar_giant', 'wailing_banshee',
      'frostbite_imp', 'marshfen_toad', 'cinderpaw_cub',
    ],
  },
  {
    id: 'vannaka',
    name: 'Valdrin',
    location: 'Deepgate Caverns',
    icon: '⚔️',
    combatReq: 40,
    slayerReq: 0,
    pointsPerTask: 4,
    description: 'Assigns mid-level combat tasks. Requires combat 40.',
    taskRange: [70, 160],
    monsterPool: [
      'briar_giant', 'green_dragon', 'lesser_fiend', 'sanguine_veld',
      'warped_spectre', 'ash_wyrm',
      'glaive_skeleton', 'mirebound_husk', 'verdant_stalker', 'stoneglare_basilisk',
      'embertongue_lizard', 'hollow_reaver',
    ],
  },
  {
    id: 'chaeldar',
    name: 'Caelira',
    location: 'Moonglade',
    icon: '🧝',
    combatReq: 70,
    slayerReq: 0,
    pointsPerTask: 10,
    description: 'High-level tasks including Netherfiend Demons. Requires combat 70.',
    taskRange: [80, 300],
    monsterPool: [
      'green_dragon', 'lesser_fiend', 'nether_demon', 'red_dragon',
      'sanguine_veld', 'nether_wraith', 'warped_spectre', 'astral_warrior',
      'astral_ranger', 'runestone_gargoyle', 'ash_wyrm',
      'briarheart_treant', 'frostmaw_direwolf', 'pyreclaw_demon',
      'wraithgale_specter', 'bloodmoon_stalker', 'ironfang_drake',
      'shadeglass_golem', 'tidereaper_crab',
    ],
  },
  {
    id: 'nieve',
    name: 'Nyra',
    location: 'Spryroot Grove',
    icon: '🌿',
    combatReq: 0,
    slayerReq: 70,
    pointsPerTask: 12,
    description: 'Elite tasks including God Wars Dungeon bosses. Requires slayer 70.',
    taskRange: [150, 400],
    bossTaskRange: [5, 25],
    monsterPool: [
      'nether_demon',
      { id: DAGANNOTH_KINGS_TASK_ID, boss: true },
      'red_dragon',
      'sanguine_veld', 'nether_wraith', 'bone_wyvern', 'cinder_devil',
      'astral_mage', 'runestone_gargoyle', 'vicious_black_dragon', 'nightfang_beast',
      { id: 'deepmaw_kraken', boss: true },
      { id: 'ember_tyrant', boss: true },
      'voidweave_stalker', 'drakthul_wyrmling', 'bonelight_pyromancer',
      'cinderfang_reaver', 'ashen_marauder',
      { id: 'sovrathar_the_ashen_sovereign', boss: true },
    ],
  },
  {
    id: 'duradel',
    name: 'Druven',
    location: 'Silverkeep Quarter',
    icon: '💀',
    combatReq: 0,
    slayerReq: 90,
    pointsPerTask: 15,
    description: 'The most prestigious master. Assigns the hardest tasks. Requires slayer 90.',
    taskRange: [100, 250],
    bossTaskRange: [20, 50],
    monsterPool: [
      'nether_demon',
      { id: DAGANNOTH_KINGS_TASK_ID, boss: true },
      { id: 'warlord_grondar', boss: true },
      { id: 'commander_zephyra', boss: true },
      { id: 'krylth_the_defiler', boss: true },
      { id: 'skyrender_kharra', boss: true },
      'sanguine_veld', 'nether_wraith', 'bone_wyvern', 'cinder_devil',
      'astral_mage', 'runestone_gargoyle', 'vicious_black_dragon', 'nightfang_beast',
      { id: 'deepmaw_kraken', boss: true },
      { id: 'ember_tyrant', boss: true },
      { id: 'threefang_cerberus', boss: true },
      { id: 'ashen_hydra', boss: true },
      'voidweave_stalker', 'drakthul_wyrmling', 'bonelight_pyromancer',
      'cinderfang_reaver', 'ashen_marauder',
      { id: 'sovrathar_the_ashen_sovereign', boss: true },
    ],
  },
]

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

function randRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
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
}

export default function SlayerScreen({ onBack, onNavigate }) {
  const { stats, slayerTask, setSlayerTask, slayerPoints, updateSlayerPoints, addToast, bank, inventory, addToBank, getSnapshot, slayerTasksCompleted, loadGame } = useGame()

  const combatLevel = getPlayerCombatLevel(stats)
  const slayerLevel = getLevelFromXP(stats.slayer?.xp || 0)


  const resolveTaskMonsterIds = (monsterId) => {
    if (monsterId === DAGANNOTH_KINGS_TASK_ID) return ['nagadoth_rex', 'nagadoth_prime', 'nagadoth_supreme']
    return [monsterId]
  }

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

    // Pick random monster from pool
    const pool = master.monsterPool
    const pick = pool[Math.floor(Math.random() * pool.length)]
    const isBoss = typeof pick === 'object' && pick.boss
    const monsterId = typeof pick === 'object' ? pick.id : pick

    // Check slayer requirement on the monster itself
    const candidateIds = resolveTaskMonsterIds(monsterId)
    const unmetRequirement = candidateIds
      .map(id => monstersData[id]?.slayerRequirement || 0)
      .find(req => req > slayerLevel)
    if (unmetRequirement) {
      // Re-roll once to avoid blocking the player
      const fallback = pool.find(p => {
        const id = typeof p === 'object' ? p.id : p
        const fallbackIds = resolveTaskMonsterIds(id)
        return fallbackIds.every(monsterKey => {
          const m = monstersData[monsterKey]
          return !m?.slayerRequirement || slayerLevel >= m.slayerRequirement
        })
      })
      if (!fallback) {
        addToast(`Need slayer level ${unmetRequirement} for this task`, 'error')
        return
      }
      const fbId = typeof fallback === 'object' ? fallback.id : fallback
      const fbBoss = typeof fallback === 'object' && fallback.boss
      assignTask(master, fbId, fbBoss)
      return
    }

    assignTask(master, monsterId, isBoss)
  }

  const assignTask = (master, monsterId, isBoss) => {
    const monsterData = monstersData[monsterId]
    const monsterName = monsterId === DAGANNOTH_KINGS_TASK_ID ? 'Nagadoth Kings' : (monsterData?.name || monsterId.replace(/_/g, ' '))

    // Ember Tyrant always has a single-kill task
    let totalCount
    if (monsterId === 'ember_tyrant') {
      totalCount = 1
    } else {
      const taskRange = isBoss ? (master.bossTaskRange || [20, 50]) : master.taskRange
      totalCount = randRange(taskRange[0], taskRange[1])
    }

    const task = {
      monsterId,
      monsterName,
      monstersRemaining: totalCount,
      totalCount,
      masterId: master.id,
      pointsOnComplete: master.pointsPerTask,
      isBoss,
    }

    setSlayerTask(task)
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
    addToast(`💀 Task: Kill ${totalCount} ${monsterName}`, 'info')
  }

  const handleCancelTask = () => {
    const skipCost = 30
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
        if (res?.save?.save_data) await applyCloudSave(JSON.parse(res.save.save_data), res.save.updatedAt)
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
      <h2 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] mb-0.5">
        💀 Slayer
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
                Skip (-30 points)
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
          const owned = ownsItem(unlock.itemId)
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
    </div>
  )
}
