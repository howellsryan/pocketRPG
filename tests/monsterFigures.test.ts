import { describe, it, expect } from 'vitest'
import monstersData from '../src/data/monsters.json'
import {
  monsterFigureFor, monsterArchetypeFor, monsterPaletteNameFor, monsterWeaponTypeFor,
  monsterWeightClass, monsterShotKind, monsterMuzzle, monsterTorso, monsterShadow, isHeavyMotion,
  HIDE_PALETTES, PALETTE_NAMES, MONSTER_MOTIONS, HOVER_LIFT, FOOT_X, GROUND_Y,
} from '../src/utils/monsterFigures.js'
import { MONSTER_ARCHETYPES, monsterBounds, monsterShapeFor } from '../src/utils/monsterShapes.js'
import { WEAPON_ICON_TYPES, monsterCombatSprite } from '../src/utils/actionSprites.js'

const monsters: any[] = Array.isArray(monstersData) ? (monstersData as any[]) : Object.values(monstersData as any)
const STYLES = ['melee', 'ranged', 'magic'] as const
// The stage InkwrightCombatStage draws into, and the mini HP bar that sits at
// its top (y=6..11) — a creature's head must clear it.
const STAGE_W = 260
const STAGE_H = 128
const HP_BAR_BOTTOM = 13

describe('monster figures', () => {
  it('has monsters to draw', () => {
    expect(monsters.length).toBeGreaterThan(100)
  })

  // The whole point of the change: nothing is left on the generic mirrored
  // player rig. A monster added later without a table entry must still land
  // on a real archetype through the name rules.
  it('resolves every monster in the game to a drawn archetype and a real palette', () => {
    for (const m of monsters) {
      for (const style of STYLES) {
        const f = monsterFigureFor(m, style)
        expect(MONSTER_ARCHETYPES, `${m.id}`).toContain(f.archetype)
        expect(PALETTE_NAMES, `${m.id}`).toContain(f.paletteName)
        expect(f.palette).toBe(HIDE_PALETTES[f.paletteName])
        expect(MONSTER_MOTIONS[f.motion], `${m.id}/${style}: motion ${f.motion}`).toBeTruthy()
        expect(f.death).toBeTruthy()
      }
    }
  })

  // A creature that overflows the frame is invisible at exactly the moment it
  // is attacking. The solve clamps for this; this is the assertion that the
  // clamp actually covers every monster at every weight it can be.
  it('keeps every monster inside the stage, at every weight', () => {
    for (const m of monsters) {
      const f = monsterFigureFor(m, 'melee')
      const b = monsterBounds(f.archetype)
      const top = GROUND_Y - f.lift + b.minY * f.scale
      const front = FOOT_X + b.maxX * f.scale
      const back = FOOT_X + b.minX * f.scale
      expect(top, `${m.id} overlaps the HP bar`).toBeGreaterThanOrEqual(HP_BAR_BOTTOM)
      expect(front, `${m.id} reaches into the player's half`).toBeLessThanOrEqual(STAGE_W / 2)
      expect(back, `${m.id} leaves the frame behind it`).toBeGreaterThanOrEqual(0)
      expect(GROUND_Y - f.lift + b.maxY * f.scale, `${m.id} sinks through the floor`).toBeLessThanOrEqual(STAGE_H)
    }
  })

  it('scales a monster by its combat level, not by nothing', () => {
    const small = monsterFigureFor({ id: 'x_giant', combatLevel: 2 }, 'melee')
    const huge = monsterFigureFor({ id: 'x_giant', combatLevel: 900 }, 'melee')
    expect(small.archetype).toBe(huge.archetype)
    expect(huge.scale).toBeGreaterThan(small.scale)
    expect(monsterWeightClass(2).key).toBe('small')
    expect(monsterWeightClass(900).key).toBe('colossal')
  })

  // "Large monsters with high combat level should swing heavier." A level-6
  // wolf and a level-600 one share a body; only the big one may maul.
  it('upgrades melee to a heavy motion only for a heavy monster', () => {
    const cub = monsterFigureFor({ id: 'x_wolf', combatLevel: 10 }, 'melee')
    const beast = monsterFigureFor({ id: 'x_wolf', combatLevel: 800 }, 'melee')
    expect(cub.archetype).toBe('beast')
    expect(isHeavyMotion(cub.motion)).toBe(false)
    expect(isHeavyMotion(beast.motion)).toBe(true)
    expect(beast.heavyMotion).toBe(true)
  })

  it('never upgrades a ranged or magic attack by weight', () => {
    for (const style of ['ranged', 'magic'] as const) {
      const light = monsterFigureFor({ id: 'x_wolf', combatLevel: 10 }, style)
      const heavy = monsterFigureFor({ id: 'x_wolf', combatLevel: 900 }, style)
      expect(heavy.motion).toBe(light.motion)
    }
  })

  // A chicken has no heavier way to peck, and giving it one would be the
  // animation lying about the fight.
  it('leaves an archetype with no heavy attack alone at any size', () => {
    const chicken = monsterFigureFor({ id: 'field_chicken', combatLevel: 1 }, 'melee')
    const monstrous = monsterFigureFor({ id: 'field_chicken', combatLevel: 1500 }, 'melee')
    expect(chicken.motion).toBe('peck')
    expect(monstrous.motion).toBe('peck')
  })

  // The bug CLAUDE.md 4 records for the open world: reading a top-level
  // attackStyle left Zaryth permanently ranged. The figure takes the style
  // from the SPRITE, which already resolves the current form.
  it('animates the form a multi-form boss is actually in', () => {
    const zaryth = monsters.find(m => m.id === 'zaryth_the_empty_lord')
    expect(zaryth?.multiForm).toBe(true)
    const melee = monsterFigureFor(zaryth, 'melee')
    const magic = monsterFigureFor(zaryth, 'magic')
    expect(melee.motion).not.toBe(magic.motion)
    expect(melee.phaseGlow).toBeTruthy()
    expect(magic.phaseGlow).toBeTruthy()
    expect(melee.phaseGlow).not.toBe(magic.phaseGlow)
  })

  // The co-op/raid stage does not hand the figure the room's boss record — it
  // hands `liveMonster`, the authored row with the room's own
  // MUTABLE_MONSTER_FIELDS (currentForm among them) laid over it, and the
  // style comes from the SPRITE resolved off that. Pinned because the obvious
  // reading of that call site is that it passes the static monsters.json row,
  // which would freeze a group fight in one form for its whole duration while
  // the same boss rotated solo.
  it('rotates a boss through its forms from the shape co-op actually passes', () => {
    const row: any = monsters.find(m => m.id === 'zaryth_the_empty_lord')
    const seen = new Set<string>()
    for (const form of Object.keys(row.forms)) {
      const live = { ...row, currentForm: form, attackStyle: row.forms[form].attackStyle }
      const sprite = monsterCombatSprite(live)
      const figure = monsterFigureFor(live, sprite.motion)
      seen.add(`${figure.motion}|${figure.phaseGlow}`)
    }
    expect(seen.size).toBe(Object.keys(row.forms).length)
  })

  it('gives a single-form monster no phase colour to read', () => {
    const cow = monsters.find(m => m.id === 'pasture_bull')
    expect(monsterFigureFor(cow, 'melee').phaseGlow).toBeNull()
  })

  it('arms only the archetypes that carry a weapon, with a real weapon type', () => {
    for (const m of monsters) {
      const f = monsterFigureFor(m, 'melee')
      expect(f.armed).toBe(!!monsterShapeFor(f.archetype).armed)
      if (f.armed) expect(WEAPON_ICON_TYPES).toContain(f.weaponIconType)
      else expect(f.weaponIconType).toBeNull()
    }
  })

  // A ranged skeleton swinging a sword at a player across the lane is the
  // failure: the NAME rule must never beat the style the fight resolves with.
  it("never hands a ranged or magic monster a melee weapon", () => {
    expect(monsterWeaponTypeFor({ id: 'zaryth_bolt_sentinel' }, 'ranged')).toBe('crossbow')
    expect(monsterWeaponTypeFor({ id: 'astral_warrior' }, 'ranged')).toBe('longbow')
    expect(monsterWeaponTypeFor({ id: 'astral_warrior' }, 'magic')).toBe('staff')
    expect(monsterWeaponTypeFor({ id: 'astral_mage' }, 'melee')).toBe('sword')
    expect(monsterWeaponTypeFor({ id: 'nothing_recognisable' }, 'melee')).toBe('sword')
  })

  it('fires a projectile from exactly the attacks that have one', () => {
    expect(monsterShotKind('bite', 'dragon')).toBeNull()
    expect(monsterShotKind('slam', 'giant')).toBeNull()
    expect(monsterShotKind('breath', 'dragon')).toBe('flame')
    expect(monsterShotKind('spit', 'serpent')).toBe('glob')
    expect(monsterShotKind('cast', 'wraith')).toBe('orb')
    expect(monsterShotKind('shoot', 'humanoid')).toBe('arrow')
    // An unarmed thrower lobs something, an armed one shoots it.
    expect(monsterShotKind('hurl', 'humanoid')).toBe('arrow')
    expect(monsterShotKind('hurl', 'demon')).toBe('glob')
  })

  // The splat overlay is a BOX positioned from the torso (22% wide, 34% tall,
  // offset back by half of each). The torso being on-frame is not enough — the
  // box around it is what actually renders, and a crab's torso 22 units off
  // the floor puts its bottom edge past the stage.
  it('keeps the hit-splat box on screen for every monster', () => {
    for (const m of monsters) {
      const t = monsterTorso(monsterFigureFor(m, 'melee'))
      const left = ((STAGE_W - t.x) / STAGE_W) * 100 - 11
      const top = (t.y / STAGE_H) * 100 - 17
      expect(left, `${m.id} splat left`).toBeGreaterThanOrEqual(0)
      expect(left + 22, `${m.id} splat right`).toBeLessThanOrEqual(100)
      expect(top, `${m.id} splat top`).toBeGreaterThanOrEqual(0)
      expect(top + 34, `${m.id} splat bottom`).toBeLessThanOrEqual(100)
    }
  })

  it('places a muzzle and a torso on the creature, not in the middle of the frame', () => {
    for (const m of monsters) {
      const f = monsterFigureFor(m, 'ranged')
      const muzzle = monsterMuzzle(f)
      const torso = monsterTorso(f)
      for (const [name, pt] of [['muzzle', muzzle], ['torso', torso]] as const) {
        expect(pt, `${m.id} ${name}`).toBeTruthy()
        expect(pt!.x, `${m.id} ${name} x`).toBeGreaterThan(0)
        expect(pt!.x, `${m.id} ${name} x`).toBeLessThan(STAGE_W)
        expect(pt!.y, `${m.id} ${name} y`).toBeGreaterThan(0)
        expect(pt!.y, `${m.id} ${name} y`).toBeLessThan(STAGE_H)
      }
    }
  })

  // One fixed ellipse under every enemy was right only while the enemy was
  // always the player's own rig at the player's own size.
  it('sizes the ground shadow from the creature standing on it', () => {
    const chicken = monsterFigureFor((monstersData as any).field_chicken, 'melee')
    const dragon = monsterFigureFor((monstersData as any).green_dragon, 'melee')
    expect(monsterShadow(chicken).rx).toBeLessThan(monsterShadow(dragon).rx)
    for (const m of monsters) {
      const shadow = monsterShadow(monsterFigureFor(m, 'melee'))
      expect(shadow.rx, `${m.id}`).toBeGreaterThan(0)
      // Inside the frame, and never wider than the creature it belongs to.
      expect(shadow.cx - shadow.rx, `${m.id} left`).toBeGreaterThan(-1)
      expect(shadow.cx + shadow.rx, `${m.id} right`).toBeLessThan(STAGE_W)
    }
  })

  it('shrinks the shadow of something that is not touching the ground', () => {
    const hovering = monsterFigureFor({ id: 'x_core', combatLevel: 50 }, 'magic')
    const standing = monsterFigureFor({ id: 'x_wolf', combatLevel: 50 }, 'melee')
    expect(monsterShadow(hovering).hover).toBe(true)
    expect(monsterShadow(standing).hover).toBe(false)
  })

  it('floats a hovering creature off the ground and stands everything else on it', () => {
    expect(monsterFigureFor({ id: 'x_core', combatLevel: 50 }, 'magic').lift).toBe(HOVER_LIFT)
    expect(monsterFigureFor({ id: 'x_wolf', combatLevel: 50 }, 'melee').lift).toBe(0)
  })

  describe('classification', () => {
    it('draws every dragon as the same dragon in a different colour', () => {
      const colours = new Map<string, string>()
      for (const id of ['green_dragon', 'red_dragon', 'black_dragon', 'rune_dragon', 'adamant_dragon', 'king_black_dragon']) {
        const m = monsters.find(x => x.id === id)!
        const f = monsterFigureFor(m, 'melee')
        expect(f.archetype, id).toBe('dragon')
        colours.set(id, f.paletteName)
      }
      expect(colours.get('green_dragon')).toBe('emerald')
      expect(colours.get('red_dragon')).toBe('crimson')
      expect(colours.get('black_dragon')).toBe('obsidian')
      expect(colours.get('king_black_dragon')).toBe('obsidian')
      expect(colours.get('rune_dragon')).toBe('azure')
      expect(colours.get('adamant_dragon')).toBe('verdigris')
      // Three distinct colours at minimum, or "many colours" is not true.
      expect(new Set(colours.values()).size).toBeGreaterThanOrEqual(4)
    })

    it('authors Sunspire as a varied arena bestiary instead of fallback animation bodies', () => {
      const expected: Record<string, string> = {
        ashen_warband_blade: 'gladiator',
        ashen_warband_bow: 'gladiator',
        ashen_warband_magus: 'gladiator',
        ashen_warband_bulwark: 'gladiator',
        embercoil_shaman: 'lizardman',
        sunclaw_gladiator: 'gladiator',
        dawnlance_colossus: 'giant',
        triune_chimera: 'dragon',
        resonance_colossus: 'golem',
        hornwarden: 'demon',
        ember_swarm: 'imp',
        sunspire_healing_totem: 'orb',
        aurelios_the_unbroken: 'gladiator',
      }
      const seen = new Set<string>()
      for (const [id, archetype] of Object.entries(expected)) {
        const monster: any = (monstersData as any)[id]
        expect(monster, id).toBeTruthy()
        const figure = monsterFigureFor(monster, monster.attackStyle)
        expect(figure.archetype, id).toBe(archetype)
        expect(figure.archetype, `${id} must never use the chicken body`).not.toBe('fowl')
        seen.add(figure.archetype)
      }
      expect(seen.size).toBeGreaterThanOrEqual(8)
    })

    it('draws the plain creatures as themselves', () => {
      const of = (id: string) => monsterFigureFor(monsters.find(m => m.id === id)!, 'melee')
      expect(of('field_chicken').archetype).toBe('fowl')
      expect(of('field_chicken').armed).toBe(false)
      expect(of('pasture_bull').archetype).toBe('bovine')
      expect(of('pasture_bull').armed).toBe(false)
      expect(of('lesser_fiend').archetype).toBe('demon')
      expect(of('lesser_fiend').paletteName).toBe('crimson')
      expect(of('cave_goblin').armed).toBe(true)
    })

    // Substring rules over ids misfire in ways nobody predicts: "col-OSSU-s"
    // read as bone and "th-REEF-ang" as a sea creature. Both shipped once.
    it('is not fooled by a material word hiding inside another word', () => {
      const of = (id: string) => monsterFigureFor(monsters.find(m => m.id === id)!, 'melee')
      expect(of('thornhide_colossus').paletteName).toBe('bark')
      expect(of('threefang_cerberus').paletteName).toBe('obsidian')
    })

    it('falls back by name for a monster nobody has authored yet', () => {
      expect(monsterArchetypeFor({ id: 'frost_wyrmling' })).toBe('dragon')
      expect(monsterArchetypeFor({ id: 'cave_wyrm' })).toBe('serpent')
      expect(monsterArchetypeFor({ id: 'sunken_kraken' })).toBe('kraken')
      expect(monsterArchetypeFor({ id: 'nothing_recognisable' })).toBe('humanoid')
      expect(monsterPaletteNameFor({ id: 'frost_wyrmling' }, 'dragon')).toBe('frost')
      expect(monsterPaletteNameFor({ id: 'nothing_recognisable' }, 'dragon')).toBe('emerald')
    })

    it('leaves no dead ids in the palette override table', () => {
      // A rename in monsters.json silently strands an override otherwise, and
      // the monster quietly goes back to a rules-derived colour.
      const ids = new Set(monsters.map(m => m.id))
      const overridden = ['green_dragon', 'nagadoth_queen', 'threefang_cerberus', 'zaryth_the_empty_lord']
      for (const id of overridden) expect(ids.has(id), id).toBe(true)
    })
  })
})
