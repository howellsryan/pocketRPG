import { describe, it, expect } from 'vitest'
import { writeAuditEventSafe } from '../functions/_lib/audit.js'

describe('audit helper', () => {
  it('does not throw on insert failure', async () => {
    const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('nope') } }) }) } }
    await expect(writeAuditEventSafe(env, { eventType: 'save_error', severity: 'warn' })).resolves.toBeUndefined()
  })
})
