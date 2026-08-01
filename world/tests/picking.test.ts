import { describe, expect, it } from 'vitest'
import { buildMenu, defaultInteract, hoverText, topPick, type Pickable } from '../client/src/picking'

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
const otherPlayer: Pickable = { kind: 'player', id: '2', name: 'WorldFriend', actions: [], monsterLevel: 42 }

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
  it('shows another player’s combat level beside their name, coloured by comparison', () => {
    expect(buildMenu([otherPlayer], 42)[0]).toMatchObject({ monsterLevel: 42, levelFavourable: true, targetName: 'WorldFriend' })
    expect(buildMenu([otherPlayer], 41)[0].levelFavourable).toBe(false)
  })
  it('leaves the Follow row levelless when the server sent no combat level', () => {
    const row = buildMenu([{ ...otherPlayer, monsterLevel: undefined }], 42)[0]
    expect(row.monsterLevel).toBeUndefined()
    expect(row.levelFavourable).toBeUndefined()
  })
})

describe('attacking a player (the Wilderness)', () => {
  const player = (over: Partial<Pickable> = {}): Pickable => ({
    kind: 'player', id: 'p2', name: 'Rival', actions: [], monsterLevel: 80, ...over,
  })
  const attackable = () => player({ actions: [{ label: 'Attack', action: 'attack' }] })

  it('makes an attackable player the left-click default', () => {
    // Regression: players had no hover priority and no actions, so a left click
    // walked straight through them and Attack was right-click only.
    const pick = topPick([attackable()])
    expect(pick?.id).toBe('p2')
    expect(defaultInteract(pick!)).toEqual({ kind: 'player', id: 'p2', action: 'attack' })
  })

  it('leaves a player you cannot attack out of the left-click entirely', () => {
    // Someone in the safe camp or outside the bracket must not swallow a walk.
    expect(topPick([player()])).toBeNull()
  })

  it('reads the hover line as an attack with their combat level', () => {
    expect(hoverText([attackable()])).toBe('Attack Rival (level-80)')
  })

  it('still walks when only an un-attackable player is under the cursor', () => {
    expect(hoverText([player()])).toBe('Walk here')
  })

  it('offers Attack above Follow in the menu, from the same action', () => {
    const rows = buildMenu([attackable()], 80)
    expect(rows[0].text).toBe('Attack Rival')
    expect(rows[0].interact).toEqual({ kind: 'player', id: 'p2', action: 'attack' })
    expect(rows[1].text).toBe('Follow Rival')
  })

  it('offers Follow alone when the attack is not on the table', () => {
    const rows = buildMenu([player()], 80)
    expect(rows.filter((r) => r.text.startsWith('Attack'))).toHaveLength(0)
    expect(rows[0].text).toBe('Follow Rival')
  })

  it('never offers Follow on a bot — there is nobody behind it', () => {
    const rows = buildMenu([player({ bot: true, actions: [{ label: 'Attack', action: 'attack' }] })], 80)
    expect(rows.filter((r) => r.text.startsWith('Follow'))).toHaveLength(0)
    expect(rows[0].text).toBe('Attack Rival')
  })

  it('lets loot still outrank a player under the same cursor', () => {
    const loot: Pickable = { kind: 'loot', id: 'l1', name: 'Coins', actions: [{ label: 'Take', action: 'take' }] }
    expect(topPick([attackable(), loot])?.id).toBe('l1')
  })
})
