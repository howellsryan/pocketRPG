import { describe, expect, it } from 'vitest'
import monsters from '../src/data/monsters.json'
import { MONSTER_ICONS } from '../src/utils/monsterIcons.js'

const monstersData = monsters as Record<string, unknown>

describe('monsterIcons', () => {
  it('every MONSTER_ICONS key is a real monsters.json id', () => {
    const unknown = Object.keys(MONSTER_ICONS).filter((id) => !monstersData[id])
    expect(unknown, `monsterIcons keys not in monsters.json: ${unknown.join(', ')}`).toEqual([])
  })
})
