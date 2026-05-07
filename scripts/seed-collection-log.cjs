#!/usr/bin/env node
// Auto-seed src/data/collectionLog.json from existing JSON sources.
//
// Hybrid pipeline (per CLAUDE.md plan): pull every isBossUnique item that
// shows up in a monster drop table or raid unique table, every isClueReward
// item that shows up in clues.json, and every oneShot minigame task product.
// The output is hand-tunable afterwards.

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const items = require(path.join(root, 'src/data/items.json'))
const monsters = require(path.join(root, 'src/data/monsters.json'))
const raids = require(path.join(root, 'src/data/raids.json'))
const minigames = require(path.join(root, 'src/data/minigames.json'))
const clues = require(path.join(root, 'src/data/clues.json'))

function buildMonsters() {
  const sections = []
  for (const [id, m] of Object.entries(monsters)) {
    const uniques = (m.drops || [])
      .filter(d => items[d.itemId]?.isBossUnique)
      .map(d => d.itemId)
    const dedup = [...new Set(uniques)]
    if (dedup.length === 0) continue
    sections.push({
      id,
      label: m.name || id,
      icon: m.boss ? '👑' : '⚔️',
      items: dedup,
    })
  }
  sections.sort((a, b) => a.label.localeCompare(b.label))
  return sections
}

function buildRaids() {
  const sections = []
  for (const [id, r] of Object.entries(raids)) {
    const list = r.rewards?.unique?.items || []
    const uniques = list.filter(u => items[u.itemId]?.isBossUnique).map(u => u.itemId)
    const dedup = [...new Set(uniques)]
    if (dedup.length === 0) continue
    sections.push({
      id,
      label: r.name || id,
      icon: r.icon || '🏛️',
      items: dedup,
    })
  }
  sections.sort((a, b) => a.label.localeCompare(b.label))
  return sections
}

function buildMinigames() {
  const map = new Map()
  for (const t of (minigames.tasks || [])) {
    if (!t.oneShot || !t.product) continue
    const mgId = t.minigame || 'misc'
    if (!map.has(mgId)) {
      const meta = (minigames.minigames || []).find(m => m.id === mgId)
      map.set(mgId, {
        id: mgId,
        label: meta?.label || mgId,
        icon: meta?.icon || '🎮',
        items: [],
      })
    }
    const section = map.get(mgId)
    if (!section.items.includes(t.product)) section.items.push(t.product)
  }
  const sections = [...map.values()]
  sections.sort((a, b) => a.label.localeCompare(b.label))
  return sections
}

function buildClues() {
  const order = ['easy', 'medium', 'hard', 'elite', 'master']
  const sections = []
  for (const tier of order) {
    const def = clues[tier]
    if (!def) continue
    const uniques = (def.rewards || [])
      .filter(r => items[r.itemId]?.isClueReward)
      .map(r => r.itemId)
    const dedup = [...new Set(uniques)]
    if (dedup.length === 0) continue
    sections.push({
      id: tier,
      label: tier.charAt(0).toUpperCase() + tier.slice(1) + ' Clue',
      icon: '📜',
      items: dedup,
    })
  }
  return sections
}

const output = {
  // Bumped whenever the hand-tuned schema changes; useful for migrations later.
  version: 1,
  categories: [
    { id: 'monsters',  label: 'Monsters',     icon: '⚔️', sections: buildMonsters()  },
    { id: 'raids',     label: 'Raids',        icon: '🏛️', sections: buildRaids()     },
    { id: 'minigames', label: 'Minigames',    icon: '🎮', sections: buildMinigames() },
    { id: 'clues',     label: 'Clue Scrolls', icon: '📜', sections: buildClues()     },
  ],
}

const total = output.categories.reduce(
  (s, c) => s + c.sections.reduce((ss, sec) => ss + sec.items.length, 0),
  0
)

const outPath = path.join(root, 'src/data/collectionLog.json')
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n')
console.log(`Wrote ${outPath}: ${total} entries across ${output.categories.length} categories`)
for (const c of output.categories) {
  const count = c.sections.reduce((s, sec) => s + sec.items.length, 0)
  console.log(`  ${c.label}: ${c.sections.length} sections, ${count} entries`)
}
