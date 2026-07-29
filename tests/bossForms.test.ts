// A multi-form boss's rotation is a per-SWING decision, and three runtimes have
// to agree on when it happens. These pin the shared-record contract that co-op
// and the open world both lean on.
import { describe, it, expect } from 'vitest'
import { applyForm, advanceSharedForm, isMultiForm, pickNextForm, pinFormToSession } from '../src/engine/bossForms.js'
import monstersData from '../src/data/monsters.json'

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
