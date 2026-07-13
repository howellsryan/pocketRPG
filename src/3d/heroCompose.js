// Pure hero-spec composition over src/data/hero3d.json shaped data: the bare
// hero plus equipment entries patched in (fit and animation are correct by
// construction — equipment parts live in the same SDF field and ride the same
// rig groups as the body). Zero imports so the dev harness can drive it with
// fetched JSON; app callers go through src/3d/heroCreature.js.
//
// Equipment entry shape (see hero3d.json):
// - palette: colors appended to the hero palette; the entry's own parts and
//   overrides index into THIS list (remapped to absolute at compose time).
// - add: parts appended to the hero; optional `rig` places each in a rig
//   group — "head" | "armL" | "armR" | "handL" | "handR" (hand = lower arm
//   chain, which is what a held weapon rides). Omitted → rides the root.
// - override: heroPartId → field patch ({ color, r1, r2, blend, a, b } — the
//   part keeps its rig membership) or { remove: true } (part dropped and
//   purged from every rig group, e.g. hair under a full helm).
// - variantOf: itemId of a base entry — inherits its add/override geometry
//   with this entry's own palette (metal tiers are palette data, not new
//   shapes). One level only; a variant may still declare add/override to
//   replace the base's wholesale.

export function heroComposeSpec(data, itemIds = []) {
  const hero = data && data.hero
  if (!hero || !Array.isArray(hero.parts) || !hero.parts.length) return null
  const spec = JSON.parse(JSON.stringify(hero))
  spec.height = typeof spec.height === 'number' ? spec.height : 1.8
  spec.rotationDeg = spec.rotationDeg || [0, 90, 0]
  const equipment = (data && data.equipment) || {}
  for (const itemId of itemIds || []) {
    const entry = heroResolveEquipEntry(equipment, equipment[itemId])
    if (entry) heroApplyEquipEntry(spec, entry)
  }
  return spec
}

// Resolve a variantOf entry against its base. Returns the entry as-is when it
// is not a variant; null when the entry is missing or its base is invalid
// (absent, or itself a variant — chains are not supported).
export function heroResolveEquipEntry(equipment, entry) {
  if (!entry) return null
  if (!entry.variantOf) return entry
  const base = (equipment || {})[entry.variantOf]
  if (!base || base.variantOf) return null
  return { ...base, ...entry }
}

function heroApplyEquipEntry(spec, entry) {
  const offset = spec.palette.length
  if (Array.isArray(entry.palette)) spec.palette = spec.palette.concat(entry.palette)

  for (const [partId, patch] of Object.entries(entry.override || {})) {
    const idx = spec.parts.findIndex((p) => p.id === partId)
    if (idx < 0 || !patch) continue
    if (patch.remove) {
      spec.parts.splice(idx, 1)
      heroPurgePart(spec, partId)
      continue
    }
    const part = spec.parts[idx]
    for (const k of ['r1', 'r2', 'blend']) if (typeof patch[k] === 'number') part[k] = patch[k]
    for (const k of ['a', 'b']) if (Array.isArray(patch[k])) part[k] = patch[k].slice()
    if (typeof patch.color === 'number') part.color = patch.color + offset
    if (patch.colorOnly !== undefined) part.colorOnly = Boolean(patch.colorOnly)
  }

  for (const p of entry.add || []) {
    const part = { ...p, color: (p.color || 0) + offset }
    delete part.rig
    spec.parts.push(part)
    heroAttachToRig(spec, p.rig, part.id)
  }
}

function heroAttachToRig(spec, rig, partId) {
  if (!rig) return
  if (rig === 'head' && spec.head) { spec.head.parts.push(partId); return }
  const arms = spec.arms || {}
  const side = /L$/.test(rig) ? arms.left : arms.right
  if (!side) return
  const seg = /^hand/.test(rig) ? 'lower' : 'upper'
  side[seg] = (side[seg] || []).concat(partId)
}

function heroPurgePart(spec, partId) {
  const drop = (list) => Array.isArray(list) ? list.filter((id) => id !== partId) : list
  for (const key of ['breathe', 'head', 'wings', 'spine']) {
    if (spec[key]) spec[key].parts = drop(spec[key].parts)
  }
  for (const key of ['breathe', 'head', 'wings', 'spine']) {
    if (spec[key] && (!spec[key].parts || !spec[key].parts.length)) delete spec[key]
  }
  if (spec.arms) {
    for (const side of ['left', 'right']) {
      const g = spec.arms[side]
      if (!g) continue
      g.upper = drop(g.upper)
      g.lower = drop(g.lower)
    }
  }
  if (Array.isArray(spec.legs)) {
    spec.legs = spec.legs.filter((leg) => leg.part !== partId)
    for (const leg of spec.legs) if (leg.foot === partId) delete leg.foot
  }
  if (Array.isArray(spec.ropes)) {
    spec.ropes = spec.ropes.filter((rope) => !(rope.parts || []).includes(partId) && rope.anchorTo !== partId)
  }
}
