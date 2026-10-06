// Canonical resource adapters shared by authoring/editor, rendering and server.
// Clients never supply products, XP, quantities or action duration.
import skillsData from '../../src/data/skills.json'
import { GATHER_TASKS } from '../../src/engine/gatherTasks.js'

export type ResourceSkill = 'mining' | 'woodcutting' | 'fishing' | 'gather'
export type ResourceNode = { rock: string; skill?: ResourceSkill }
type SkillAction = { id: string; name: string; product: string; ticks: number; level: number; xp: number }
export type GatherTask = {
  id: string; name: string; description?: string; product?: string; ticks: number; qty?: number
  materials?: unknown; gpCost?: number; requiresItem?: unknown; oneShot?: boolean; isClue?: boolean
}
export type ResourceAction = SkillAction & {
  quantity: number; xpSkill: Exclude<ResourceSkill, 'gather'> | null
  verb: 'mine' | 'chop' | 'fish' | 'gather'; depletionTicks: number; description?: string
}
const skills = skillsData as unknown as Record<string, { actions: SkillAction[] }>
export function isSimpleGatherTask(task: GatherTask): boolean {
  return Boolean(task.product && task.ticks > 0 && !task.materials && !task.gpCost && !task.requiresItem && !task.oneShot && !task.isClue)
}
export const SIMPLE_GATHER_TASKS = (GATHER_TASKS as unknown as GatherTask[]).filter(isSimpleGatherTask)

export function resourceAction(node: ResourceNode): ResourceAction | undefined {
  const skill = node.skill ?? 'mining'
  if (skill === 'gather') {
    const task = SIMPLE_GATHER_TASKS.find((t) => t.id === node.rock)
    if (!task?.product) return undefined
    return { id: task.id, name: task.name, description: task.description, product: task.product,
      ticks: task.ticks, level: 1, xp: 0, quantity: task.qty ?? 1, xpSkill: null, verb: 'gather', depletionTicks: 0 }
  }
  const action = skills[skill]?.actions.find((a) => a.id === node.rock)
  if (!action?.product) return undefined
  return { ...action, quantity: 1, xpSkill: skill,
    verb: skill === 'mining' ? 'mine' : skill === 'woodcutting' ? 'chop' : 'fish',
    depletionTicks: skill === 'fishing' ? 0 : 8 }
}

export function resourceNodeFor(object: {
  type: string; rock?: string; tree?: string; fishing?: string; gather?: string
}): ResourceNode | undefined {
  const mapping: Record<string, [ResourceSkill, string | undefined]> = {
    rock: ['mining', object.rock], tree: ['woodcutting', object.tree],
    fishing_spot: ['fishing', object.fishing], gather_site: ['gather', object.gather],
  }
  const pair = mapping[object.type]
  if (!pair?.[1]) return undefined
  const node: ResourceNode = { skill: pair[0], rock: pair[1] }
  return resourceAction(node) ? node : undefined
}
