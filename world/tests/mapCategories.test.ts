import { describe, expect, it } from 'vitest'
import { CATEGORY_ICON_KEY, STATIC_CATEGORY } from '../shared/mapCategories'

describe('mapCategories', () => {
  it('gives every static category an icon key (shared by the world map and minimap)', () => {
    for (const category of new Set(Object.values(STATIC_CATEGORY))) {
      expect(CATEGORY_ICON_KEY[category]).toBeTruthy()
    }
  })
})
