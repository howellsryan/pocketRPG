import { describe, expect, it } from 'vitest'
import { advanceMovement, toEntityDiff, type TickPlayer } from '../server/tick'

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return { charId: '1', name: 'WorldTester', x: 0, z: 0, path: [], anim: 'idle', ...overrides }
}

describe('advanceMovement', () => {
  it('reports no change for an idle player with an empty path', () => {
    const player = makePlayer()
    const result = advanceMovement(player)
    expect(result.changed).toBe(false)
    expect(result.next).toBe(player)
  })

  it('consumes one tile off the path per call', () => {
    const player = makePlayer({ path: [{ x: 1, z: 0 }, { x: 2, z: 0 }] })
    const step1 = advanceMovement(player)
    expect(step1.changed).toBe(true)
    expect(step1.next).toMatchObject({ x: 1, z: 0, anim: 'walk' })
    expect(step1.next.path).toEqual([{ x: 2, z: 0 }])

    const step2 = advanceMovement(step1.next)
    expect(step2.next).toMatchObject({ x: 2, z: 0, anim: 'walk' })
    expect(step2.next.path).toEqual([])
  })

  it('settles to idle exactly once when the path just emptied', () => {
    const walking = makePlayer({ x: 2, z: 0, path: [], anim: 'walk' })
    const settled = advanceMovement(walking)
    expect(settled.changed).toBe(true)
    expect(settled.next.anim).toBe('idle')

    const alreadyIdle = advanceMovement(settled.next)
    expect(alreadyIdle.changed).toBe(false)
  })
})

describe('toEntityDiff', () => {
  it('maps a player to a wire-format entity diff', () => {
    const player = makePlayer({ x: 3, z: 4, anim: 'walk' })
    expect(toEntityDiff(player)).toEqual({
      id: '1', kind: 'player', x: 3, z: 4, anim: 'walk', name: 'WorldTester',
    })
  })
})
