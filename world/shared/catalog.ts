import { SIMPLE_GATHER_TASKS, resourceAction } from './resources'
import creaturesData from '../../src/data/creatures3d.json'
import skillsData from '../../src/data/skills.json'
import monstersData from '../../src/data/monsters.json'
import { MODELED_MONSTERS } from './monsterModels'

// The editor's asset library, derived entirely from game data so new content
// flows in with no editor change: gather nodes from skills.json, monsters from
// monsters.json, plus the fixed object types. Props are discovered separately
// (a Vite glob over the models folder — a client-only concern). Pure + testable.

export type CatalogEntry =
  | { kind: 'rock'; label: string; icon: string; rock: string; level: number }
  | { kind: 'tree'; label: string; icon: string; tree: string; level: number }
  | { kind: 'fishing_spot'; label: string; icon: string; fishing: string; level: number }
  | { kind: 'gather_site'; label: string; icon: string; gather: string; level: number }
  | { kind: 'npc'; label: string; icon: string; monsterId: string; combatLevel: number; hp: number; hasModel: boolean }
  | { kind: 'object'; label: string; icon: string; objectType: 'bank_chest' | 'furnace' | 'anvil' | 'range' }
  | { kind: 'prop'; label: string; icon: string; model: string }

export type CatalogGroup = { title: string; entries: CatalogEntry[] }

type SkillAction = { id: string; name?: string; level?: number }
type Skill = { actions?: SkillAction[] }
const skills = skillsData as unknown as Record<string, Skill>

type Monster = { name?: string; hp?: number; hitpoints?: number; combatLevel?: number }
const monsters = monstersData as unknown as Record<string, Monster>

export function gatherCatalog(): CatalogGroup {
  const entries: CatalogEntry[] = []
  for (const action of skills.mining?.actions ?? []) {
    if (!resourceAction({skill:'mining',rock:action.id})) continue
    entries.push({ kind: 'rock', label: action.name ?? action.id, icon: '⛏️', rock: action.id, level: action.level ?? 1 })
  }
  for (const action of skills.woodcutting?.actions ?? []) {
    if (!resourceAction({skill:'woodcutting',rock:action.id})) continue
    entries.push({ kind: 'tree', label: action.name ?? action.id, icon: '🌲', tree: action.id, level: action.level ?? 1 })
  }
  for (const action of skills.fishing?.actions ?? []) {
    if (!resourceAction({skill:'fishing',rock:action.id})) continue
    entries.push({ kind: 'fishing_spot', label: action.name ?? action.id, icon: '🎣', fishing: action.id, level: action.level ?? 1 })
  }
  for (const task of SIMPLE_GATHER_TASKS) entries.push({ kind: 'gather_site', label: task.name, icon: '🧵', gather: task.id, level: 1 })
  return { title: 'Gathering nodes', entries }
}

const hasVisual = (id: string) => MODELED_MONSTERS.has(id) || Object.hasOwn(creaturesData.monsters, id)

export function monsterCatalog(): CatalogGroup {
  const entries: CatalogEntry[] = Object.entries(monsters)
    .map(([id, m]) => ({
      kind: 'npc' as const,
      label: m.name ?? id,
      icon: hasVisual(id) ? '🐾' : '☠️',
      monsterId: id,
      combatLevel: Number(m.combatLevel) || 0,
      hp: Number(m.hp ?? m.hitpoints) || 0,
      hasModel: hasVisual(id),
    }))
    .sort((a, b) => a.combatLevel - b.combatLevel || a.label.localeCompare(b.label))
  return { title: 'Monsters', entries }
}

export function objectCatalog(): CatalogGroup {
  return {
    title: 'Objects',
    entries: [
      { kind: 'object', label: 'Bank chest', icon: '🏦', objectType: 'bank_chest' },
      { kind: 'object', label: 'Furnace', icon: '🔥', objectType: 'furnace' },
      { kind: 'object', label: 'Anvil', icon: '🔨', objectType: 'anvil' },
      { kind: 'object', label: 'Cooking range', icon: '🍳', objectType: 'range' },
    ],
  }
}

export function propCatalog(models: string[]): CatalogGroup {
  const entries: CatalogEntry[] = models
    .slice()
    .sort()
    .map((model) => ({ kind: 'prop', label: model.replace(/_/g, ' '), icon: '🌿', model }))
  return { title: 'Scenery props', entries }
}

/** Full library. `propModels` comes from the client's Vite glob of the props
 * folder; pass [] where props aren't available (e.g. tests). */
export function buildCatalog(propModels: string[]): CatalogGroup[] {
  return [gatherCatalog(), monsterCatalog(), objectCatalog(), propCatalog(propModels)]
}
