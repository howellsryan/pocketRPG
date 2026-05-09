import { useGame } from '../state/gameState.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import monstersData from '../data/monsters.json'
import itemsData from '../data/items.json'
import { SLAYER_UNLOCKS, getSlayerUnlockPurchaseState } from '../engine/slayerUnlocks.js'
import { requestCriticalPushSave } from '../cloud/sync.js'
import { DAGANNOTH_KINGS_TASK_ID } from '../engine/slayerTasks.js'
import { CRITICAL_SAVE_REASONS } from '../cloud/criticalSavePolicy.js'
import { recordCollectionLogDrop } from '../cloud/collectionLog.js'

// OSRS slayer masters — requirements and monster pools from OSRS Wiki
const SLAYER_MASTERS = [
  {
    id: 'turael',
    name: 'Turael',
    location: 'Burthorpe',
    icon: '👴',
    combatReq: 0,
    slayerReq: 0,
    pointsPerTask: 0,
    description: 'Assigns the easiest slayer tasks. No requirements.',
    taskRange: [50, 120],
    monsterPool: [
      'chicken', 'goblin', 'cow', 'wizard', 'rock_crab', 'sand_crab', 'dark_wizard',
    ],
  },
  {
    id: 'mazchna',
    name: 'Mazchna',
    location: 'Canifis',
    icon: '🧙',
    combatReq: 20,
    slayerReq: 0,
    pointsPerTask: 2,
    description: 'Assigns medium-low level monsters. Requires combat 20.',
    taskRange: [60, 130],
    monsterPool: [
      'dark_wizard', 'giant_spider', 'hill_giant', 'moss_giant', 'banshee',
    ],
  },
  {
    id: 'vannaka',
    name: 'Vannaka',
    location: 'Edgeville Dungeon',
    icon: '⚔️',
    combatReq: 40,
    slayerReq: 0,
    pointsPerTask: 4,
    description: 'Assigns mid-level combat tasks. Requires combat 40.',
    taskRange: [70, 160],
    monsterPool: [
      'moss_giant', 'green_dragon', 'lesser_demon', 'blood_veld',
      'aberrant_spectre', 'wyrm',
    ],
  },
  {
    id: 'chaeldar',
    name: 'Chaeldar',
    location: 'Zanaris',
    icon: '🧝',
    combatReq: 70,
    slayerReq: 0,
    pointsPerTask: 10,
    description: 'High-level tasks including Abyssal Demons. Requires combat 70.',
    taskRange: [80, 300],
    monsterPool: [
      'green_dragon', 'lesser_demon', 'abyssal_demon', 'red_dragon',
      'blood_veld', 'nechryael', 'aberrant_spectre', 'spiritual_warrior',
      'spiritual_ranger', 'gargoyle', 'wyrm',
    ],
  },
  {
    id: 'nieve',
    name: 'Nieve',
    location: 'Tree Gnome Stronghold',
    icon: '🌿',
    combatReq: 85,
    slayerReq: 70,
    pointsPerTask: 12,
    description: 'Elite tasks including God Wars Dungeon bosses. Requires combat 85, slayer 70.',
    taskRange: [150, 400],
    bossTaskRange: [5, 25],
    monsterPool: [
      'abyssal_demon',
      { id: DAGANNOTH_KINGS_TASK_ID, boss: true },
      'red_dragon',
      'blood_veld', 'nechryael', 'skeletal_wyvern', 'smoke_devil',
      'spiritual_mage', 'gargoyle', 'brutal_black_dragon', 'dark_beast',
      { id: 'kraken', boss: true },
      { id: 'jad', boss: true },
    ],
  },
  {
    id: 'duradel',
    name: 'Duradel',
    location: 'Shilo Village',
    icon: '💀',
    combatReq: 100,
    slayerReq: 50,
    pointsPerTask: 15,
    description: 'The most prestigious master. Assigns the hardest tasks. Requires combat 100, slayer 50.',
    taskRange: [100, 250],
    bossTaskRange: [20, 50],
    monsterPool: [
      'abyssal_demon',
      { id: DAGANNOTH_KINGS_TASK_ID, boss: true },
      { id: 'general_graardor', boss: true },
      { id: 'commander_zilyana', boss: true },
      { id: 'kril_tsutsaroth', boss: true },
      { id: 'kreearra', boss: true },
      'blood_veld', 'nechryael', 'skeletal_wyvern', 'smoke_devil',
      'spiritual_mage', 'gargoyle', 'brutal_black_dragon', 'dark_beast',
      { id: 'kraken', boss: true },
      { id: 'jad', boss: true },
      { id: 'cerberus', boss: true },
      { id: 'hydra', boss: true },
    ],
  },
]

// OSRS combat level formula
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
  chicken: '🐔', goblin: '👺', cow: '🐄', wizard: '🧙', rock_crab: '🦀',
  sand_crab: '🦀', dark_wizard: '🧙‍♂️', giant_spider: '🕷️', hill_giant: '👊',
  moss_giant: '🌿', green_dragon: '🐉', lesser_demon: '👿', abyssal_demon: '😈',
  general_graardor: '👹', commander_zilyana: '🌟', kril_tsutsaroth: '🔥', kreearra: '🦅',
  dagganoth_kings: '👑', dagganoth_rex: '🦖', dagganoth_prime: '👹', dagganoth_supreme: '🏹', jad: '🔥',
  blood_veld: '🩸', nechryael: '👻', skeletal_wyvern: '🐲', smoke_devil: '💨', kraken: '🦑',
  banshee: '👻', aberrant_spectre: '👁️', wyrm: '🐍', spiritual_warrior: '⚔️',
  spiritual_ranger: '🏹', spiritual_mage: '🔮', gargoyle: '🗿',
  brutal_black_dragon: '🐉', dark_beast: '🦇', cerberus: '🐺', hydra: '🐲',
}

export default function SlayerScreen({ onBack }) {
  const { stats, slayerTask, setSlayerTask, slayerPoints, updateSlayerPoints, addToast, bank, inventory, addToBank, getSnapshot, slayerTasksCompleted } = useGame()

  const combatLevel = getPlayerCombatLevel(stats)
  const slayerLevel = getLevelFromXP(stats.slayer?.xp || 0)


  const resolveTaskMonsterIds = (monsterId) => {
    if (monsterId === DAGANNOTH_KINGS_TASK_ID) return ['dagganoth_rex', 'dagganoth_prime', 'dagganoth_supreme']
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
    const monsterName = monsterId === DAGANNOTH_KINGS_TASK_ID ? 'Dagannoth Kings' : (monsterData?.name || monsterId.replace(/_/g, ' '))

    // Jad always has a single-kill task
    let totalCount
    if (monsterId === 'jad') {
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

  const handleUnlock = (unlock) => {
    const item = itemsData[unlock.itemId]
    const purchaseState = getSlayerUnlockPurchaseState({ unlock, item, slayerPoints, bank, inventory })
    if (!purchaseState.allowed) {
      addToast(purchaseState.message || 'Unable to purchase unlock', 'error')
      return
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
          <div class="text-[10px] text-yellow-400 uppercase font-bold tracking-wider mb-1">⚔️ Current Task</div>
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
            <button
              onClick={handleCancelTask}
              class="text-[10px] text-[var(--color-parchment)] opacity-40 underline"
            >
              Skip (-30 points)
            </button>
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
