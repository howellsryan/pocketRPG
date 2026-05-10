#!/usr/bin/env node

/**
 * PocketRPG Economy Benchmark
 *
 * Generates expected coins/hour reports for:
 * - Skilling actions
 * - Monsters
 * - Raids
 * - Minigames
 * - Farming crops
 *
 * Assumption:
 * - The player sells everything at item.shopValue.
 * - Coins are valued at 1 each, even though the coins item has shopValue: 0.
 * - Production skills include both gross and net value, where net subtracts material opportunity cost.
 * - Monster coins/hour uses a configurable kills/hour assumption because true kill speed depends on gear/stats.
 *
 * Usage:
 *   node scripts/economy-benchmark.cjs
 *   node scripts/economy-benchmark.cjs --kills-per-hour=500
 *   node scripts/economy-benchmark.cjs --raid-completions-per-hour=2
 *   node scripts/economy-benchmark.cjs --out=reports/economy-benchmark
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'src', 'data')
const TICK_MS = 600
const ACTIONS_PER_HOUR_PER_TICK = 3_600_000 / TICK_MS

const args = parseArgs(process.argv.slice(2))

const DEFAULT_KILLS_PER_HOUR = Number(args['kills-per-hour'] ?? 100)
const DEFAULT_RAID_COMPLETIONS_PER_HOUR = Number(args['raid-completions-per-hour'] ?? 1)
const FARMING_HERB_YIELD = Number(args['farming-herb-yield'] ?? 1)
const FARMING_TREE_YIELD = Number(args['farming-tree-yield'] ?? 1)
const FARMING_FRUIT_YIELD = Number(args['farming-fruit-yield'] ?? 6)
const OUT_BASE = String(args.out ?? 'reports/economy-benchmark')

const items = readJsonRequired('items.json')
const skills = readJsonOptional('skills.json', {})
const monsters = readJsonOptional('monsters.json', {})
const raids = readJsonOptional('raids.json', {})
const minigames = readJsonOptional('minigames.json', {})
const farming = readJsonOptional('farming.json', {})
const clues = readJsonOptional('clues.json', {})
const collectionLog = readJsonOptional('collectionLog.json', {})

const missingItemIds = new Set()
const zeroValueItemIds = new Set()

const rows = [
  ...buildSkillRows(skills, collectionLog, raids),
  ...buildMonsterRows(monsters, raids),
  ...buildRaidRows(raids),
  ...buildMinigameRows(minigames),
  ...buildFarmingRows(farming),
  ...buildClueRows(clues),
]

const filteredRows = rows
  .filter(row => Number.isFinite(row.grossCoinsPerHour))
  .sort((a, b) => {
    const categoryCompare = String(a.category).localeCompare(String(b.category))
    if (categoryCompare !== 0) return categoryCompare
    return Number(b.netCoinsPerHour || 0) - Number(a.netCoinsPerHour || 0)
  })

writeReport(filteredRows)
writeCsv(filteredRows)

console.log(`✅ Economy benchmark written:`)
console.log(`   ${path.resolve(ROOT, `${OUT_BASE}.md`)}`)
console.log(`   ${path.resolve(ROOT, `${OUT_BASE}.csv`)}`)
console.log('')
console.log(`Rows: ${filteredRows.length}`)
console.log(`Missing item ids: ${missingItemIds.size}`)
console.log(`Zero-value item ids: ${zeroValueItemIds.size}`)

function parseArgs(argv) {
  const parsed = {}

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue

    const withoutPrefix = arg.slice(2)
    const separatorIndex = withoutPrefix.indexOf('=')

    if (separatorIndex === -1) {
      parsed[withoutPrefix] = true
      continue
    }

    const key = withoutPrefix.slice(0, separatorIndex)
    const value = withoutPrefix.slice(separatorIndex + 1)
    parsed[key] = value
  }

  return parsed
}

function readJsonRequired(fileName) {
  const filePath = path.join(DATA_DIR, fileName)

  if (!fs.existsSync(filePath)) {
    throw new Error(`Required data file not found: ${filePath}`)
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readJsonOptional(fileName, fallback) {
  const filePath = path.join(DATA_DIR, fileName)

  if (!fs.existsSync(filePath)) {
    return fallback
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function itemUnitValue(itemId) {
  if (!itemId) return 0

  if (itemId === 'coins') {
    return 1
  }

  const item = items[itemId]

  if (!item) {
    missingItemIds.add(itemId)
    return 0
  }

  const value = Number(item.shopValue ?? 0)

  if (value === 0) {
    zeroValueItemIds.add(itemId)
  }

  return value
}

function itemName(itemId) {
  if (!itemId) return ''
  return items[itemId]?.name || itemId
}

function averageQuantity(quantity) {
  if (quantity == null) return 1

  if (Array.isArray(quantity)) {
    const [min, max] = quantity
    return (Number(min || 0) + Number(max || 0)) / 2
  }

  return Number(quantity || 0)
}

function chanceValue(chance) {
  if (chance == null) return 1

  const parsed = Number(chance)

  if (!Number.isFinite(parsed)) return 1

  return parsed
}

function expectedDropValue(drop) {
  if (!drop || !drop.itemId) return 0

  const chance = chanceValue(drop.chance)
  const qty = averageQuantity(drop.quantity)
  const value = itemUnitValue(drop.itemId)

  return chance * qty * value
}

function expectedDropTableValue(dropTable) {
  if (!Array.isArray(dropTable)) return 0
  return dropTable.reduce((sum, drop) => sum + expectedDropValue(drop), 0)
}

function formatDropBreakdown(dropTable, maxEntries = 8) {
  if (!Array.isArray(dropTable) || dropTable.length === 0) return ''

  const entries = dropTable
    .map(drop => {
      const ev = expectedDropValue(drop)
      return {
        itemId: drop.itemId,
        ev,
      }
    })
    .sort((a, b) => b.ev - a.ev)
    .slice(0, maxEntries)
    .map(entry => `${itemName(entry.itemId)}: ${formatNumber(entry.ev)}`)

  if (dropTable.length > maxEntries) {
    entries.push(`+${dropTable.length - maxEntries} more`)
  }

  return entries.join('; ')
}

function actionProductValue(action) {
  if (!action) return 0

  if (Array.isArray(action.dropTable)) {
    return expectedDropTableValue(action.dropTable)
  }

  if (Array.isArray(action.rewardItems)) {
    return action.rewardItems.reduce((sum, itemId) => {
      return sum + itemUnitValue(itemId)
    }, 0)
  }

  if (action.product) {
    const qty = Number(action.productQty ?? action.qty ?? 1)
    return qty * itemUnitValue(action.product)
  }

  if (action.coinReward) {
    return Number(action.coinReward)
  }

  if (action.coins) {
    return averageQuantity(action.coins)
  }

  return 0
}

function actionMaterialCost(action) {
  if (!action || !action.materials) return 0

  return Object.entries(action.materials).reduce((sum, [itemId, qty]) => {
    return sum + Number(qty || 0) * itemUnitValue(itemId)
  }, 0)
}

function actionsPerHourFromTicks(ticks) {
  const parsedTicks = Number(ticks)

  if (!Number.isFinite(parsedTicks) || parsedTicks <= 0) {
    return 0
  }

  return ACTIONS_PER_HOUR_PER_TICK / parsedTicks
}

function buildSkillRows(skillsData, collectionLogData, raidsData) {
  const result = []
  const blockedMaterials = collectBlockedMaterialIds(collectionLogData, raidsData, skillsData)

  for (const [skillId, skill] of Object.entries(skillsData || {})) {
    const actions = Array.isArray(skill.actions) ? skill.actions : []

    for (const action of actions) {
      if (actionUsesBlockedMaterial(action, blockedMaterials)) {
        continue
      }

      const actionsPerHour = actionsPerHourFromTicks(action.ticks)
      const grossPerAction = actionProductValue(action)
      const materialCostPerAction = actionMaterialCost(action)
      const netPerAction = grossPerAction - materialCostPerAction

      result.push({
        category: 'Skilling',
        subcategory: skill.name || skillId,
        id: `${skillId}:${action.id}`,
        name: action.name || action.id,
        level: action.level ?? '',
        ticks: action.ticks ?? '',
        actionsPerHour,
        expectedValuePerAction: grossPerAction,
        expectedValuePerKill: '',
        expectedValuePerCompletion: '',
        materialCostPerAction,
        netValuePerAction: netPerAction,
        grossCoinsPerHour: grossPerAction * actionsPerHour,
        netCoinsPerHour: netPerAction * actionsPerHour,
        notes: buildActionNotes(action),
      })
    }
  }

  return result
}

function actionUsesBlockedMaterial(action, blockedMaterials) {
  if (!action?.materials || !blockedMaterials || blockedMaterials.size === 0) {
    return false
  }

  return Object.keys(action.materials).some(itemId => blockedMaterials.has(itemId))
}

function collectBlockedMaterialIds(collectionLogData, raidsData, skillsData) {
  const ids = new Set()

  for (const raid of Object.values(raidsData || {})) {
    for (const item of (raid?.rewards?.unique?.items || [])) {
      if (item?.itemId) ids.add(item.itemId)
    }
  }

  for (const category of (collectionLogData?.categories || [])) {
    for (const section of (category?.sections || [])) {
      for (const itemId of (section?.items || [])) ids.add(itemId)
    }
  }

  for (const itemId of (collectionLogData?.sharedItems || [])) {
    ids.add(itemId)
  }

  // Explicit non-repeatable resources currently treated as blocked inputs.
  ids.add('godsword_shard')

  // Propagate blocked status through skilling dependency chains:
  // if an action consumes blocked input, its produced item is also blocked.
  let changed = true
  while (changed) {
    changed = false
    for (const skill of Object.values(skillsData || {})) {
      for (const action of (skill?.actions || [])) {
        if (!action?.product || !action?.materials) continue
        const usesBlocked = Object.keys(action.materials).some(itemId => ids.has(itemId))
        if (usesBlocked && !ids.has(action.product)) {
          ids.add(action.product)
          changed = true
        }
      }
    }
  }

  return ids
}

function buildActionNotes(action) {
  const notes = []

  if (action.product) {
    notes.push(`Product: ${itemName(action.product)} x${Number(action.productQty ?? action.qty ?? 1)}`)
  }

  if (Array.isArray(action.rewardItems)) {
    notes.push(`Rewards: ${action.rewardItems.map(itemName).join(', ')}`)
  }

  if (Array.isArray(action.dropTable)) {
    notes.push(`Drop EV: ${formatDropBreakdown(action.dropTable)}`)
  }

  if (action.materials) {
    const materials = Object.entries(action.materials)
      .filter(([, qty]) => Number(qty || 0) > 0)
      .map(([itemId, qty]) => `${itemName(itemId)} x${qty}`)

    if (materials.length > 0) {
      notes.push(`Materials: ${materials.join(', ')}`)
    }
  }

  return notes.join(' | ')
}

function buildMonsterRows(monstersData, raidsData) {
  const raidBossIds = collectRaidBossIds(raidsData)
  const result = []

  for (const [monsterId, monster] of Object.entries(monstersData || {})) {
    if (raidBossIds.has(monsterId)) continue
    const drops = Array.isArray(monster.drops) ? monster.drops : []
    const evPerKill = expectedDropTableValue(drops)
    const killsPerHour = getMonsterKillsPerHour(monsterId)

    result.push({
      category: 'Monsters',
      subcategory: monster.combatLevel != null ? `Combat ${monster.combatLevel}` : '',
      id: monsterId,
      name: monster.name || monsterId,
      level: monster.combatLevel ?? '',
      ticks: '',
      actionsPerHour: killsPerHour,
      expectedValuePerAction: '',
      expectedValuePerKill: evPerKill,
      expectedValuePerCompletion: '',
      materialCostPerAction: '',
      netValuePerAction: '',
      grossCoinsPerHour: evPerKill * killsPerHour,
      netCoinsPerHour: evPerKill * killsPerHour,
      notes: `Assumes ${formatNumber(killsPerHour)} kills/hr. EV: ${formatDropBreakdown(drops)}`,
    })
  }

  return result
}


function collectRaidBossIds(raidsData) {
  const ids = new Set()

  for (const raid of Object.values(raidsData || {})) {
    for (const bossId of (raid?.bosses || [])) {
      ids.add(bossId)
    }
  }

  return ids
}
function getMonsterKillsPerHour(monsterId) {
  const rawOverrides = String(args['monster-kills-per-hour'] ?? args['monster-kph'] ?? '').trim()

  if (!rawOverrides) {
    return DEFAULT_KILLS_PER_HOUR
  }

  const overrides = rawOverrides
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

  for (const override of overrides) {
    const [id, rawRate] = override.split(':')
    if (id === monsterId) {
      const rate = Number(rawRate)
      if (Number.isFinite(rate) && rate >= 0) return rate
    }
  }

  return DEFAULT_KILLS_PER_HOUR
}

function buildRaidRows(raidsData) {
  const result = []

  for (const [raidId, raid] of Object.entries(raidsData || {})) {
    const alwaysDrops = raid.rewards?.always || []
    const alwaysEv = expectedDropTableValue(alwaysDrops)
    const uniqueEv = expectedWeightedUniqueValue(raid.rewards?.unique)
    const evPerCompletion = alwaysEv + uniqueEv

    result.push({
      category: 'Raids',
      subcategory: raid.name || raidId,
      id: raidId,
      name: raid.name || raidId,
      level: '',
      ticks: '',
      actionsPerHour: DEFAULT_RAID_COMPLETIONS_PER_HOUR,
      expectedValuePerAction: '',
      expectedValuePerKill: '',
      expectedValuePerCompletion: evPerCompletion,
      materialCostPerAction: '',
      netValuePerAction: '',
      grossCoinsPerHour: evPerCompletion * DEFAULT_RAID_COMPLETIONS_PER_HOUR,
      netCoinsPerHour: evPerCompletion * DEFAULT_RAID_COMPLETIONS_PER_HOUR,
      notes: [
        `Assumes ${formatNumber(DEFAULT_RAID_COMPLETIONS_PER_HOUR)} completions/hr`,
        `Common EV: ${formatNumber(alwaysEv)}`,
        `Unique EV: ${formatNumber(uniqueEv)}`,
        formatUniqueBreakdown(raid.rewards?.unique),
      ].filter(Boolean).join(' | '),
    })
  }

  return result
}

function expectedWeightedUniqueValue(uniqueTable) {
  if (!uniqueTable || !Array.isArray(uniqueTable.items)) return 0

  const uniqueChance = chanceValue(uniqueTable.chance)
  const totalWeight = uniqueTable.items.reduce((sum, item) => sum + Number(item.weight || 0), 0)

  if (totalWeight <= 0) return 0

  return uniqueTable.items.reduce((sum, item) => {
    const itemChance = uniqueChance * (Number(item.weight || 0) / totalWeight)
    return sum + itemChance * itemUnitValue(item.itemId)
  }, 0)
}

function formatUniqueBreakdown(uniqueTable, maxEntries = 8) {
  if (!uniqueTable || !Array.isArray(uniqueTable.items)) return ''

  const uniqueChance = chanceValue(uniqueTable.chance)
  const totalWeight = uniqueTable.items.reduce((sum, item) => sum + Number(item.weight || 0), 0)

  if (totalWeight <= 0) return ''

  const entries = uniqueTable.items
    .map(item => {
      const itemChance = uniqueChance * (Number(item.weight || 0) / totalWeight)
      const ev = itemChance * itemUnitValue(item.itemId)

      return {
        itemId: item.itemId,
        itemChance,
        ev,
      }
    })
    .sort((a, b) => b.ev - a.ev)
    .slice(0, maxEntries)
    .map(entry => `${itemName(entry.itemId)} ${formatPercent(entry.itemChance)} EV ${formatNumber(entry.ev)}`)

  if (uniqueTable.items.length > maxEntries) {
    entries.push(`+${uniqueTable.items.length - maxEntries} more`)
  }

  return `Unique table: ${entries.join('; ')}`
}

function buildMinigameRows(minigamesData) {
  const tasks = Array.isArray(minigamesData.tasks) ? minigamesData.tasks : []
  const result = []

  for (const task of tasks) {
    const durationHours = Number(task.hours || 0) || ticksToHours(task.ticks)
    const rewardValue = minigameRewardValue(task)
    const coinsPerHour = durationHours > 0 ? rewardValue / durationHours : 0

    result.push({
      category: 'Minigames',
      subcategory: task.minigame || '',
      id: task.id,
      name: task.name || task.id,
      level: '',
      ticks: task.ticks ?? '',
      actionsPerHour: durationHours > 0 ? 1 / durationHours : 0,
      expectedValuePerAction: rewardValue,
      expectedValuePerKill: '',
      expectedValuePerCompletion: rewardValue,
      materialCostPerAction: '',
      netValuePerAction: rewardValue,
      grossCoinsPerHour: coinsPerHour,
      netCoinsPerHour: coinsPerHour,
      notes: [
        task.oneShot ? 'One-shot reward' : '',
        task.product ? `Product: ${itemName(task.product)} x${Number(task.qty ?? 1)}` : '',
        Array.isArray(task.rewardItems) ? `Rewards: ${task.rewardItems.map(itemName).join(', ')}` : '',
        durationHours > 0 ? `Duration: ${formatNumber(durationHours)} hours` : '',
      ].filter(Boolean).join(' | '),
    })
  }

  return result
}

function minigameRewardValue(task) {
  if (Array.isArray(task.rewardItems)) {
    return task.rewardItems.reduce((sum, itemId) => sum + itemUnitValue(itemId), 0)
  }

  if (task.product) {
    if (task.product === 'void_knight_set' && Array.isArray(task.rewardItems)) {
      return task.rewardItems.reduce((sum, itemId) => sum + itemUnitValue(itemId), 0)
    }

    return Number(task.qty ?? 1) * itemUnitValue(task.product)
  }

  return 0
}

function buildFarmingRows(farmingData) {
  const result = []
  const patchCounts = getFarmingPatchCounts(farmingData.locations || [])

  addFarmingCropRows(result, 'Herb', farmingData.herbs || [], patchCounts.herb, FARMING_HERB_YIELD)
  addFarmingCropRows(result, 'Tree', farmingData.trees || [], patchCounts.tree, FARMING_TREE_YIELD)
  addFarmingCropRows(result, 'Fruit tree', farmingData.fruitTrees || [], patchCounts.fruitTree, FARMING_FRUIT_YIELD, true)

  return result
}

function getFarmingPatchCounts(locations) {
  const counts = {
    herb: 0,
    tree: 0,
    fruitTree: 0,
  }

  for (const location of locations) {
    for (const patch of location.patches || []) {
      if (!counts[patch.type] && counts[patch.type] !== 0) {
        counts[patch.type] = 0
      }

      counts[patch.type] += Number(patch.count || 0)
    }
  }

  return counts
}

function addFarmingCropRows(result, cropType, crops, totalPatchCount, defaultYield, useFruitLimit = false) {
  for (const crop of crops) {
    const growthHours = Number(crop.growthTimeMs || 0) / 3_600_000
    const harvestQty = useFruitLimit
      ? Number(crop.fruitLimit ?? defaultYield)
      : defaultYield

    const valuePerPatchCycle = harvestQty * itemUnitValue(crop.cropId)
    const perPatchCoinsPerHour = growthHours > 0 ? valuePerPatchCycle / growthHours : 0
    const allPatchCoinsPerHour = perPatchCoinsPerHour * Number(totalPatchCount || 0)

    result.push({
      category: 'Farming',
      subcategory: cropType,
      id: crop.id,
      name: `${crop.name || crop.id} (${cropType}, per patch)`,
      level: crop.level ?? '',
      ticks: '',
      actionsPerHour: growthHours > 0 ? 1 / growthHours : 0,
      expectedValuePerAction: valuePerPatchCycle,
      expectedValuePerKill: '',
      expectedValuePerCompletion: valuePerPatchCycle,
      materialCostPerAction: itemUnitValue(crop.id),
      netValuePerAction: valuePerPatchCycle - itemUnitValue(crop.id),
      grossCoinsPerHour: perPatchCoinsPerHour,
      netCoinsPerHour: growthHours > 0 ? (valuePerPatchCycle - itemUnitValue(crop.id)) / growthHours : 0,
      notes: `Per patch. Crop: ${itemName(crop.cropId)} x${harvestQty}. Growth: ${formatNumber(growthHours)} hours.`,
    })

    result.push({
      category: 'Farming',
      subcategory: cropType,
      id: `${crop.id}:all-patches`,
      name: `${crop.name || crop.id} (${cropType}, all ${totalPatchCount} patches)`,
      level: crop.level ?? '',
      ticks: '',
      actionsPerHour: growthHours > 0 ? Number(totalPatchCount || 0) / growthHours : 0,
      expectedValuePerAction: valuePerPatchCycle * Number(totalPatchCount || 0),
      expectedValuePerKill: '',
      expectedValuePerCompletion: valuePerPatchCycle * Number(totalPatchCount || 0),
      materialCostPerAction: itemUnitValue(crop.id) * Number(totalPatchCount || 0),
      netValuePerAction: (valuePerPatchCycle - itemUnitValue(crop.id)) * Number(totalPatchCount || 0),
      grossCoinsPerHour: allPatchCoinsPerHour,
      netCoinsPerHour: growthHours > 0
        ? ((valuePerPatchCycle - itemUnitValue(crop.id)) * Number(totalPatchCount || 0)) / growthHours
        : 0,
      notes: `All available ${cropType.toLowerCase()} patches from farming.json. Crop: ${itemName(crop.cropId)} x${harvestQty}. Growth: ${formatNumber(growthHours)} hours.`,
    })
  }
}

function buildClueRows(clueData) {
  const result = []

  const clueEntries = normaliseClueEntries(clueData)

  for (const clue of clueEntries) {
    const rewards = clue.rewards || clue.dropTable || clue.items || []

    if (!Array.isArray(rewards) || rewards.length === 0) {
      continue
    }

    const ev = expectedDropTableValue(rewards)

    result.push({
      category: 'Clues',
      subcategory: clue.tier || clue.id || '',
      id: clue.id || clue.tier || clue.name,
      name: clue.name || clue.id || clue.tier || 'Clue',
      level: '',
      ticks: '',
      actionsPerHour: '',
      expectedValuePerAction: '',
      expectedValuePerKill: '',
      expectedValuePerCompletion: ev,
      materialCostPerAction: '',
      netValuePerAction: '',
      grossCoinsPerHour: '',
      netCoinsPerHour: '',
      notes: `EV per clue completion only. ${formatDropBreakdown(rewards)}`,
    })
  }

  return result
}

function normaliseClueEntries(clueData) {
  if (Array.isArray(clueData)) return clueData

  if (Array.isArray(clueData.clues)) return clueData.clues

  return Object.entries(clueData || {}).map(([id, value]) => {
    if (value && typeof value === 'object') {
      return { id, ...value }
    }

    return { id, value }
  })
}

function ticksToHours(ticks) {
  const parsedTicks = Number(ticks)
  if (!Number.isFinite(parsedTicks) || parsedTicks <= 0) return 0
  return parsedTicks * TICK_MS / 3_600_000
}

function writeReport(reportRows) {
  const outPath = path.resolve(ROOT, `${OUT_BASE}.md`)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  const byCategory = groupBy(reportRows, row => row.category)
  const topRows = [...reportRows]
    .filter(row => Number(row.netCoinsPerHour) > 0)
    .sort((a, b) => Number(b.netCoinsPerHour) - Number(a.netCoinsPerHour))
    .slice(0, 50)

  const lines = []

  lines.push('# PocketRPG Economy Benchmark')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Assumptions')
  lines.push('')
  lines.push(`- Tick length: ${TICK_MS}ms.`)
  lines.push('- Coins are valued at 1 each.')
  lines.push('- All item rewards are valued using `item.shopValue`.')
  lines.push('- Production net value subtracts material opportunity cost.')
  lines.push(`- Monster coins/hour assumes ${formatNumber(DEFAULT_KILLS_PER_HOUR)} kills/hour unless overridden.`)
  lines.push(`- Raid coins/hour assumes ${formatNumber(DEFAULT_RAID_COMPLETIONS_PER_HOUR)} completions/hour.`)
  lines.push(`- Farming herb/tree yields default to ${FARMING_HERB_YIELD}/${FARMING_TREE_YIELD}; fruit trees use fruitLimit where present, otherwise ${FARMING_FRUIT_YIELD}.`)
  lines.push('')
  lines.push('## Top activities by net coins/hour')
  lines.push('')
  lines.push(markdownTable(topRows))
  lines.push('')

  for (const category of Object.keys(byCategory).sort()) {
    lines.push(`## ${category}`)
    lines.push('')
    lines.push(markdownTable(byCategory[category]))
    lines.push('')
  }

  lines.push('## Data quality notes')
  lines.push('')
  lines.push(`- Missing item ids treated as 0 value: ${missingItemIds.size === 0 ? 'None' : [...missingItemIds].sort().join(', ')}`)
  lines.push(`- Existing item ids with 0 shopValue: ${zeroValueItemIds.size === 0 ? 'None' : [...zeroValueItemIds].sort().join(', ')}`)
  lines.push('')

  fs.writeFileSync(outPath, lines.join('\n'))
}

function writeCsv(reportRows) {
  const outPath = path.resolve(ROOT, `${OUT_BASE}.csv`)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  const headers = [
    'category',
    'subcategory',
    'id',
    'name',
    'level',
    'ticks',
    'actionsPerHour',
    'expectedValuePerAction',
    'expectedValuePerKill',
    'expectedValuePerCompletion',
    'materialCostPerAction',
    'netValuePerAction',
    'grossCoinsPerHour',
    'netCoinsPerHour',
    'notes',
  ]

  const csv = [
    headers.join(','),
    ...reportRows.map(row => headers.map(header => csvEscape(row[header])).join(',')),
  ].join('\n')

  fs.writeFileSync(outPath, csv)
}

function markdownTable(reportRows) {
  if (!reportRows || reportRows.length === 0) {
    return '_No rows._'
  }

  const rowsForTable = reportRows.map(row => ({
    Category: row.subcategory || row.category,
    Name: row.name,
    Level: row.level,
    Ticks: row.ticks,
    'Actions/hr': formatNumber(row.actionsPerHour),
    'EV/action': formatNumber(row.expectedValuePerAction),
    'EV/kill': formatNumber(row.expectedValuePerKill),
    'EV/completion': formatNumber(row.expectedValuePerCompletion),
    'Gross coins/hr': formatNumber(row.grossCoinsPerHour),
    'Net coins/hr': formatNumber(row.netCoinsPerHour),
    Notes: row.notes,
  }))

  const headers = Object.keys(rowsForTable[0])
  const lines = []

  lines.push(`| ${headers.join(' | ')} |`)
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`)

  for (const row of rowsForTable) {
    lines.push(`| ${headers.map(header => markdownEscape(row[header])).join(' | ')} |`)
  }

  return lines.join('\n')
}

function groupBy(values, keyFn) {
  return values.reduce((groups, value) => {
    const key = keyFn(value)
    if (!groups[key]) groups[key] = []
    groups[key].push(value)
    return groups
  }, {})
}

function csvEscape(value) {
  if (value == null) return ''

  const stringValue = String(value)

  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  return stringValue
}

function markdownEscape(value) {
  if (value == null || value === '') return ''

  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')
}

function formatNumber(value) {
  if (value == null || value === '') return ''

  const numeric = Number(value)

  if (!Number.isFinite(numeric)) {
    return ''
  }

  if (Math.abs(numeric) >= 100) {
    return Math.round(numeric).toLocaleString('en-GB')
  }

  if (Math.abs(numeric) >= 10) {
    return numeric.toFixed(1).replace(/\.0$/, '')
  }

  if (Math.abs(numeric) >= 1) {
    return numeric.toFixed(2).replace(/\.00$/, '')
  }

  if (numeric === 0) return '0'

  return numeric.toFixed(4)
}

function formatPercent(value) {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) return ''

  return `${(numeric * 100).toFixed(3)}%`
}
