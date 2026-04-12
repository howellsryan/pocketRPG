import { useGame } from '../state/gameState.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import monstersData from '../data/monsters.json'

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
      'dark_wizard', 'giant_spider', 'hill_giant', 'moss_giant',
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
      'moss_giant', 'green_dragon', 'lesser_demon',
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
    taskRange: [80, 200],
    monsterPool: [
      'green_dragon', 'lesser_demon', 'abyssal_demon',
    ],
  },
  {
    id: 'nieve',
    name: 'Nieve',
    location: 'Tree Gnome Stronghold',
    icon: '🌿',
    combatReq: 85,
    slayerReq: 0,
    pointsPerTask: 12,
    description: 'Elite tasks including God Wars Dungeon bosses. Requires combat 85.',
    taskRange: [100, 250],
    bossTaskRange: [20, 50],
    monsterPool: [
      'abyssal_demon',
      { id: 'general_graardor', boss: true },
      { id: 'commander_zilyana', boss: true },
      { id: 'kril_tsutsaroth', boss: true },
      { id: 'kreearra', boss: true },
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
      { id: 'dagganoth_rex', boss: true },
      { id: 'dagganoth_prime', boss: true },
      { id: 'dagganoth_supreme', boss: true },
      { id: 'general_graardor', boss: true },
      { id: 'commander_zilyana', boss: true },
      { id: 'kril_tsutsaroth', boss: true },
      { id: 'kreearra', boss: true },
      { id: 'jad', boss: true },
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
  dagganoth_rex: '🦖', dagganoth_prime: '👹', dagganoth_supreme: '🏹', jad: '🔥',
}

export default function SlayerScreen({ onBack }) {
  const { stats, slayerTask, setSlayerTask, slayerPoints, updateSlayerPoints, addToast } = useGame()

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

    // Pick random monster from pool
    const pool = master.monsterPool
    const pick = pool[Math.floor(Math.random() * pool.length)]
    const isBoss = typeof pick === 'object' && pick.boss
    const monsterId = typeof pick === 'object' ? pick.id : pick

    // Check slayer requirement on the monster itself
    const monsterData = monstersData[monsterId]
    if (monsterData?.slayerRequirement && slayerLevel < monsterData.slayerRequirement) {
      // Re-roll once to avoid blocking the player
      const fallback = pool.find(p => {
        const id = typeof p === 'object' ? p.id : p
        const m = monstersData[id]
        return !m?.slayerRequirement || slayerLevel >= m.slayerRequirement
      })
      if (!fallback) {
        addToast(`Need slayer level ${monsterData.slayerRequirement} for this task`, 'error')
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
    const monsterName = monsterData?.name || monsterId.replace(/_/g, ' ')

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
    addToast(`💀 Task: Kill ${totalCount} ${monsterName}`, 'info')
  }

  const handleCancelTask = () => {
    setSlayerTask(null)
    addToast('Task cancelled. No points awarded.', 'info')
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
        Level {slayerLevel} · Combat {combatLevel} · {slayerPoints.toLocaleString()} points
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
              Cancel (no points)
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
    </div>
  )
}
