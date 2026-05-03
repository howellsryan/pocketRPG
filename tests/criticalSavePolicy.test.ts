import { describe, expect, it } from 'vitest'
import { CRITICAL_SAVE_REASONS, normaliseCriticalSaveReason } from '../src/cloud/criticalSavePolicy.js'

describe('critical save reasons', () => {
  it('normalises slayer task change reason', () => {
    expect(normaliseCriticalSaveReason(CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)).toBe('slayer_task_change')
  })
})
