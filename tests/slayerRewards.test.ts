import { describe, expect, it } from 'vitest'
import { getSlayerTaskReward } from '../src/engine/slayerRewards.js'

describe('getSlayerTaskReward', () => {
  it('awards base points on normal tasks', () => {
    expect(getSlayerTaskReward(10, 0)).toEqual({ totalTasks: 1, multiplier: 1, pointsEarned: 10 })
  })

  it('awards 10x points every 5th task', () => {
    expect(getSlayerTaskReward(12, 4)).toEqual({ totalTasks: 5, multiplier: 10, pointsEarned: 120 })
  })

  it('awards 50x points every 50th task', () => {
    expect(getSlayerTaskReward(7, 49)).toEqual({ totalTasks: 50, multiplier: 50, pointsEarned: 350 })
  })
})
