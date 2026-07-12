#!/usr/bin/env node
// Drop-table audit for new/edited monsters, bosses, and raids. NOT a build gate
// (excluded from npm run ci) — run it by hand when authoring content and read
// the economy report. Structural checks are hard errors; drop-rate/economy
// checks are advisory warnings for the author to eyeball against tier peers.
// See docs/testing-strategy-delivery-plan.md (PR 16) and the add-content skill.
//
// Usage:
//   npm run check:drops -- <monsterId|raidId>   audit one entry
//   npm run check:drops -- --all                 sweep everything

const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const monsters = require(path.join(ROOT, 'src/data/monsters.json'))
const raids = require(path.join(ROOT, 'src/data/raids.json'))
const items = require(path.join(ROOT, 'src/data/items.json'))
const collectionLog = require(path.join(ROOT, 'src/data/collectionLog.json'))
const { BOSS_SLAYER_TASK_XP_MULTIPLIER } = require(path.join(ROOT, 'src/engine/slayerRewards.js'))

const itemIds = new Set(Object.keys(items))

// Every item id that has a collection-log slot.
const loggedItems = new Set()
for (const cat of collectionLog.categories || []) {
  for (const section of cat.sections || []) {
    for (const id of section.items || []) loggedItems.add(id)
  }
}
const shared = collectionLog.sharedItems
if (Array.isArray(shared)) for (const id of shared) loggedItems.add(id)
else if (shared && typeof shared === 'object') for (const id of Object.keys(shared)) loggedItems.add(id)

const errors = []
const warnings = []
const rows = []

const avgQty = (q) => (Array.isArray(q) ? (Number(q[0]) + Number(q[1])) / 2 : Number(q) || 0)
const isUniqueItem = (id) => {
  const it = items[id]
  return Boolean(it && (it.isBossUnique || it.isRaidUnique || it.isClueReward))
}

// Rough, consistent kill-time model so ratios between monsters are meaningful
// even though absolute gp/hr is an estimate. Assumes a player geared for the
// monster's combat level; labelled "est" everywhere it surfaces.
function killsPerHour(monster) {
  const hp = Number(monster.hitpoints) || 1
  const dmgPerTick = Math.max(1, (Number(monster.combatLevel) || 1) * 0.15)
  const ticksToKill = hp / dmgPerTick + 2 // + restart/approach overhead
  const secondsPerKill = ticksToKill * 0.6
  return 3600 / secondsPerKill
}

function auditMonster(id) {
  const m = monsters[id]
  if (!m) { errors.push(`Unknown monster/raid id: ${id}`); return }
  let evPerKill = 0
  let rarest = 1
  for (const d of m.drops || []) {
    if (!itemIds.has(d.itemId)) errors.push(`${id}: drop references unknown item '${d.itemId}'`)
    const c = Number(d.chance)
    if (!(c > 0 && c <= 1)) errors.push(`${id}: drop '${d.itemId}' has chance ${d.chance} (must be in (0,1])`)
    if (Array.isArray(d.quantity)) {
      if (d.quantity.length !== 2 || !(d.quantity[0] > 0) || !(d.quantity[1] >= d.quantity[0]))
        errors.push(`${id}: drop '${d.itemId}' has malformed quantity ${JSON.stringify(d.quantity)}`)
    } else if (!(Number(d.quantity) > 0)) {
      errors.push(`${id}: drop '${d.itemId}' has non-positive quantity ${d.quantity}`)
    }
    evPerKill += (Number(d.chance) || 0) * avgQty(d.quantity) * (Number(items[d.itemId]?.shopValue) || 0)
    if (isUniqueItem(d.itemId)) {
      if (!loggedItems.has(d.itemId)) errors.push(`${id}: unique drop '${d.itemId}' has no collection-log slot`)
      if (c > 0 && c < rarest) rarest = c
    }
  }
  const kph = killsPerHour(m)
  const hp = Number(m.hitpoints) || 0
  const combatXpPerKill = hp * 4 + hp * 1.33
  const isBoss = Boolean(m.boss || m.isBoss)
  // CLAUDE.md §8: bosses should not carry an inflated explicit slayerXP — the
  // natural hitpoints base x4 is the ceiling. An explicit slayerXP above the
  // monster's own hitpoints is the inflation the rule warns against.
  if (isBoss && m.slayerXP != null && Number(m.slayerXP) > hp) {
    errors.push(`${id}: boss has explicit slayerXP ${m.slayerXP} > hitpoints ${hp} (inflated — see CLAUDE.md §8)`)
  }
  const baseSlayer = Number(m.slayerXP) || hp
  const slayerXpPerKill = baseSlayer * (isBoss ? BOSS_SLAYER_TASK_XP_MULTIPLIER : 1)
  rows.push({
    id, kind: isBoss ? 'boss' : 'monster', cb: m.combatLevel, hp,
    evPerKill: Math.round(evPerKill), gpPerHrEst: Math.round(evPerKill * kph),
    combatXpPerHrEst: Math.round(combatXpPerKill * kph), slayerXpPerHrEst: Math.round(slayerXpPerKill * kph),
    rarestUnique: rarest < 1 ? `1/${Math.round(1 / rarest)}` : '-',
  })
  return { isBoss, slayerXpPerHr: slayerXpPerKill * kph }
}

function auditRaid(id) {
  const r = raids[id]
  if (!r) { errors.push(`Unknown monster/raid id: ${id}`); return }
  for (const d of r.rewards?.always || []) {
    if (!itemIds.has(d.itemId)) errors.push(`${id}: always-drop references unknown item '${d.itemId}'`)
    const c = Number(d.chance)
    if (!(c > 0 && c <= 1)) errors.push(`${id}: always-drop '${d.itemId}' has chance ${d.chance}`)
  }
  const uniq = r.rewards?.unique
  if (uniq) {
    const totalWeight = (uniq.items || []).reduce((s, i) => s + (Number(i.weight) || 0), 0)
    let rarest = 1
    for (const it of uniq.items || []) {
      if (!itemIds.has(it.itemId)) errors.push(`${id}: unique '${it.itemId}' is not a known item`)
      if (!loggedItems.has(it.itemId)) errors.push(`${id}: unique '${it.itemId}' has no collection-log slot`)
      const eff = totalWeight > 0 ? (Number(uniq.chance) || 0) * (Number(it.weight) || 0) / totalWeight : 0
      if (eff > 0 && eff < rarest) rarest = eff
    }
    rows.push({ id, kind: 'raid', cb: '-', hp: '-', evPerKill: '-', gpPerHrEst: '-', combatXpPerHrEst: '-', slayerXpPerHrEst: '-', rarestUnique: rarest < 1 ? `1/${Math.round(1 / rarest)}` : '-' })
  }
}

// ── run ──
const arg = process.argv[2]
if (!arg) { console.error('Usage: npm run check:drops -- <monsterId|raidId> | --all'); process.exit(2) }

if (arg === '--all') {
  for (const id of Object.keys(monsters)) auditMonster(id)
  for (const id of Object.keys(raids)) auditRaid(id)
} else if (raids[arg]) {
  auditRaid(arg)
} else {
  auditMonster(arg)
}

console.log('\nDrop-table audit (economy figures are estimates for eyeballing vs tier peers):')
console.table(rows)
if (warnings.length) { console.log('\nWarnings:'); for (const w of warnings) console.log('  ⚠ ' + w) }
if (errors.length) {
  console.error('\nHard errors:')
  for (const e of errors) console.error('  ✗ ' + e)
  process.exit(1)
}
console.log('\nNo structural errors.')
