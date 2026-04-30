import { describe, expect, it } from 'vitest'
import { simulateQuestIdleCascade, createQueuedQuestTask } from '../src/engine/questIdleCascade.js'
import { TICK_DURATION } from '../src/utils/constants.js'

const HOUR_MS = 60 * 60 * 1000

const twoHourQuest = {
  id: 'two_hour',
  name: 'Two Hour Quest',
  durationSeconds: 2 * 60 * 60,
  xpReward: { attack: 100 },
  coinReward: 10,
}

const fiveHourQuest = {
  id: 'five_hour',
  name: 'Five Hour Quest',
  durationSeconds: 5 * 60 * 60,
  xpReward: { strength: 100 },
  coinReward: 20,
}

describe('simulateQuestIdleCascade', () => {
  it('does not complete a 2h active quest after one 1h skip', () => {
    const activeTask = createQueuedQuestTask(twoHourQuest, null, 1_000)
    const result = simulateQuestIdleCascade({ activeTask, questQueue: [fiveHourQuest], elapsedMs: HOUR_MS, now: 2_000 })
    expect(result.completed).toEqual([])
    expect(result.finalTask?.quest.id).toBe('two_hour')
    expect(result.finalTask?.ticksRemaining).toBe(activeTask.totalTicks - Math.floor(HOUR_MS / TICK_DURATION))
    expect(result.finalQueue.map(q => q.id)).toEqual(['five_hour'])
  })

  it('completes the 2h active quest after two 1h skips but does not progress the 5h queued quest without leftover time', () => {
    const activeTask = createQueuedQuestTask(twoHourQuest, null, 1_000)
    const first = simulateQuestIdleCascade({ activeTask, questQueue: [fiveHourQuest], elapsedMs: HOUR_MS, now: 2_000 })
    const second = simulateQuestIdleCascade({ activeTask: first.finalTask, questQueue: first.finalQueue, elapsedMs: HOUR_MS, now: 3_000 })

    expect(second.completed.map(entry => entry.quest.id)).toEqual(['two_hour'])
    expect(second.finalTask?.quest.id).toBe('five_hour')
    expect(second.finalTask?.ticksRemaining).toBe(second.finalTask?.totalTicks)
    expect(second.finalQueue).toEqual([])
  })

  it('requires seven 1h skips to complete a 2h quest followed by a 5h quest', () => {
    let activeTask = createQueuedQuestTask(twoHourQuest, null, 1_000)
    let queue = [fiveHourQuest]
    const completed: string[] = []

    for (let i = 1; i <= 6; i++) {
      const result = simulateQuestIdleCascade({ activeTask, questQueue: queue, elapsedMs: HOUR_MS, now: 1_000 + i })
      completed.push(...result.completed.map(entry => entry.quest.id))
      activeTask = result.finalTask
      queue = result.finalQueue
      expect(completed).not.toEqual(['two_hour', 'five_hour'])
    }

    const seventh = simulateQuestIdleCascade({ activeTask, questQueue: queue, elapsedMs: HOUR_MS, now: 8_000 })
    completed.push(...seventh.completed.map(entry => entry.quest.id))

    expect(completed).toEqual(['two_hour', 'five_hour'])
    expect(seventh.finalTask).toBeNull()
    expect(seventh.finalQueue).toEqual([])
  })

  it('applies only leftover time to the next queued quest when active quest finishes mid-skip', () => {
    const activeTask = createQueuedQuestTask(twoHourQuest, Math.floor((30 * 60 * 1000) / TICK_DURATION), 1_000)
    const result = simulateQuestIdleCascade({ activeTask, questQueue: [fiveHourQuest], elapsedMs: HOUR_MS, now: 2_000 })

    expect(result.completed.map(entry => entry.quest.id)).toEqual(['two_hour'])
    expect(result.finalTask?.quest.id).toBe('five_hour')

    const expectedFiveHourTicks = Math.ceil(fiveHourQuest.durationSeconds * 1000 / TICK_DURATION)
    const expectedLeftoverTicks = Math.floor((30 * 60 * 1000) / TICK_DURATION)
    expect(result.finalTask?.ticksRemaining).toBe(expectedFiveHourTicks - expectedLeftoverTicks)
  })

  it('does not mutate the original queue', () => {
    const activeTask = createQueuedQuestTask(twoHourQuest, null, 1_000)
    const queue = [fiveHourQuest]
    simulateQuestIdleCascade({ activeTask, questQueue: queue, elapsedMs: HOUR_MS, now: 2_000 })
    expect(queue).toEqual([fiveHourQuest])
  })
})
