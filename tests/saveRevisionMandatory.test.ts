import { describe, it, expect } from 'vitest'
import { writeSave } from '../functions/_lib/game/save.js'

// Builds an in-memory D1 mock with a tiny `saves` table keyed by
// character_id. UPDATE rows with matching CAS revision; INSERT only on
// ON CONFLICT DO NOTHING semantics. Returns the bind/run interface
// writeSave expects.
function makeDb({ initialRows = [] as Array<{ character_id: number; save_revision: number }> } = {}) {
  const rows = new Map<number, { save_blob: any; save_data: string; updated_at: number; save_revision: number }>()
  for (const r of initialRows) {
    rows.set(r.character_id, { save_blob: null, save_data: '{}', updated_at: 0, save_revision: r.save_revision })
  }
  return {
    rows,
    DB: {
      prepare(sql: string) {
        const upper = sql.trim().toUpperCase()
        let bound: any[] = []
        return {
          bind(...args: any[]) { bound = args; return this },
          async run() {
            if (upper.startsWith('UPDATE SAVES')) {
              const [, , now, characterId, expectedRevision] = bound.slice(0, 5)
              const row = rows.get(characterId)
              if (row && row.save_revision === expectedRevision) {
                row.save_blob = bound[0]
                row.save_data = bound[1]
                row.updated_at = now
                row.save_revision += 1
                return { meta: { changes: 1 } }
              }
              return { meta: { changes: 0 } }
            }
            if (upper.startsWith('INSERT INTO SAVES')) {
              const [characterId, save_blob, save_data, now] = bound
              if (rows.has(characterId)) return { meta: { changes: 0 } }
              rows.set(characterId, { save_blob, save_data, updated_at: now, save_revision: 1 })
              return { meta: { changes: 1 } }
            }
            return { meta: { changes: 0 } }
          },
          async first() {
            if (upper.startsWith('SELECT SAVE_REVISION FROM SAVES')) {
              const [characterId] = bound
              const row = rows.get(characterId)
              return row ? { save_revision: row.save_revision } : null
            }
            return null
          },
        }
      },
      // writeSave batches the save-history snapshot ahead of the UPDATE, so it
      // always goes through batch() now. Run the statements in order, as D1
      // does, and hand back the per-statement results the caller indexes into.
      async batch(statements: any[]) {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        return results
      },
    },
  }
}

describe('writeSave requires save_revision', () => {
  it('throws SAVE_REVISION_REQUIRED when expectedRevision is undefined', async () => {
    const { DB } = makeDb()
    await expect(writeSave({ DB } as any, 42, {}, undefined as any))
      .rejects.toMatchObject({ code: 'SAVE_REVISION_REQUIRED', status: 400 })
  })

  it('throws SAVE_REVISION_REQUIRED when expectedRevision is null', async () => {
    const { DB } = makeDb()
    await expect(writeSave({ DB } as any, 42, {}, null as any))
      .rejects.toMatchObject({ code: 'SAVE_REVISION_REQUIRED' })
  })

  it('throws SAVE_REVISION_REQUIRED when expectedRevision is negative', async () => {
    const { DB } = makeDb()
    await expect(writeSave({ DB } as any, 42, {}, -1))
      .rejects.toMatchObject({ code: 'SAVE_REVISION_REQUIRED' })
  })

  it('inserts the first save when expectedRevision is 0 and no row exists', async () => {
    const { DB, rows } = makeDb()
    const result = await writeSave({ DB } as any, 42, { x: 1 }, 0)
    expect(result.saveRevision).toBe(1)
    expect(rows.get(42)?.save_revision).toBe(1)
  })

  it('updates the existing save via CAS', async () => {
    const { DB } = makeDb({ initialRows: [{ character_id: 42, save_revision: 3 }] })
    const result = await writeSave({ DB } as any, 42, { x: 1 }, 3)
    expect(result.saveRevision).toBe(4)
  })

  it('throws SAVE_REVISION_CONFLICT when expectedRevision is stale', async () => {
    const { DB } = makeDb({ initialRows: [{ character_id: 42, save_revision: 5 }] })
    await expect(writeSave({ DB } as any, 42, { x: 1 }, 3))
      .rejects.toMatchObject({ code: 'SAVE_REVISION_CONFLICT', status: 409 })
  })

  it('throws SAVE_REVISION_CONFLICT when expectedRevision is 0 but a row already exists', async () => {
    const { DB } = makeDb({ initialRows: [{ character_id: 42, save_revision: 1 }] })
    await expect(writeSave({ DB } as any, 42, { x: 1 }, 0))
      .rejects.toMatchObject({ code: 'SAVE_REVISION_CONFLICT' })
  })
})
