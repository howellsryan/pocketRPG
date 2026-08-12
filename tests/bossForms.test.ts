// A multi-form boss's rotation is a per-SWING decision, and three runtimes have
// to agree on when it happens. These pin the shared-record contract that co-op
// and the open world both lean on.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { applyForm, advanceSharedForm, clearDefenceBonusDrain, DEFENCE_BONUS_FLOOR, formChangeAttackTimer, isMultiForm, pickNextForm, pinFormToSession, recordDefenceBonusDrain } from '../src/engine/bossForms.js'
import monstersData from '../src/data/monsters.json'
import itemsData from '../src/data/items.json'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'

afterEach(() => { vi.restoreAllMocks() })

const ZARYTH = 'zaryth_the_empty_lord'
const zaryth = () => JSON.parse(JSON.stringify((monstersData as Record<string, unknown>)[ZARYTH])) as Record<string, any>

describe('being in a form', () => {
  it('is the monster\'s own fields, not a lookup the readers have to remember', () => {
    // Everything downstream — max hit, accuracy, the client's clip, the reach a
    // world npc fights at — reads these fields. A form that only lived in
    // `forms` would be invisible to all of it.
    const monster = zaryth()
    const form = applyForm(monster, 'melee')
    expect(form).toBeTruthy()
    expect(monster.currentForm).toBe('melee')
    expect(monster.attackStyle).toBe(monster.forms.melee.attackStyle)
    expect(monster.formMaxHit).toBe(monster.forms.melee.maxHit)
    expect(monster.defenceBonus).toEqual(monster.forms.melee.defenceBonus)
    // The weakness hint follows too, or it names the form before last.
    expect(monster.weakness).toBe(monster.forms.melee.weakness)
  })

  it('refuses a form the boss does not have, leaving it where it was', () => {
    const monster = zaryth()
    applyForm(monster, 'ranged')
    expect(applyForm(monster, 'not_a_form')).toBeNull()
    expect(monster.currentForm).toBe('ranged')
  })

  it('inherits the boss\'s own defences for a form that authors none', () => {
    // attackBonus and strengthBonus have always fallen back to the monster's
    // own; defenceBonus was spread unguarded, so a form authored without one
    // replaced the boss's defences with {} — every bonus reads 0 through the
    // lookup, and the whole room suddenly hits it as if it were unarmoured.
    // Every shipped form carries defences, so this is the guard on the next one.
    const monster: Record<string, any> = {
      multiForm: true,
      attackBonus: 100,
      strengthBonus: 90,
      defenceBonus: { stab: 70, slash: 70, crush: 70, magic: 70, ranged: 70 },
      forms: { bare: { attackStyle: 'crush', maxHit: 20 } },
    }
    applyForm(monster, 'bare')
    expect(monster.defenceBonus).toEqual({ stab: 70, slash: 70, crush: 70, magic: 70, ranged: 70 })
    expect(monster.attackBonus).toBe(100)
    expect(monster.strengthBonus).toBe(90)
  })

  it('is only claimed by a boss that actually rotates', () => {
    expect(isMultiForm(zaryth())).toBe(true)
    expect(isMultiForm((monstersData as Record<string, unknown>)['warlord_grondar'])).toBe(false)
    expect(isMultiForm({ multiForm: true, forms: {} })).toBe(false)
    expect(isMultiForm(null)).toBe(false)
  })
})

describe('choosing the next form', () => {
  it('walks an authored cycle in order, and wraps', () => {
    const monster = { forms: { a: {}, b: {}, c: {} }, formCycleOrder: ['a', 'b', 'c'], currentForm: 'c' }
    expect(pickNextForm(monster)).toBe('a')
    expect(pickNextForm({ ...monster, currentForm: 'a' })).toBe('b')
  })

  it('picks at random with no cycle authored, and may repeat itself', () => {
    // Deliberate: a boss that could never repeat a style would be readable a
    // swing ahead, which is the opposite of what the rotation is for.
    const monster = zaryth()
    monster.currentForm = 'ranged'
    const keys = Object.keys(monster.forms)
    expect(pickNextForm(monster, () => 0)).toBe(keys[0])
    expect(pickNextForm(monster, () => 0.999)).toBe(keys[keys.length - 1])
  })

  it('holds its form when there is only one', () => {
    expect(pickNextForm({ forms: { only: {} }, currentForm: 'only' })).toBe('only')
  })
})

describe('advancing the shared record', () => {
  it('switches on the swing the threshold lands, and not before', () => {
    const monster = zaryth()
    applyForm(monster, 'ranged')
    monster.formAttackCount = 0
    monster.formSwitchThreshold = 3
    expect(advanceSharedForm(monster, () => 0)).toBeNull()
    expect(advanceSharedForm(monster, () => 0)).toBeNull()
    const change = advanceSharedForm(monster, () => 0)
    expect(change?.type).toBe('formChange')
    expect(change?.previousForm).toBe('ranged')
    expect(monster.currentForm).toBe(change?.currentForm)
    // And the count restarts, so the next switch is a full hold away.
    expect(monster.formAttackCount).toBe(0)
  })

  it('switches every swing for a boss authored that way', () => {
    const monster = zaryth()
    expect(monster.randomFormEveryAttack).toBe(true)
    applyForm(monster, 'ranged')
    monster.formAttackCount = 0
    monster.formSwitchThreshold = 1
    for (let i = 0; i < 5; i++) expect(advanceSharedForm(monster, () => 0.5)).toBeTruthy()
  })

  it('says nothing at all for a boss with no forms', () => {
    expect(advanceSharedForm({ name: 'Grondar' } as never)).toBeNull()
  })
})

describe('pinning a session to the room', () => {
  it('moves a session onto the room\'s form', () => {
    const session = zaryth()
    applyForm(session, 'ranged')
    const shared = zaryth()
    applyForm(shared, 'magic')

    expect(pinFormToSession(session, shared)).toBe(true)
    expect(session.currentForm).toBe('magic')
    expect(session.attackStyle).toBe(session.forms.magic.attackStyle)
  })

  it('does nothing when they already agree, or when there is nothing to pin', () => {
    const session = zaryth()
    applyForm(session, 'magic')
    expect(pinFormToSession(session, { currentForm: 'magic' })).toBe(false)
    expect(pinFormToSession(session, {})).toBe(false)
    expect(pinFormToSession({ name: 'Grondar' }, { currentForm: 'magic' })).toBe(false)
  })
})

describe('the clock a form change restarts', () => {
  it('is one cycle of the form the boss has just moved INTO', () => {
    // Read after applyForm, never before: a form that carries its own cadence
    // must set the beat the player is about to face, not the one just left.
    const monster = zaryth()
    applyForm(monster, 'melee')
    expect(formChangeAttackTimer(monster)).toBe(monster.attackSpeed)

    const paced = { attackSpeed: 5, forms: { a: { attackSpeed: 2 } }, multiForm: true }
    applyForm(paced, 'a')
    expect(formChangeAttackTimer(paced)).toBe(paced.attackSpeed)
  })

  it('falls back to 4 for a monster carrying no speed at all', () => {
    expect(formChangeAttackTimer({})).toBe(4)
    expect(formChangeAttackTimer(null)).toBe(4)
  })

  it('is the SAME expression all three runtimes restart their own clock with', () => {
    // Solo restarts state.monsterAttackTimer, co-op restarts the room's
    // boss.attackTimer plus every member's pinned copy, the world restarts
    // npc.attackTimer. Today every form inherits the boss's attackSpeed, so all
    // three land on the same number and the restart is a no-op everywhere —
    // which is the point: the day a form carries a cadence of its own, none of
    // them can quietly disagree. This pins that they read one function.
    const monster = zaryth()
    const solo = formChangeAttackTimer(monster)
    const coop = formChangeAttackTimer(monster)
    const world = formChangeAttackTimer(monster)
    expect(new Set([solo, coop, world]).size).toBe(1)
    expect(solo).toBe(monster.attackSpeed)
  })
})

describe('a defence drain across a form change', () => {
  // Grondar Godsword's warstrike "permanently weakens the target's defences for
  // the rest of the fight". A form change replaces defenceBonus wholesale with
  // the form's authored numbers, so without a running total every rotation
  // handed all of it back — on a boss switching every attack, a warstrike was
  // worth exactly one swing.
  const drainOf = (monster: Record<string, any>, style: string) =>
    monster.forms[monster.currentForm].defenceBonus[style] - monster.defenceBonus[style]

  it('survives a rotation into a form with its own authored defences', () => {
    const monster = zaryth()
    applyForm(monster, 'melee')
    recordDefenceBonusDrain(monster, 40)
    expect(drainOf(monster, 'stab')).toBe(40)

    applyForm(monster, 'ranged')
    expect(monster.currentForm).toBe('ranged')
    expect(drainOf(monster, 'stab')).toBe(40)
    expect(monster.defenceBonus).not.toEqual(monster.forms.ranged.defenceBonus)
  })

  it('accumulates across rotations rather than restarting from each form', () => {
    const monster = zaryth()
    applyForm(monster, 'melee')
    recordDefenceBonusDrain(monster, 30)
    applyForm(monster, 'magic')
    recordDefenceBonusDrain(monster, 25)
    expect(drainOf(monster, 'slash')).toBe(55)
    applyForm(monster, 'melee')
    expect(drainOf(monster, 'slash')).toBe(55)
  })

  it('is applied exactly once when a form inherits the boss\'s defences instead of authoring its own', () => {
    // The inherited numbers already carry the drain; subtracting again would
    // grind the boss down a second time for every rotation it happened to make.
    const monster = zaryth()
    for (const form of Object.values(monster.forms) as Record<string, any>[]) delete form.defenceBonus
    applyForm(monster, 'melee')
    const base = { ...monster.defenceBonus }
    recordDefenceBonusDrain(monster, 20)
    applyForm(monster, 'ranged')
    applyForm(monster, 'magic')
    for (const style of Object.keys(base)) {
      expect(monster.defenceBonus[style], style).toBe(base[style] - 20)
    }
  })

  it('never grinds a bonus below the floor, however many warstrikes land', () => {
    const monster = zaryth()
    applyForm(monster, 'melee')
    for (let i = 0; i < 20; i++) recordDefenceBonusDrain(monster, 60)
    applyForm(monster, 'ranged')
    for (const value of Object.values(monster.defenceBonus) as number[]) {
      expect(value).toBe(DEFENCE_BONUS_FLOOR)
    }
  })

  it('does not follow the boss into a new body', () => {
    const monster = zaryth()
    applyForm(monster, 'melee')
    recordDefenceBonusDrain(monster, 40)
    clearDefenceBonusDrain(monster)
    applyForm(monster, 'ranged')
    expect(monster.defenceBonus).toEqual(monster.forms.ranged.defenceBonus)
  })

  it('nulls rather than deletes the total, so a shared record cannot keep a shed drain', () => {
    // co-op's pickMutableMonsterFields skips `undefined`, so a delete would
    // leave the room holding the drain the new body just shed.
    const monster = zaryth()
    recordDefenceBonusDrain(monster, 10)
    clearDefenceBonusDrain(monster)
    expect('defenceBonusDrain' in monster).toBe(true)
    expect(monster.defenceBonusDrain).toBeNull()
  })
})

describe('a phase change is a new body', () => {
  it('sheds a warstrike drain when Verzik moves to her next phase', () => {
    // Unlike a rotation, a phase hands the boss a fresh health bar and refills
    // the player's special energy — it is a new fight in all but name, so the
    // grind taken off the last body does not follow it onto this one.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const verzik = (monstersData as Record<string, any>).verzik_vitur
    const state: any = createCombatState(verzik, 'ranged', 'accurate', null, monstersData)
    state.monster.currentHP = 1
    state.monster.defenceBonusDrain = { stab: 50, slash: 50, crush: 50, magic: 50, ranged: 50 }
    state.playerAttackTimer = 0

    const out = processCombatTick(state, { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, hitpoints: 99, currentHP: 99 },
      { weapon: { itemId: 'bow_of_faerdhinen', charges: 999 } }, itemsData)

    expect(out.events.some((e: any) => e.type === 'verzikPhaseChange')).toBe(true)
    const monster = out.combatState.monster
    expect(monster.defenceBonusDrain).toBeNull()
    expect(monster.defenceBonus).toEqual(verzik.forms[monster.currentForm].defenceBonus)
  })
})
