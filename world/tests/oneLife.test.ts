// One Life deaths in the open world. The world resolves combat itself, so
// nothing in the idle game's death paths ever revokes the flag for a player who
// dies out here — WorldZone.respawnPlayer is the only caller.
import { describe, expect, it } from 'vitest'
import { endOneLifeRun, ONE_LIFE_OVER_MESSAGE, type OneLifeSession } from '../server/oneLife'

const session = (isOneLife: boolean): OneLifeSession => ({ charId: '42', isOneLife, pendingEvents: [] })

describe('endOneLifeRun', () => {
  it('revokes the flag for the dying character and tells them', async () => {
    const flipped: number[] = []
    const s = session(true)
    endOneLifeRun(s, async (id) => { flipped.push(id); return true })
    expect(s.isOneLife).toBe(false)
    expect(s.pendingEvents).toEqual([{ e: 'msg', text: ONE_LIFE_OVER_MESSAGE }])
    await Promise.resolve()
    expect(flipped).toEqual([42])
  })

  it('does nothing for a character who was never one-life', () => {
    let calls = 0
    const s = session(false)
    endOneLifeRun(s, async () => { calls += 1; return true })
    expect(s.pendingEvents).toEqual([])
    expect(calls).toBe(0)
  })

  it('is a no-op on a second death — one run, one revert', async () => {
    const flipped: number[] = []
    const s = session(true)
    const flip = async (id: number) => { flipped.push(id); return true }
    endOneLifeRun(s, flip)
    await Promise.resolve()
    endOneLifeRun(s, flip)
    expect(flipped).toEqual([42])
    expect(s.pendingEvents).toHaveLength(1)
  })

  it('restores the flag when the write fails, so the next death retries', async () => {
    const s = session(true)
    endOneLifeRun(s, async () => false)
    await Promise.resolve()
    await Promise.resolve()
    expect(s.isOneLife).toBe(true)

    const flipped: number[] = []
    endOneLifeRun(s, async (id) => { flipped.push(id); return true })
    await Promise.resolve()
    expect(flipped).toEqual([42])
    expect(s.isOneLife).toBe(false)
  })
})
