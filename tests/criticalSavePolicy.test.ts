import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { CRITICAL_SAVE_REASONS, normaliseCriticalSaveReason } from '../src/cloud/criticalSavePolicy.js'

describe('critical save reasons', () => {
  it('normalises slayer task change reason', () => {
    expect(normaliseCriticalSaveReason(CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)).toBe('slayer_task_change')
  })
})

// Regression guard for the last per-kill /api/save amplifier (see #624 / #640
// for the earlier rounds). An on-task slayer kill decrementing the remaining
// count is routine progress that rides the 120s combat heartbeat — firing a
// SLAYER_TASK_CHANGE critical save per kill turned every slayer grind into a
// full cloud save every few seconds, which dominated daily D1 write volume.
// Slayer task CHANGES (assign / skip / block) are initiated from SlayerScreen,
// so the combat kill handler must never emit that reason.
describe('per-kill save amplification', () => {
  it('CombatScreen does not fire a SLAYER_TASK_CHANGE critical save on kills', () => {
    const src = readFileSync(resolve(__dirname, '..', 'src/screens/CombatScreen.jsx'), 'utf8')
    expect(src).not.toMatch(/SLAYER_TASK_CHANGE/)
  })
})
