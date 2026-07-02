import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_CHUNKS } from '../functions/_lib/chat/knowledge.js'
import questsData from '../src/data/quests.json'

describe('generated chat knowledge index', () => {
  it('has a healthy number of well-formed chunks', () => {
    expect(KNOWLEDGE_CHUNKS.length).toBeGreaterThan(50)
    for (const chunk of KNOWLEDGE_CHUNKS) {
      expect(typeof chunk.id).toBe('string')
      expect(chunk.id.length).toBeGreaterThan(0)
      expect(typeof chunk.title).toBe('string')
      expect(typeof chunk.text).toBe('string')
      expect(chunk.text.trim().length).toBeGreaterThan(0)
      expect(Array.isArray(chunk.tags)).toBe(true)
    }
  })

  it('has unique chunk ids', () => {
    const ids = KNOWLEDGE_CHUNKS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps chunks compact (retrieval-sized, not documents)', () => {
    for (const chunk of KNOWLEDGE_CHUNKS) {
      expect(chunk.text.length).toBeLessThan(6000)
    }
  })

  it('contains the core guide sections', () => {
    const ids = new Set(KNOWLEDGE_CHUNKS.map((c) => c.id))
    for (const required of [
      'guide_prayer',
      'guide_dragonfire',
      'guide_daily_tasks',
      'guide_combat_basics',
      'guide_slayer',
      'data_prayers',
      'data_spells',
    ]) {
      expect(ids.has(required), `missing chunk ${required}`).toBe(true)
    }
  })

  it('has one chunk per quest in quests.json', () => {
    const questChunks = KNOWLEDGE_CHUNKS.filter((c) => c.id.startsWith('quest_'))
    expect(questChunks.length).toBe((questsData as Array<{ id: string }>).length)
    const ids = new Set(KNOWLEDGE_CHUNKS.map((c) => c.id))
    for (const q of questsData as Array<{ id: string }>) {
      expect(ids.has(`quest_${q.id}`), `missing quest chunk for ${q.id}`).toBe(true)
    }
  })
})
