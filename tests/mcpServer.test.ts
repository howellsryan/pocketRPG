import { describe, it, expect } from 'vitest'
import { summarizeSave } from '../functions/_lib/mcp/summary.js'
import { TOOL_SCHEMAS, TOOL_NAMES } from '../functions/_lib/mcp/schema.js'

describe('MCP summarizeSave', () => {
  const save = {
    coins: 12345,
    settings: { combatStance: 'aggressive' },
    player: { currentHP: 42, prayer: 7 },
    stats: {
      attack: { xp: 0 },
      // 1,154 XP is the level-10 hitpoints baseline (see AGENTS.md §5).
      hitpoints: { xp: 1154 },
    },
    equipment: {
      weapon: { itemId: 'bronze_dagger', quantity: 1 },
      head: null,
    },
    inventory: [
      { itemId: 'oak_logs', quantity: 5 },
      null,
      { id: 'coins', quantity: 100, noted: true },
    ],
    bank: { iron_ore: { itemId: 'iron_ore', quantity: 30 }, coal: { itemId: 'coal', quantity: 10 } },
  }

  it('derives skill levels from XP', () => {
    const out = summarizeSave(save)
    expect(out.skills.attack.level).toBe(1)
    expect(out.skills.hitpoints.level).toBe(10)
    expect(out.skills.hitpoints.xp).toBe(1154)
  })

  it('reports coins, stance and HP', () => {
    const out = summarizeSave(save)
    expect(out.coins).toBe(12345)
    expect(out.combatStance).toBe('aggressive')
    expect(out.currentHP).toBe(42)
    expect(out.prayerPoints).toBe(7)
  })

  it('compacts inventory (drops empty slots) and equipment (drops empty slots)', () => {
    const out = summarizeSave(save)
    expect(out.inventoryUsed).toBe(2)
    expect(out.inventoryCapacity).toBe(28)
    expect(out.inventory).toEqual([
      { itemId: 'oak_logs', quantity: 5, noted: false },
      { itemId: 'coins', quantity: 100, noted: true },
    ])
    expect(out.equipment).toEqual({ weapon: { itemId: 'bronze_dagger', quantity: 1 } })
    expect(out.bankUniqueItems).toBe(2)
  })

  it('accepts a JSON string as well as an object', () => {
    expect(summarizeSave(JSON.stringify(save)).coins).toBe(12345)
  })

  it('tolerates an empty/partial save', () => {
    const out = summarizeSave({})
    expect(out.coins).toBe(0)
    expect(out.inventoryUsed).toBe(0)
    expect(out.skills).toEqual({})
  })
})

describe('MCP tool schema', () => {
  it('exposes the expected tool set', () => {
    expect(TOOL_NAMES).toEqual([
      'list_characters',
      'get_account',
      'get_character_state',
      'get_collection_log',
      'get_kill_counts',
      'get_leaderboard',
      'buy_item',
      'skip_hour',
      'skip_slayer_task',
    ])
  })

  it('every tool has a description and a valid object input schema', () => {
    for (const tool of TOOL_SCHEMAS) {
      expect(typeof tool.name).toBe('string')
      expect(tool.description.length).toBeGreaterThan(10)
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.properties).toBeTypeOf('object')
    }
  })

  it('buy_item requires item_id', () => {
    const buy = TOOL_SCHEMAS.find((t) => t.name === 'buy_item')
    expect(buy?.inputSchema.required).toContain('item_id')
  })
})
