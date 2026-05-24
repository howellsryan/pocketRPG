import { describe, it, expect, vi } from 'vitest'
import { auditLog } from '../functions/_lib/game/audit.js'

function makeDb() {
  const rows: any[] = []
  return {
    rows,
    DB: {
      prepare(_sql: string) {
        let bound: any[] = []
        return {
          bind(...args: any[]) { bound = args; return this },
          async run() { rows.push(bound); return { meta: { changes: 1 } } },
        }
      },
    },
  }
}

describe('auditLog', () => {
  it('writes a row to audit_events when given env, eventType, payload', async () => {
    const { DB, rows } = makeDb()
    await auditLog({ DB } as any, 'shop_purchase', { characterId: 7, identityId: 3, itemId: 'food' })
    expect(rows).toHaveLength(1)
    const [eventType, identityId, characterId, payloadJson, createdAt] = rows[0]
    expect(eventType).toBe('shop_purchase')
    expect(identityId).toBe(3)
    expect(characterId).toBe(7)
    expect(JSON.parse(payloadJson)).toMatchObject({ characterId: 7, identityId: 3, itemId: 'food' })
    expect(typeof createdAt).toBe('number')
  })

  it('falls back to console.log for legacy signature without env', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await auditLog('legacy_event' as any, { foo: 'bar' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('rethrows by default when the DB write fails', async () => {
    const DB = {
      prepare() {
        return {
          bind() { return this },
          async run() { throw new Error('d1 down') },
        }
      },
    }
    await expect(auditLog({ DB } as any, 'evt', {})).rejects.toThrow('d1 down')
  })

  it('swallows DB failures when { swallow: true }', async () => {
    const DB = {
      prepare() {
        return {
          bind() { return this },
          async run() { throw new Error('d1 down') },
        }
      },
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(auditLog({ DB } as any, 'evt', {}, { swallow: true })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('coerces missing identity / character to null in the row', async () => {
    const { DB, rows } = makeDb()
    await auditLog({ DB } as any, 'system_event', { foo: 'bar' })
    const [, identityId, characterId] = rows[0]
    expect(identityId).toBeNull()
    expect(characterId).toBeNull()
  })
})
