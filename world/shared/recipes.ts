// Processing-station recipe tables, driven entirely by src/data/skills.json —
// never hand-author a recipe row. Shared client/server: the panel renders from
// here and the server re-validates against the same table.
import skillsData from '../../src/data/skills.json'

export type StationType = 'furnace' | 'anvil' | 'range'

export type Recipe = {
  id: string
  name: string
  level: number
  ticks: number
  xp: number
  product: string
  materials: Record<string, number>
  burnStopLevel?: number
}

type SkillsData = Record<string, { actions?: Recipe[] }>
const skills = skillsData as unknown as SkillsData

const smithing = skills.smithing?.actions ?? []
const cooking = skills.cooking?.actions ?? []

const withMaterials = (actions: Recipe[]): Recipe[] => actions.filter((a) => a.materials && a.product)

export const STATIONS: Record<StationType, { skill: string; verb: string; label: string; recipes: Recipe[] }> = {
  furnace: {
    skill: 'smithing',
    verb: 'smelt',
    label: 'Furnace',
    recipes: withMaterials(smithing.filter((a) => a.id.startsWith('smelt_'))),
  },
  anvil: {
    skill: 'smithing',
    verb: 'smith',
    label: 'Anvil',
    recipes: withMaterials(smithing.filter((a) => !a.id.startsWith('smelt_'))),
  },
  range: {
    skill: 'cooking',
    verb: 'cook',
    label: 'Cooking Range',
    recipes: withMaterials(cooking),
  },
}

export function isStationType(value: unknown): value is StationType {
  return value === 'furnace' || value === 'anvil' || value === 'range'
}

/** Interact verb → station object type ('smelt' → furnace, …). */
export function stationTypeForVerb(verb: string): StationType | null {
  for (const [type, station] of Object.entries(STATIONS)) {
    if (station.verb === verb) return type as StationType
  }
  return null
}

export function recipeFor(station: StationType, recipeId: string): Recipe | undefined {
  return STATIONS[station].recipes.find((r) => r.id === recipeId)
}
