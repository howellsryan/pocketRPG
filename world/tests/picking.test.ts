import { describe, expect, it } from 'vitest'
import { buildMenu, hoverText, topPick, type Pickable } from '../client/src/picking'

const rock: Pickable = { kind: 'rock', id: 'rock_tin_1', name: 'Tin Rock', actions: [{ label: 'Mine', action: 'mine' }], examine: 'Tin ore, ripe for the picking.' }
const chest: Pickable = { kind: 'object', id: 'chest_1', name: 'Bank Chest', actions: [{ label: 'Deposit', action: 'deposit' }] }
const bull: Pickable = { kind: 'npc', id: 'bull_1', name: 'Pasture Bull', actions: [{ label: 'Attack', action: 'attack' }], monsterLevel: 8, examine: 'A hefty highland bull.' }
const lootPile: Pickable = {
  kind: 'loot', id: 'tile@5,6', name: 'Cowhide', examine: 'A pile of dropped items.',
  actions: [
    { label: 'Take', name: 'Cowhide', action: 'take', id: 'loot_3' },
    { label: 'Take', name: 'Bones', action: 'take', id: 'loot_1' },
  ],
}
// Other players are menu-only (item 10): no actions, so topPick/hoverText
// never select them — see the 'players are never a default action' tests.
const otherPlayer: Pickable = { kind: 'player', id: '2', name: 'WorldFriend', actions: [] }

describe('topPick', () => {
  it('prefers loot over npc over rock/object', () => {
    expect(topPick([rock, bull, lootPile])?.kind).toBe('loot')
    expect(topPick([rock, bull])?.kind).toBe('npc')
    expect(topPick([rock, chest])?.kind).toBe('rock')
  })
  it('returns null with nothing pickable', () => {
    expect(topPick([])).toBeNull()
  })
  it('breaks priority ties by caller order (near-to-far)', () => {
    const a = { ...rock, id: 'a' }
    const b = { ...rock, id: 'b' }
    expect(topPick([a, b])?.id).toBe('a')
  })
  it('never picks a player as the default action, even alone under the cursor', () => {
    expect(topPick([otherPlayer])).toBeNull()
    expect(topPick([otherPlayer, rock])?.kind).toBe('rock')
  })
})

describe('hoverText', () => {
  it('formats default action + name, with level for npcs', () => {
    expect(hoverText([bull])).toBe('Attack Pasture Bull (level-8)')
    expect(hoverText([rock])).toBe('Mine Tin Rock')
  })
  it('uses the top pick when several overlap', () => {
    expect(hoverText([rock, bull])).toBe('Attack Pasture Bull (level-8)')
  })
  it('falls back to Walk here on empty ground', () => {
    expect(hoverText([])).toBe('Walk here')
  })
  it('falls back to Walk here over a player (no default action)', () => {
    expect(hoverText([otherPlayer])).toBe('Walk here')
  })
})

describe('buildMenu', () => {
  it('lists every action near-to-far, then Walk here, then Cancel', () => {
    const rows = buildMenu([bull, rock], 15)
    expect(rows.map((r) => r.text)).toEqual([
      'Attack Pasture Bull',
      'Examine Pasture Bull',
      'Mine Tin Rock',
      'Examine Tin Rock',
      'Walk here',
      'Cancel',
    ])
  })
  it('carries interact dispatch and per-item loot ids + names', () => {
    const rows = buildMenu([lootPile], 15)
    expect(rows[0].text).toBe('Take Cowhide')
    expect(rows[0].interact).toEqual({ kind: 'loot', id: 'loot_3', action: 'take' })
    expect(rows[1].text).toBe('Take Bones')
    expect(rows[1].interact).toEqual({ kind: 'loot', id: 'loot_1', action: 'take' })
  })
  it('marks Examine rows local with their flavour text', () => {
    const rows = buildMenu([bull], 15)
    const examine = rows.find((r) => r.local === 'examine')
    expect(examine?.examineText).toBe('A hefty highland bull.')
  })
  it('flags level favourability from the player combat level', () => {
    expect(buildMenu([bull], 8)[0].levelFavourable).toBe(true)
    expect(buildMenu([bull], 7)[0].levelFavourable).toBe(false)
  })
  it('always ends with Walk here then Cancel even with no pickables', () => {
    expect(buildMenu([], 3).map((r) => r.local)).toEqual(['walk', 'cancel'])
  })
  it('gives a player pickable a Follow row that carries followTargetId, not interact', () => {
    const rows = buildMenu([otherPlayer], 15)
    expect(rows[0]).toMatchObject({ text: 'Follow WorldFriend', followTargetId: '2' })
    expect(rows[0].interact).toBeUndefined()
    expect(rows.map((r) => r.text)).toEqual(['Follow WorldFriend', 'Walk here', 'Cancel'])
  })
})
