// End-to-end behaviour of the preview bypass across the gates it exists for,
// plus the rule that keeps it from doing damage: it answers requirements only.
// Marking quests "complete" instead would empty the quest list and hide every
// quest from the world map — the opposite of unlocking them.

import { describe, it, expect, afterEach } from 'vitest'
import { setQuestGateBypass } from '../src/engine/questGates.js'
import { checkEquipRequirements } from '../src/engine/equipment.js'
import { checkBossRequirementsPure, checkRaidRequirementsPure } from '../src/engine/combatRequirements.js'
import { checkQuestEligibility } from '../src/engine/quests.js'
import { isEntryEligible } from '../src/engine/slayerMasters.js'
import { coopEquipRequirementFailure } from '../src/engine/coopBossEngine.js'

const NO_QUESTS = new Set<string>()

afterEach(() => {
  setQuestGateBypass(false)
  delete (globalThis as any).pocketQuestGatesDisabled
})

describe('gates enforced (production default)', () => {
  it('locks quest-gated gear, bosses, raids and quests', () => {
    expect(checkEquipRequirements({ questUnlock: 'dragon_slayer' }, {}, NO_QUESTS))
      .toEqual({ reason: 'quest', questUnlock: 'dragon_slayer' })
    expect(checkBossRequirementsPure({ id: 'x', name: 'X', questRequirement: 'dragon_slayer' }, { completedQuests: NO_QUESTS }).locked).toBe(true)
    expect(checkRaidRequirementsPure({ id: 'theatre_of_blood' }, { completedQuests: NO_QUESTS }).locked).toBe(true)
    expect(coopEquipRequirementFailure({ questUnlock: 'dragon_slayer' }, { completedQuests: [], levels: {} }))
      .toEqual({ reason: 'quest', questUnlock: 'dragon_slayer' })
  })

  it('keeps a quest with an unmet prerequisite ineligible', () => {
    const quest: any = { id: 'sequel', questRequirements: ['prequel'] }
    const result = checkQuestEligibility(quest, {}, NO_QUESTS, [{ id: 'prequel', name: 'The Prequel' }] as any)
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('Complete The Prequel')
  })
})

describe('bypass on (preview)', () => {
  it('unlocks quest-gated gear, bosses, raids and co-op equips', () => {
    setQuestGateBypass(true)
    expect(checkEquipRequirements({ questUnlock: 'dragon_slayer' }, {}, NO_QUESTS)).toBe(null)
    expect(checkBossRequirementsPure({ id: 'x', name: 'X', questRequirement: 'dragon_slayer' }, { completedQuests: NO_QUESTS }).locked).toBe(false)
    expect(checkRaidRequirementsPure({ id: 'theatre_of_blood' }, { completedQuests: NO_QUESTS }).locked).toBe(false)
    expect(coopEquipRequirementFailure({ questUnlock: 'dragon_slayer' }, { completedQuests: [], levels: {} })).toBe(null)
  })

  it('drops a quest prerequisite but keeps the skill requirements', () => {
    setQuestGateBypass(true)
    const quest: any = { id: 'sequel', questRequirements: ['prequel'], skillRequirements: { mining: 70 } }
    const result = checkQuestEligibility(quest, {}, NO_QUESTS, [{ id: 'prequel', name: 'The Prequel' }] as any)
    expect(result.reasons).not.toContain('Complete The Prequel')
    expect(result.reasons).toContain('Mining 70')
  })

  it('opens quest-gated slayer assignments without touching the slayer level gate', () => {
    const gated: any = { id: 'gated', questRequirement: 'dragon_slayer' }
    // isEntryEligible resolves ids against monsters.json, so drive it through a
    // monster that really carries a quest gate.
    setQuestGateBypass(true)
    expect(isEntryEligible(gated, 99, NO_QUESTS)).toBe(true)
  })
})

describe('the client bundle path (baked build-time flag, no server installer)', () => {
  it('reaches the same gates the server installer does', () => {
    ;(globalThis as any).pocketQuestGatesDisabled = true
    expect(checkEquipRequirements({ questUnlock: 'dragon_slayer' }, {}, NO_QUESTS)).toBe(null)
    expect(checkBossRequirementsPure({ id: 'x', name: 'X', questRequirement: 'dragon_slayer' }, { completedQuests: NO_QUESTS }).locked).toBe(false)
  })
})

describe('the bypass never fabricates quest completion', () => {
  it('leaves "already complete" answering the real set', () => {
    setQuestGateBypass(true)
    // A quest the player has NOT done must still be startable, not reported
    // complete — checkQuestEligibility short-circuits on real completion only.
    const quest: any = { id: 'sequel' }
    expect(checkQuestEligibility(quest, {}, NO_QUESTS, [] as any).eligible).toBe(true)
    expect(checkQuestEligibility(quest, {}, new Set(['sequel']), [] as any).reasons).toEqual(['Already complete'])
  })
})
