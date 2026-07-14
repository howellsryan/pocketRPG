// Auto Slayer Task chain (the `auto_slayer_task` character unlock).
//
// When a player who owns the unlock returns from idling — or uses skip-hour —
// while fighting their assigned slayer monster, keep the slayer grind going for
// the whole idle window instead of mindlessly farming the same monster after
// the task is done: complete the current task, auto-assign the next task from
// the SAME master, and repeat until time (or supplies) run out.
//
// This is a thin orchestration layer over simulateIdleCombat. Each iteration
// runs one task to completion (via `stopOnSlayerComplete`), then this wrapper
// threads the surviving resource state (inventory, bank, equipped ammo/charges,
// HP) into the next call and rolls the next assignment. Bosses can't be idled,
// so a rolled boss task ends the chain and is left as the active slayer task for
// the player to tackle manually ("grind whatever's assigned" — no reroll).
//
// The return shape is a superset of a single simulateIdleCombat result so the
// existing apply layers (applyTaskResult.js + the client callers) consume the
// aggregate fields unchanged; the extra fields (slayerCompletions, perMonster,
// finalTaskMonster) drive per-task point/streak awards and per-monster
// collection-log / daily-task attribution.
import { simulateIdleCombat } from './idleEngine.js'
import { SLAYER_MASTERS, pickSlayerMonster, buildSlayerTask } from './slayerMasters.js'
import { doesSlayerTaskMatchMonster } from './slayerTasks.js'
import { getLevelFromXP } from './experience.js'
import monstersData from '../data/monsters.json'

const IDLE_CHAIN_TICK_MS = 600
// Safety valve: a pathological setup (e.g. 1-kill tasks in a huge window) could
// otherwise spin for a very long time. 300 completed tasks is far beyond any
// realistic offline window and keeps the sim bounded.
const MAX_CHAIN_TASKS = 300

function addCounts(target, source) {
  if (!source) return
  for (const [key, value] of Object.entries(source)) {
    const n = Number(value) || 0
    if (n !== 0) target[key] = (target[key] || 0) + n
  }
}

// Remove consumed supplies from a working bank copy so the next task in the
// chain sees the real remaining stock (simulateIdleCombat reads the whole bank
// for supply availability every call).
function debitBank(bank, consumed) {
  if (!consumed) return
  for (const [itemId, qty] of Object.entries(consumed)) {
    const cur = bank[itemId]
    if (!cur) continue
    const left = (Number(cur.quantity) || 0) - Number(qty)
    if (left <= 0) delete bank[itemId]
    else bank[itemId] = { ...cur, quantity: left }
  }
}

function cloneEquipment(equipment) {
  const next = { ...(equipment || {}) }
  if (next.ammo) next.ammo = { ...next.ammo }
  if (next.weapon) next.weapon = { ...next.weapon }
  return next
}

// Roll the next task from the same master. Returns null when nothing is
// eligible (chain ends). A boss roll is returned too — the caller lets
// simulateIdleCombat reject it (bosses aren't idleable) which ends the chain.
function assignNextTask(masterId, stats, options) {
  const master = SLAYER_MASTERS.find(m => m.id === masterId)
  if (!master) return null
  const slayerLevel = Math.max(1, getLevelFromXP(stats.slayer?.xp || 0))
  const pick = pickSlayerMonster(master, slayerLevel, {
    rng: options.rng,
    completedQuests: options.completedQuests,
    history: options.slayerHistory,
  })
  if (!pick) return null
  const quantityMultiplier = options.slayerPerks?.doubleQuantity ? 2 : 1
  const slayerTask = buildSlayerTask(master, pick.monsterId, pick.isBoss, {
    rng: options.rng,
    quantityMultiplier,
  })
  return { slayerTask, monster: monstersData[pick.monsterId] || null }
}

/**
 * Run one or more slayer tasks across `elapsedMs`, auto-assigning from the same
 * master between tasks. Falls back to a single simulateIdleCombat call when the
 * chain shouldn't engage (unlock off, no slayer task, or the active fight isn't
 * the assigned slayer monster) so callers can route combat through this
 * unconditionally.
 *
 * Extra `options` beyond simulateIdleCombat's:
 *  - autoSlayer      boolean — the unlock is owned.
 *  - slayerPerks     { doubleQuantity } — task-size multiplier for new tasks.
 *  - completedQuests Set/array — quest-gated monster eligibility.
 *  - rng             () => number — deterministic assignment in tests.
 *  - slayerHistory   Map — per-master recent-task history (defaults to the
 *                    module-level history inside pickSlayerMonster).
 */
export function simulateIdleCombatChain(task, elapsedMs, stats, equipment, inventory, itemsData, slayerTask = null, bank = {}, options = {}) {
  const engages = options.autoSlayer
    && slayerTask
    && task?.monster?.id
    && doesSlayerTaskMatchMonster(slayerTask.monsterId, task.monster.id)

  if (!engages) {
    return simulateIdleCombat(task, elapsedMs, stats, equipment, inventory, itemsData, slayerTask, bank, options)
  }

  const aggregate = {
    xpGained: {}, lootGained: {}, lootLost: {}, lootBanked: {}, runesConsumed: {},
    itemsConsumed: {}, foodConsumed: {}, potionsConsumed: {},
    monstersKilled: 0, monstersKilledOnTask: 0, slayerXpGained: 0,
    chargesConsumed: 0, attacksUsed: 0,
    damageTaken: 0, damagePreventedByPrayer: 0,
  }
  const slayerCompletions = []
  const perMonster = []
  let ammoConsumed = null
  let firstSim = null

  let workInv = inventory
  const workBank = { ...(bank || {}) }
  for (const key of Object.keys(workBank)) workBank[key] = { ...workBank[key] }
  let workEquip = cloneEquipment(equipment)
  let currentHP = options.currentHP
  let currentTask = task
  let currentSlayer = slayerTask
  let finalTaskMonster = null

  let remainingMs = elapsedMs
  let died = false
  let stoppedReason = null

  for (let i = 0; i < MAX_CHAIN_TASKS && remainingMs >= IDLE_CHAIN_TICK_MS; i++) {
    const sim = simulateIdleCombat(
      currentTask, remainingMs, stats, workEquip, workInv, itemsData, currentSlayer, workBank,
      { ...options, currentHP, stopOnSlayerComplete: true },
    )
    if (!sim) { stoppedReason = stoppedReason || 'chain_unidleable'; break }
    if (!firstSim) firstSim = sim

    addCounts(aggregate.xpGained, sim.xpGained)
    addCounts(aggregate.lootGained, sim.lootGained)
    addCounts(aggregate.lootLost, sim.lootLost)
    addCounts(aggregate.lootBanked, sim.lootBanked)
    addCounts(aggregate.runesConsumed, sim.runesConsumed)
    addCounts(aggregate.itemsConsumed, sim.itemsConsumed)
    addCounts(aggregate.foodConsumed, sim.foodConsumed)
    addCounts(aggregate.potionsConsumed, sim.potionsConsumed)
    aggregate.monstersKilled += sim.monstersKilled || 0
    aggregate.monstersKilledOnTask += sim.monstersKilledOnTask || 0
    aggregate.slayerXpGained += sim.slayerXpGained || 0
    aggregate.chargesConsumed += sim.chargesConsumed || 0
    aggregate.attacksUsed += sim.attacksUsed || 0
    aggregate.damageTaken += sim.damageTaken || 0
    aggregate.damagePreventedByPrayer += sim.damagePreventedByPrayer || 0
    if (sim.ammoConsumed) {
      ammoConsumed = ammoConsumed && ammoConsumed.itemId === sim.ammoConsumed.itemId
        ? { itemId: ammoConsumed.itemId, quantity: ammoConsumed.quantity + sim.ammoConsumed.quantity }
        : sim.ammoConsumed
    }
    if (sim.monstersKilled > 0 && currentTask.monster?.id) {
      perMonster.push({
        monsterId: currentTask.monster.id,
        monstersKilled: sim.monstersKilled,
        lootGained: sim.lootGained || {},
        lootBanked: sim.lootBanked || {},
      })
    }

    // Thread surviving resource state into the next task.
    workInv = sim.finalInventory || workInv
    currentHP = sim.finalHP
    debitBank(workBank, sim.itemsConsumed)
    debitBank(workBank, sim.runesConsumed)
    if (sim.ammoConsumed && workEquip.ammo && workEquip.ammo.itemId === sim.ammoConsumed.itemId) {
      const left = Math.max(0, (workEquip.ammo.quantity || 0) - sim.ammoConsumed.quantity)
      workEquip = cloneEquipment(workEquip)
      workEquip.ammo = left > 0 ? { ...workEquip.ammo, quantity: left } : null
    }
    if (sim.chargesConsumed > 0 && workEquip.weapon) {
      const left = Math.max(0, (workEquip.weapon.charges || 0) - sim.chargesConsumed)
      workEquip = cloneEquipment(workEquip)
      workEquip.weapon = { ...workEquip.weapon, charges: left }
    }

    remainingMs -= (sim.effectiveElapsedMs || 0)

    if (sim.died) { died = true; stoppedReason = 'died'; currentSlayer = sim.slayerTaskUpdate?.completed ? null : (sim.slayerTaskUpdate || currentSlayer); break }

    if (sim.slayerTaskUpdate?.completed) {
      slayerCompletions.push({
        monsterId: currentSlayer.monsterId,
        monsterName: currentSlayer.monsterName,
        count: sim.monstersKilledOnTask || currentSlayer.monstersRemaining || 0,
        pointsOnComplete: sim.slayerTaskUpdate.pointsOnComplete,
      })
      const next = assignNextTask(currentSlayer.masterId, stats, options)
      if (!next || !next.monster) { currentSlayer = next?.slayerTask || null; finalTaskMonster = null; stoppedReason = 'chain_no_task'; break }
      currentSlayer = next.slayerTask
      currentTask = { ...task, monster: next.monster }
      finalTaskMonster = next.monster
    } else {
      // Ran out of time or resources mid-task — task stays in progress.
      currentSlayer = sim.slayerTaskUpdate || currentSlayer
      stoppedReason = sim.stoppedReason || 'completed_elapsed'
      if (sim.stoppedReason === 'resource_limited') break
      if ((sim.effectiveElapsedMs || 0) <= 0 && (sim.monstersKilled || 0) <= 0) break
      // Otherwise the window is spent (completed_elapsed) — loop guard ends it.
    }
  }

  // finalTaskMonster: the monster the live game should resume on — the current
  // in-progress task's monster when it's idleable, else null (boss/none) so the
  // caller leaves live combat where it was.
  if (finalTaskMonster && (finalTaskMonster.boss === true)) finalTaskMonster = null

  // Nothing simulated (e.g. window shorter than a tick) — preserve the single
  // sim's null/empty contract exactly so callers' `if (!sim)` paths still fire.
  if (!firstSim) {
    return simulateIdleCombat(task, elapsedMs, stats, equipment, inventory, itemsData, slayerTask, bank, options)
  }

  const base = firstSim
  const effectiveElapsedMs = Math.max(0, elapsedMs - remainingMs)
  const maxHP = stats.hitpoints ? getLevelFromXP(stats.hitpoints.xp || 0) : 10

  return {
    ...base,
    xpGained: aggregate.xpGained,
    lootGained: aggregate.lootGained,
    lootLost: aggregate.lootLost,
    lootBanked: aggregate.lootBanked,
    runesConsumed: aggregate.runesConsumed,
    itemsConsumed: aggregate.itemsConsumed,
    foodConsumed: aggregate.foodConsumed,
    potionsConsumed: aggregate.potionsConsumed,
    monstersKilled: aggregate.monstersKilled,
    monstersKilledOnTask: aggregate.monstersKilledOnTask,
    slayerXpGained: aggregate.slayerXpGained,
    chargesConsumed: aggregate.chargesConsumed,
    attacksUsed: aggregate.attacksUsed,
    damageTaken: Math.max(0, Math.floor(aggregate.damageTaken)),
    damagePreventedByPrayer: Math.max(0, Math.floor(aggregate.damagePreventedByPrayer)),
    ammoConsumed,
    finalInventory: workInv,
    finalHP: died ? 0 : Math.max(1, Math.min(maxHP, Math.floor(Number(currentHP) || maxHP))),
    died,
    stoppedReason: stoppedReason || base.stoppedReason || 'completed_elapsed',
    effectiveElapsedMs,
    // Chain-specific outputs:
    slayerTaskUpdate: currentSlayer,     // final in-progress task (or null)
    slayerCompletions,                   // one entry per task cleared this window
    slayerTasksCompletedCount: slayerCompletions.length,
    perMonster,                          // per-monster kills + loot for logging
    finalTaskMonster,                    // monster to resume live combat on
    autoSlayerChained: true,
  }
}
