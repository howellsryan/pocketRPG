// Everyone past the 10% line rolls the drop table for themselves, and the pile
// they get is theirs alone until the owner window lapses.
import { describe, expect, it } from 'vitest'
import { isOnTaskFor, rollLootForCredited } from '../server/killLoot'
import { LOOT_OWNER_TICKS, isVisibleTo, spawnDrops, visibleLootFor } from '../server/loot'

const MONSTER = 'green_dragon'
const view = (charId: string) => ({ charId, isIronman: false, isGrindman: false })

describe('rolling a world kill for everyone who earned it', () => {
  // The killer's roll rode the death event and is already on the floor. Rolling
  // it again here would double every drop the killer gets.
  it('never rolls again for the owner', () => {
    const rolls = rollLootForCredited(
      MONSTER,
      [{ charId: 'a', slayerTask: null }, { charId: 'b', slayerTask: null }],
      'a',
      () => [{ itemId: 'bones', quantity: 1 }],
    )
    expect(rolls.map((r) => r.charId)).toEqual(['b'])
  })

  it('rolls once for each other credited player', () => {
    const rolls = rollLootForCredited(
      MONSTER,
      [{ charId: 'a', slayerTask: null }, { charId: 'b', slayerTask: null }, { charId: 'c', slayerTask: null }],
      'a',
      () => [{ itemId: 'bones', quantity: 1 }],
    )
    expect(rolls.map((r) => r.charId)).toEqual(['b', 'c'])
  })

  it('rolls independently, so two players do not get the same drop', () => {
    const tables = [[{ itemId: 'dragon_visage', quantity: 1 }], [{ itemId: 'bones', quantity: 1 }]]
    let n = 0
    const rolls = rollLootForCredited(
      MONSTER,
      [{ charId: 'b', slayerTask: null }, { charId: 'c', slayerTask: null }],
      'a',
      () => tables[n++]!,
    )
    expect(rolls[0].loot[0].itemId).toBe('dragon_visage')
    expect(rolls[1].loot[0].itemId).toBe('bones')
  })

  // The reason this is N rolls rather than one roll copied N times: a task-only
  // drop must not roll for someone who does not have the monster assigned.
  it('passes each player their OWN on-task flag, never the killer\'s', () => {
    const seen: boolean[] = []
    rollLootForCredited(
      MONSTER,
      [
        { charId: 'onTask', slayerTask: { monsterId: MONSTER } },
        { charId: 'offTask', slayerTask: { monsterId: 'blue_dragon' } },
        { charId: 'noTask', slayerTask: null },
      ],
      'killer',
      (_m, isOnTask) => { seen.push(isOnTask); return [{ itemId: 'bones', quantity: 1 }] },
    )
    expect(seen).toEqual([true, false, false])
  })

  // Grindman is an account type, not a property of the fight — the killer's roll
  // reads it off their own combat state, so a helper's must read off theirs, or
  // a Grindman past the line silently rolls at ordinary rates.
  it('passes each player their OWN Grindman flag', () => {
    const seen: boolean[] = []
    rollLootForCredited(
      MONSTER,
      [
        { charId: 'grindman', slayerTask: null, isGrindman: true },
        { charId: 'ordinary', slayerTask: null, isGrindman: false },
        { charId: 'unstamped', slayerTask: null },
      ],
      'killer',
      (_m, _t, grindman) => { seen.push(grindman); return [{ itemId: 'bones', quantity: 1 }] },
    )
    expect(seen).toEqual([true, false, false])
  })

  it('drops a player who rolled nothing rather than spawning an empty pile', () => {
    const rolls = rollLootForCredited(MONSTER, [{ charId: 'b', slayerTask: null }], 'a', () => [])
    expect(rolls).toEqual([])
  })

  it('ignores a monster that is not in the table', () => {
    expect(rollLootForCredited('not_a_monster', [{ charId: 'b', slayerTask: null }], 'a')).toEqual([])
  })

  it('matches a task by the monster it names', () => {
    expect(isOnTaskFor({ monsterId: MONSTER }, MONSTER)).toBe(true)
    expect(isOnTaskFor({ monsterId: 'blue_dragon' }, MONSTER)).toBe(false)
    expect(isOnTaskFor(null, MONSTER)).toBe(false)
  })
})

describe('two piles on one tile', () => {
  /** What the floor looks like after a shared kill: a pile each, same tile. */
  function sharedKill() {
    return [
      ...spawnDrops([{ itemId: 'dragon_visage', quantity: 1 }], 10, 10, 'a', 0),
      ...spawnDrops([{ itemId: 'bones', quantity: 1 }], 10, 10, 'b', 0),
    ]
  }

  it('shows each player only their own during the owner window', () => {
    const floor = sharedKill()
    const forA = visibleLootFor(floor, view('a'), 1)
    const forB = visibleLootFor(floor, view('b'), 1)

    expect(forA.map((l) => l.itemId)).toEqual(['dragon_visage'])
    expect(forB.map((l) => l.itemId)).toEqual(['bones'])
    // Same tile — the piles are stacked, not spread out.
    expect(forA[0].x).toBe(forB[0].x)
    expect(forA[0].z).toBe(forB[0].z)
  })

  it('hides a stranger from both of them', () => {
    const floor = sharedKill()
    expect(visibleLootFor(floor, view('stranger'), 1)).toEqual([])
  })

  it('opens both piles to everyone once the window lapses', () => {
    const floor = sharedKill()
    const late = LOOT_OWNER_TICKS + 1
    expect(visibleLootFor(floor, view('stranger'), late).map((l) => l.itemId).sort())
      .toEqual(['bones', 'dragon_visage'])
    for (const pile of floor) expect(isVisibleTo(pile, view('a'), late)).toBe(true)
  })

  // An Ironman's own pile is theirs; a public window never opens for them.
  it('never shows an Ironman the other player\'s pile, even after the window', () => {
    const floor = sharedKill()
    const iron = { charId: 'a', isIronman: true, isGrindman: false }
    expect(visibleLootFor(floor, iron, LOOT_OWNER_TICKS + 1).map((l) => l.itemId))
      .toEqual(['dragon_visage'])
  })
})
