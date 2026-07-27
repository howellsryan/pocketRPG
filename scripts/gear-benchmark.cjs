#!/usr/bin/env node

/**
 * PocketRPG Gear Balance Benchmark
 *
 * Companion to economy-benchmark.cjs. Where that one answers "how much gold per
 * hour", this one answers "is the gear balanced" — for every equippable item it
 * estimates the combat value it contributes, then checks two things the design
 * cares about:
 *
 *   1. Combat-triangle parity — assemble a best-in-slot loadout for melee,
 *      ranged and magic and compare their DPS against one style-neutral target.
 *      A healthy triangle keeps the three within a tolerance band.
 *
 *   2. Within-slot balance — inside each (slot, style) group, rank items by the
 *      marginal DPS they add to a BiS loadout and flag two failure modes:
 *        - DOMINATED: a lower-requirement, cheaper item is >= on DPS AND
 *          defence (the item is dead content — never worth equipping).
 *        - VALUE INVERSION: a much harder / far pricier item is only a sliver
 *          better on DPS than a cheap alternative (the classic Kodai-vs-Shroud
 *          problem — huge acquisition cost, negligible power gain).
 *
 * The combat maths mirror src/engine/formulas.js + combatPrimitives.js
 * (max hits, attack/defence rolls, hit chance, the magic-damage multiplier).
 * They are re-implemented here (not imported) so this stays a dependency-free
 * CJS report script like economy-benchmark.cjs; if the engine formulas change,
 * update the small block under "── Combat maths ──" to match.
 *
 * Usage:
 *   node scripts/gear-benchmark.cjs
 *   node scripts/gear-benchmark.cjs --level=99 --target-level=200 --target-def-bonus=100
 *   node scripts/gear-benchmark.cjs --by-level
 *   node scripts/gear-benchmark.cjs --triangle-tolerance=1.35
 *   node scripts/gear-benchmark.cjs --out=reports/gear-benchmark
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'src', 'data')
const TICK_SECONDS = 0.6

const args = parseArgs(process.argv.slice(2))

// Reference attacker: a maxed player. The absolute DPS numbers matter less than
// the cross-style ratios and the within-slot rankings, all of which are stable
// under this choice.
const PLAYER_LEVEL = Number(args.level ?? 99)
// Style-neutral target: magic level == defence level so magic and melee/ranged
// face the same effective defensive difficulty (magic def = 70% magic + 30% def).
const TARGET_LEVEL = Number(args['target-level'] ?? 200)
const TARGET_DEF_BONUS = Number(args['target-def-bonus'] ?? 100)
const TRIANGLE_TOLERANCE = Number(args['triangle-tolerance'] ?? 1.35)
const OUT_BASE = String(args.out ?? 'reports/gear-benchmark')

const items = readJson('items.json')
const spells = readJson('spells.json')
// Item ids that belong to a combat set (combatSetBonuses.js). Set bonuses are
// not modelled in the DPS/defence scalars, so these are excluded from the
// dominated / value-inversion flags to avoid false positives (a set piece can
// look weak in isolation yet be BiS once the full-set multiplier applies).
const SET_ITEM_IDS = readSetItemIds()

// An item only counts as a balance problem if it is a "premium" target — high
// requirement or high price. A low-tier item being outclassed is normal
// progression, not a bug, and flagging it drowns the real signal.
const PREMIUM_REQ = 60
const PREMIUM_VALUE = 1_000_000

// Best standard combat spell, and the powered-staff base at PLAYER_LEVEL
// (floor(level/3)+9, from poweredStaffMagicBaseDamage in combatPrimitives.js).
const BEST_SPELL_BASE = Math.max(
  0,
  ...Object.values(spells).map((s) => Number(s?.baseDamage) || 0),
)
const POWERED_STAFF_BASE = Math.max(1, Math.floor(PLAYER_LEVEL / 3) + 9)

const STYLES = ['melee', 'ranged', 'magic']
// Armour/accessory slots a loadout draws from, per the item.slot vocabulary.
const GEAR_SLOTS = ['head', 'body', 'legs', 'gloves', 'boots', 'shield', 'cape', 'neck', 'ring', 'ammo']

// ── Combat maths (mirror of src/engine/formulas.js) ──

function effective(level, styleBonus = 0) {
  return Math.floor(level) + styleBonus + 8
}
function meleeMaxHit(effStr, strengthBonus) {
  return Math.floor(0.5 + (effStr * (strengthBonus + 64)) / 640)
}
function rangedMaxHit(effRng, rangedStrength) {
  return Math.floor(0.5 + (effRng * (rangedStrength + 64)) / 640)
}
function magicMaxHit(spellBase, magicDamagePct) {
  return Math.floor(spellBase * (1 + magicDamagePct / 100))
}
function attackRoll(effLevel, attackBonus) {
  return effLevel * (attackBonus + 64)
}
function hitChance(atkRoll, defRoll) {
  if (atkRoll > defRoll) return 1 - (defRoll + 2) / (2 * (atkRoll + 1))
  return atkRoll / (2 * (defRoll + 1))
}
// getEffectiveWornMagicDamage: weapon multiplier applied to summed worn magic
// damage, capped by the weapon's magicDamageMultiplierCap when a multiplier is
// in effect (Shadow of Tumaken).
function effectiveWornMagicDamage(baseMagicDamage, weapon) {
  const mult = Number(weapon?.magicDamageMultiplier) > 0 ? Number(weapon.magicDamageMultiplier) : 1
  let value = (Number(baseMagicDamage) || 0) * mult
  if (mult > 1) {
    const cap = Number(weapon?.magicDamageMultiplierCap)
    if (Number.isFinite(cap) && cap > 0) value = Math.min(value, cap)
  }
  return value
}

// Style-neutral defence roll for the reference target.
function targetDefenceRoll() {
  return (TARGET_LEVEL + 9) * (TARGET_DEF_BONUS + 64)
}

// ── Item helpers ──

function requirementLevel(item) {
  const r = item?.requirements || {}
  const levels = Object.values(r).filter((v) => typeof v === 'number')
  return levels.length ? Math.max(...levels) : 0
}
function styleAttackBonus(item, style) {
  const a = item?.attackBonus || {}
  if (style === 'magic') return a.magic || 0
  if (style === 'ranged') return a.ranged || 0
  return Math.max(a.stab || 0, a.slash || 0, a.crush || 0)
}
function styleDamageBonus(item, style) {
  const o = item?.otherBonus || {}
  if (style === 'magic') return o.magicDamage || 0
  if (style === 'ranged') return o.rangedStrength || 0
  return o.meleeStrength || 0
}
// Sum of all defensive bonuses — a single scalar "how tanky" score.
function defenceTotal(item) {
  const d = item?.defenceBonus || {}
  return (d.stab || 0) + (d.slash || 0) + (d.crush || 0) + (d.magic || 0) + (d.ranged || 0)
}
function weaponStyle(weapon) {
  const s = weapon?.attackStyle
  if (s === 'ranged') return 'ranged'
  if (s === 'magic') return 'magic'
  if (s === 'stab' || s === 'slash' || s === 'crush' || s === 'melee') return 'melee'
  return null
}
// Does this armour/accessory meaningfully serve `style` (offence or defence)?
function servesStyle(item, style) {
  if (styleAttackBonus(item, style) !== 0) return true
  if (styleDamageBonus(item, style) > 0) return true
  const d = item?.defenceBonus || {}
  if (style === 'magic') return (d.magic || 0) > 0
  if (style === 'ranged') return (d.ranged || 0) > 0
  return (d.stab || 0) > 0 || (d.slash || 0) > 0 || (d.crush || 0) > 0
}

const allItems = Object.entries(items).map(([id, item]) => ({ id, ...item }))
const weapons = allItems.filter((it) => it.type === 'weapon' && weaponStyle(it))
const gearBySlot = {}
for (const slot of GEAR_SLOTS) {
  gearBySlot[slot] = allItems.filter((it) => it.slot === slot && it.type !== 'weapon')
}

// ── DPS of a full loadout ──

// Ammo only contributes if the equipped weapon actually fires it: the ammo's
// ammoKind must match the weapon's ammoType. A weapon with no ammoType (crystal
// bow, blowpipe) is self-contained and gains nothing from the ammo slot.
function ammoCompatible(weapon, ammoItem) {
  if (!ammoItem) return true
  if (ammoItem.slot !== 'ammo') return true
  const wt = weapon?.ammoType
  if (!wt) return false
  return ammoItem.ammoKind === wt
}

function loadoutDPS(style, weapon, gear) {
  const worn = [weapon, ...Object.values(gear)]
    .filter(Boolean)
    .filter((it) => ammoCompatible(weapon, it))
  const attackBonus = worn.reduce((s, it) => s + styleAttackBonus(it, style), 0)
  const speed = Number(weapon?.attackSpeed) || 4
  const interval = speed * TICK_SECONDS

  let maxHit
  const effAtkLevel = effective(PLAYER_LEVEL, style === 'melee' ? 0 : 0)
  let atkRoll = attackRoll(effAtkLevel, attackBonus)

  if (style === 'melee') {
    const strengthBonus = worn.reduce((s, it) => s + styleDamageBonus(it, 'melee'), 0)
    maxHit = meleeMaxHit(effective(PLAYER_LEVEL, 3), strengthBonus) // aggressive stance +3 str
  } else if (style === 'ranged') {
    const strengthBonus = worn.reduce((s, it) => s + styleDamageBonus(it, 'ranged'), 0)
    maxHit = rangedMaxHit(effective(PLAYER_LEVEL), strengthBonus)
    // Twisted-Bow-style magic scaling (combat.js): accuracy and damage scale
    // with the target's magic level. Our target's magic level == TARGET_LEVEL,
    // so a bow built for high-magic monsters is rated on that target.
    if (weapon?.scalesWithMagic) {
      const M = Math.min(250, Math.max(1, TARGET_LEVEL))
      const accInner = Math.floor((3 * M) / 10) - 100
      const dmgInner = Math.floor((3 * M) / 10) - 140
      const accMult = Math.min(140, Math.max(0, 140 + Math.floor((3 * M - 10) / 100) - Math.floor((accInner * accInner) / 100))) / 100
      const dmgMult = Math.min(250, Math.max(0, 250 + Math.floor((3 * M - 14) / 100) - Math.floor((dmgInner * dmgInner) / 100))) / 100
      atkRoll = Math.floor(atkRoll * accMult)
      maxHit = Math.floor(maxHit * dmgMult)
    }
  } else {
    const rawMagicDamage = worn.reduce((s, it) => s + styleDamageBonus(it, 'magic'), 0)
    const magicDamage = effectiveWornMagicDamage(rawMagicDamage, weapon)
    const base = weapon?.poweredStaff ? POWERED_STAFF_BASE : BEST_SPELL_BASE
    maxHit = magicMaxHit(base, magicDamage)
  }

  const acc = hitChance(atkRoll, targetDefenceRoll())
  const avgDamage = acc * ((1 + maxHit) / 2)
  return { dps: avgDamage / interval, acc, maxHit, attackBonus }
}

// Greedy best-in-slot loadout for a style: iteratively pick, per slot, the item
// that maximises full-loadout DPS given the current picks. Converges in a couple
// of passes because offence bonuses are additive; iterating handles the weapon's
// magic-damage-multiplier interaction and the 2h/shield tradeoff.
function buildReferenceLoadout(style) {
  const styleWeapons = weapons.filter((w) => weaponStyle(w) === style)
  let weapon = styleWeapons[0] || null
  const gear = {}

  for (let pass = 0; pass < 3; pass++) {
    // Weapon
    let best = weapon
    let bestDps = weapon ? loadoutDPS(style, weapon, gear).dps : -1
    for (const w of styleWeapons) {
      const dps = loadoutDPS(style, w, gear).dps
      if (dps > bestDps) { bestDps = dps; best = w }
    }
    weapon = best
    const twoHanded = !!weapon?.twoHanded

    for (const slot of GEAR_SLOTS) {
      if (slot === 'shield' && twoHanded) { delete gear[slot]; continue }
      let bestItem = gear[slot] || null
      let baseDps = loadoutDPS(style, weapon, { ...gear, [slot]: bestItem || undefined }).dps
      for (const it of gearBySlot[slot]) {
        if (!servesStyle(it, style)) continue
        const dps = loadoutDPS(style, weapon, { ...gear, [slot]: it }).dps
        if (dps > baseDps) { baseDps = dps; bestItem = it }
      }
      if (bestItem) gear[slot] = bestItem
    }
  }
  return { weapon, gear }
}

// ── Level-band parity (--by-level) ──
//
// The level-99 model above answers "is max gear balanced". This one answers the
// harder question: does a player of level L have comparable DPS whichever style
// they picked? It differs from the model above in four ways that all matter at
// mid level, and it is the model the combat-style rebalance was tuned against:
//
//   1. gear/weapon/ammo/spell pool is restricted to what level L can equip;
//   2. the ranged `rapid` stance (-1 tick) is modelled — the single biggest DPS
//      lever in the game, and invisible to a stance-less model;
//   3. combat set bonuses are applied, so Shardglass/Masari/Kodai builds score;
//   4. DPS is averaged over real monsters of the right combat level rather than
//      one synthetic target, so monster magic defence counts against magic.

const BANDS = [30, 40, 50, 60, 70, 75, 80, 85, 90, 99]
const monsters = readJson('monsters.json')

// COMBAT_SETS is a plain array literal in an ES module we can't require(); pull
// the literal out and evaluate it so set multipliers are real, not guessed.
function readCombatSets() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'combatSetBonuses.js'), 'utf8')
    const start = src.indexOf('const COMBAT_SETS = [')
    if (start < 0) return []
    const open = src.indexOf('[', start)
    let depth = 0
    for (let i = open; i < src.length; i++) {
      if (src[i] === '[') depth++
      else if (src[i] === ']' && --depth === 0) {
        // eslint-disable-next-line no-new-func
        return new Function(`return ${src.slice(open, i + 1)}`)()
      }
    }
  } catch { /* fall through */ }
  return []
}
const COMBAT_SETS = readCombatSets()

function setMultipliers(wornIds, weaponId) {
  const out = {
    meleeAccuracy: 1, meleeDamage: 1, rangedAccuracy: 1, rangedDamage: 1,
    magicAccuracy: 1, magicDamageBonusFlat: 0,
  }
  for (const set of COMBAT_SETS) {
    const slots = Object.values(set.slots || {})
    if (!slots.length || !slots.every((aliases) => aliases.some((id) => wornIds.has(id)))) continue
    if (set.requiredWeapons && !set.requiredWeapons.includes(weaponId)) continue
    for (const [k, v] of Object.entries(set.multipliers || {})) out[k] *= v
    out.magicDamageBonusFlat += set.magicDamageBonusFlat || 0
  }
  return out
}

// Percentage damage bonuses (otherBonus.meleeDamage / rangedDamage) mirror
// magicDamage and multiply the final max hit — see src/engine/formulas.js.
function stylePercentBonus(item, style) {
  const o = item?.otherBonus || {}
  if (style === 'melee') return o.meleeDamage || 0
  if (style === 'ranged') return o.rangedDamage || 0
  return 0
}

function poweredStaffBase(weapon, magicLevel) {
  const anchor = Number(weapon?.poweredStaffBaseDamage)
  const baseAtAnchor = Number.isFinite(anchor) && anchor > 0 ? anchor : 34
  return Math.max(1, Math.floor(magicLevel / 3) + (baseAtAnchor - Math.floor(75 / 3)))
}

function bandTargetOf(monster, style) {
  const d = monster.defenceBonus || {}
  const bonus = style === 'melee' ? Math.max(d.stab || 0, d.slash || 0, d.crush || 0) : (d[style] || 0)
  return { defLevel: monster.stats?.defence || 1, magLevel: monster.stats?.magic || 1, bonus }
}

function bandDPS(style, level, weapon, gear, target, opts) {
  const worn = [weapon, ...Object.values(gear)].filter(Boolean).filter((it) => ammoCompatible(weapon, it))
  const wornIds = new Set(worn.map((it) => it.id))
  const mult = setMultipliers(wornIds, weapon?.id)
  const attackBonus = worn.reduce((s, it) => s + styleAttackBonus(it, style), 0)
  const pct = worn.reduce((s, it) => s + stylePercentBonus(it, style), 0)

  let speed = Number(weapon?.attackSpeed) || 4
  let stanceBonus = 0
  if (style === 'ranged') {
    if (opts.stance === 'rapid') speed = Math.max(1, speed - 1)
    else stanceBonus = 3 // accurate
  }

  let maxHit, atkRoll, defRoll
  if (style === 'melee') {
    const str = worn.reduce((s, it) => s + styleDamageBonus(it, 'melee'), 0)
    maxHit = Math.floor(Math.floor(meleeMaxHit(effective(level, 3), str) * (1 + pct / 100)) * mult.meleeDamage)
    atkRoll = Math.floor(attackRoll(effective(level), attackBonus) * mult.meleeAccuracy)
    defRoll = (target.defLevel + 9) * (target.bonus + 64)
  } else if (style === 'ranged') {
    const str = worn.reduce((s, it) => s + styleDamageBonus(it, 'ranged'), 0)
    maxHit = Math.floor(Math.floor(rangedMaxHit(effective(level, stanceBonus), str) * (1 + pct / 100)) * mult.rangedDamage)
    atkRoll = Math.floor(attackRoll(effective(level, stanceBonus), attackBonus) * mult.rangedAccuracy)
    if (weapon?.scalesWithMagic) {
      const M = Math.min(250, Math.max(1, target.magLevel))
      const ai = Math.floor((3 * M) / 10) - 100
      const di = Math.floor((3 * M) / 10) - 140
      const am = Math.min(140, Math.max(0, 140 + Math.floor((3 * M - 10) / 100) - Math.floor((ai * ai) / 100))) / 100
      const dm = Math.min(250, Math.max(0, 250 + Math.floor((3 * M - 14) / 100) - Math.floor((di * di) / 100))) / 100
      atkRoll = Math.floor(atkRoll * am)
      maxHit = Math.floor(maxHit * dm)
    }
    defRoll = (target.defLevel + 9) * (target.bonus + 64)
  } else {
    const raw = worn.reduce((s, it) => s + styleDamageBonus(it, 'magic'), 0)
    const md = effectiveWornMagicDamage(raw, weapon) + mult.magicDamageBonusFlat
    const base = weapon?.poweredStaff ? poweredStaffBase(weapon, level) : (opts.spell?.baseDamage || 0)
    maxHit = magicMaxHit(base, md)
    atkRoll = Math.floor(attackRoll(effective(level), attackBonus) * mult.magicAccuracy)
    const magDefLevel = Math.floor(target.magLevel * 0.7) + Math.floor(target.defLevel * 0.3)
    defRoll = (magDefLevel + 9) * (target.bonus + 64)
  }

  const acc = hitChance(atkRoll, defRoll)
  return (acc * ((1 + maxHit) / 2)) / (speed * TICK_SECONDS)
}

// Greedy per-slot BiS, run once per (weapon, stance, spell) candidate. Greedy
// alone cannot discover a 3-piece set bonus, so full set kits are offered as
// explicit whole-loadout candidates on top.
//
// Slots are filled against a cheap style-neutral target (the ranking of one
// armour piece over another is stable whatever we shoot at), but the finished
// candidates are RANKED on the real monster pool. That distinction is load
// bearing: against a synthetic target whose magic level matches its defence,
// the Twisted Longbow's scalesWithMagic multiplier makes it look like the
// best bow in the game for everything, when its whole design is to be a
// specialist that falls off a cliff against ordinary low-magic monsters.
const SET_KITS = COMBAT_SETS.map((set) => Object.values(set.slots || {}).map((aliases) => aliases[0]))

function bandBest(style, level, target, scoreLoadout) {
  const pool = weapons.filter((w) => weaponStyle(w) === style && requirementLevel(w) <= level)
  const stances = style === 'ranged' ? ['rapid', 'accurate'] : [null]
  const spellPool = style === 'magic'
    ? Object.values(spells).filter((s) => Number(s.baseDamage) > 0 && (s.levelReq || 1) <= level)
    : [null]

  let best = null
  const consider = (weapon, gear, opts) => {
    const dps = scoreLoadout(style, weapon, gear, opts)
    if (!best || dps > best.dps) best = { dps, weapon, gear, opts }
  }

  for (const stance of stances) {
    for (const weapon of pool) {
      const spellChoices = style === 'magic' && !weapon.poweredStaff ? spellPool : [null]
      for (const spell of spellChoices) {
        const opts = { stance, spell }
        const gear = {}
        for (let pass = 0; pass < 3; pass++) {
          for (const slot of GEAR_SLOTS) {
            if (slot === 'shield' && weapon.twoHanded) { delete gear[slot]; continue }
            let pick = gear[slot] || null
            let bestSlotDps = bandDPS(style, level, weapon, { ...gear, [slot]: pick || undefined }, target, opts)
            for (const it of gearBySlot[slot]) {
              if (requirementLevel(it) > level || !servesStyle(it, style)) continue
              const dps = bandDPS(style, level, weapon, { ...gear, [slot]: it }, target, opts)
              if (dps > bestSlotDps) { bestSlotDps = dps; pick = it }
            }
            if (pick) gear[slot] = pick
          }
        }
        consider(weapon, gear, opts)
        for (const kit of SET_KITS) {
          if (kit.some((id) => !items[id] || requirementLevel({ ...items[id] }) > level)) continue
          const kitted = { ...gear }
          for (const id of kit) kitted[items[id].slot] = { id, ...items[id] }
          if (weapon.twoHanded) delete kitted.shield
          consider(weapon, kitted, opts)
        }
      }
    }
  }
  return best
}

function levelBandReport() {
  const rows = []
  for (const level of BANDS) {
    // Monsters a player of this level would realistically be killing.
    const pool = Object.entries(monsters)
      .map(([id, m]) => ({ id, ...m }))
      .filter((m) => (m.combatLevel || 0) >= level * 0.8 && (m.combatLevel || 0) <= level * 3.2 && (m.hitpoints || 0) > 0)
    if (!pool.length) continue
    // Loadouts are picked against one style-neutral target, then scored across
    // the real pool — otherwise each style optimises for a different monster.
    const neutral = { defLevel: 2 * level, magLevel: 2 * level, bonus: level }
    const avgOver = (style, weapon, gear, opts) =>
      pool.reduce((sum, m) => sum + bandDPS(style, level, weapon, gear, bandTargetOf(m, style), opts), 0) / pool.length

    const row = { level, monsters: pool.length, styles: {} }
    for (const style of STYLES) {
      const picked = bandBest(style, level, neutral, avgOver)
      if (!picked) continue
      row.styles[style] = {
        dps: avgOver(style, picked.weapon, picked.gear, picked.opts),
        weapon: picked.weapon?.name || '—',
        ammo: picked.gear.ammo?.name || null,
        spell: picked.opts.spell?.name || null,
        stance: picked.opts.stance || null,
      }
    }
    const values = STYLES.map((s) => row.styles[s]?.dps).filter((v) => typeof v === 'number')
    row.ratio = values.length ? Math.max(...values) / Math.min(...values) : 0
    rows.push(row)
  }
  return rows
}

// Marginal DPS an item adds when swapped into the reference loadout's own slot.
function marginalDPS(item, style, ref) {
  if (item.type === 'weapon') {
    return loadoutDPS(style, item, ref.gear).dps
  }
  const slot = item.slot
  const withItem = loadoutDPS(style, ref.weapon, { ...ref.gear, [slot]: item }).dps
  const without = loadoutDPS(style, ref.weapon, { ...ref.gear, [slot]: undefined }).dps
  return withItem - without
}

// ── Analysis ──

const references = {}
for (const style of STYLES) references[style] = buildReferenceLoadout(style)

// Triangle parity
const triangle = STYLES.map((style) => {
  const ref = references[style]
  const r = loadoutDPS(style, ref.weapon, ref.gear)
  return { style, dps: r.dps, weapon: ref.weapon, maxHit: r.maxHit, acc: r.acc }
})
const dpsValues = triangle.map((t) => t.dps)
const triangleRatio = Math.max(...dpsValues) / Math.min(...dpsValues)
const triangleOk = triangleRatio <= TRIANGLE_TOLERANCE

// Per (slot, style) rankings + flags
const groups = []
const dominated = []
const inversions = []

for (const style of STYLES) {
  const ref = references[style]
  const slotList = ['weapon', ...GEAR_SLOTS]
  for (const slot of slotList) {
    const pool = slot === 'weapon'
      ? weapons.filter((w) => weaponStyle(w) === style)
      : gearBySlot[slot].filter((it) => servesStyle(it, style))
    if (pool.length < 2) continue

    const scored = pool.map((it) => ({
      id: it.id,
      name: it.name,
      req: requirementLevel(it),
      value: Number(it.shopValue) || 0,
      dps: marginalDPS(it, style, ref),
      def: defenceTotal(it),
      item: it,
    })).sort((a, b) => b.dps - a.dps)

    groups.push({ style, slot, scored })

    for (const x of scored) {
      if (SET_ITEM_IDS.has(x.id)) continue // set-bonus gear not modelled
      const premium = x.req >= PREMIUM_REQ || x.value >= PREMIUM_VALUE
      if (!premium) continue
      // DOMINATED: a genuinely EASIER-to-get item (lower req AND not pricier, or
      // meaningfully cheaper AND not harder) beats x on both DPS and defence by a
      // real margin — x is dead content.
      const dom = scored.find((y) =>
        y.id !== x.id && !SET_ITEM_IDS.has(y.id) &&
        y.dps >= x.dps - 0.01 && y.def >= x.def &&
        (y.dps > x.dps + 0.05 || y.def > x.def) &&
        ((y.req < x.req && y.value <= x.value) || (y.value * 2 <= x.value && y.req <= x.req)))
      if (dom) {
        dominated.push({ style, slot, item: x, by: dom })
        continue
      }
      // VALUE INVERSION: x is expensive (>=2x pricier) yet a cheaper item lands
      // within 5% of its DPS while being at least as tanky — the effort/reward
      // gap is the problem even though x is nominally "better".
      if (x.value > 0) {
        const cheaper = scored.find((y) =>
          y.id !== x.id && !SET_ITEM_IDS.has(y.id) &&
          y.value > 0 && y.value * 2 <= x.value &&
          y.dps >= x.dps * 0.95 &&
          y.def >= x.def)
        if (cheaper) inversions.push({ style, slot, item: x, vs: cheaper })
      }
    }
  }
}

// ── Report ──

const bands = args['by-level'] ? levelBandReport() : null

writeReport()

function writeReport() {
  const lines = []
  const p = (s = '') => lines.push(s)

  p('# Gear Balance Benchmark')
  p('')
  p(`Generated by \`scripts/gear-benchmark.cjs\`. Player level **${PLAYER_LEVEL}**, style-neutral target (defence/magic level **${TARGET_LEVEL}**, defence bonus **+${TARGET_DEF_BONUS}**). DPS is average damage per second against that target; the numbers are a comparison scale, not live combat.`)
  p('')

  p('## Combat-triangle parity')
  p('')
  p(`Best-in-slot loadout DPS per style. Tolerance band: max/min ≤ **${TRIANGLE_TOLERANCE}**.`)
  p('')
  p('This section models one bare loadout against one synthetic target: no combat stances, no set bonuses, no monster variety. It is the right lens for the per-slot rankings below, and the wrong one for judging the combat triangle — run **`--by-level`** for that, which models all three and disagrees with the ratio here.')
  p('')
  p('| Style | BiS weapon | Max hit | Hit chance | DPS |')
  p('|---|---|---:|---:|---:|')
  for (const t of triangle) {
    p(`| ${t.style} | ${t.weapon ? t.weapon.name : '—'} | ${t.maxHit} | ${(t.acc * 100).toFixed(1)}% | ${t.dps.toFixed(2)} |`)
  }
  p('')
  p(`**Ratio (max/min): ${triangleRatio.toFixed(2)} — ${triangleOk ? 'WITHIN tolerance ✅' : 'OUT OF tolerance ⚠️'}**`)
  p('')

  if (bands) {
    p('## Level-band parity')
    p('')
    p('Best-in-slot DPS per style at each player level, restricted to gear/ammo/spells that level can equip, averaged over real monsters of the right combat level. Models the ranged `rapid` stance and combat set bonuses.')
    p('')
    p('| Level | Melee | Ranged | Magic | Ratio | Melee BiS | Ranged BiS | Magic BiS |')
    p('|---:|---:|---:|---:|---:|---|---|---|')
    for (const r of bands) {
      const cell = (s) => {
        const v = r.styles[s]
        if (!v) return '—'
        return [v.weapon, v.ammo, v.spell, v.stance].filter(Boolean).join(' + ')
      }
      const dps = (s) => (r.styles[s] ? r.styles[s].dps.toFixed(2) : '—')
      p(`| ${r.level} | ${dps('melee')} | ${dps('ranged')} | ${dps('magic')} | ${r.ratio.toFixed(2)} | ${cell('melee')} | ${cell('ranged')} | ${cell('magic')} |`)
    }
    p('')
    const worst = bands.reduce((a, b) => (b.ratio > a.ratio ? b : a))
    p(`**Worst band: level ${worst.level} at ${worst.ratio.toFixed(2)}.**`)
    p('')
  }
  p('Reference loadouts (greedy BiS per style):')
  p('')
  for (const style of STYLES) {
    const ref = references[style]
    const pieces = [ref.weapon, ...GEAR_SLOTS.map((s) => ref.gear[s])].filter(Boolean).map((it) => it.name)
    p(`- **${style}**: ${pieces.join(', ')}`)
  }
  p('')

  p('## Dominated items (dead content)')
  p('')
  p('An equally-or-less demanding, equally-or-cheaper item is at least as good on **both** DPS and defence — so this item is never worth equipping.')
  p('')
  if (!dominated.length) {
    p('_None._')
  } else {
    p('| Style | Slot | Item | Req | Value | DPS | Def | Dominated by | by DPS | by Def | by Req | by Value |')
    p('|---|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|')
    for (const d of dominated.sort((a, b) => b.item.value - a.item.value)) {
      p(`| ${d.style} | ${d.slot} | ${d.item.name} | ${d.item.req} | ${fmt(d.item.value)} | ${d.item.dps.toFixed(2)} | ${d.item.def} | ${d.by.name} | ${d.by.dps.toFixed(2)} | ${d.by.def} | ${d.by.req} | ${fmt(d.by.value)} |`)
    }
  }
  p('')

  p('## Value inversions (poor reward for effort)')
  p('')
  p('A far cheaper item (≤ half the price) lands within 5% of this item\'s DPS while being at least as tanky. The pricier/harder item is barely an upgrade — the acquisition cost does not match the power gain.')
  p('')
  if (!inversions.length) {
    p('_None._')
  } else {
    p('| Style | Slot | Pricey item | Req | Value | DPS | Def | Cheap alt | alt Req | alt Value | alt DPS | alt Def |')
    p('|---|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|')
    for (const inv of inversions.sort((a, b) => b.item.value - a.item.value)) {
      p(`| ${inv.style} | ${inv.slot} | ${inv.item.name} | ${inv.item.req} | ${fmt(inv.item.value)} | ${inv.item.dps.toFixed(2)} | ${inv.item.def} | ${inv.vs.name} | ${inv.vs.req} | ${fmt(inv.vs.value)} | ${inv.vs.dps.toFixed(2)} | ${inv.vs.def} |`)
    }
  }
  p('')

  p('## Per-slot rankings')
  p('')
  p('Top items per (style, slot) by marginal DPS added to the BiS loadout. `def` is summed defence bonus.')
  p('')
  for (const g of groups) {
    if (g.scored.length < 2) continue
    p(`### ${g.style} — ${g.slot}`)
    p('')
    p('| Item | Req | Value | DPS | Def |')
    p('|---|---:|---:|---:|---:|')
    for (const s of g.scored.slice(0, 10)) {
      p(`| ${s.name} | ${s.req} | ${fmt(s.value)} | ${s.dps.toFixed(2)} | ${s.def} |`)
    }
    p('')
  }

  const md = lines.join('\n')
  const outMd = path.join(ROOT, `${OUT_BASE}.md`)
  const outJson = path.join(ROOT, `${OUT_BASE}.json`)
  fs.mkdirSync(path.dirname(outMd), { recursive: true })
  fs.writeFileSync(outMd, md)
  fs.writeFileSync(outJson, JSON.stringify({
    config: { PLAYER_LEVEL, TARGET_LEVEL, TARGET_DEF_BONUS, TRIANGLE_TOLERANCE, BEST_SPELL_BASE, POWERED_STAFF_BASE },
    triangle: triangle.map((t) => ({ style: t.style, weapon: t.weapon?.id, dps: t.dps, maxHit: t.maxHit, acc: t.acc })),
    triangleRatio,
    triangleOk,
    bands,
    dominated: dominated.map((d) => ({ style: d.style, slot: d.slot, item: leaf(d.item), by: leaf(d.by) })),
    inversions: inversions.map((i) => ({ style: i.style, slot: i.slot, item: leaf(i.item), vs: leaf(i.vs) })),
    groups: groups.map((g) => ({ style: g.style, slot: g.slot, items: g.scored.map(leaf) })),
  }, null, 2))

  // Console summary
  console.log(`Gear balance benchmark → ${path.relative(ROOT, outMd)}, ${path.relative(ROOT, outJson)}`)
  console.log(`Bare-loadout DPS (no stances/sets): ${triangle.map((t) => `${t.style} ${t.dps.toFixed(1)}`).join(' | ')} (ratio ${triangleRatio.toFixed(2)}, ${triangleOk ? 'ok' : 'OUT OF BAND'}) — see --by-level for real triangle parity`)
  console.log(`Dominated items: ${dominated.length} | Value inversions: ${inversions.length}`)
  if (bands) {
    for (const r of bands) {
      const dps = (s) => (r.styles[s] ? r.styles[s].dps.toFixed(2).padStart(6) : '     —')
      console.log(`  L${String(r.level).padStart(2)}  melee ${dps('melee')} | ranged ${dps('ranged')} | magic ${dps('magic')}  ratio ${r.ratio.toFixed(2)}`)
    }
    const worst = bands.reduce((a, b) => (b.ratio > a.ratio ? b : a))
    console.log(`Worst level band: ${worst.level} at ${worst.ratio.toFixed(2)}`)
  }
}

function leaf(s) {
  return { id: s.id, name: s.name, req: s.req, value: s.value, dps: Number(s.dps.toFixed(3)), def: s.def }
}
function fmt(n) {
  return Number(n).toLocaleString('en-GB')
}

// ── util ──

function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    const m = /^--([^=]+)=?(.*)$/.exec(a)
    if (m) out[m[1]] = m[2] === '' ? true : m[2]
  }
  return out
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'))
}
// Pull the itemId aliases out of src/engine/combatSetBonuses.js by text scan
// (it is an ES module, so we don't import it). Any single-quoted token that is
// also a real item id is treated as a set member.
function readSetItemIds() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'combatSetBonuses.js'), 'utf8')
    const ids = new Set()
    for (const m of src.matchAll(/'([a-z0-9_]+)'/g)) {
      if (items[m[1]]) ids.add(m[1])
    }
    return ids
  } catch {
    return new Set()
  }
}
