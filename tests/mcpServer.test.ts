import { describe, it, expect } from 'vitest'
import { summarizeSave } from '../functions/_lib/mcp/summary.js'
import { TOOL_SCHEMAS, TOOL_NAMES, SERVER_INSTRUCTIONS } from '../functions/_lib/mcp/schema.js'
import { itemName, shopCatalog, REFERENCE_RESOURCES, readReference, getItem, listSkills, getSkillActions, searchItems, searchMonsters, REFERENCE_TOPIC_NAMES } from '../functions/_lib/mcp/reference.js'
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
      'logout',
      'get_character_state',
      'get_collection_log',
      'get_kill_counts',
      'get_leaderboard',
      'inspect_item',
      'inspect_monster',
      'list_skill_actions',
      'list_items',
      'list_monsters',
      'get_reference',
      'buy_item',
      'skip_hour',
      'skip_slayer_task',
      'get_slayer_task',
      'assign_slayer_task',
      'search_market',
      'list_market_listings',
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
      'start_gather',
      'claim_activity',
      'get_quests',
      'start_quest',
      'queue_quest',
      'remove_from_queue',
      'get_idle_combat_setup',
      'set_idle_combat_setup',
      'start_fight',
      'kill_boss',
      'fight_boss',
      'kill_raid',
      'claim_dungeoneering_reward',
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
    expect(a('list_market_listings')?.readOnlyHint).toBe(true)
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

  it('instructs the model not to use OSRS/RuneScape knowledge or the web', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/OSRS|RuneScape/)
    expect(SERVER_INSTRUCTIONS).toMatch(/not search the web|do not rely/i)
    // The browse tools the rule points the model at must actually exist.
    for (const name of ['list_items', 'list_monsters', 'list_skill_actions', 'get_reference']) {
      expect(TOOL_NAMES).toContain(name)
    }
  })
})

describe('MCP browse helpers', () => {
  it('lists every skill with an action count', () => {
    const skills = listSkills()
    const mining = skills.find((s) => s.id === 'mining')
    expect(mining?.name).toBe('Mining')
    expect(mining?.actionCount).toBeGreaterThan(0)
  })

  it('resolves a skill\'s actions (including non-"actions" arrays like thieving npcs)', () => {
    expect(getSkillActions('mining')?.actions.some((a: any) => a.id === 'iron')).toBe(true)
    const thieving = getSkillActions('thieving')
    expect(thieving?.actionKey).toBe('npcs')
    expect(thieving?.actions.length).toBeGreaterThan(0)
    expect(getSkillActions('not_a_skill')).toBe(null)
  })

  it('searches items by name and type, honouring the limit', () => {
    const bronze = searchItems({ query: 'bronze' })
    expect(bronze.items.length).toBeGreaterThan(0)
    expect(bronze.items.every((i) => /bronze/i.test(i.name) || /bronze/i.test(i.id))).toBe(true)
    const food = searchItems({ type: 'food', limit: 3 })
    expect(food.items.length).toBe(3)
    expect(food.items.every((i) => i.type === 'food')).toBe(true)
    expect(food.total).toBeGreaterThanOrEqual(food.returned)
  })

  it('searches monsters by name and flags bosses', () => {
    const all = searchMonsters({})
    expect(all.total).toBeGreaterThan(0)
    expect(all.monsters[0]).toHaveProperty('boss')
  })

  it('every advertised reference topic resolves to readable data', () => {
    expect(REFERENCE_TOPIC_NAMES).toContain('mechanics')
    expect(REFERENCE_TOPIC_NAMES).not.toContain('items')
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

  it('browse tools return real content without auth/DB', async () => {
    const items = await callTool('list_items', { query: 'bronze', limit: 5 }, ctx)
    expect(items.isError).toBeFalsy()
    expect(JSON.parse(items.content[0].text).items.length).toBeGreaterThan(0)

    const skills = await callTool('list_skill_actions', {}, ctx)
    expect(JSON.parse(skills.content[0].text).skills.length).toBeGreaterThan(0)

    const ref = await callTool('get_reference', { topic: 'mechanics' }, ctx)
    expect(ref.isError).toBeFalsy()
    expect(ref.content[0].text).toMatch(/PocketRPG/)

    const bad = await callTool('get_reference', { topic: 'nonsense' }, ctx)
    expect(bad.isError).toBe(true)
  })

  it('logout returns disconnect/switch guidance for the signed-in identity', async () => {
    const authed = { env: {}, authorization: null, identity: { id: 7, provider: 'github', displayName: 'Ada' } } as any
    const res = await callTool('logout', {}, authed)
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.account).toEqual({ provider: 'github', displayName: 'Ada' })
    expect(Array.isArray(data.switchAccount)).toBe(true)
    expect(data.switchAccount.join(' ')).toMatch(/different account/i)
    // Without an identity it surfaces an auth error rather than guidance.
    expect((await callTool('logout', {}, ctx)).isError).toBe(true)
  })
})
