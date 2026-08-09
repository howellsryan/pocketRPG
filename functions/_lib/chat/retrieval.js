// Lexical retrieval over the generated knowledge chunks (BM25-style, no
// embeddings — deterministic and free). Pure logic: chunks are injected so
// tests can run without the generated corpus.

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does',
  'for', 'from', 'get', 'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it',
  'its', 'me', 'my', 'of', 'on', 'or', 'that', 'the', 'their', 'them', 'then',
  'there', 'they', 'this', 'to', 'was', 'we', 'what', 'when', 'where', 'which',
  'who', 'why', 'will', 'with', 'you', 'your',
])

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

// Light stemmer so "prayers" matches "prayer", "healing" ~ "heal", etc.
// Exported for reuse by the chat tool-search ranking (prompt.js).
export function stem(token) {
  return token
    .replace(/ies$/, 'y')
    .replace(/(?:es|s)$/, '')
    .replace(/ing$/, '')
}

const K1 = 1.5
const B = 0.75
const HEAD_WEIGHT = 3

// Relevance guards. Coverage down-weights chunks that match only a fraction of
// the query's informative terms (one generic word like "level" or "fight" must
// not carry a chunk into the context); the relative floor then drops the weak
// tail so only chunks in the same league as the best hit are returned.
const COVERAGE_WEIGHT = 0.5
const RELATIVE_FLOOR = 0.3
// Terms carried in from earlier turns of the conversation count at a fraction
// of a question term's weight, in BM25 and in focus but never in coverage —
// coverage stays a measure of how much of the question was answered, which is
// what keeps a carried term from making a chunk look like a better answer to
// what was actually asked. With no carried terms searchKnowledge is
// byte-for-byte its old self, so the tuned FOCUS_WEIGHT plateau below still
// holds; retune it against tests/chatRetrieval.test.ts, never one follow-up.
const CONTEXT_TERM_WEIGHT = 0.35
// How many earlier user turns feed those terms, and the cap on how many
// survive. A follow-up refers back a turn or two, not to the whole session;
// past that the carried terms are just noise competing with the question.
const CONTEXT_HISTORY_TURNS = 3
const CONTEXT_TERM_LIMIT = 12
// History reaches this straight off the request body, so each turn is bounded
// before it is tokenized — the transcript sanitizer runs later, and nothing
// here should depend on having been called after it.
const CONTEXT_TURN_CHARS = 1000
// Focus rewards a chunk whose OWN headline terms are what the query asked
// about, which is the only signal that separates a chunk *on* the topic from
// one that merely shares a generic word with it. Term rarity cannot: the 17
// "Skill training options: X" chunks made `train` rarer (df 22) than `slayer`
// (df 80), so plain BM25 ranked every wrong skill above the Slayer guide and
// answered that Slayer isn't in the game. Coverage can't either — it scores
// "matched train, not slayer" and "matched slayer, not train" identically.
// Chosen off the middle of a stable 3.5–5 plateau; below ~3 the Slayer guide
// slips back under the skill chunks, above ~6 a short title starts outranking
// a chunk that genuinely answers the question.
const FOCUS_WEIGHT = 4

// Build a searchable index over chunks: [{ id, title, tags, text }].
export function buildIndex(chunks) {
  const docs = chunks.map((chunk) => {
    const freq = new Map()
    // Title and tags are one field, not two: a term in both used to score 6
    // against a body term's 1, which is how boilerplate in a templated title
    // ("Skill training options: …" + a matching `training` tag) outweighed a
    // chunk that is actually about the subject.
    const head = new Set()
    for (const t of tokenize(chunk.title)) head.add(stem(t))
    for (const tag of chunk.tags || []) for (const t of tokenize(tag)) head.add(stem(t))
    for (const s of head) freq.set(s, HEAD_WEIGHT)
    for (const t of tokenize(chunk.text)) {
      const s = stem(t)
      freq.set(s, (freq.get(s) || 0) + 1)
    }
    let len = 0
    for (const n of freq.values()) len += n
    return { chunk, freq, len, head }
  })
  const df = new Map()
  for (const doc of docs) for (const term of doc.freq.keys()) df.set(term, (df.get(term) || 0) + 1)
  const avgLen = docs.reduce((sum, d) => sum + d.len, 0) / Math.max(1, docs.length)
  return { docs, df, avgLen, n: docs.length }
}

// Terms to carry into retrieval from earlier in the conversation. A follow-up
// like "and the drop rate?" tokenizes to almost nothing, so ranking it on its
// own words alone returns chunks about whatever generic term survived — and
// the system prompt tells the model to answer from those chunks, which is how
// a long conversation drifts off its own topic. Question terms are excluded so
// they are never double-counted, and the result is capped: this is a tiebreak
// signal, not a second query.
export function conversationContextTerms(history, question) {
  if (!Array.isArray(history)) return []
  const asked = new Set(tokenize(question).map(stem))
  const recent = history.filter((m) => m?.role === 'user' && typeof m.content === 'string').slice(-CONTEXT_HISTORY_TURNS)
  const terms = []
  const seen = new Set()
  // Newest turn first: the most recent thing the player asked about is the
  // likeliest referent, and it survives the cap.
  for (let i = recent.length - 1; i >= 0; i--) {
    for (const t of tokenize(recent[i].content.slice(0, CONTEXT_TURN_CHARS)).map(stem)) {
      if (asked.has(t) || seen.has(t)) continue
      seen.add(t)
      terms.push(t)
      if (terms.length >= CONTEXT_TERM_LIMIT) return terms
    }
  }
  return terms
}

// Top-k chunks for a query. Returns [{ chunk, score }] with score > 0 only —
// an off-topic query with no term overlap returns [].
// `contextTerms` (from conversationContextTerms) count at CONTEXT_TERM_WEIGHT
// everywhere a question term counts at 1, except coverage. They may score a
// chunk the question misses entirely, but only down at that weight with
// coverage at its floor — so a question that stands on its own retrieves the
// same chunks and the same best chunk as it would with no conversation at all.
export function searchKnowledge(query, index, k = 4, contextTerms = []) {
  const terms = [...new Set(tokenize(query).map(stem))]
  if (!terms.length) return []
  const asked = new Set(terms)
  const carried = contextTerms.filter((t) => !asked.has(t))
  const carriedSet = new Set(carried)
  const scored = []
  for (const doc of index.docs) {
    let score = 0
    let matched = 0
    const idfScore = (term) => {
      const tf = doc.freq.get(term)
      if (!tf) return 0
      const df = index.df.get(term) || 0
      const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5))
      return idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.len) / index.avgLen)))
    }
    for (const term of terms) {
      const contribution = idfScore(term)
      if (!contribution) continue
      matched++
      score += contribution
    }
    // A chunk the question misses entirely can still be scored on carried terms
    // alone — at 0.35 weight with coverage at its floor, so it lands below
    // anything the question genuinely matched. That is the case the whole
    // signal exists for: "how many do I get?" matches nothing informative on
    // its own words and used to retrieve three unrelated chunks, which the
    // system prompt then told the model to answer from.
    for (const term of carried) score += CONTEXT_TERM_WEIGHT * idfScore(term)
    if (score > 0) {
      score *= 1 - COVERAGE_WEIGHT + COVERAGE_WEIGHT * (matched / terms.length)
      // Coverage asks how much of the QUERY the chunk answered; focus asks how
      // much of the CHUNK the query was about. "Slayer" is wholly about slayer;
      // "Skill training options: Thieving" is a quarter about training and not
      // at all about slayer.
      // Focus counts carried terms too, at their reduced weight. Without that,
      // a follow-up about the topic under discussion is the one case focus
      // works against: the on-topic chunk's headline is the CARRIED word, so it
      // scores 0 focus while a chunk sharing the follow-up's one generic word
      // takes the full multiplier — the exact inversion this signal exists to
      // prevent, just a turn later.
      let inQuery = 0
      for (const term of doc.head) {
        if (asked.has(term)) inQuery++
        else if (carriedSet.has(term)) inQuery += CONTEXT_TERM_WEIGHT
      }
      score *= 1 + FOCUS_WEIGHT * (doc.head.size ? inQuery / doc.head.size : 0)
      scored.push({ chunk: doc.chunk, score })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  if (!scored.length) return []
  const floor = scored[0].score * RELATIVE_FLOOR
  return scored.filter((h) => h.score >= floor).slice(0, k)
}
