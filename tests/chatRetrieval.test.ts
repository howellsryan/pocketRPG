import { describe, expect, it } from 'vitest'
import { buildIndex, searchKnowledge, tokenize } from '../functions/_lib/chat/retrieval.js'
import { KNOWLEDGE_CHUNKS } from '../functions/_lib/chat/knowledge.js'

const index = buildIndex(KNOWLEDGE_CHUNKS)
const topIds = (query: string, k = 4) => searchKnowledge(query, index, k).map((h) => h.chunk.id)

describe('chat retrieval', () => {
  it('tokenizes and drops stopwords', () => {
    expect(tokenize('How does the Prayer drain work?')).toEqual(['prayer', 'drain', 'work'])
  })

  it('finds the prayer chunks for a prayer question', () => {
    const ids = topIds('how fast does prayer drain?')
    expect(ids.some((id) => id === 'guide_prayer' || id === 'data_prayers')).toBe(true)
  })

  it('finds the dragonfire chunk', () => {
    expect(topIds('how do I block dragonfire?')).toContain('guide_dragonfire')
  })

  it('finds the daily tasks chunk', () => {
    expect(topIds('when do daily tasks reset?')).toContain('guide_daily_tasks')
  })

  it('finds a specific quest chunk by name', () => {
    expect(topIds('what are the requirements for A Realm Divided?', 6)).toContain('quest_a_realm_divided')
  })

  it('returns nothing for queries with no game-term overlap', () => {
    expect(searchKnowledge('quantum chromodynamics homework', index)).toEqual([])
    expect(searchKnowledge('', index)).toEqual([])
  })

  it('ranks results by score descending', () => {
    const hits = searchKnowledge('prayer potion restore', index, 10)
    const scores = hits.map((h) => h.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })
})
