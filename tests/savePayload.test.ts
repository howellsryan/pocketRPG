import { describe, expect, it } from 'vitest'
import { buildSavePayloadFromState } from '../src/db/saveload.js'

describe('save payload combat stance', () => {
  globalThis.localStorage = { getItem: () => null } as any
  it('persists combatStance into settings', () => {
    const payload = buildSavePayloadFromState({ username: 'Tester' }, {}, [], {}, {}, null, null, {}, [], [], 'defensive')
    expect(payload.settings.combatStance).toBe('defensive')
  })
})
