// The preview-only quest-gate bypass. Two properties matter more than the
// bypass itself: it must be OFF in production by construction (two independent
// locks), and it must only ever answer "is this REQUIREMENT met" — never "is
// this quest complete", which would empty the quest list rather than unlock it.

import { describe, it, expect, afterEach } from 'vitest'
import {
  questRequirementMet,
  questGatesDisabled,
  setQuestGateBypass,
  resolveQuestGateBypass,
} from '../src/engine/questGates.js'

afterEach(() => {
  setQuestGateBypass(false)
  delete (globalThis as any).pocketQuestGatesDisabled
})

describe('questRequirementMet (gates enforced)', () => {
  it('accepts a Set, an array and a plain object of completed quest ids', () => {
    expect(questRequirementMet(new Set(['crown_complications']), 'crown_complications')).toBe(true)
    expect(questRequirementMet(['crown_complications'], 'crown_complications')).toBe(true)
    expect(questRequirementMet({ crown_complications: true }, 'crown_complications')).toBe(true)
  })

  it('refuses a quest the player has not completed', () => {
    expect(questRequirementMet(new Set(['other_quest']), 'crown_complications')).toBe(false)
    expect(questRequirementMet(['other_quest'], 'crown_complications')).toBe(false)
    expect(questRequirementMet({ crown_complications: false }, 'crown_complications')).toBe(false)
    expect(questRequirementMet(null, 'crown_complications')).toBe(false)
    expect(questRequirementMet(undefined, 'crown_complications')).toBe(false)
  })

  it('treats "no quest required" as met regardless of the collection', () => {
    expect(questRequirementMet(null, null)).toBe(true)
    expect(questRequirementMet(new Set(), undefined)).toBe(true)
    expect(questRequirementMet(new Set(), '')).toBe(true)
  })
})

describe('questRequirementMet (bypass on)', () => {
  it('passes every requirement once the server installs the bypass', () => {
    setQuestGateBypass(true)
    expect(questGatesDisabled()).toBe(true)
    expect(questRequirementMet(new Set(), 'crown_complications')).toBe(true)
    expect(questRequirementMet(null, 'dragon_slayer')).toBe(true)
  })

  it('passes every requirement from the build-time baked client flag', () => {
    ;(globalThis as any).pocketQuestGatesDisabled = true
    expect(questGatesDisabled()).toBe(true)
    expect(questRequirementMet(new Set(), 'crown_complications')).toBe(true)
  })

  it('stays off when the baked flag is anything other than true', () => {
    ;(globalThis as any).pocketQuestGatesDisabled = 'true'
    expect(questGatesDisabled()).toBe(false)
    expect(questRequirementMet(new Set(), 'crown_complications')).toBe(false)
  })

  it('defaults to enforcing gates when nothing set the flag at all', () => {
    expect(questGatesDisabled()).toBe(false)
  })
})

describe('resolveQuestGateBypass — the server-side production locks', () => {
  const previewUrl = 'https://abc123.pocketrpg.pages.dev/api/purchase'

  it('enables only when the preview env var is exactly "true"', () => {
    expect(resolveQuestGateBypass({ DISABLE_QUEST_REQUIREMENTS: 'true' }, previewUrl)).toBe(true)
    expect(resolveQuestGateBypass({ DISABLE_QUEST_REQUIREMENTS: 'false' }, previewUrl)).toBe(false)
    expect(resolveQuestGateBypass({ DISABLE_QUEST_REQUIREMENTS: '1' }, previewUrl)).toBe(false)
    expect(resolveQuestGateBypass({}, previewUrl)).toBe(false)
    expect(resolveQuestGateBypass(null, previewUrl)).toBe(false)
    expect(resolveQuestGateBypass(undefined, undefined)).toBe(false)
  })

  it('refuses every production host even if the var somehow got set there', () => {
    const env = { DISABLE_QUEST_REQUIREMENTS: 'true' }
    expect(resolveQuestGateBypass(env, 'https://pocketrpg.co.uk/api/purchase')).toBe(false)
    expect(resolveQuestGateBypass(env, 'https://www.pocketrpg.co.uk/api/purchase')).toBe(false)
    expect(resolveQuestGateBypass(env, 'https://world.pocketrpg.co.uk/session')).toBe(false)
    expect(resolveQuestGateBypass(env, 'https://POCKETRPG.CO.UK/api/purchase')).toBe(false)
  })

  it('refuses a malformed request URL rather than falling open', () => {
    expect(resolveQuestGateBypass({ DISABLE_QUEST_REQUIREMENTS: 'true' }, 'not-a-url')).toBe(false)
    expect(resolveQuestGateBypass({ DISABLE_QUEST_REQUIREMENTS: 'true' }, '')).toBe(false)
  })

  it('allows the preview hosts the flag exists for', () => {
    const env = { DISABLE_QUEST_REQUIREMENTS: 'true' }
    expect(resolveQuestGateBypass(env, previewUrl)).toBe(true)
    expect(resolveQuestGateBypass(env, 'https://preview.pocketrpg.pages.dev/api/save')).toBe(true)
    expect(resolveQuestGateBypass(env, 'https://pocketrpg-world-preview.workers.dev/session')).toBe(true)
    expect(resolveQuestGateBypass(env, 'http://localhost:8788/api/purchase')).toBe(true)
  })
})
