import { describe, it, expect } from 'vitest'
import { loadCharacterWithSave } from '../functions/_lib/game/save.js'

// Minimal env.DB stub: returns the character row from the LEFT JOIN with no
// save columns (the state of a character created via MCP create_character and
// never opened in the browser).
function envWithNoSave() {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            id: 7, owner_id: 1, is_ironman: 0, credits: 0,
            save_data: null, save_blob: null, updated_at: null, save_revision: null,
          }),
        }),
      }),
    },
  }
}

describe('loadCharacterWithSave — save-less character', () => {
  it('hands back the canonical fresh-character baseline instead of an empty {}', async () => {
    const { saveObject, saveRevision } = await loadCharacterWithSave(envWithNoSave() as any, 7, 1)
    // Was previously {} → every skill uninitialized → idle XP dropped on claim.
    expect(saveObject.stats.agility).toEqual({ skill: 'agility', xp: 0, level: 1 })
    expect(saveObject.stats.hitpoints).toEqual({ skill: 'hitpoints', xp: 1154, level: 10 })
    expect(saveObject.inventory[0]).toEqual({ itemId: 'bronze_dagger', quantity: 1 })
    // Revision 0 → the first writeSave takes the INSERT path and persists this
    // baseline plus whatever the action just earned.
    expect(saveRevision).toBe(0)
  })
})
