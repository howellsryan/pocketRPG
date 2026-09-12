// The action sprite foundation (src/utils/actionSprites.js): the timing law that
// makes an animation's speed the action's own cadence, the style→tool mapping
// (melee→sword, ranged→bow, magic→staff), and the event→swing mapping shared by
// the solo and co-op combat screens. Combat is the first consumer; the same
// arithmetic is what the skilling rollout will use, so these are the tests that
// stop a later change from quietly pinning a constant duration.
import { describe, expect, it } from 'vitest'
import {
  ACTION_TICK_MS,
  ACTION_SPRITES,
  WEAPON_ICON_TYPES,
  actionCycleMs,
  swingDurationMs,
  spriteStyleKey,
  actionSpriteFor,
  weaponIconTypeFor,
  isSmashWeaponType,
  isLungeWeaponType,
  playerCombatSprite,
  monsterCombatSprite,
  swingsFromCombatEvents,
  swingsFromCoopEvents,
  EAT_ANIM_MS,
  MONSTER_DEATH_ANIM_MS,
  combatStageTarget,
  combatStageDeathTransition,
  makeConsumeToken,
} from '../src/utils/actionSprites.js'
import gameIcons from '../src/data/gameIcons.json'
import realItemsData from '../src/data/items.json'

const itemsData: Record<string, any> = {
  rune_scimitar: { id: 'rune_scimitar', attackStyle: 'slash', attackSpeed: 4 },
  armadyl_godsword: { id: 'armadyl_godsword', attackStyle: 'slash', attackSpeed: 7 },
  magic_shortbow: { id: 'magic_shortbow', attackStyle: 'ranged', attackSpeed: 3 },
  ancient_staff: { id: 'ancient_staff', attackStyle: 'magic', attackSpeed: 5 },
  no_speed_dagger: { id: 'no_speed_dagger', attackStyle: 'stab' },
}

describe('actionCycleMs — the cadence is the tick speed', () => {
  it('is the action tick count times the game tick', () => {
    expect(actionCycleMs(4)).toBe(4 * ACTION_TICK_MS)
    expect(actionCycleMs(7)).toBe(7 * ACTION_TICK_MS)
  })

  it('floors at one tick for junk input rather than returning 0 (a 0ms animation never renders)', () => {
    expect(actionCycleMs(0)).toBe(ACTION_TICK_MS)
    expect(actionCycleMs(-3)).toBe(ACTION_TICK_MS)
    expect(actionCycleMs(undefined as any)).toBe(ACTION_TICK_MS)
    expect(actionCycleMs(NaN)).toBe(ACTION_TICK_MS)
  })

  it('accepts a caller tick length so a non-600ms cadence can drive it', () => {
    expect(actionCycleMs(3, 1000)).toBe(3000)
  })
})

describe('swingDurationMs', () => {
  it('scales with the cycle — a faster weapon animates faster', () => {
    const fast = swingDurationMs(actionCycleMs(3))
    const slow = swingDurationMs(actionCycleMs(6))
    expect(fast).toBeLessThan(slow)
  })

  it('always finishes inside its own cycle, at every shipped weapon speed', () => {
    for (let ticks = 1; ticks <= 12; ticks += 1) {
      const cycle = actionCycleMs(ticks)
      expect(swingDurationMs(cycle), `${ticks} ticks`).toBeLessThan(cycle)
    }
  })

  // The regression that made this module worth testing: a proportional duration
  // hit the cap at 3 ticks, so every weapon from a scimitar to a godsword
  // animated identically and the stage stopped saying anything about speed.
  it('is strictly monotonic across every shipped weapon and monster speed — no two cadences animate the same', () => {
    const durations = [2, 3, 4, 5, 6, 7, 8, 9].map((t) => swingDurationMs(actionCycleMs(t)))
    for (let i = 1; i < durations.length; i += 1) expect(durations[i]).toBeGreaterThan(durations[i - 1])
    expect(new Set(durations).size).toBe(durations.length)
  })

  it('keeps the clamps off the shipped range — they are safety rails, not the curve', () => {
    expect(swingDurationMs(actionCycleMs(2))).toBeGreaterThan(240)
    expect(swingDurationMs(actionCycleMs(9))).toBeLessThan(1000)
    expect(swingDurationMs(50)).toBe(240)
    expect(swingDurationMs(60_000)).toBe(1000)
  })
})

describe('style → sprite', () => {
  it('collapses the melee sub-styles onto the sword', () => {
    for (const style of ['stab', 'slash', 'crush', 'melee']) {
      expect(spriteStyleKey(style)).toBe('melee')
      expect(actionSpriteFor(style).tool).toBe('sword')
    }
  })

  it('shows a bow for ranged and a staff for magic', () => {
    expect(actionSpriteFor('ranged').tool).toBe('bow')
    expect(actionSpriteFor('magic').tool).toBe('staff')
  })

  it('falls back to melee for an unknown or missing style', () => {
    expect(actionSpriteFor(undefined).tool).toBe('sword')
    expect(actionSpriteFor('interpretive_dance' as any).tool).toBe('sword')
  })

  it('only names glyph keys that are actually vendored — a missing key renders nothing at all', () => {
    for (const sprite of Object.values(ACTION_SPRITES)) {
      expect(gameIcons, `tool ${sprite.tool}`).toHaveProperty(sprite.tool)
      if (sprite.projectile) expect(gameIcons, `projectile ${sprite.projectile}`).toHaveProperty(sprite.projectile)
    }
  })

  it('gives every ranged/magic sprite a projectile and melee none', () => {
    expect(ACTION_SPRITES.melee.projectile).toBeNull()
    expect(ACTION_SPRITES.ranged.projectile).toBeTruthy()
    expect(ACTION_SPRITES.magic.projectile).toBeTruthy()
  })
})

// weaponIconTypeFor picks which of CombatTool's ten hand-drawn shapes an
// equipped weapon draws as (InkwrightCombatStage.jsx) — the second attempt at
// "the weapon should look like the weapon", after embedding the actual
// bespoke inventory icon per item (reverted: no single anchor lands all 151
// of them correctly). One shape per TYPE this time, told apart only by tint.
describe('weaponIconTypeFor', () => {
  it('reads the shape straight off a name that says what it is', () => {
    expect(weaponIconTypeFor({ id: 'dragon_scimitar', attackStyle: 'slash' })).toBe('scimitar')
    expect(weaponIconTypeFor({ id: 'ghraxis_rapier', attackStyle: 'stab' })).toBe('rapier')
    expect(weaponIconTypeFor({ id: 'grondar_godsword', attackStyle: 'slash', twoHanded: true })).toBe('godsword')
    expect(weaponIconTypeFor({ id: 'ancient_maul', attackStyle: 'crush', twoHanded: true })).toBe('maul')
    expect(weaponIconTypeFor({ id: 'bronze_mace', attackStyle: 'crush' })).toBe('mace')
    expect(weaponIconTypeFor({ id: 'verin_s_flail', attackStyle: 'crush' })).toBe('mace')
    expect(weaponIconTypeFor({ id: 'dragon_warhammer', attackStyle: 'crush' })).toBe('mace')
    expect(weaponIconTypeFor({ id: 'ancestral_wand', attackStyle: 'magic' })).toBe('wand')
    expect(weaponIconTypeFor({ id: 'battlestaff', attackStyle: 'magic' })).toBe('staff')
    expect(weaponIconTypeFor({ id: 'longbow', attackStyle: 'ranged', ammoType: 'arrow' })).toBe('longbow')
    expect(weaponIconTypeFor({ id: 'shortbow', attackStyle: 'ranged', ammoType: 'arrow' })).toBe('shortbow')
    expect(weaponIconTypeFor({ id: 'dragon_dagger', attackStyle: 'slash' })).toBe('dagger')
    expect(weaponIconTypeFor({ id: 'adamant_crossbow', attackStyle: 'ranged', ammoType: 'bolt' })).toBe('crossbow')
  })

  it('checks crossbow before the bare bow pattern — a crossbow id also contains "bow"', () => {
    expect(weaponIconTypeFor({ id: 'zephyra_crossbow', attackStyle: 'ranged' })).toBe('crossbow')
  })

  it('does not misread "bowyers_knife" as a bow — the regression this pattern fixed', () => {
    // It is a knife, so it now lands on the dagger shape rather than merely
    // avoiding the bow one. The bare bow pattern's negative lookahead stays
    // as a second line of defence behind the dagger rule's ordering.
    expect(weaponIconTypeFor({ id: 'bowyers_knife', attackStyle: 'stab' })).toBe('dagger')
  })

  it('checks shortbow before the bare bow pattern — every shortbow id contains "bow"', () => {
    expect(weaponIconTypeFor({ id: 'thornspine_shortbow', attackStyle: 'ranged' })).toBe('shortbow')
    expect(weaponIconTypeFor({ id: 'magic_shortbow', attackStyle: 'ranged' })).toBe('shortbow')
  })

  it('falls back to the mechanical style when the name says nothing', () => {
    expect(weaponIconTypeFor({ id: 'zesta_longsword', attackStyle: 'slash' })).toBe('sword')
    expect(weaponIconTypeFor({ id: 'trident_of_venom', attackStyle: 'magic' })).toBe('staff')
    expect(weaponIconTypeFor({ id: 'colossal_ballista', attackStyle: 'ranged', ammoType: 'javelin' })).toBe('longbow')
    expect(weaponIconTypeFor({ id: 'torvek_s_hammers', attackStyle: 'crush' })).toBe('mace')
    expect(weaponIconTypeFor({ id: 'dravok_s_greataxe', attackStyle: 'crush', twoHanded: true })).toBe('maul')
    expect(weaponIconTypeFor({ id: 'scythe_of_vythar', attackStyle: 'slash', twoHanded: true })).toBe('godsword')
  })

  it('returns null for unarmed rather than guessing a shape', () => {
    expect(weaponIconTypeFor(null)).toBeNull()
    expect(weaponIconTypeFor(undefined)).toBeNull()
  })

  // Structural instead of a hand-maintained per-item mirror list (testing.md):
  // every weapon actually shipped must classify to a real shape, so a new
  // weapon with a name none of the rules recognise still gets SOMETHING
  // sane instead of silently falling through CombatTool to its own default.
  it('classifies every shipped weapon item to one of the ten known shapes', () => {
    const weapons = (Array.isArray(realItemsData) ? realItemsData : Object.values(realItemsData) as any[])
      .filter((i: any) => i.slot === 'weapon')
    expect(weapons.length).toBeGreaterThan(50)
    for (const w of weapons) {
      const type = weaponIconTypeFor(w)
      expect(WEAPON_ICON_TYPES, `${w.id} → ${type}`).toContain(type)
    }
  })
})

describe('isSmashWeaponType', () => {
  it('is true only for the two-handed smash weapons', () => {
    expect(isSmashWeaponType('godsword')).toBe(true)
    expect(isSmashWeaponType('maul')).toBe(true)
  })

  it('is false for every other shape, including unarmed (null)', () => {
    for (const type of WEAPON_ICON_TYPES.filter((t) => t !== 'godsword' && t !== 'maul')) {
      expect(isSmashWeaponType(type)).toBe(false)
    }
    expect(isSmashWeaponType(null as any)).toBe(false)
    expect(isSmashWeaponType(undefined as any)).toBe(false)
  })
})

describe('isLungeWeaponType', () => {
  it('is true only for the rapier', () => {
    expect(isLungeWeaponType('rapier')).toBe(true)
  })

  it('is false for every other shape, including unarmed (null)', () => {
    for (const type of WEAPON_ICON_TYPES.filter((t) => t !== 'rapier')) {
      expect(isLungeWeaponType(type)).toBe(false)
    }
    expect(isLungeWeaponType(null as any)).toBe(false)
    expect(isLungeWeaponType(undefined as any)).toBe(false)
  })

  it('never overlaps with the smash weapons — a swing is at most one variant', () => {
    for (const type of WEAPON_ICON_TYPES) {
      expect(isSmashWeaponType(type) && isLungeWeaponType(type)).toBe(false)
    }
  })
})

describe('playerCombatSprite', () => {
  it('reads the tool and the speed off the equipped weapon', () => {
    const scim = playerCombatSprite({ weapon: { itemId: 'rune_scimitar' } }, itemsData)
    expect(scim.tool).toBe('sword')
    expect(scim.speedTicks).toBe(4)
    expect(scim.cycleMs).toBe(2400)

    expect(playerCombatSprite({ weapon: { itemId: 'magic_shortbow' } }, itemsData).tool).toBe('bow')
    expect(playerCombatSprite({ weapon: { itemId: 'ancient_staff' } }, itemsData).tool).toBe('staff')
  })

  it('animates a 4-tick scimitar faster than a 7-tick godsword', () => {
    const scim = playerCombatSprite({ weapon: { itemId: 'rune_scimitar' } }, itemsData)
    const ags = playerCombatSprite({ weapon: { itemId: 'armadyl_godsword' } }, itemsData)
    expect(scim.swingMs).toBeLessThan(ags.swingMs)
  })

  // Rapid is the stance a player picks specifically to be faster; combat.js
  // shortens a ranged swing by a tick for it, so a stage that ignores the stance
  // animates it at Accurate's pace.
  it('takes a tick off a ranged swing on the Rapid stance', () => {
    const accurate = playerCombatSprite({ weapon: { itemId: 'magic_shortbow' } }, itemsData, { stance: 'accurate' })
    const rapid = playerCombatSprite({ weapon: { itemId: 'magic_shortbow' } }, itemsData, { stance: 'rapid' })
    expect(accurate.speedTicks).toBe(3)
    expect(rapid.speedTicks).toBe(2)
    expect(rapid.swingMs).toBeLessThan(accurate.swingMs)
  })

  it('does not apply Rapid to a melee or magic weapon — the engine does not either', () => {
    expect(playerCombatSprite({ weapon: { itemId: 'rune_scimitar' } }, itemsData, { stance: 'rapid' }).speedTicks).toBe(4)
    expect(playerCombatSprite({ weapon: { itemId: 'ancient_staff' } }, itemsData, { stance: 'rapid' }).speedTicks).toBe(5)
  })

  it('never lets a stance produce a zero-tick cycle', () => {
    expect(playerCombatSprite({ weapon: { itemId: 'one_tick_bow' } }, { one_tick_bow: { attackStyle: 'ranged', attackSpeed: 1 } }, { stance: 'rapid' }).speedTicks).toBe(1)
  })

  // The engine fights from `state.combatType`, which is NOT always the weapon's
  // style: an equipped staff with no spell selected resolves as melee
  // (`needsSpell ? 'melee' : weaponCombatType`).
  it('animates the style the fight actually resolves with, not the weapon\'s', () => {
    const staffNoSpell = playerCombatSprite({ weapon: { itemId: 'ancient_staff' } }, itemsData, { combatType: 'melee' })
    expect(staffNoSpell.tool).toBe('sword')
    // The cadence is still the staff's — only the style changed.
    expect(staffNoSpell.speedTicks).toBe(5)
  })

  it('falls back to the weapon when the combat state has no type yet', () => {
    expect(playerCombatSprite({ weapon: { itemId: 'ancient_staff' } }, itemsData, {}).tool).toBe('staff')
    expect(playerCombatSprite({ weapon: { itemId: 'ancient_staff' } }, itemsData).tool).toBe('staff')
  })

  it('applies Rapid off the resolved type, so a staff swinging melee is not shortened', () => {
    expect(playerCombatSprite({ weapon: { itemId: 'ancient_staff' } }, itemsData, { combatType: 'melee', stance: 'rapid' }).speedTicks).toBe(5)
    expect(playerCombatSprite({ weapon: { itemId: 'magic_shortbow' } }, itemsData, { combatType: 'ranged', stance: 'rapid' }).speedTicks).toBe(2)
  })

  it('falls back to the unarmed 4-tick sword rather than producing a zero-length animation', () => {
    for (const equip of [{}, null, undefined, { weapon: { itemId: 'no_speed_dagger' } }]) {
      const sprite = playerCombatSprite(equip as any, itemsData)
      expect(sprite.tool).toBe('sword')
      expect(sprite.speedTicks).toBe(4)
      expect(sprite.swingMs).toBeGreaterThan(0)
    }
  })

  it('carries the equipped weapon\'s shape and material tint onto the sprite', () => {
    const scim = playerCombatSprite({ weapon: { itemId: 'rune_scimitar' } }, itemsData)
    expect(scim.weaponIconType).toBe('scimitar')
    // No tier prefix on this fixture id → falls to the generic weapon tint.
    expect(scim.weaponTint).toBe('var(--color-parchment)')
  })

  it('resolves the real tier tint for a real tiered item id', () => {
    const dragonScim = playerCombatSprite(
      { weapon: { itemId: 'dragon_scimitar' } },
      { dragon_scimitar: { id: 'dragon_scimitar', attackStyle: 'slash', attackSpeed: 4 } },
    )
    expect(dragonScim.weaponIconType).toBe('scimitar')
    expect(dragonScim.weaponTint).toBe('var(--tier-dragon)')
  })

  it('gives unarmed no weapon shape and no tint to draw', () => {
    const unarmed = playerCombatSprite({}, itemsData)
    expect(unarmed.weaponIconType).toBeNull()
    expect(unarmed.weaponTint).toBeNull()
  })
})

describe('monsterCombatSprite', () => {
  it('reads a single-form monster straight off its record', () => {
    const sprite = monsterCombatSprite({ attackStyle: 'ranged', attackSpeed: 5 })
    expect(sprite.tool).toBe('bow')
    expect(sprite.speedTicks).toBe(5)
  })

  it('follows the CURRENT FORM of a multi-form boss, not its top-level style', () => {
    // Reading the top-level style is the bug CLAUDE.md §4 records for the world,
    // where it left a rotating boss permanently ranged.
    const boss = {
      attackStyle: 'ranged',
      attackSpeed: 4,
      multiForm: true,
      currentForm: 'melee_form',
      forms: {
        melee_form: { attackStyle: 'crush', attackSpeed: 6 },
        magic_form: { attackStyle: 'magic' },
      },
    }
    const melee = monsterCombatSprite(boss)
    expect(melee.tool).toBe('sword')
    expect(melee.speedTicks).toBe(6)

    // A form with no speed override inherits the boss's own.
    const magic = monsterCombatSprite({ ...boss, currentForm: 'magic_form' })
    expect(magic.tool).toBe('staff')
    expect(magic.speedTicks).toBe(4)
  })

  it('ignores forms while the boss is not multi-form', () => {
    const sprite = monsterCombatSprite({ attackStyle: 'magic', attackSpeed: 4, currentForm: 'x', forms: { x: { attackStyle: 'ranged' } } })
    expect(sprite.tool).toBe('staff')
  })

  it('has a defined answer for a missing monster', () => {
    const sprite = monsterCombatSprite(null)
    expect(sprite.tool).toBe('sword')
    expect(sprite.swingMs).toBeGreaterThan(0)
  })
})

describe('swingsFromCombatEvents', () => {
  it('animates a hit on both sides', () => {
    const { player, monster } = swingsFromCombatEvents([
      { type: 'playerHit', damage: 12 },
      { type: 'monsterHit', damage: 7 },
    ])
    expect(player?.hit).toBe(true)
    expect(monster?.hit).toBe(true)
  })

  it('still swings on a miss — the motion happened, only the damage is 0', () => {
    const { player, monster } = swingsFromCombatEvents([
      { type: 'playerHit', damage: 0 },
      { type: 'monsterMiss' },
    ])
    expect(player).not.toBeNull()
    expect(player?.hit).toBe(false)
    expect(monster).not.toBeNull()
    expect(monster?.hit).toBe(false)
  })

  it('treats a multi-hit special as ONE swing, not one per hit', () => {
    const { player } = swingsFromCombatEvents([{ type: 'specialHit', hits: [10, 0, 14] }])
    expect(player?.hit).toBe(true)
    // A single token means a single motion; the id is what the renderer keys on.
    expect(typeof player?.id).toBe('number')
  })

  it('counts dragonfire as a monster swing', () => {
    expect(swingsFromCombatEvents([{ type: 'dragonfireHit', damage: 40 }]).monster).not.toBeNull()
  })

  // With an anti-dragon shield combat.js emits dragonfireBlocked INSTEAD of
  // dragonfireHit and still resets the timer, so omitting it froze the dragon
  // for exactly the swings the player wore the shield to see stopped.
  it('still breathes when the shield blocks it', () => {
    const { monster } = swingsFromCombatEvents([{ type: 'dragonfireBlocked', damage: 0 }])
    expect(monster).not.toBeNull()
    expect(monster?.hit).toBe(false)
  })

  // combat.js emits immuneHit INSTEAD of playerHit against an immune form and
  // still resets the attack timer. Left out, a whole immune phase read as the
  // player standing there doing nothing.
  it('swings on a blocked hit against an immune form, without claiming it landed', () => {
    const { player } = swingsFromCombatEvents([{ type: 'immuneHit', immunity: 'magic', monsterName: 'Hellbound Gorilla' }])
    expect(player).not.toBeNull()
    expect(player?.hit).toBe(false)
  })

  // A boss and its adds swing through the same events, separated only by
  // `fromAdd` — and the stage follows whichever enemy the player is targeting.
  it('routes an incoming swing to the enemy the stage is actually showing', () => {
    const bossSwing = { type: 'monsterHit', damage: 20 }
    const addSwing = { type: 'monsterHit', damage: 6, fromAdd: true, addIndex: 0 }

    expect(swingsFromCombatEvents([bossSwing]).monster).not.toBeNull()
    expect(swingsFromCombatEvents([addSwing]).monster).toBeNull()
    expect(swingsFromCombatEvents([bossSwing], { showingAdd: true }).monster).toBeNull()
    expect(swingsFromCombatEvents([addSwing], { showingAdd: true }).monster).not.toBeNull()
  })

  it('keeps dragonfire on the boss, where it comes from', () => {
    expect(swingsFromCombatEvents([{ type: 'dragonfireHit', damage: 40 }], { showingAdd: true }).monster).toBeNull()
  })

  // The outgoing direction needs the same routing: a hit on the add is tagged
  // `toAdd`, and unfiltered it flashed the boss's emblem over an HP bar that
  // never moved.
  it('routes the player\'s own swing to the enemy the stage is showing', () => {
    const atBoss = { type: 'playerHit', damage: 15 }
    const atAdd = { type: 'playerHit', damage: 15, toAdd: true }

    expect(swingsFromCombatEvents([atBoss]).player).not.toBeNull()
    expect(swingsFromCombatEvents([atAdd]).player).toBeNull()
    expect(swingsFromCombatEvents([atBoss], { showingAdd: true }).player).toBeNull()
    expect(swingsFromCombatEvents([atAdd], { showingAdd: true }).player).not.toBeNull()
  })

  it('routes a special at the add the same way', () => {
    expect(swingsFromCombatEvents([{ type: 'specialHit', hits: [8, 8], toAdd: true }]).player).toBeNull()
    expect(swingsFromCombatEvents([{ type: 'specialHit', hits: [8, 8], toAdd: true }], { showingAdd: true }).player).not.toBeNull()
  })

  // immuneHit carries no routing flag, so dropping it on a flag it never had
  // would blank the tool for a whole immune phase while an add is selected.
  it('shows a blocked hit whichever enemy is on screen', () => {
    const immune = [{ type: 'immuneHit', immunity: 'magic', monsterName: 'Hellbound Gorilla' }]
    expect(swingsFromCombatEvents(immune).player).not.toBeNull()
    expect(swingsFromCombatEvents(immune, { showingAdd: true }).player).not.toBeNull()
  })

  it('animates each side independently when the player hits the add and the boss hits back', () => {
    const events = [
      { type: 'playerHit', damage: 9, toAdd: true },
      { type: 'monsterHit', damage: 30 },
    ]
    const onBoss = swingsFromCombatEvents(events)
    expect(onBoss.player).toBeNull()
    expect(onBoss.monster).not.toBeNull()

    const onAdd = swingsFromCombatEvents(events, { showingAdd: true })
    expect(onAdd.player).not.toBeNull()
    expect(onAdd.monster).toBeNull()
  })

  it('returns nothing on a tick with no attack in it', () => {
    expect(swingsFromCombatEvents([{ type: 'xp', skill: 'attack' }, { type: 'consumeAmmo' }, null])).toEqual({ player: null, monster: null })
    expect(swingsFromCombatEvents([])).toEqual({ player: null, monster: null })
    expect(swingsFromCombatEvents(undefined as any)).toEqual({ player: null, monster: null })
  })

  it('issues a fresh id per swing so a repeat swing replays instead of being ignored', () => {
    const a = swingsFromCombatEvents([{ type: 'playerHit', damage: 1 }]).player
    const b = swingsFromCombatEvents([{ type: 'playerHit', damage: 1 }]).player
    expect(a!.id).not.toBe(b!.id)
  })
})

describe('makeConsumeToken — the eat/drink gesture token', () => {
  it('issues a fresh id per call so a repeat gesture replays instead of being ignored', () => {
    const a = makeConsumeToken()
    const b = makeConsumeToken()
    expect(a.id).not.toBe(b.id)
  })

  it('has a positive, finite duration to hold the gesture\'s CSS animation', () => {
    expect(EAT_ANIM_MS).toBeGreaterThan(0)
    expect(Number.isFinite(EAT_ANIM_MS)).toBe(true)
  })
})

describe('swingsFromCoopEvents', () => {
  const events = [
    { type: 'playerHit', damage: 9, characterId: 1 },
    { type: 'playerHit', damage: 30, characterId: 2 },
    { type: 'monsterHit', damage: 12, characterId: 2, isTarget: true },
  ]

  it('animates only the viewer\'s own swing', () => {
    expect(swingsFromCoopEvents(events, 1).player).not.toBeNull()
    expect(swingsFromCoopEvents(events, 3).player).toBeNull()
  })

  it('only lunges the boss at the member it actually swung at', () => {
    // Member 1 sees their own attack but takes no incoming motion: the boss hit
    // member 2. Without the isTarget gate a full room lunges once per member.
    expect(swingsFromCoopEvents(events, 1).monster).toBeNull()
    expect(swingsFromCoopEvents(events, 2).monster).not.toBeNull()
  })

  it('ignores a boss swing tagged for this member but not aimed at them', () => {
    expect(swingsFromCoopEvents([{ type: 'monsterHit', damage: 5, characterId: 1 }], 1).monster).toBeNull()
  })

  // A room-wide attacker damages EVERY member while naming only one as its
  // target (coopBossEngine tags both flags for exactly this reason). Gated on
  // isTarget alone, everyone else watched their health drop with the boss
  // standing perfectly still.
  it('animates a room-wide swing for a member who is not the target', () => {
    const roomWide = [{ type: 'monsterHit', damage: 18, characterId: 1, isTarget: false, roomWide: true }]
    expect(swingsFromCoopEvents(roomWide, 1).monster).not.toBeNull()
  })

  it('matches string and numeric character ids', () => {
    expect(swingsFromCoopEvents([{ type: 'playerHit', damage: 4, characterId: '7' }], 7).player).not.toBeNull()
  })

  it('keeps an add\'s swing off the boss\'s mark, which is the one the room draws', () => {
    const addSwing = [{ type: 'monsterHit', damage: 6, characterId: 1, isTarget: true, fromAdd: true }]
    expect(swingsFromCoopEvents(addSwing, 1).monster).toBeNull()
    expect(swingsFromCoopEvents(addSwing, 1, { showingAdd: true }).monster).not.toBeNull()
  })

  it('routes the member\'s own swing by target too, exactly as solo does', () => {
    const atAdd = [{ type: 'playerHit', damage: 11, characterId: 1, toAdd: true }]
    expect(swingsFromCoopEvents(atAdd, 1).player).toBeNull()
    expect(swingsFromCoopEvents(atAdd, 1, { showingAdd: true }).player).not.toBeNull()
  })

  it('swings on an immune-blocked hit here too', () => {
    const { player } = swingsFromCoopEvents([{ type: 'immuneHit', immunity: 'magic', characterId: 1 }], 1)
    expect(player).not.toBeNull()
    expect(player?.hit).toBe(false)
  })
})


describe('combat stage target handoff', () => {
  const primary = { id: 'primary', name: 'Primary', hitpoints: 100, currentHP: 100 }
  const add = { id: 'add', instanceId: 'add#1', name: 'Add', hitpoints: 50, currentHP: 50 }

  it('holds the defeated primary for the death animation before showing the next live enemy', () => {
    const previous = { ...primary }
    const after: any = {
      active: true,
      monster: { ...primary, currentHP: 0 },
      encounter: { finite: true, primaryDefeated: true },
      adds: [{ ...add }],
      addTargetIndex: null,
    }

    const transition = combatStageDeathTransition(previous, after)
    expect(MONSTER_DEATH_ANIM_MS).toBe(900)
    expect(transition).toMatchObject({ monster: { id: 'primary', currentHP: 0 }, wasAdd: false })
    expect(combatStageTarget(after, transition)?.id).toBe('primary')
    expect(combatStageTarget(after)?.instanceId).toBe('add#1')
  })

  it('holds a defeated selected add, then follows the engine to the surviving target', () => {
    const selected = { ...add }
    const after: any = {
      active: true,
      monster: { ...primary },
      adds: [],
      addTargetIndex: null,
    }

    const transition = combatStageDeathTransition(selected, after)
    expect(transition).toMatchObject({ monster: { instanceId: 'add#1', currentHP: 0 }, wasAdd: true })
    expect(combatStageTarget(after, transition)?.instanceId).toBe('add#1')
    expect(combatStageTarget(after)?.id).toBe('primary')
  })

  it('does not invent a death transition for a manual target change or an ended fight', () => {
    const other = { id: 'other', instanceId: 'other#1', currentHP: 40, hitpoints: 40 }
    const manual: any = {
      active: true,
      monster: { ...primary },
      adds: [{ ...add }, other],
      addTargetIndex: 1,
    }
    expect(combatStageDeathTransition({ ...add }, manual)).toBeNull()

    const ended = { ...manual, active: false, adds: [], addTargetIndex: null }
    expect(combatStageDeathTransition({ ...add }, ended)).toBeNull()
  })
})
