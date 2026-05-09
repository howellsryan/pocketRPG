import { describe, it, expect } from 'vitest'
import { writeAuditEvent, writeAuditEventSafe } from '../functions/_lib/audit.js'

describe('audit helper', () => {
  it('does not throw on insert failure', async () => {
    const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('nope') } }) }) } }
    await expect(writeAuditEventSafe(env, { eventType: 'save_error', severity: 'warn', requestId: 'r', characterId: 1, status: 'failed', errorCode: 'x', message: 'm' })).resolves.toBeUndefined()
  })

  it('writes compact mandatory schema columns', async () => {
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
      requestId: 'req-1',
      characterId: 42,
      status: 'failed',
      errorCode: 'missing_bearer_token',
      message: 'Missing bearer token',
      createdAt: 123,
    })

    expect(capturedSql).toContain('event_type, severity, request_id, character_id, status, error_code, message, created_at')
    expect(capturedBindings).toEqual(['auth_failure', 'warn', 'req-1', 42, 'failed', 'missing_bearer_token', 'Missing bearer token', 123])
  })
})
