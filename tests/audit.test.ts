import { describe, it, expect } from 'vitest'
import { writeAuditEvent, writeAuditEventSafe } from '../functions/_lib/audit.js'

describe('audit helper', () => {
  it('does not throw on insert failure', async () => {
    const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('nope') } }) }) } }
    await expect(writeAuditEventSafe(env, { eventType: 'save_error', severity: 'warn' })).resolves.toBeUndefined()
  })

  it('only includes populated columns and sanitizes metadata', async () => {
    let capturedSql = ''
    let capturedBindings: unknown[] = []
    const env = {
      DB: {
        prepare: (sql: string) => {
          capturedSql = sql
          return {
            bind: (...args: unknown[]) => {
              capturedBindings = args
              return { run: async () => ({ ok: true }) }
            },
          }
        },
      },
    }

    await writeAuditEvent(env as never, {
      eventType: 'auth_failure',
      severity: 'warn',
      characterId: 42,
      metadata: { token: 'abc', reason: 'invalid_token' },
      createdAt: 123,
    })

    expect(capturedSql).toContain('character_id')
    expect(capturedSql).not.toContain('related_character_id')
    expect(capturedBindings).toContain(42)
    expect(JSON.stringify(capturedBindings)).not.toContain('abc')
    expect(JSON.stringify(capturedBindings)).toContain('[redacted]')
  })
})
