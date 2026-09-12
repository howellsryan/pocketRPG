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

// monsterId → raid name for monsters that only exist inside a raid. Their
// monsters.json drop tables are never rolled — raid loot comes from the
// raid's reward chest — so their chunks must not advertise personal drops.
function raidMonsterIds(raid) {
  const ids = new Set([...(raid?.bosses || []), ...(raid?.encounterOnlyMonsters || [])])
  for (const wave of raid?.waves || []) {
    if (wave?.primary) ids.add(wave.primary)
    for (const id of wave?.initialAdds || []) ids.add(id)
    for (const group of wave?.reinforcements || []) {
      for (const id of group?.monsterIds || []) ids.add(id)
    }
  }
  return [...ids]
}

function raidBossMap() {
  const raids = readJson('raids.json')
  const seen = new Set()
  const map = new Map()
  for (const [key, r] of Object.entries(raids)) {
    const id = r.id || key
    if (seen.has(id)) continue
    seen.add(id)
    for (const monsterId of raidMonsterIds(r)) if (!map.has(monsterId)) map.set(monsterId, r.name)
  }
  return map
}

function raidChunks() {
  const raids = readJson('raids.json')
  const items = readJson('items.json')
  const monsters = readJson('monsters.json')
  const itemName = (id) => items[id]?.name || titleCaseId(id)
  const monsterName = (id) => monsters[id]?.name || titleCaseId(id)
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
    const unique = r.rewards?.unique
    const uniques = (unique?.items || []).map((u) => itemName(u.itemId || u)).filter(Boolean)

    if (Array.isArray(r.waves)) {
      const finalPrimary = r.waves[r.waves.length - 1]?.primary
      const rules = r.sunspireRewards || {}
      const chances = Object.entries(rules.uniqueChanceByWave || {})
        .map(([wave, chance]) => ({ wave: Number(wave), chance: Number(chance) }))
        .filter((entry) => entry.wave > 0 && entry.chance > 0)
        .sort((a, b) => a.wave - b.wave)
      const first = chances[0]
      const last = chances[chances.length - 1]
      const chanceText = first && last
        ? `Unique rolls begin on wave ${first.wave} at about 1 in ${Math.round(1 / first.chance)} and rise to about 1 in ${Math.round(1 / last.chance)} on wave ${last.wave}.`
        : ''
      const headline = rules.headlineItem ? itemName(rules.headlineItem) : null
      const text =
        `${r.name}: ${r.description || 'A wave-based raid.'} It has ${r.waves.length} arena waves` +
        (finalPrimary ? `, ending with ${monsterName(finalPrimary)}` : '') + '. ' +
        `Rewards are staged after each cleared wave: claim the accumulated chest to leave safely, or continue and risk it on the next wave. ` +
        chanceText + ' ' +
        (headline && rules.guaranteedFirstClear !== false ? `The first full clear guarantees ${headline}. ` : '') +
        (uniques.length ? `Sunspire uniques are: ${uniques.join(', ')}. ` : '') +
        `Ordinary Hard Mode and credit skipping are not used for this raid; between-wave modifiers are currently disabled.`
      return {
        id: `raid_${r.id || key}`,
        title: `Raid: ${r.name} — waves and unique rewards`,
        tags: ['raid', 'raids', 'boss', 'wave', 'uniques', 'drops'],
        text: text.replace(/\s+/g, ' ').trim(),
      }
    }

    const bosses = (r.bosses || []).map(titleCaseId).join(', ')
    const chestChance = unique?.chance ? `about 1 in ${Math.round(1 / unique.chance)}` : 'a'
    const text =
      `${r.name}: ${r.description || 'A multi-boss raid.'} Bosses fought in sequence: ${bosses || 'unknown'}. ` +
      `Credit skip cost: ${r.skipCost ?? 'n/a'}. ` +
      `Completing the raid rolls its reward chest: guaranteed loot (coins, runes, supplies)` +
      (uniques.length
        ? ` plus ${chestChance} chance at one unique. These uniques come from the raid reward chest itself, not from any individual boss inside the raid: ${uniques.join(', ')}.`
        : '.')
    return { id: `raid_${r.id || key}`, title: `Raid: ${r.name} — bosses and unique rewards`, tags: ['raid', 'raids', 'boss', 'uniques', 'drops'], text }
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

// Mirrors src/engine/consumables.js: combat potions grant a secondary ranged +
// magic boost on top of their primary melee boost; prayer/super_restore potions
// restore a flat amount instantly instead of a timed stat buff (their `boost`
// field in items.json is vestigial for those two effects).
const COMBAT_POTION_RANGED_BOOST = 14
const COMBAT_POTION_MAGIC_BOOST = 4
const PRAYER_RESTORE_AMOUNTS = { prayer: 20, super_restore: 22 }

function potionChunk() {
  const items = readJson('items.json')
  const potions = Object.values(items).filter((it) => it.type === 'potion')
  const lines = potions.map((p) => {
    const restore = PRAYER_RESTORE_AMOUNTS[p.effect]
    if (restore) return `${p.name}: instantly restores ${restore} Prayer points, no timed buff`
    if (p.effect === 'hp') {
      const wipe = p.wipesPotions ? '; also clears every other active potion buff' : ''
      return `${p.name}: instantly heals ${p.boost} HP${wipe}, no timed stat buff`
    }
    const boost = Number(p.boost) || 0
    const dur = fmtDuration(Number(p.duration) || 300)
    const stats = p.effect === 'combat'
      ? `+${boost} Attack, +${boost} Strength, +${boost} Defence, +${COMBAT_POTION_RANGED_BOOST} Ranged, +${COMBAT_POTION_MAGIC_BOOST} Magic`
      : `+${boost} ${titleCaseId(p.effect)}`
    return `${p.name}: ${stats} for ${dur}`
  })
  return {
    id: 'data_potions',
    title: 'Potions: stat boosts, heals and durations',
    tags: ['potion', 'potions', 'boost', 'buff', 'super combat', 'super strength', 'super attack', 'super defence'],
    text:
      `All potions and what they do. Stat-boost potions last a limited time, stack additively with other active potions ` +
      `on the same stat, and never delay your next attack (they're combo consumables). ${lines.join('. ')}.`,
  }
}

// Woodcutting axes use a dedicated override map instead of their own item
// speedMultiplier field — mirrors WOODCUTTING_AXE_SPEED_MULTIPLIERS in
// src/engine/skilling.js (kept in lockstep by tests/skilling.test.ts).
const WOODCUTTING_AXE_SPEED_MULTIPLIERS = {
  bronze_axe: 1.00, iron_axe: 0.90, steel_axe: 0.85, black_axe: 0.80,
  mithril_axe: 0.75, adamant_axe: 0.70, runeforged_axe: 0.62, dragon_axe: 0.56,
  infernal_axe: 0.53, shardglass_axe: 0.50, third_age_axe: 0.50, '2nd_age_axe': 0.50,
}

// Mirrors SHARDGLASS_GATHER_TOOLS / SHARDGLASS_SHARDS_PER_GATHER in
// src/engine/skilling.js: while charged with Shardglass Shards, these tools
// burn shards from their own charge (not loose inventory shards) each action
// and double the gathered yield — live, idle and offline alike.
const SHARDGLASS_SHARDS_PER_GATHER = 2
const SHARDGLASS_GATHER_TOOL_IDS = new Set(['shardglass_pickaxe', 'shardglass_axe'])

function toolSpeedChunk() {
  const items = readJson('items.json')
  const bySkill = { woodcutting: [], mining: [], fishing: [] }
  for (const it of Object.values(items)) {
    if (!it.toolFor || !(it.toolFor in bySkill)) continue
    const mult = it.toolFor === 'woodcutting'
      ? (WOODCUTTING_AXE_SPEED_MULTIPLIERS[it.id] ?? it.speedMultiplier ?? 1)
      : (it.speedMultiplier ?? 1)
    bySkill[it.toolFor].push({ item: it, mult })
  }
  const label = { woodcutting: 'Woodcutting axes, on trees', mining: 'Mining pickaxes, on ore', fishing: 'Fishing tools' }
  const sections = Object.entries(bySkill).map(([skill, tools]) => {
    tools.sort((a, b) => b.mult - a.mult)
    const lines = tools.map(({ item, mult }) => {
      const pct = Math.round((1 - mult) * 100)
      const reqs = Object.entries(item.requirements || {}).map(([sk, lvl]) => `${titleCaseId(sk)} ${lvl}`).join(' + ')
      const speed = pct <= 0 ? 'no speed bonus (baseline)' : `${pct}% faster action time`
      const perk = SHARDGLASS_GATHER_TOOL_IDS.has(item.id)
        ? `; while charged with Shardglass Shards, also doubles the ore/log yield per action (burns ${SHARDGLASS_SHARDS_PER_GATHER} shards from the tool's own charge each time)`
        : ''
      return `${item.name}${reqs ? ` (requires ${reqs})` : ''}: ${speed}${perk}`
    })
    return `${label[skill]} — ${lines.join('. ')}.`
  })
  return {
    id: 'data_gathering_tool_speed',
    title: 'Gathering tool speed: woodcutting axes, mining pickaxes and fishing tools',
    tags: ['tool', 'tools', 'axe', 'pickaxe', 'dragon axe', 'dragon pickaxe', 'shardglass', 'shardglass pickaxe', 'shardglass axe', 'speed', 'woodcutting', 'mining', 'fishing'],
    text:
      `Woodcutting, Mining and Fishing can always be done bare-handed, but holding no tool at all takes twice as long as ` +
      `even the most basic tool tier. Better tool tiers cut the action time further; each tier needs the shown skill ` +
      `(and sometimes Attack) level to use. The Shardglass Pickaxe and Shardglass Axe match the Dragon tools for speed ` +
      `and additionally double gathered ore/logs while charged with Shardglass Shards (loaded like any other scale-charged ` +
      `weapon); once their charges run out they stop counting as a tool at all until recharged. ${sections.join(' ')}`,
  }
}

function specialAttackChunk() {
  const items = readJson('items.json')
  const lines = Object.values(items)
    .filter((it) => it.specialAttack)
    .map((it) => {
      const cost = it.specialAttack.energyCostPercent
        ? `${it.specialAttack.energyCostPercent}% of current energy`
        : `${it.specialAttack.energyCost}% energy`
      return `${it.name} (${cost}): ${it.specialAttack.description}`
    })
  return {
    id: 'data_special_attacks',
    title: 'Weapon special attacks: which weapons have one and what they do',
    tags: ['special attack', 'special', 'weapon', 'weapons'],
    text:
      `Every weapon with a special attack, its energy cost and effect. Special attacks are triggered manually with the ` +
      `⚡ Special Attack button, never automatically or offline; special energy runs 0-100, starts each fight at 100, ` +
      `drains on use and refills on a kill. ${lines.join('. ')}.`,
  }
}

function bossChunk() {
  const monsters = readJson('monsters.json')
  const raidBosses = raidBossMap()
  const lines = Object.values(monsters)
    .filter((m) => m.boss)
    .map((m) => {
      const slayer = m.slayerRequirement ? `, Slayer ${m.slayerRequirement} required` : ''
      const raid = raidBosses.get(m.id) ? `, fought inside the ${raidBosses.get(m.id)} raid` : ''
      return `${m.name} (combat level ${m.combatLevel}, ${m.hitpoints} HP${slayer}${raid})`
    })
  return {
    id: 'data_bosses',
    title: 'Boss list: combat levels, HP and Slayer requirements',
    tags: ['boss', 'bosses', 'slayer'],
    text: `All bosses with combat level, hitpoints and Slayer level requirement where one applies. Bosses marked as raid bosses are only fought inside their raid and have no personal drop table. ${lines.join('. ')}.`,
  }
}

function monsterChunks() {
  const monsters = readJson('monsters.json')
  const raidBosses = raidBossMap()
  const fmtChance = (c) => (c >= 1 ? 'always' : `1 in ${Math.round(1 / c).toLocaleString('en-GB')}`)
  return Object.values(monsters).map((m) => {
    const slayer = m.slayerRequirement ? ` Requires Slayer level ${m.slayerRequirement}.` : ''
    const raidName = raidBosses.get(m.id)
    if (raidName) {
      const role = m.boss ? 'boss' : 'encounter monster'
      const text =
        `${m.name} is a raid ${role} fought only inside the ${raidName}, at combat level ${m.combatLevel} with ${m.hitpoints} HP, attacking with ${m.attackStyle || 'melee'}.${slayer}` +
        ` It has no personal drop table — rewards come from the raid's own server-authoritative reward flow.`
      return {
        id: `monster_${m.id}`,
        title: `Raid ${role}: ${m.name} (${raidName})`,
        tags: ['monster', ...(m.boss ? ['boss'] : []), 'raid'],
        text,
      }
    }
    const drops = (m.drops || [])
      .slice()
      .sort((a, b) => a.chance - b.chance)
      .map((d) => `${titleCaseId(d.itemId)} (${fmtChance(d.chance)})`)
    const kind = m.boss ? 'boss' : 'monster'
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
  const items = readJson('items.json')
  const itemName = (id) => items[id]?.name || titleCaseId(id)
  // Recipe/ingredient line for a production action: "needs 1 Marshflax + 1
  // Crushed Bird's Nest → Lumira Brew". Only emitted when the action lists
  // materials, so the chat helper can answer "how do I make X?" precisely.
  const recipeOf = (a) => {
    const mats = a.materials && typeof a.materials === 'object' ? Object.entries(a.materials) : []
    if (!mats.length) return ''
    const needs = mats.map(([id, qty]) => `${qty} ${itemName(id)}`).join(' + ')
    const product = a.product ? ` → ${itemName(a.product)}` : ''
    return `; needs ${needs}${product}`
  }
  return Object.values(skills).map((s) => {
    const actions = (s.actions || []).slice(0, 40)
    const lines = actions.map((a) => `${a.name} (level ${a.level}, ${a.xp} XP${recipeOf(a)})`)
    const more = (s.actions || []).length > 40 ? ` …and ${(s.actions || []).length - 40} more` : ''
    return {
      id: `skill_${s.id}`,
      title: `Skill training options: ${s.name}`,
      tags: ['skill', 'skills', 'training', 'ingredients', 'materials', 'recipe', s.id],
      text: `${s.name} training options with level requirements, XP per action and any ingredients required to make each item: ${lines.join(', ')}${more}.`,
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
  potionChunk(),
  toolSpeedChunk(),
  specialAttackChunk(),
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
