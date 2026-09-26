// A monster with no bespoke GLB (world/shared/monsterModels.ts) and no own
// creatures3d spec (src/data/creatures3d.json) used to render as a literal
// cow (entities.ts's Phase 2 default) regardless of what it actually is —
// most of the bestiary, since only ~24 of 119 monsters have either. The idle
// game never has this problem: monsterArchetypeFor (src/utils/
// monsterFigures.js) gives every monster a species-correct body from an
// explicit table + name-pattern fallback, no gaps possible. This table lets
// the world borrow an EXISTING model/spec that already represents the same
// archetype — the shape a Golden Hen's idle-game cousin already draws — so an
// uncovered monster reads as roughly the right creature instead of a cow.
//
// Deliberately partial: only archetypes with an existing GLB or creatures3d
// spec to borrow are listed. An archetype with neither (lizardman, beast,
// bird, insect, kraken, orb, husk, golem, treant, as of this table) still
// falls to the cow — closing that needs new art (procgen-creature), not a
// remap, and is out of scope here.
//
// Reusing monsterArchetypeFor/monsterPaletteNameFor rather than duplicating
// the classification tables is the same call CLAUDE.md §9 makes for item
// icons ("never give a client its own resolver") — one archetype/palette
// answer for a monster id, shared by both renderers.
import { monsterArchetypeFor, monsterPaletteNameFor } from '../../src/utils/monsterFigures.js'
import { hidePaletteHexFor } from '../../src/utils/hidePaletteHex.js'

export type ArchetypeFallback =
  | { kind: 'glb'; templateId: string; heightScale?: number }
  | { kind: 'proc'; templateId: string }

/** archetype (monsterFigures.js's 22) → an existing monster id whose model
 * this one borrows. GLB entries name a world/shared/monsterModels.ts key;
 * proc entries name a src/data/creatures3d.json key. `heightScale` scales the
 * template's own targetHeight — only 'giant' needs one, since every other
 * bucket's template is already sized about right for its archetype. */
export const ARCHETYPE_FALLBACK: Record<string, ArchetypeFallback> = {
  bovine: { kind: 'glb', templateId: 'pasture_bull' },
  fowl: { kind: 'glb', templateId: 'field_chicken' },
  toad: { kind: 'glb', templateId: 'marshfen_toad' },
  imp: { kind: 'glb', templateId: 'frostbite_imp' },
  humanoid: { kind: 'glb', templateId: 'cave_goblin' },
  giant: { kind: 'glb', templateId: 'cave_goblin', heightScale: 1.5 },
  demon: { kind: 'glb', templateId: 'lesser_fiend' },
  skeleton: { kind: 'glb', templateId: 'zaryth_blade_sentinel' },
  arachnid: { kind: 'proc', templateId: 'broodfang_spider' },
  crab: { kind: 'proc', templateId: 'stoneback_crab' },
  serpent: { kind: 'proc', templateId: 'cindermaw_serpent' },
  wraith: { kind: 'proc', templateId: 'shroudwraith_specter' },
}

export type ResolvedArchetypeFallback = ArchetypeFallback & { tintHex: string }

/** Pure decision: what should `monsterId` borrow, and what colour. Callers
 * only reach this once they've already checked MONSTER_MODELS[monsterId] and
 * creatureSpecFor(monsterId) both come back empty — this never overrides a
 * monster's own registered model or spec. */
export function resolveArchetypeFallback(monsterId: string): ResolvedArchetypeFallback | null {
  const monster = { id: monsterId }
  const archetype = monsterArchetypeFor(monster)
  const fallback = ARCHETYPE_FALLBACK[archetype]
  if (!fallback) return null
  const paletteName = monsterPaletteNameFor(monster, archetype)
  return { ...fallback, tintHex: hidePaletteHexFor(paletteName) }
}
