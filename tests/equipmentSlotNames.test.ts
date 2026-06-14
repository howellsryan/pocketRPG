import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Regression guard for the "can't view the Equipment screen" bug.
//
// EquipmentScreen renders `EQ_SLOT_NAMES[selected.slot]` in the unequip modal.
// That identifier lives in EquipmentPaperdoll. The single-file build flattens
// every module into one shared global scope, so the reference *happened* to
// resolve there even without an import — but every module-based build (Vite
// dev server, `vite build` dist) threw `ReferenceError: EQ_SLOT_NAMES is not
// defined` the moment a player tapped an equipped item, white-screening the
// Equipment screen. Require an explicit import so the binding exists in both
// build modes.
const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8')

describe('Equipment slot-name binding', () => {
  it('EquipmentPaperdoll exports EQ_SLOT_NAMES', () => {
    expect(read('src/components/EquipmentPaperdoll.jsx')).toMatch(
      /export\s+const\s+EQ_SLOT_NAMES\b/
    )
  })

  it('EquipmentScreen imports EQ_SLOT_NAMES wherever it references it', () => {
    const src = read('src/screens/EquipmentScreen.jsx')
    if (/\bEQ_SLOT_NAMES\b/.test(src)) {
      const importsIt =
        /import[^;]*\bEQ_SLOT_NAMES\b[^;]*from\s+['"][^'"]*EquipmentPaperdoll[^'"]*['"]/.test(src)
      expect(importsIt).toBe(true)
    }
  })
})
