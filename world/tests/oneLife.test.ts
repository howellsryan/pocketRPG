// One Life deaths resolved by this Worker. Both the open world and the co-op
// rooms resolve combat themselves, so nothing in the idle game's death paths
// ever revokes the flag for a player who dies in either.
import { describe, expect, it } from 'vitest'
import { endOneLifeRun, flipOneLifeOff, ONE_LIFE_OVER_MESSAGE, revokeOneLifeIfSet, updateOneLifeOff, type OneLifeSession } from '../server/oneLife'
import type { Env } from '../server/env'

/** A D1 stand-in: records the statement + bindings, answers with `changes`. */
function fakeDb(changes: number | Error) {
  const runs: { sql: string; args: unknown[] }[] = []
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async run() {
                if (changes instanceof Error) throw changes
                runs.push({ sql, args })
                return { meta: { changes } }
              },
            }
          },
        }
      },
    },
  } as unknown as Env
  return { env, runs }
}

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

describe('updateOneLifeOff', () => {
  it('only touches a character that is still one-life, and nothing else about them', async () => {
    const { env, runs } = fakeDb(1)
    expect(await updateOneLifeOff(env, 42)).toBe(1)
    expect(runs).toHaveLength(1)
    expect(runs[0].args).toEqual([42])
    // The whole revert is the flag: any other column here would be a wipe.
    expect(runs[0].sql).toMatch(/^UPDATE characters SET is_one_life = 0 WHERE id = \? AND is_one_life = 1/)
  })

  it('reports a failed write as null, distinct from a character who was not one-life', async () => {
    expect(await updateOneLifeOff(fakeDb(new Error('D1 down')).env, 42)).toBeNull()
    expect(await updateOneLifeOff(fakeDb(0).env, 42)).toBe(0)
  })
})

describe('revokeOneLifeIfSet', () => {
  it('answers whether this death is what ended the run', async () => {
    expect(await revokeOneLifeIfSet(fakeDb(1).env, 42)).toBe(true)
    expect(await revokeOneLifeIfSet(fakeDb(0).env, 42)).toBe(false)
    // Null, not false: the caller holds no copy of the flag, so "D1 could not
    // answer" has to stay tellable from "they were never one-life" or the
    // retry queue would drop the revert.
    expect(await revokeOneLifeIfSet(fakeDb(new Error('D1 down')).env, 42)).toBeNull()
  })
})

describe('flipOneLifeOff', () => {
  it('treats a character who was already reverted as a success', async () => {
    expect(await flipOneLifeOff(fakeDb(0).env, 42)).toBe(true)
    expect(await flipOneLifeOff(fakeDb(new Error('D1 down')).env, 42)).toBe(false)
  })
})
