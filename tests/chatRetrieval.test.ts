import { describe, expect, it } from 'vitest'
import {
  buildIndex,
  conversationContextTerms,
  searchKnowledge,
  tokenize,
} from '../functions/_lib/chat/retrieval.js'
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

describe('chat retrieval carries the conversation', () => {
  it('carries terms from recent user turns, newest first, minus what the question already asks', () => {
    const history = [
      { role: 'user', content: 'how does prayer drain work?' },
      { role: 'assistant', content: 'It drains a pool.' },
      { role: 'user', content: 'and the dragonfire shield?' },
    ]
    const terms = conversationContextTerms(history, 'how do I restore prayer?')
    // 'prayer' is in the question, so it is never carried twice.
    expect(terms).not.toContain('prayer')
    // Newest turn first: the likeliest referent survives the cap.
    expect(terms.indexOf('dragonfire')).toBeLessThan(terms.indexOf('drain'))
    // Assistant turns are not the player's topic — only their own asks are.
    expect(terms).not.toContain('pool')
  })

  it('ignores a missing or malformed history rather than throwing', () => {
    expect(conversationContextTerms(undefined, 'prayer')).toEqual([])
    expect(conversationContextTerms([{ role: 'user' }, null, 'x'] as never, 'prayer')).toEqual([])
  })

  it('lifts the chunk the conversation is about when the follow-up names nothing', () => {
    // "how do I get a task?" on its own is a daily-tasks question; asked right
    // after a slayer question it is a slayer one. Without the conversation the
    // whole context window was daily tasks, and the system prompt tells the
    // model to answer from that context — which is how a long chat drifts.
    const history = [{ role: 'user', content: 'How do I train slayer?' }]
    const question = 'how do I get a task?'
    expect(topIds(question, 5)).not.toContain('guide_slayer')
    const withContext = searchKnowledge(question, index, 5, conversationContextTerms(history, question))
    expect(withContext.map((h) => h.chunk.id)).toContain('guide_slayer')
  })

  it('retrieves the topic under discussion for a follow-up that matches nothing on its own', () => {
    const history = [{ role: 'user', content: 'tell me about daily tasks' }]
    const question = 'how many do I get?'
    expect(topIds(question, 5)).not.toContain('guide_daily_tasks')
    const withContext = searchKnowledge(question, index, 5, conversationContextTerms(history, question))
    expect(withContext[0].chunk.id).toBe('guide_daily_tasks')
  })

  it('never outranks a chunk the question itself matched with one it did not', () => {
    // Context reorders and back-fills; it must not displace a direct answer.
    const history = [{ role: 'user', content: 'how do I train mining?' }]
    const question = 'how do I train herblore?'
    const withContext = searchKnowledge(question, index, 8, conversationContextTerms(history, question))
    expect(withContext[0].chunk.id).toBe('skill_herblore')
  })

  it('lets a clear new question switch topic outright, however long the old one ran', () => {
    // The other side of the bargain: carrying context must not make the helper
    // sticky. A question that stands on its own ranks as if there were no
    // conversation at all.
    const history = [
      { role: 'user', content: 'how do I train slayer?' },
      { role: 'user', content: 'what tasks do I get?' },
      { role: 'user', content: 'best slayer master?' },
    ]
    for (const question of ['how do I block dragonfire?', 'how do I train mining?']) {
      const terms = conversationContextTerms(history, question)
      expect(terms.length).toBeGreaterThan(0)
      const ids = searchKnowledge(question, index, 5, terms).map((h) => h.chunk.id)
      const plain = topIds(question, 5)
      // Same chunks, same best chunk. Order within the irrelevant tail may
      // shuffle — that tail is what context is allowed to reorder.
      expect(ids[0]).toBe(plain[0])
      expect([...ids].sort()).toEqual([...plain].sort())
    }
  })

  it('is byte-for-byte its old self with no conversation to carry', () => {
    // The tuned COVERAGE/FOCUS/floor constants above are calibrated on this
    // path — an empty context must not perturb it, or every tuning test here
    // is measuring something else.
    for (const q of ['How do I train slayer?', 'how do I get dragon boots?', 'prayer potion restore']) {
      const plain = searchKnowledge(q, index, 8)
      const empty = searchKnowledge(q, index, 8, [])
      expect(empty.map((h) => [h.chunk.id, h.score])).toEqual(plain.map((h) => [h.chunk.id, h.score]))
    }
  })
})
