import { describe, expect, it } from 'vitest'
import { simulateQuestIdleCascade, createQueuedQuestTask } from '../src/engine/questIdleCascade.js'

const q1 = { id: 'q1', name: 'Quest 1', durationSeconds: 600, xpReward: { attack: 100 }, coinReward: 10 }
const q2 = { id: 'q2', name: 'Quest 2', durationSeconds: 600, xpReward: { strength: 100 }, coinReward: 20 }
const q3 = { id: 'q3', name: 'Quest 3', durationSeconds: 600, xpReward: { defence: 100 }, coinReward: 30 }

describe('simulateQuestIdleCascade', () => {
  it('completes active and multiple queued quests within one elapsed window', () => {
    const activeTask = createQueuedQuestTask(q1, 10, 1_000)
    const result = simulateQuestIdleCascade({ activeTask, questQueue: [q2, q3], elapsedMs: 30 * 600, now: 2_000 })
    expect(result.completed.map(entry => entry.quest.id)).toEqual(['q1', 'q2', 'q3'])
    expect(result.finalTask).toBeNull()
    expect(result.finalQueue).toEqual([])
  })

  it('completes queued quest when elapsed window is enough for both quests', () => {
    const activeTask = createQueuedQuestTask(q1, 10, 1_000)
    const result = simulateQuestIdleCascade({ activeTask, questQueue: [q2], elapsedMs: 15 * 600, now: 2_000 })
    expect(result.completed.map(entry => entry.quest.id)).toEqual(['q1', 'q2'])
    expect(result.finalTask).toBeNull()
    expect(result.finalQueue).toEqual([])
  })

  it('updates only the active quest when it does not complete', () => {
    const activeTask = createQueuedQuestTask(q1, 100, 1_000)
    const result = simulateQuestIdleCascade({ activeTask, questQueue: [q2], elapsedMs: 10 * 600, now: 2_000 })
    expect(result.completed).toEqual([])
    expect(result.finalTask?.quest.id).toBe('q1')
    expect(result.finalTask?.ticksRemaining).toBe(90)
    expect(result.finalQueue).toEqual([q2])
  })

  it('does not mutate the original queue', () => {
    const queue = [q2, q3]
    const activeTask = createQueuedQuestTask(q1, 10, 1_000)
    simulateQuestIdleCascade({ activeTask, questQueue: queue, elapsedMs: 20 * 600, now: 2_000 })
    expect(queue).toEqual([q2, q3])
  })
})
