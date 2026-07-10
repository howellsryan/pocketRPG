// Equipment → visual appearance mapping (guide §11, decision D3: archetype ×
// tier tint, maximum asset reuse). One model per archetype in
// world/client/public/models/weapons/ (built by scripts/build-weapons.mjs);
// coverage tracked in docs/open-world-asset-coverage.md. Unmapped items render
// bare-handed — appearance never blocks gameplay.
import itemsData from '../../src/data/items.json'
import type { GearDescriptor } from './protocol'

type Items = Record<string, { slot?: string | null; twoHanded?: boolean } | undefined>

export const WEAPON_ARCHETYPES = ['sword', 'sword2h', 'dagger', 'axe', 'axe2h', 'blunt', 'bow', 'crossbow', 'staff', 'wand'] as const

// First match wins — specific tokens (battleaxe, crossbow, godsword) must sit
// above the generic tokens they contain (axe, bow, sword).
const ARCHETYPE_RULES: [RegExp, string][] = [
  [/scythe|battleaxe|greataxe/, 'axe2h'],
  [/pickaxe|axe/, 'axe'],
  [/godsword|2h_sword/, 'sword2h'],
  [/crossbow|ballista|blowpipe/, 'crossbow'],
  [/shortbow|longbow|bow/, 'bow'],
  [/scimitar|longsword|sword|rapier|blade|edge/, 'sword'],
  [/dagger|claws|whip|tentacle|fang/, 'dagger'],
  [/mace|maul|warhammer|hammer|flail|bulwark/, 'blunt'],
  [/wand/, 'wand'],
  [/battlestaff|staff|trident|tumaken/, 'staff'],
  [/spear|lance|harpoon/, 'staff'], // long-pole silhouette until a spear model exists
]

const TIER_TINTS: [RegExp, string][] = [
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

/** Visual descriptor for a character's equipped weapon, from the save blob's
 * equipment shape (`equipment.weapon = { itemId }`). Unknown/unmapped/absent
 * weapons → `{}` (bare hands). */
export function gearFromEquipment(equipment: Record<string, unknown> | null | undefined): GearDescriptor {
  const slot = equipment?.weapon as { itemId?: unknown } | null | undefined
  const itemId = typeof slot?.itemId === 'string' ? slot.itemId : null
  if (!itemId) return {}
  const item = (itemsData as Items)[itemId]
  if (!item || item.slot !== 'weapon') return {}

  let archetype: string | null = null
  for (const [pattern, name] of ARCHETYPE_RULES) {
    if (pattern.test(itemId)) {
      archetype = name
      break
    }
  }
  if (!archetype) return {}
  if (item.twoHanded) {
    if (archetype === 'sword') archetype = 'sword2h'
    else if (archetype === 'axe') archetype = 'axe2h'
  }

  const tint = TIER_TINTS.find(([pattern]) => pattern.test(itemId))?.[1]
  return { weapon: tint ? { archetype, tint } : { archetype } }
}
