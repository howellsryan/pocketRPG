// Unit test for the shared character_idle_state upsert helpers — the single
// SQL source of truth used by /api/idle, /api/save, and the MCP idle helper.

import { describe, it, expect } from 'vitest'
import { stampIdleActive, stampIdleActiveStatement } from '../functions/_lib/game/idleStamp.js'

function makeEnv() {
  const runs: { sql: string, args: any[] }[] = []
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          sql,
          args,
          run: async () => { runs.push({ sql, args }) },
        }),
      }),
    },
  }
  return { env, runs }
}

describe('stampIdleActive', () => {
  it('runs an upsert binding [characterId, now, task, now]', async () => {
    const { env, runs } = makeEnv()
    await stampIdleActive(env as any, 42, '{"skill":"mining"}', 1234)
    expect(runs).toHaveLength(1)
    expect(runs[0].sql).toMatch(/INSERT INTO character_idle_state/)
    expect(runs[0].sql).toMatch(/ON CONFLICT\(character_id\) DO UPDATE/)
    expect(runs[0].args).toEqual([42, 1234, '{"skill":"mining"}', 1234])
  })

  it('accepts a null active_task', async () => {
    const { env, runs } = makeEnv()
    await stampIdleActive(env as any, 7, null, 9000)
    expect(runs[0].args).toEqual([7, 9000, null, 9000])
  })
})

describe('stampIdleActiveStatement', () => {
  it('returns a bound, not-yet-run statement for batching', () => {
    const { env, runs } = makeEnv()
    const stmt = stampIdleActiveStatement(env as any, 5, null, 100) as any
    expect(stmt.sql).toMatch(/INSERT INTO character_idle_state/)
    expect(stmt.args).toEqual([5, 100, null, 100])
    expect(runs).toHaveLength(0) // not executed until the batch runs it
  })
})
