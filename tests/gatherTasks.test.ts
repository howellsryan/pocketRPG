// Data-contract + lookup tests for the gather-task table shared by GatherScreen
// and the MCP idle engine. A task that references a missing item id would
// silently award nothing, so the item-reference contract is pinned here.

import { describe, it, expect } from 'vitest'
import { GATHER_TASKS, findGatherTask } from '../src/engine/gatherTasks.js'
import itemsData from '../src/data/items.json'

const items = itemsData as Record<string, unknown>

describe('GATHER_TASKS data contract', () => {
  it('has at least one task', () => {
    expect(GATHER_TASKS.length).toBeGreaterThan(0)
  })

  it('every task id is unique', () => {
    const ids = GATHER_TASKS.map((t: any) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every task has the required fields with sane values', () => {
    for (const t of GATHER_TASKS as any[]) {
      expect(typeof t.id, `${t.id} id`).toBe('string')
      expect(typeof t.name, `${t.id} name`).toBe('string')
      expect(t.ticks, `${t.id} ticks`).toBeGreaterThan(0)
      expect(Number.isInteger(t.ticks), `${t.id} ticks integer`).toBe(true)
      expect(t.qty, `${t.id} qty`).toBeGreaterThan(0)
      expect(typeof t.product, `${t.id} product`).toBe('string')
    }
  })

  it('every referenced product item exists in items.json', () => {
    for (const t of GATHER_TASKS as any[]) {
      expect(items[t.product], `gather task ${t.id} references missing item "${t.product}"`).toBeDefined()
    }
  })
})

describe('findGatherTask', () => {
  it('returns the matching task', () => {
    const first = (GATHER_TASKS as any[])[0]
    expect(findGatherTask(first.id)).toBe(first)
  })

  it('returns null for an unknown id', () => {
    expect(findGatherTask('does_not_exist')).toBeNull()
    expect(findGatherTask(undefined as any)).toBeNull()
  })
})
