import { describe, it, expect } from 'vitest'
import { summarizeSave } from '../functions/_lib/mcp/summary.js'
import { TOOL_SCHEMAS, TOOL_NAMES, SERVER_INSTRUCTIONS } from '../functions/_lib/mcp/schema.js'
import { itemName, shopCatalog, REFERENCE_RESOURCES, readReference, getItem } from '../functions/_lib/mcp/reference.js'
import { callTool } from '../functions/_lib/mcp/tools.js'

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
      'inspect_item',
      'inspect_monster',
      'buy_item',
      'skip_hour',
      'skip_slayer_task',
      'search_market',
      'my_offers',
      'place_offer',
      'cancel_offer',
      'collect_offer',
      'instant_sell_offer',
      'sell_item',
      'deposit_to_bank',
      'withdraw_from_bank',
      'equip_item',
      'unequip_item',
      'get_active_activity',
      'start_skilling',
      'claim_activity',
    ])
  })

  it('every tool has a description, object input schema and annotations', () => {
    for (const tool of TOOL_SCHEMAS) {
      expect(typeof tool.name).toBe('string')
      expect(tool.description.length).toBeGreaterThan(10)
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.properties).toBeTypeOf('object')
      expect(typeof tool.annotations.title).toBe('string')
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean')
    }
  })

  it('marks reads read-only and writes not read-only', () => {
    const a = (n: string) => TOOL_SCHEMAS.find((t) => t.name === n)?.annotations
    expect(a('get_character_state')?.readOnlyHint).toBe(true)
    expect(a('inspect_item')?.readOnlyHint).toBe(true)
    expect(a('search_market')?.readOnlyHint).toBe(true)
    expect(a('buy_item')?.readOnlyHint).toBe(false)
    expect(a('skip_hour')?.readOnlyHint).toBe(false)
    expect(a('place_offer')?.readOnlyHint).toBe(false)
    expect(a('sell_item')?.readOnlyHint).toBe(false)
  })

  it('place_offer requires its order fields', () => {
    const req = TOOL_SCHEMAS.find((t) => t.name === 'place_offer')?.inputSchema.required
    expect(req).toEqual(expect.arrayContaining(['offer_type', 'item_id', 'price', 'quantity']))
  })

  it('buy_item requires item_id', () => {
    const buy = TOOL_SCHEMAS.find((t) => t.name === 'buy_item')
    expect(buy?.inputSchema.required).toContain('item_id')
  })

  it('advertises non-trivial server instructions', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(100)
    expect(SERVER_INSTRUCTIONS).toMatch(/list_characters/)
  })
})

describe('MCP reference data', () => {
  it('resolves item ids to names', () => {
    expect(itemName('coins')).toBe('Coins')
    expect(getItem('coins')?.type).toBe('currency')
    expect(itemName('definitely_not_an_item')).toBe('definitely_not_an_item')
  })

  it('shop catalogue entries all have id + name and exclude restricted uniques', () => {
    const shop = shopCatalog()
    expect(shop.length).toBeGreaterThan(0)
    for (const entry of shop) {
      expect(typeof entry.id).toBe('string')
      expect(typeof entry.name).toBe('string')
      expect(getItem(entry.id)?.isBossUnique).not.toBe(true)
    }
  })

  it('lists reference resources including mechanics + item index', () => {
    const uris = REFERENCE_RESOURCES.map((r) => r.uri)
    expect(uris).toContain('pocketrpg://reference/mechanics')
    expect(uris).toContain('pocketrpg://reference/items')
  })

  it('reads markdown mechanics and a JSON index, and rejects unknown uris', () => {
    expect(readReference('pocketrpg://reference/mechanics')?.mimeType).toBe('text/markdown')
    const items = readReference('pocketrpg://reference/items')
    expect(items?.mimeType).toBe('application/json')
    expect(Array.isArray(JSON.parse(items!.text))).toBe(true)
    expect(readReference('pocketrpg://reference/nope')).toBe(null)
  })
})

describe('MCP dispatch', () => {
  // Empty env: handlers fail auth/DB and surface as isError results, but a
  // *known* tool must never throw "Unknown tool" — this guards schema/dispatch drift.
  const ctx = { env: {}, authorization: null } as any

  it('every advertised tool has a dispatch handler', async () => {
    for (const name of TOOL_NAMES) {
      const result = await callTool(name, {}, ctx)
      expect(result).toBeTypeOf('object')
      expect(Array.isArray(result.content)).toBe(true)
    }
  })

  it('unknown tool names reject', async () => {
    await expect(callTool('does_not_exist', {}, ctx)).rejects.toThrow(/Unknown tool/)
  })
})
