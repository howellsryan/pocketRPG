// What a world kill is worth beyond its loot: a kill count, slayer-task
// progress, and daily-task progress.
//
// All three used to stop at the world's edge. Loot and XP ride the grant flush
// onto the save, but a green dragon killed out here incremented nothing, moved
// no slayer task, and no daily task ever saw it — the world resolves its own
// combat in a Durable Object, and the idle client that owns those three things
// is not running. So the DO owns them out here, and they ride the same flush:
// batched, because a per-kill D1 round trip is not affordable on a grind.

import monstersData from '../../src/data/monsters.json'
import { bankSlayerCredit, creditSlayerTaskKill, emptySlayerCredit } from '../../src/engine/slayerKillCredit.js'
import { isBossMonster } from './bossKills'

export type SlayerTask = {
  monsterId?: string
  monstersRemaining?: number
  masterId?: string
  pointsOnComplete?: number
} | null

export type SlayerCredit = { pointsEarned: number; tasksCompleted: number; masterCompletions: Record<string, number> }

export type SlayerSession = {
  task: SlayerTask
  tasksCompleted: number
  doubleXp: boolean
  credit: SlayerCredit
  /** Only a session that has actually moved the task writes it back — an
   * untouched snapshot must never overwrite whatever the idle game holds. */
  dirty: boolean
}

export type DailyEvent = {
  kind: string
  monsterId?: string
  skill?: string
  count?: number
  xp?: number
}

export type SlayerKillCredit = {
  slayerXp: number
  completed: boolean
  monstersRemaining: number
  pointsEarned: number
  message: string
}

type Save = Record<string, unknown>

/** Seeds the session's slayer state from the save at hello. */
export function seedSlayerSession(saveObject: Save): SlayerSession {
  const settings = (saveObject?.settings ?? {}) as Record<string, unknown>
  const unlocks = (settings.characterUnlocks ?? {}) as Record<string, unknown>
  return {
    task: (settings.slayerTask as SlayerTask) || null,
    tasksCompleted: Math.max(0, Math.floor(Number(settings.slayerTasksCompleted) || 0)),
    doubleXp: unlocks.doubleSlayerXp === true,
    credit: emptySlayerCredit(),
    dirty: false,
  }
}

/**
 * Credits one kill against the session's slayer task.
 *
 * Returns null when the kill was off-task (nothing to say and nothing to
 * write). Mutates the session — the task advances, completions bank into the
 * credit delta — and hands back the XP for the caller to grant through the
 * normal pending-XP path, so slayer XP flushes exactly like every other skill.
 */
export function creditWorldSlayerKill(session: SlayerSession, monsterId: string): SlayerKillCredit | null {
  const credited = creditSlayerTaskKill(
    { task: session.task, tasksCompleted: session.tasksCompleted, doubleXp: session.doubleXp },
    monsterId,
    monstersData,
  ) as {
    completed: boolean
    slayerXp: number
    task: SlayerTask
    monstersRemaining: number
    pointsEarned?: number
    totalTasks?: number
    masterId?: string | null
  } | null
  if (!credited) return null

  session.task = credited.task
  session.dirty = true
  if (!credited.completed) {
    return {
      slayerXp: credited.slayerXp,
      completed: false,
      monstersRemaining: credited.monstersRemaining,
      pointsEarned: 0,
      message: `${credited.monstersRemaining} left on your Slayer task.`,
    }
  }

  session.tasksCompleted = Math.max(session.tasksCompleted, Math.floor(Number(credited.totalTasks) || 0))
  session.credit = bankSlayerCredit(session.credit, credited)
  const pointsEarned = Math.max(0, Math.floor(Number(credited.pointsEarned) || 0))
  return {
    slayerXp: credited.slayerXp,
    completed: true,
    monstersRemaining: 0,
    pointsEarned,
    message: `Slayer task complete — ${pointsEarned.toLocaleString()} points.`,
  }
}

/** The slayer fields a flush carries, or null when nothing has moved. Taking
 * them CLEARS the banked delta: the caller restores it if the grant fails. */
export function drainSlayerCredit(session: SlayerSession): { slayerTask: SlayerTask; slayerCredit: SlayerCredit; slayerTasksCompleted: number } | null {
  if (!session.dirty) return null
  const drained = { slayerTask: session.task, slayerCredit: session.credit, slayerTasksCompleted: session.tasksCompleted }
  session.credit = emptySlayerCredit()
  session.dirty = false
  return drained
}

/** Puts a failed flush's slayer delta back, so the next one carries it. Every
 * field ADDS — a task completed while the failed flush was in flight is already
 * on the session's own credit, and a merge that overwrote the master counts
 * would hand back two completions with one master credit. */
export function restoreSlayerCredit(session: SlayerSession, drained: { slayerCredit: SlayerCredit } | null): void {
  if (!drained) return
  session.dirty = true
  const masterCompletions = { ...session.credit.masterCompletions }
  for (const [masterId, count] of Object.entries(drained.slayerCredit.masterCompletions || {})) {
    masterCompletions[masterId] = (Math.floor(Number(masterCompletions[masterId]) || 0)) + Math.max(0, Math.floor(Number(count) || 0))
  }
  session.credit = {
    pointsEarned: session.credit.pointsEarned + drained.slayerCredit.pointsEarned,
    tasksCompleted: session.credit.tasksCompleted + drained.slayerCredit.tasksCompleted,
    masterCompletions,
  }
}

/** The daily-task events a kill is worth. `boss_kill` and `monster_kill` are
 * separate triggers in the task pool, exactly as they are solo. */
export function killDailyEvents(tally: Record<string, number>): DailyEvent[] {
  const events: DailyEvent[] = []
  for (const [monsterId, count] of Object.entries(tally || {})) {
    const n = Math.floor(Number(count) || 0)
    if (n <= 0) continue
    events.push({ kind: isBossMonster(monsterId) ? 'boss_kill' : 'monster_kill', monsterId, count: n })
  }
  return events
}

/** The daily-task events a flush's XP is worth. Combat XP feeds no daily task
 * (the pool's XP tasks are all named skills), and 'any'/'combat' are not skills
 * — the same two exclusions the idle catch-up path makes. */
export function xpDailyEvents(xpBySkill: Record<string, number>): DailyEvent[] {
  const events: DailyEvent[] = []
  for (const [skill, xp] of Object.entries(xpBySkill || {})) {
    const amount = Math.floor(Number(xp) || 0)
    if (amount <= 0 || skill === 'combat' || skill === 'any') continue
    events.push({ kind: 'skill_xp', skill, xp: amount })
  }
  return events
}
