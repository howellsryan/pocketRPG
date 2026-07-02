#!/usr/bin/env node
// Generates functions/_lib/chat/knowledge.js — the retrieval corpus for the
// in-game help chatbot (/api/chat). Sources:
//   1. docs/game-guide.md            — hand-written player guide (## = 1 chunk)
//   2. src/data/*.json               — compact derived summaries (quests,
//      prayers, spells, raids, minigames, farming, skills)
// Item/monster details are NOT baked in: the chat endpoint resolves those live
// via functions/_lib/mcp/reference.js. Keep this file small — it ships inside
// the Pages Functions bundle.
//
// Run: npm run gen:knowledge   (commit the regenerated output)

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT_PATH = path.join(ROOT, 'functions', '_lib', 'chat', 'knowledge.js')
const MAX_BYTES = 250 * 1024

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', rel), 'utf8'))

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

const titleCaseId = (id) => String(id).split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

function fmtDuration(seconds) {
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = m / 60
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}

// ── 1. Guide sections ────────────────────────────────────────────────────────

function guideChunks() {
  const md = fs.readFileSync(path.join(ROOT, 'docs', 'game-guide.md'), 'utf8')
  const chunks = []
  const sections = md.split(/^## /m).slice(1) // drop preamble before first ##
  for (const section of sections) {
    const nl = section.indexOf('\n')
    const title = section.slice(0, nl).trim()
    const text = section
      .slice(nl + 1)
      .replace(/^>.*$/gm, '')
      .replace(/\n{2,}/g, '\n')
      .trim()
    if (!text) continue
    chunks.push({ id: `guide_${slug(title)}`, title, tags: ['guide'], text })
  }
  return chunks
}

// ── 2. Derived data summaries ────────────────────────────────────────────────

function questChunks() {
  const quests = readJson('quests.json')
  return quests.map((q) => {
    const reqs = []
    for (const [skill, lvl] of Object.entries(q.skillRequirements || {})) reqs.push(`${titleCaseId(skill)} ${lvl}`)
    if (q.questPointRequirement) reqs.push(`${q.questPointRequirement} quest points`)
    if (q.combatLevelRequirement) reqs.push(`combat level ${q.combatLevelRequirement}`)
    if (Array.isArray(q.questRequirements) && q.questRequirements.length) {
      reqs.push(`quests: ${q.questRequirements.map(titleCaseId).join(', ')}`)
    }
    const xp = Object.entries(q.xpReward || {})
      .map(([skill, amt]) => `${amt.toLocaleString('en-GB')} ${skill === 'any' ? 'XP in a skill of your choice' : `${titleCaseId(skill)} XP`}`)
      .join(', ')
    const rewards = []
    if (q.coinReward) rewards.push(`${q.coinReward.toLocaleString('en-GB')} coins`)
    if (xp) rewards.push(xp)
    if (Array.isArray(q.itemUnlocks) && q.itemUnlocks.length) rewards.push(`unlocks: ${q.itemUnlocks.map(titleCaseId).join(', ')}`)
    const text =
      `${q.name} is a ${q.complexity} complexity, ${q.length} length quest taking ${fmtDuration(q.durationSeconds)}. ` +
      `Requirements: ${reqs.length ? reqs.join(', ') : 'none'}. ` +
      `Rewards: ${rewards.length ? rewards.join('; ') : 'quest points only'}.`
    return { id: `quest_${q.id}`, title: `Quest: ${q.name}`, tags: ['quest', 'quests'], text }
  })
}

function prayerChunk() {
  const prayers = readJson('prayers.json')
  const lines = Object.values(prayers).map(
    (p) => `${p.name} (level ${p.level}): ${p.description}, drains ${p.drainPerMinute}/min`,
  )
  return {
    id: 'data_prayers',
    title: 'Prayer list: levels, effects and drain rates',
    tags: ['prayer', 'prayers'],
    text: `All prayers, with Prayer level required, effect and pool drain per minute. ${lines.join('. ')}.`,
  }
}

function spellChunk() {
  const spells = readJson('spells.json')
  const lines = Object.values(spells).map((sp) => {
    const runes = Object.entries(sp.runeReq || {}).map(([r, n]) => `${n} ${titleCaseId(r)}`).join(' + ')
    return `${sp.name} (Magic ${sp.levelReq}, ${sp.tier}): base damage ${sp.baseDamage}, ${sp.baseXP} base XP, runes ${runes}`
  })
  return {
    id: 'data_spells',
    title: 'Spellbook: spells, levels, damage and rune costs',
    tags: ['magic', 'spells', 'spell', 'runes'],
    text: `All combat spells. ${lines.join('. ')}.`,
  }
}

function raidChunks() {
  const raids = readJson('raids.json')
  const seen = new Set()
  return Object.entries(raids)
    .filter(([key, r]) => {
      // raids.json aliases some raids under legacy keys — keep one per id
      const id = r.id || key
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .map(([key, r]) => {
    const bosses = (r.bosses || []).map(titleCaseId).join(', ')
    const uniques = (r.rewards?.uniques || r.rewards?.rare || [])
      .map((u) => titleCaseId(u.itemId || u))
      .filter(Boolean)
    const text =
      `${r.name}: ${r.description || 'A multi-boss raid.'} Bosses: ${bosses || 'unknown'}. ` +
      `Credit skip cost: ${r.skipCost ?? 'n/a'}.` +
      (uniques.length ? ` Notable uniques: ${uniques.join(', ')}.` : '')
    return { id: `raid_${r.id || key}`, title: `Raid: ${r.name}`, tags: ['raid', 'raids', 'boss'], text }
  })
}

function minigameChunk() {
  const data = readJson('minigames.json')
  const tasks = Array.isArray(data.tasks) ? data.tasks : []
  const lines = tasks.map((t) => `${t.name} (${t.hours}h): ${t.description}${t.oneShot ? ' (one-time reward)' : ''}`)
  return {
    id: 'data_minigames',
    title: 'Minigame grinds and their rewards',
    tags: ['minigame', 'minigames'],
    text: `Available minigame tasks. ${lines.join('. ')}.`,
  }
}

function farmingChunks() {
  const data = readJson('farming.json')
  const category = (key, label) => {
    const rows = Array.isArray(data[key]) ? data[key] : []
    if (!rows.length) return null
    const lines = rows.map(
      (c) => `${c.name} (Farming ${c.level}): ${c.plantXp} XP to plant, ${c.harvestXp} XP per harvest, grows in ${fmtDuration((c.growthTimeMs || 0) / 1000)}`,
    )
    return {
      id: `farming_${key.toLowerCase()}`,
      title: `Farming: ${label}`,
      tags: ['farming', 'seeds', 'crops'],
      text: `${label} you can grow. ${lines.join('. ')}.`,
    }
  }
  return [category('herbs', 'Herbs'), category('trees', 'Trees'), category('fruitTrees', 'Fruit trees')].filter(Boolean)
}

function bossChunk() {
  const monsters = readJson('monsters.json')
  const lines = Object.values(monsters)
    .filter((m) => m.boss)
    .map((m) => {
      const slayer = m.slayerRequirement ? `, Slayer ${m.slayerRequirement} required` : ''
      return `${m.name} (combat level ${m.combatLevel}, ${m.hitpoints} HP${slayer})`
    })
  return {
    id: 'data_bosses',
    title: 'Boss list: combat levels, HP and Slayer requirements',
    tags: ['boss', 'bosses', 'slayer'],
    text: `All bosses with combat level, hitpoints and Slayer level requirement where one applies. ${lines.join('. ')}.`,
  }
}

function monsterChunks() {
  const monsters = readJson('monsters.json')
  const fmtChance = (c) => (c >= 1 ? 'always' : `1 in ${Math.round(1 / c).toLocaleString('en-GB')}`)
  return Object.values(monsters).map((m) => {
    const drops = (m.drops || [])
      .slice()
      .sort((a, b) => a.chance - b.chance)
      .map((d) => `${titleCaseId(d.itemId)} (${fmtChance(d.chance)})`)
    const kind = m.boss ? 'boss' : 'monster'
    const slayer = m.slayerRequirement ? ` Requires Slayer level ${m.slayerRequirement}.` : ''
    const text =
      `${m.name} is a ${kind} at combat level ${m.combatLevel} with ${m.hitpoints} HP, attacking with ${m.attackStyle || 'melee'}.${slayer}` +
      (drops.length ? ` Drops: ${drops.join(', ')}.` : '')
    return {
      id: `monster_${m.id}`,
      title: `${m.boss ? 'Boss' : 'Monster'}: ${m.name} — stats and drops`,
      tags: ['monster', 'drops', ...(m.boss ? ['boss'] : [])],
      text,
    }
  })
}

function clueChunks() {
  const clues = readJson('clues.json')
  // Engine constants (src/engine/clueScrolls.js): completion ticks per tier.
  const minutes = { medium: 5, hard: 15, elite: 30, master: 60 }
  return Object.entries(clues).map(([tier, data]) => {
    const rewards = data.rewards || []
    const uniques = rewards.filter((r) => r.weight < 0.05).map((r) => titleCaseId(r.itemId))
    const time = minutes[tier] ? `takes about ${minutes[tier]} minutes` : 'takes time'
    const text =
      `A ${tier} clue scroll ${time} to complete and rewards 1 to 4 rolls from a table of ` +
      `${rewards.length} possible rewards (runes, coins and gear).` +
      (uniques.length ? ` Rare uniques: ${uniques.join(', ')}.` : '')
    return { id: `clue_${tier}`, title: `Clue scroll tier: ${tier}`, tags: ['clue', 'clues', 'clue scroll'], text }
  })
}

function dailyTaskChunks() {
  const tasks = readJson('dailyTasks.json')
  const byTier = new Map()
  for (const t of tasks) {
    if (!byTier.has(t.tier)) byTier.set(t.tier, [])
    byTier.get(t.tier).push(t.name)
  }
  return [...byTier.entries()].map(([tier, names]) => ({
    id: `daily_tasks_${slug(tier)}`,
    title: `Daily tasks: ${tier} tier pool`,
    tags: ['daily', 'daily tasks', 'tasks'],
    text: `${tier} daily tasks — one is assigned each day from this pool of ${names.length}: ${names.join(', ')}.`,
  }))
}

function collectionLogChunks() {
  const log = readJson('collectionLog.json')
  return (log.categories || []).map((cat) => {
    const sections = cat.sections || []
    const total = sections.reduce((n, s) => n + (s.items || []).length, 0)
    const lines = sections.map((s) => `${s.label}: ${(s.items || []).map(titleCaseId).join(', ')}`)
    return {
      id: `collection_log_${cat.id}`,
      title: `Collection log: ${cat.label || cat.id} slots`,
      tags: ['collection log', 'collection', 'uniques'],
      text: `The ${cat.label || cat.id} collection log has ${total} slots. ${lines.join('. ')}.`,
    }
  })
}

function skillChunks() {
  const skills = readJson('skills.json')
  return Object.values(skills).map((s) => {
    const actions = (s.actions || []).slice(0, 40)
    const lines = actions.map((a) => `${a.name} (level ${a.level}, ${a.xp} XP)`)
    const more = (s.actions || []).length > 40 ? ` …and ${(s.actions || []).length - 40} more` : ''
    return {
      id: `skill_${s.id}`,
      title: `Skill training options: ${s.name}`,
      tags: ['skill', 'skills', 'training', s.id],
      text: `${s.name} training options with level requirements and XP per action: ${lines.join(', ')}${more}.`,
    }
  })
}

// ── Assemble ─────────────────────────────────────────────────────────────────

const chunks = [
  ...guideChunks(),
  ...questChunks(),
  prayerChunk(),
  spellChunk(),
  ...raidChunks(),
  minigameChunk(),
  ...farmingChunks(),
  ...skillChunks(),
  bossChunk(),
  ...monsterChunks(),
  ...clueChunks(),
  ...dailyTaskChunks(),
  ...collectionLogChunks(),
]

const ids = new Set()
for (const c of chunks) {
  if (!c.id || !c.title || !c.text) throw new Error(`Malformed chunk: ${JSON.stringify(c).slice(0, 120)}`)
  if (ids.has(c.id)) throw new Error(`Duplicate chunk id: ${c.id}`)
  ids.add(c.id)
  c.text = c.text.replace(/\s+/g, ' ').trim()
}

const body =
  `// GENERATED FILE — do not edit by hand. Regenerate with: npm run gen:knowledge\n` +
  `// Source: docs/game-guide.md + src/data/*.json (see scripts/gen-chat-knowledge.cjs)\n` +
  `export const KNOWLEDGE_CHUNKS = ${JSON.stringify(chunks, null, 1)}\n`

if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) {
  throw new Error(`knowledge.js is ${Buffer.byteLength(body, 'utf8')} bytes (cap ${MAX_BYTES}) — trim sources`)
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
fs.writeFileSync(OUT_PATH, body)
console.log(`Wrote ${OUT_PATH}: ${chunks.length} chunks, ${(Buffer.byteLength(body, 'utf8') / 1024).toFixed(1)} KiB`)
