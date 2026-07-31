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

  it('finds the monsters that drop an item ("how do I get X")', () => {
    const ids = topIds('how do I get dragon boots?', 6)
    expect(ids.some((id) => id.startsWith('monster_astral_'))).toBe(true)
  })

  it('ranks a named monster chunk first despite generic query words', () => {
    expect(topIds('where do I fight the kraken', 6)[0]).toBe('monster_deepmaw_kraken')
  })

  it('answers "how do I train X" with X, for skills that have no skill_ chunk', () => {
    // Slayer has no entry in skills.json, so the only chunk about it is the
    // guide section. The 17 "Skill training options: …" chunks all match
    // "train" and used to bury it at rank 19 — the helper then told the player
    // slayer was not in the game.
    expect(topIds('How do I train slayer?', 8)).toContain('guide_slayer')
    expect(topIds('how do I train construction?', 8)).toContain('guide_construction')
    expect(topIds('how do I train summoning?', 8)).toContain('guide_summoning')
  })

  it('still prefers the skill chunk for skills that do have one', () => {
    expect(topIds('how do I train mining?', 8)[0]).toBe('skill_mining')
    expect(topIds('how do I train herblore?', 8)[0]).toBe('skill_herblore')
  })

  it('ranks a chunk the query is wholly about over one sharing a generic word', () => {
    const hits = searchKnowledge('How do I train slayer?', index, 8)
    const rank = (id: string) => hits.findIndex((h) => h.chunk.id === id)
    expect(rank('guide_slayer')).toBeGreaterThanOrEqual(0)
    // Every skill chunk matches "train" and none of them is about slayer.
    for (const h of hits) {
      if (h.chunk.id.startsWith('skill_')) expect(rank('guide_slayer')).toBeLessThan(rank(h.chunk.id))
    }
  })

  it('drops the weak tail: every hit scores within range of the best hit', () => {
    for (const q of ['how do I get dragon boots?', 'best food to cook', 'prayer potion restore']) {
      const hits = searchKnowledge(q, index, 6)
      for (const h of hits) expect(h.score).toBeGreaterThanOrEqual(hits[0].score * 0.3)
    }
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
