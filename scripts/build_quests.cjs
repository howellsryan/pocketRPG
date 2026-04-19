#!/usr/bin/env node
/**
 * Generates src/data/quests.json from quest_list.csv.
 *
 * The CSV has unquoted commas inside fields (e.g. "54 Agility, 52 Thieving"),
 * so a naive split fails. Instead we anchor on the first three deterministic
 * columns (Name, complexity, duration) and then use pattern matching against
 * the remainder of the row to extract rewards/skill requirements/quest
 * prerequisites.
 */
const fs = require('fs')
const path = require('path')

const CSV_PATH = path.join(__dirname, '..', 'quest_list.csv')
const OUT_PATH = path.join(__dirname, '..', 'src', 'data', 'quests.json')

const LENGTH_BASE_MIN = { Short: 5, Medium: 15, Long: 30, 'Very Long': 60 }
const COMPLEXITY_MULT = {
  Novice: 1, Intermediate: 1.5, Experienced: 2,
  Master: 5, Grandmaster: 10, Special: 10,
}
const COIN_REWARD = {
  Novice: 1000, Intermediate: 5000, Experienced: 10000,
  Master: 25000, Grandmaster: 50000, Special: 50000,
}
const XP_REWARD = {
  Novice: 1000, Intermediate: 5000, Experienced: 12500,
  Master: 35000, Grandmaster: 75000, Special: 75000,
}

const CANONICAL_SKILLS = [
  'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
  'mining', 'woodcutting', 'fishing', 'farming', 'hunter',
  'smithing', 'cooking', 'crafting', 'fletching', 'herblore', 'runecraft',
  'firemaking', 'agility', 'thieving', 'slayer', 'construction',
]
const SKILL_ALIASES = { runecrafting: 'runecraft' }

const ITEM_UNLOCK_PATTERNS = [
  { rx: /barrows gloves/i, id: 'barrows_gloves' },
  { rx: /ava'?s assembler/i, id: 'avas_assembler' },
  { rx: /ava'?s (attractor|accumulator)/i, id: 'avas_accumulator' },
  { rx: /dragon scimitar/i, id: 'dragon_scimitar' },
  { rx: /dragon dagger/i, id: 'dragon_dagger' },
  { rx: /anti-?dragon shield/i, id: 'anti_dragon_shield' },
]

function slug(name) {
  return name.toLowerCase()
    .replace(/[''']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function firstThreeColumns(line) {
  // Name, complexity, duration never contain commas, so the first 3
  // comma-separated tokens are deterministic. Duration may be "Very Long"
  // which contains a space but no comma.
  const parts = line.split(',')
  const name = parts[0].trim()
  const complexity = parts[1].trim()
  const duration = parts[2].trim()
  const rest = parts.slice(3).join(',')
  return { name, complexity, duration, rest }
}

function extractSkillRequirements(rest) {
  const skills = {}
  let questPoints = 0
  let combatLevel = 0
  // Greedy scan: match "NN Skill" pairs anywhere in the string
  const rx = /(\d+)\s+([A-Z][a-zA-Z]*)\b/g
  let m
  while ((m = rx.exec(rest)) !== null) {
    const num = parseInt(m[1], 10)
    const rawSkill = m[2].toLowerCase()
    if (rawSkill === 'quest') {
      // Check next word — "Quest points"
      const tail = rest.slice(m.index + m[0].length).trim().toLowerCase()
      if (tail.startsWith('points')) questPoints = Math.max(questPoints, num)
      continue
    }
    if (rawSkill === 'combat') {
      const tail = rest.slice(m.index + m[0].length).trim().toLowerCase()
      if (tail.startsWith('level')) combatLevel = Math.max(combatLevel, num)
      continue
    }
    const id = SKILL_ALIASES[rawSkill] || rawSkill
    if (CANONICAL_SKILLS.includes(id)) {
      skills[id] = Math.max(skills[id] || 0, num)
    }
  }
  return { skills, questPoints, combatLevel }
}

function extractItemUnlocks(rest) {
  const found = new Set()
  for (const { rx, id } of ITEM_UNLOCK_PATTERNS) {
    if (rx.test(rest)) found.add(id)
  }
  return [...found]
}

function extractQuestPrereqs(rest, validSlugToName) {
  // Strip "N Quest points" so it doesn't accidentally match an unrelated quest
  const cleaned = rest.replace(/\b\d+\s+Quest points\b/gi, '')
  const foundSlugs = new Set()
  // Sort longer names first so "Monkey Madness II" wins over "Monkey Madness I"
  const entries = [...validSlugToName.entries()].sort(
    (a, b) => b[1].length - a[1].length
  )
  let scratch = cleaned
  for (const [slugId, questName] of entries) {
    const escaped = questName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rx = new RegExp(`(^|[^A-Za-z])${escaped}(?![A-Za-z])`, 'i')
    if (rx.test(scratch)) {
      foundSlugs.add(slugId)
      // Remove matched text so it can't also satisfy a shorter quest name
      scratch = scratch.replace(new RegExp(escaped, 'ig'), '')
    }
  }
  return [...foundSlugs]
}

function build() {
  const csv = fs.readFileSync(CSV_PATH, 'utf-8')
  const lines = csv.split(/\r?\n/).filter(Boolean)
  lines.shift() // header

  // Pass 1: gather valid slugs + name lookup (for pattern matching in Pass 2)
  const validSlugToName = new Map()
  const rowBuffers = []
  for (const line of lines) {
    const cols = firstThreeColumns(line)
    if (!cols.name) continue
    const id = slug(cols.name)
    if (validSlugToName.has(id)) continue // dedupe
    validSlugToName.set(id, cols.name)
    rowBuffers.push({ id, ...cols })
  }

  // Pass 2: full records
  const quests = []
  for (const row of rowBuffers) {
    const { id, name, complexity, duration, rest } = row
    const baseMin = LENGTH_BASE_MIN[duration]
    const mult = COMPLEXITY_MULT[complexity]
    if (!baseMin || !mult) {
      console.warn(`Skipping ${name}: unknown complexity/length ${complexity}/${duration}`)
      continue
    }
    const durationSeconds = Math.round(baseMin * mult * 60)
    const reqs = extractSkillRequirements(rest)
    const questRequirements = extractQuestPrereqs(rest, validSlugToName)
      .filter(s => s !== id) // don't require self
    const itemUnlocks = extractItemUnlocks(rest)

    const totalXp = XP_REWARD[complexity]
    const xpReward = {}
    const skillKeys = Object.keys(reqs.skills)
    if (skillKeys.length > 0) {
      const per = Math.floor(totalXp / skillKeys.length)
      for (const k of skillKeys) xpReward[k] = per
    } else {
      xpReward.attack = totalXp
    }

    quests.push({
      id,
      name,
      complexity,
      length: duration,
      durationSeconds,
      coinReward: COIN_REWARD[complexity],
      xpReward,
      itemUnlocks,
      skillRequirements: reqs.skills,
      questPointRequirement: reqs.questPoints,
      combatLevelRequirement: reqs.combatLevel,
      questRequirements,
    })
  }

  quests.sort((a, b) => a.name.localeCompare(b.name))
  fs.writeFileSync(OUT_PATH, JSON.stringify(quests, null, 2) + '\n')
  console.log(`Wrote ${quests.length} quests → ${path.relative(process.cwd(), OUT_PATH)}`)
}

build()
