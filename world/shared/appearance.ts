// Equipment → visual appearance mapping (guide §11, decision D3: archetype ×
// tier tint, maximum asset reuse). One model per archetype in
// world/client/public/models/weapons/ (built by scripts/build-weapons.mjs);
// coverage tracked in docs/open-world-asset-coverage.md. Unmapped items render
// bare-handed — appearance never blocks gameplay.
//
// Tint (item 12, stage 2): the combat arena's src/data/equipmentModels.json
// already carries a per-item `tint` for everything in its own registry —
// that IS "what colour is mithril" for the arena, authored per item rather
// than derived from a tier-prefix regex. Prefer it here whenever an item is
// registered there, so both renderers agree; TIER_TINTS below is now only a
// fallback for weapons/armour the arena registry doesn't cover yet (archetype
// selection stays regex-based regardless — the registry has no notion of the
// world's small fixed archetype set, only a specific model file per item).
import equipmentModelsData from '../../src/data/equipmentModels.json'
import itemsData from '../../src/data/items.json'
import type { GearDescriptor } from './protocol'

type Items = Record<string, { slot?: string | null; twoHanded?: boolean } | undefined>
type EquipmentModelEntry = { tint?: string; model?: string }
type EquipmentModels = {
  weapons?: Record<string, EquipmentModelEntry>
  gear?: Record<string, EquipmentModelEntry>
  defaults?: { gear?: { boots?: { tint?: string } } }
}
const equipmentModels = equipmentModelsData as unknown as EquipmentModels
// Every boots item shares one default skinned boot + tint (like helms → default
// helm), so boots don't take a per-tier tint.
const DEFAULT_BOOTS_TINT = equipmentModels.defaults?.gear?.boots?.tint

/** True when the arena registry can render this itemId per-item (as a weapon or
 * a gear piece with a model). Gates what goes into `GearDescriptor.equip`. */
function hasRegistryModel(itemId: string): boolean {
  return Boolean(equipmentModels.weapons?.[itemId]?.model || equipmentModels.gear?.[itemId]?.model)
}

export const WEAPON_ARCHETYPES = ['sword', 'sword2h', 'dagger', 'axe', 'axe2h', 'blunt', 'bow', 'crossbow', 'staff', 'wand'] as const

// First match wins — specific tokens (battleaxe, crossbow, godsword) must sit
// above the generic tokens they contain (axe, bow, sword).
const ARCHETYPE_RULES: [RegExp, string][] = [
  [/scythe|battleaxe|greataxe/, 'axe2h'],
  [/pickaxe|axe/, 'axe'],
  [/godsword|2h_sword/, 'sword2h'],
  [/crossbow|ballista|blowpipe/, 'crossbow'],
  [/shortbow|longbow|bow/, 'bow'],
  // Scimitars share the curved-blade (dagger) asset by developer decision
  // (2026-07-10) — the straight sword model reads wrong for them.
  [/scimitar|dagger|claws|whip|tentacle|fang/, 'dagger'],
  [/longsword|sword|rapier|blade|edge/, 'sword'],
  [/mace|maul|warhammer|hammer|flail|bulwark/, 'blunt'],
  [/wand/, 'wand'],
  [/battlestaff|staff|trident|tumaken/, 'staff'],
  [/spear|lance|harpoon/, 'staff'], // long-pole silhouette until a spear model exists
]

export const TIER_TINTS: [RegExp, string][] = [
  [/^bronze_/, '#c07a3d'],
  [/^iron_/, '#8a8f96'],
  [/^steel_/, '#c9ced6'],
  [/^mithril_/, '#6274c9'],
  [/^adamant_/, '#57a05c'],
  [/^runeforged_/, '#5aa7bd'],
  [/^dragon_/, '#c94a3b'],
  [/^gold_/, '#e0b93f'],
  [/^oak_/, '#a5814f'],
  [/^willow_/, '#90a35b'],
  [/^maple_/, '#c08e45'],
  [/^yew_/, '#96543f'],
  [/^magic_/, '#5a6fd0'],
  [/^chaotic_/, '#b04ad0'],
  [/^2nd_age_/, '#e8ddb5'],
  [/_of_air$/, '#d8e4ec'],
  [/_of_fire$/, '#d05a3a'],
  [/_of_water$/, '#4a7fd0'],
  [/_of_earth$/, '#8a6b3f'],
]

function itemIdInSlot(equipment: Record<string, unknown> | null | undefined, slotName: string): string | null {
  const slot = equipment?.[slotName] as { itemId?: unknown } | null | undefined
  return typeof slot?.itemId === 'string' ? slot.itemId : null
}

/** Tint for `itemId` from a registry section (equipmentModels.json's `weapons`
 * or `gear`) if it's listed there — even if that entry has no `tint` (the
 * arena renders it untinted, so the world should too) — else the regex
 * TIER_TINTS fallback for items the arena registry doesn't cover. */
function tintFor(itemId: string, registry: Record<string, EquipmentModelEntry> | undefined): string | undefined {
  const entry = registry?.[itemId]
  if (entry) return entry.tint
  return TIER_TINTS.find(([pattern]) => pattern.test(itemId))?.[1]
}

function weaponFromEquipment(equipment: Record<string, unknown> | null | undefined): { archetype: string; tint?: string } | undefined {
  const itemId = itemIdInSlot(equipment, 'weapon')
  if (!itemId) return undefined
  const item = (itemsData as Items)[itemId]
  if (!item || item.slot !== 'weapon') return undefined

  let archetype: string | null = null
  for (const [pattern, name] of ARCHETYPE_RULES) {
    if (pattern.test(itemId)) {
      archetype = name
      break
    }
  }
  if (!archetype) return undefined
  if (item.twoHanded) {
    if (archetype === 'sword') archetype = 'sword2h'
    else if (archetype === 'axe') archetype = 'axe2h'
  }

  const tint = tintFor(itemId, equipmentModels.weapons)
  return tint ? { archetype, tint } : { archetype }
}

/** Tint for an armour slot's equipped item. Absent/non-matching slot → omit
 * (undefined); an equipped body/legs item with no tint (registered untinted,
 * or unregistered with no matching tier prefix) → `{}` (present, no tint). */
function armorSlotTint(equipment: Record<string, unknown> | null | undefined, slotName: 'body' | 'legs' | 'boots'): { tint?: string } | undefined {
  const itemId = itemIdInSlot(equipment, slotName)
  if (!itemId) return undefined
  const item = (itemsData as Items)[itemId]
  if (!item || item.slot !== slotName) return undefined
  if (slotName === 'boots') return DEFAULT_BOOTS_TINT ? { tint: DEFAULT_BOOTS_TINT } : {}
  const tint = tintFor(itemId, equipmentModels.gear)
  return tint ? { tint } : {}
}

/** Visual descriptor for a character's equipped gear, from the save blob's
 * equipment shape (`equipment.weapon/body/legs = { itemId }`). Unknown/unmapped/
 * absent weapons → bare hands; empty armour slots are omitted entirely. */
export function gearFromEquipment(equipment: Record<string, unknown> | null | undefined): GearDescriptor {
  const gear: GearDescriptor = {}
  const weapon = weaponFromEquipment(equipment)
  if (weapon) gear.weapon = weapon
  const body = armorSlotTint(equipment, 'body')
  const legs = armorSlotTint(equipment, 'legs')
  const boots = armorSlotTint(equipment, 'boots')
  if (body || legs || boots) {
    gear.armor = {}
    if (body) gear.armor.body = body
    if (legs) gear.armor.legs = legs
    if (boots) gear.armor.boots = boots
  }
  // Registry-renderable equipped itemIds the client resolves to the arena's
  // exact model + placement: the weapon (overrides the archetype above) and the
  // rigid accessory slots (head/shield/cape/neck). body/legs are excluded — they
  // ride the tinted-outfit path via `armor` above, so echoing them here would be
  // dead weight on every entity diff.
  if (equipment) {
    const equip: Record<string, string> = {}
    for (const slot of Object.keys(equipment)) {
      // body/legs/boots ride the skinned-outfit `armor` path above, not the
      // rigid per-item `equip` path.
      if (slot === 'body' || slot === 'legs' || slot === 'boots') continue
      const itemId = itemIdInSlot(equipment, slot)
      if (!itemId) continue
      // head renders a generic default helm shell client-side even without
      // registry coverage (per-item art isn't authored); other rigid slots need
      // a registry model. (A modelled head item — a wizard hat — resolves to its
      // own art and also has a registry model, so it passes either arm.)
      if (slot === 'head' || hasRegistryModel(itemId)) equip[slot] = itemId
    }
    if (Object.keys(equip).length) gear.equip = equip
  }
  return gear
}
