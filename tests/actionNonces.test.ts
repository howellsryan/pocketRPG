import { describe, it, expect } from 'vitest'
import { claimActionNonce, migrateLegacyNonces } from '../functions/_lib/game/nonces.js'

// Models a (character_id, nonce) primary-key constraint: INSERT returns
// changes:1 only if the row didn't already exist. Anything else returns
// changes:0, which the helper interprets as a replay.
function makeNonceDb({ initial = [] as Array<{ character_id: number; nonce: string }> } = {}) {
  const rows = new Set<string>(initial.map(r => `${r.character_id}:${r.nonce}`))
  const inserts: Array<{ character_id: number; nonce: string; used_at: number }> = []
  return {
    rows,
    inserts,
    DB: {
      prepare(_sql: string) {
        let bound: any[] = []
        return {
          bind(...args: any[]) { bound = args; return this },
          async run() {
            const [character_id, nonce, used_at] = bound
            const key = `${character_id}:${nonce}`
            if (rows.has(key)) return { meta: { changes: 0 } }
            rows.add(key)
            inserts.push({ character_id, nonce, used_at })
            return { meta: { changes: 1 } }
          },
        }
      },
      async batch(stmts: any[]) {
        for (const s of stmts) await (s as any).run()
        return []
      },
    },
  }
}

describe('claimActionNonce', () => {
  it('succeeds on first claim and inserts a row', async () => {
    const { DB, inserts } = makeNonceDb()
    await expect(claimActionNonce({ DB } as any, 42, 'abc')).resolves.toBeUndefined()
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ character_id: 42, nonce: 'abc' })
  })

  it('throws STALE_REPLAYED_ACTION on replay', async () => {
    const { DB } = makeNonceDb({ initial: [{ character_id: 42, nonce: 'abc' }] })
    await expect(claimActionNonce({ DB } as any, 42, 'abc')).rejects.toMatchObject({
      code: 'STALE_REPLAYED_ACTION',
      status: 409,
    })
  })

  it('rejects empty / non-string nonces', async () => {
    const { DB } = makeNonceDb()
    await expect(claimActionNonce({ DB } as any, 42, '' as any)).rejects.toMatchObject({ code: 'INVALID_NONCE' })
    await expect(claimActionNonce({ DB } as any, 42, null as any)).rejects.toMatchObject({ code: 'INVALID_NONCE' })
    await expect(claimActionNonce({ DB } as any, 42, 123 as any)).rejects.toMatchObject({ code: 'INVALID_NONCE' })
  })

  it('rejects absurdly long nonces', async () => {
    const { DB } = makeNonceDb()
    const huge = 'x'.repeat(200)
    await expect(claimActionNonce({ DB } as any, 42, huge)).rejects.toMatchObject({ code: 'INVALID_NONCE' })
  })

  it('treats character_id scopes independently (same nonce, different characters)', async () => {
    const { DB } = makeNonceDb()
    await claimActionNonce({ DB } as any, 1, 'shared')
    await expect(claimActionNonce({ DB } as any, 2, 'shared')).resolves.toBeUndefined()
  })
})

describe('migrateLegacyNonces', () => {
  it('copies _serverActionNonces into the table and strips it from the save', async () => {
    const { DB, rows } = makeNonceDb()
    const save: any = {
      _serverActionNonces: { a: 1000, b: 2000 },
      inventory: [],
    }
    const migrated = await migrateLegacyNonces({ DB } as any, 7, save)
    expect(migrated).toBe(true)
    expect(rows.has('7:a')).toBe(true)
    expect(rows.has('7:b')).toBe(true)
    expect(save._serverActionNonces).toBeUndefined()
  })

  it('is idempotent: replaying the same legacy blob inserts nothing new', async () => {
    const { DB, rows } = makeNonceDb({
      initial: [{ character_id: 7, nonce: 'a' }, { character_id: 7, nonce: 'b' }],
    })
    const save: any = { _serverActionNonces: { a: 1, b: 2 } }
    await migrateLegacyNonces({ DB } as any, 7, save)
    expect(rows.size).toBe(2)
    expect(save._serverActionNonces).toBeUndefined()
  })

  it('returns false when there is nothing to migrate', async () => {
    const { DB } = makeNonceDb()
    expect(await migrateLegacyNonces({ DB } as any, 7, {} as any)).toBe(false)
    expect(await migrateLegacyNonces({ DB } as any, 7, { _serverActionNonces: {} } as any)).toBe(false)
  })
})
