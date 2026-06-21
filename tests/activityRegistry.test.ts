// activityRegistry.js is the single source of truth for whether an in-progress
// activity is preserved (background) or stopped (modal) on navigate, and for the
// per-activity ledger key used to flush/restore partial progress. A regression
// here silently WIPES player progress — the exact bug the idle-robustness work
// fixed — so every branch is pinned here.

import { describe, it, expect } from 'vitest'
import {
  ACTIVITY_POLICY,
  getActivityPolicy,
  isBackground,
  getActivityKey,
} from '../src/engine/activityRegistry.js'

const BACKGROUND_TYPES = [
  'quest', 'minigame', 'clue', 'gather', 'agility', 'thieving', 'hunter', 'skill',
]

describe('activityRegistry — persistence policy', () => {
  it('classifies every background activity as background', () => {
    for (const type of BACKGROUND_TYPES) {
      expect(isBackground({ type }), `${type} should be background`).toBe(true)
      expect(getActivityPolicy({ type })?.persistence).toBe('background')
    }
  })

  it('classifies combat as modal (stops on navigate)', () => {
    expect(isBackground({ type: 'combat' })).toBe(false)
    expect(getActivityPolicy({ type: 'combat' })?.persistence).toBe('modal')
  })

  it('treats unknown / empty / null tasks as not-background', () => {
    expect(isBackground(null as any)).toBe(false)
    expect(isBackground(undefined as any)).toBe(false)
    expect(isBackground({} as any)).toBe(false)
    expect(isBackground({ type: 'nonsense' } as any)).toBe(false)
    expect(getActivityPolicy(null as any)).toBeNull()
    expect(getActivityPolicy({ type: 'nonsense' } as any)).toBeNull()
  })

  it('ACTIVITY_POLICY covers exactly the known activity types', () => {
    expect(Object.keys(ACTIVITY_POLICY).sort()).toEqual(
      [...BACKGROUND_TYPES, 'combat'].sort(),
    )
  })
})

describe('activityRegistry — ledger keys', () => {
  const sample: Record<string, any> = {
    quest: { type: 'quest', quest: { id: 'cooks_assistant' } },
    minigame: { type: 'minigame', minigameTask: { id: 'pest_control' } },
    clue: { type: 'clue', gatherTask: { clueLevel: 'hard' } },
    gather: { type: 'gather', gatherTask: { id: 'oak_tree' } },
    agility: { type: 'agility', action: { id: 'gnome_course' } },
    thieving: { type: 'thieving', npc: { id: 'master_farmer' } },
    hunter: { type: 'hunter', action: { id: 'chinchompa' } },
    skill: { type: 'skill', skill: 'cooking', action: { id: 'shrimp' } },
    dungeoneering: { type: 'skill', skill: 'dungeoneering', action: { id: 'floor_1' } },
  }

  it('returns a stable, non-null key for every background task shape', () => {
    for (const [name, task] of Object.entries(sample)) {
      const key = getActivityKey(task)
      expect(key, `${name} should have a key`).toBeTruthy()
      // Stable: same inputs → same key.
      expect(getActivityKey(task)).toBe(key)
    }
  })

  it('gives every distinct activity a unique key (no ledger collisions)', () => {
    const keys = Object.values(sample).map(getActivityKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('namespaces dungeoneering separately from generic skills', () => {
    expect(getActivityKey(sample.dungeoneering)).toMatch(/^dungeoneering:/)
    expect(getActivityKey(sample.skill)).toMatch(/^skill:/)
    expect(getActivityKey(sample.dungeoneering)).not.toBe(getActivityKey(sample.skill))
  })

  it('returns null for modal/unknown tasks (no ledger entry)', () => {
    expect(getActivityKey({ type: 'combat' } as any)).toBeNull()
    expect(getActivityKey({ type: 'nonsense' } as any)).toBeNull()
    expect(getActivityKey(null as any)).toBeNull()
    expect(getActivityKey({} as any)).toBeNull()
  })

  it('distinguishes two different actions within the same skill', () => {
    const a = getActivityKey({ type: 'skill', skill: 'cooking', action: { id: 'shrimp' } })
    const b = getActivityKey({ type: 'skill', skill: 'cooking', action: { id: 'lobster' } })
    expect(a).not.toBe(b)
  })
})
