import { describe, it, expect } from 'vitest'
import { summarizeSave } from '../functions/_lib/mcp/summary.js'
import { TOOL_SCHEMAS, TOOL_NAMES, SERVER_INSTRUCTIONS } from '../functions/_lib/mcp/schema.js'
import { itemName, itemSources, shopCatalog, REFERENCE_RESOURCES, readReference, getItem, listSkills, getSkillActions, searchItems, searchMonsters, REFERENCE_TOPIC_NAMES } from '../functions/_lib/mcp/reference.js'
import { callTool } from '../functions/_lib/mcp/tools.js'
import { signJWT } from '../functions/_lib/jwt.js'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'

// writeSave batches the save-history snapshot ahead of its UPDATE, so these
// hand-rolled D1 doubles have to run a batch in order and hand back one result
// per statement — the caller indexes into them.
const runBatch = async (statements: any[]) => {
  const out = []
  for (const statement of statements) out.push(await statement.run())
  return out
}

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

  it('reports total level, total XP and combat level', () => {
    const out = summarizeSave(save)
    expect(out.totalLevel).toBe(11) // attack 1 + hitpoints 10
    expect(out.totalXp).toBe(1154)
    expect(typeof out.combatLevel).toBe('number')
    expect(out.combatLevel).toBeGreaterThanOrEqual(3)
  })

  it('reports combat type, attack speed and prayer cap from worn gear/stats', () => {
    const out = summarizeSave(save)
    expect(out.combatType).toBe('melee')
    expect(out.attackSpeedTicks).toBe(4) // bronze_dagger
    expect(out.prayerPointsMax).toBe(1) // no prayer XP → level 1
  })

  it('aggregates equipment bonuses and best-case max hits', () => {
    const out = summarizeSave(save)
    expect(out.equipmentBonuses.otherBonus.meleeStrength).toBe(3) // bronze_dagger
    expect(out.equipmentBonuses.attackBonus.stab).toBe(4)
    expect(out.maxHits.melee).toBe(1)
    expect(out.maxHits.ranged).toBe(1)
    expect(out.maxHits.magic).toBeNull() // dagger is not a powered staff
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
      'create_character',
      'get_account',
      'logout',
      'get_character_state',
      'get_bank',
      'get_daily_tasks',
      'get_collection_log',
      'get_kill_counts',
      'get_leaderboard',
      'inspect_item',
      'inspect_monster',
      'analyze_dps',
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
      'start_clue',
      'start_minigame',
      'train_prayer',
      'train_construction',
      'unlock_construction_perk',
      'get_farm',
      'plant_seed',
      'harvest_patch',
      'harvest_all',
      'cast_magic',
      'buy_unlock',
      'buy_slayer_unlock',
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

  it('opens with a tool-first operating contract, a routing index and a safety valve', () => {
    // The mandate to use these tools (and not the web/memory) must come BEFORE
    // the deep "Acting" reference so weak models read it first.
    const howToOperate = SERVER_INSTRUCTIONS.indexOf('HOW TO OPERATE')
    const acting = SERVER_INSTRUCTIONS.indexOf('Acting:')
    expect(howToOperate).toBeGreaterThanOrEqual(0)
    expect(acting).toBeGreaterThan(howToOperate)
    // Tool-first mandate.
    expect(SERVER_INSTRUCTIONS).toMatch(/ONLY valid source/)
    expect(SERVER_INSTRUCTIONS).toMatch(/call a tool here/i)
    // Safety valve — degrade gracefully instead of guessing.
    expect(SERVER_INSTRUCTIONS).toMatch(/Safety valve/)
    expect(SERVER_INSTRUCTIONS).toMatch(/say so plainly and stop/i)
    // Capability/routing index that names real tools.
    expect(SERVER_INSTRUCTIONS).toMatch(/WHAT YOU CAN DO HERE/)
    for (const name of ['start_skilling', 'start_fight', 'plant_seed', 'cast_magic', 'buy_slayer_unlock']) {
      expect(SERVER_INSTRUCTIONS).toContain(name)
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

  it('exposes construction and gather reference topics with real data', () => {
    expect(REFERENCE_TOPIC_NAMES).toContain('construction')
    expect(REFERENCE_TOPIC_NAMES).toContain('gather')
    const construction = readReference('pocketrpg://reference/construction')
    expect(construction?.mimeType).toBe('application/json')
    const conData = JSON.parse(construction!.text)
    expect(conData.buildActions.some((a: any) => a.id === 'build_oak_plank')).toBe(true)
    expect(conData.perks.some((p: any) => p.id === 'money_purse')).toBe(true)
    const gather = readReference('pocketrpg://reference/gather')
    expect(Array.isArray(JSON.parse(gather!.text))).toBe(true)
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

  it('itemSources reverse-lookup answers "how do I get X"', async () => {
    const boots = itemSources('dragon_boots')
    expect(boots?.monsters?.length).toBeGreaterThan(0)
    for (const m of boots!.monsters) {
      expect(typeof m.name).toBe('string')
      expect(m.chance).toBeGreaterThan(0)
    }
    // Skilling products and General Store stock are sources too.
    expect(itemSources('tin_ore')?.skills?.[0]?.skill).toBeTruthy()
    // Unknown/ungranted items return null, not an empty object.
    expect(itemSources('definitely_not_an_item')).toBe(null)
    // inspect_item surfaces the sources field to the model.
    const res = await callTool('inspect_item', { item_id: 'dragon_boots' }, { env: {} } as any)
    expect(JSON.parse(res.content[0].text).sources.monsters.length).toBeGreaterThan(0)
  })

  it('raid uniques source from the raid reward chest, never from raid sub-bosses', async () => {
    // rewards.unique.items is the real raids.json shape.
    expect(itemSources('shadow_of_tumaken')?.raids).toContain('Tomb of Arasmus')
    // Raid-only bosses' monsters.json drop tables are never rolled — they must
    // not appear as monster sources; the raid is the only source.
    const helm = itemSources('torvek_s_helm')
    expect(helm?.raids).toContain('Cryptbound Champions')
    expect(helm?.monsters).toBeUndefined()
    // inspect_monster on a raid sub-boss hides the dead drop table and points
    // at the raid chest instead.
    const res = await callTool('inspect_monster', { monster_id: 'torvek_the_corrupted' }, { env: {} } as any)
    const monster = JSON.parse(res.content[0].text)
    expect(monster.drops).toBeUndefined()
    expect(monster.raid).toBe('Cryptbound Champions')
    expect(monster.lootNote).toContain('reward chest')
    // Standalone bosses keep their drop tables.
    const kbd = await callTool('inspect_monster', { monster_id: 'king_black_dragon' }, { env: {} } as any)
    expect(JSON.parse(kbd.content[0].text).drops?.length).toBeGreaterThan(0)
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

describe('MCP trading-post source: inventory|bank', () => {
  it('place_offer and sell_item advertise an optional inventory|bank source', () => {
    for (const name of ['place_offer', 'sell_item']) {
      const src = TOOL_SCHEMAS.find((t) => t.name === name)?.inputSchema.properties.source
      expect(src).toMatchObject({ type: 'string', enum: ['inventory', 'bank'] })
      // Optional — never a required field.
      expect(TOOL_SCHEMAS.find((t) => t.name === name)?.inputSchema.required).not.toContain('source')
    }
  })

  // End-to-end: a sell_item call with source:'bank' must reach the production
  // sell-immediate handler and escrow the item from the bank, leaving any
  // inventory copy untouched. This proves the MCP layer forwards `source`.
  const TEST_SECRET = 'test-jwt-secret'
  const IDENTITY = 'identity-1'

  function mockEnv(save: any) {
    const captured: { saveData: string | null } = { saveData: null }
    const blob = gzipJsonString(JSON.stringify(save))
    const prepare = (sql: string) => ({
      bind: (...args: any[]) => ({
        all: async () => {
          // characters listing (resolveCharacterId)
          if (sql.includes('FROM characters c') && sql.includes('total_pvp_kills')) {
            return { results: [{ id: 7, username: 'Hero', is_ironman: 0, is_one_life: 0, created_at: 1 }] }
          }
          return { results: [] }
        },
        first: async () => {
          // Ownership read at the head of GET /api/save.
          if (sql.includes('combat_level FROM characters')) {
            return { id: Number(args[0]), total_level: 1, combat_level: 3 }
          }
          // GET /api/save read (bridged by get_bank / get_character_state).
          if (sql.includes('save_data, save_blob') && sql.includes('FROM saves')) {
            return { save_data: null, save_blob: await blob, updated_at: 123, save_revision: 0 }
          }
          if (sql.includes("c.credits") && sql.includes('save_blob')) {
            return {
              id: Number(args[0]),
              owner_id: args[1],
              is_ironman: 0,
              credits: 0,
              save_blob: await blob,
              save_data: null,
              updated_at: 123,
              save_revision: 0,
            }
          }
          if (sql.includes('save_revision FROM saves')) return { save_revision: 1 }
          return null
        },
        run: async () => {
          if (sql.startsWith('UPDATE saves')) captured.saveData = args[1]
          return { meta: { changes: 1 } }
        },
      }),
    })
    return { env: { DB: { prepare, batch: runBatch }, JWT_SECRET: TEST_SECRET } as any, captured }
  }

  it("sell_item with source:'bank' drains the bank and leaves inventory copies", async () => {
    const save = {
      inventory: [{ itemId: 'fighter_helm', quantity: 1 }],
      bank: { fighter_helm: { itemId: 'fighter_helm', quantity: 2 } },
    }
    const { env, captured } = mockEnv(save)
    const token = await signJWT({ sub: IDENTITY, provider: 'test' }, TEST_SECRET)
    const ctx = { env, authorization: `Bearer ${token}`, identity: { id: IDENTITY } } as any

    const res = await callTool('sell_item', { item_id: 'fighter_helm', quantity: 2, source: 'bank', character_id: 7 }, ctx)
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.source).toBe('bank')
    expect(data.total_payout).toBe(1000000)

    const written = JSON.parse(captured.saveData!)
    expect(written.bank.fighter_helm).toBeUndefined()
    // Inventory copy untouched — the bank was the source.
    expect(written.inventory.find((s: any) => s.itemId === 'fighter_helm')?.quantity).toBe(1)
  })

  it('analyze_dps reads the character save and rates their gear', async () => {
    const stats: Record<string, any> = {}
    for (const skill of ['attack', 'strength', 'defence', 'ranged', 'magic', 'hitpoints', 'prayer']) {
      stats[skill] = { xp: 1_210_421 } // level 75
    }
    const save = {
      stats,
      equipment: { weapon: { itemId: 'bronze_scimitar' } },
      inventory: [],
      bank: { runeforged_scimitar: { itemId: 'runeforged_scimitar', quantity: 1 } },
      settings: { combatStance: 'accurate' },
    }
    const { env } = mockEnv(save)
    const token = await signJWT({ sub: IDENTITY, provider: 'test' }, TEST_SECRET)
    const ctx = { env, authorization: `Bearer ${token}`, identity: { id: IDENTITY } } as any

    const res = await callTool('analyze_dps', { character_id: 7 }, ctx)
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.characterId).toBe(7)
    expect(data.current.gear.weapon).toBe('Bronze Scimitar')
    expect(data.bestOwned.style).toBe('melee')
    expect(data.byStyle.melee.gear.weapon).toBe('Runeforged Scimitar')
  })

  it('get_bank lists bank contents with names and honours the query filter', async () => {
    const save = {
      inventory: [],
      bank: {
        iron_ore: { itemId: 'iron_ore', quantity: 30 },
        coal: { itemId: 'coal', quantity: 10 },
        oak_logs: 5, // legacy numeric entry
      },
    }
    const { env } = mockEnv(save)
    const token = await signJWT({ sub: IDENTITY, provider: 'test' }, TEST_SECRET)
    const ctx = { env, authorization: `Bearer ${token}`, identity: { id: IDENTITY } } as any

    const all = JSON.parse((await callTool('get_bank', { character_id: 7 }, ctx)).content[0].text)
    expect(all.total).toBe(3)
    expect(all.items.find((i: any) => i.itemId === 'oak_logs')?.quantity).toBe(5)
    expect(all.items.find((i: any) => i.itemId === 'iron_ore')?.name).toBeTruthy()

    const filtered = JSON.parse((await callTool('get_bank', { query: 'ore', character_id: 7 }, ctx)).content[0].text)
    expect(filtered.total).toBe(1)
    expect(filtered.items[0].itemId).toBe('iron_ore')
  })
})

describe('MCP clue scrolls (start_clue + server claim)', () => {
  const TEST_SECRET = 'test-jwt-secret'
  const IDENTITY = 'identity-clue'

  // Stateful mock backing the idle table, the save and the nonce/collection-log
  // writes the clue completion endpoint performs. The clue claim bridges to the
  // real /api/actions/clue/complete handler, so this exercises the full path.
  function mockEnv(opts: { save: any; idle: any }) {
    const idle = { ...opts.idle }
    const captured: { saveData: string | null; nonces: string[] } = { saveData: null, nonces: [] }
    const blob = gzipJsonString(JSON.stringify(opts.save))
    const prepare = (sql: string) => ({
      bind: (...args: any[]) => ({
        all: async () => {
          if (sql.includes('FROM characters c') && sql.includes('total_pvp_kills')) {
            return { results: [{ id: 7, username: 'Hero', is_ironman: 0, is_one_life: 0, created_at: 1 }] }
          }
          return { results: [] }
        },
        first: async () => {
          if (sql.includes('FROM character_idle_state')) {
            return idle.active_task === null && idle.last_active_at === null
              ? null
              : { last_active_at: idle.last_active_at, active_task: idle.active_task, updated_at: idle.updated_at || 1 }
          }
          if (sql.includes('c.credits') && sql.includes('save_blob')) {
            return { id: Number(args[0]), owner_id: args[1], is_ironman: 0, credits: 0, save_blob: await blob, save_data: null, updated_at: 123, save_revision: 0 }
          }
          if (sql.includes('save_revision FROM saves')) return { save_revision: 1 }
          return null
        },
        run: async () => {
          if (sql.startsWith('UPDATE saves')) captured.saveData = args[1]
          if (sql.includes('INSERT INTO action_nonces')) {
            const nonce = String(args[1])
            if (captured.nonces.includes(nonce)) return { meta: { changes: 0 } }
            captured.nonces.push(nonce)
            return { meta: { changes: 1 } }
          }
          if (sql.includes('UPDATE character_idle_state') && sql.includes('active_task = NULL')) {
            idle.active_task = null
            idle.last_active_at = args[0]
          }
          if (sql.includes('INSERT INTO character_idle_state')) {
            idle.last_active_at = args[1]
            idle.active_task = args[2]
          }
          return { meta: { changes: 1 } }
        },
      }),
    })
    const env = { DB: { prepare, batch: runBatch }, JWT_SECRET: TEST_SECRET } as any
    return { env, idle, captured }
  }

  async function ctxFor(env: any) {
    const token = await signJWT({ sub: IDENTITY, provider: 'test' }, TEST_SECRET)
    return { env, authorization: `Bearer ${token}`, identity: { id: IDENTITY } } as any
  }

  const clueTask = (now: number, elapsedMs: number) => ({
    active_task: JSON.stringify({ type: 'clue', gatherTask: { id: 'complete_medium_clue', clueLevel: 'medium', requiresItem: 'clue_scroll_medium', ticks: 500 }, bankingEnabled: true }),
    last_active_at: now - elapsedMs,
    updated_at: now - elapsedMs,
  })

  it('claims a finished clue via the completion endpoint, granting loot and clearing the slot', async () => {
    const now = Date.now()
    // medium clue = 500 ticks = 300_000ms; 10 minutes elapsed → done.
    const { env, idle } = mockEnv({
      save: { inventory: [{ itemId: 'clue_scroll_medium', quantity: 1 }], bank: {} },
      idle: clueTask(now, 600_000),
    })
    const res = await callTool('claim_activity', { character_id: 7 }, await ctxFor(env))
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.claimed).toBe(true)
    expect(data.clueLevel).toBe('medium')
    expect(Array.isArray(data.granted)).toBe(true)
    expect(data.granted.length).toBeGreaterThan(0)
    // Slot cleared after a successful clue completion.
    expect(idle.active_task).toBeNull()
  })

  it('leaves an unfinished clue running (in_progress, slot intact)', async () => {
    const now = Date.now()
    const { env, idle } = mockEnv({
      save: { inventory: [{ itemId: 'clue_scroll_medium', quantity: 1 }], bank: {} },
      idle: clueTask(now, 10_000), // 10s « 300_000ms
    })
    const res = await callTool('claim_activity', { character_id: 7 }, await ctxFor(env))
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.claimed).toBe(false)
    expect(data.reason).toBe('in_progress')
    expect(idle.active_task).not.toBeNull()
  })

  it('refuses to start a new activity over a still-running clue (no silent discard)', async () => {
    const now = Date.now()
    // Unfinished medium clue (10s « 300_000ms). Starting skilling must not
    // overwrite it — it should refuse so the timer isn't silently lost.
    const { env, idle } = mockEnv({
      save: { inventory: [{ itemId: 'clue_scroll_medium', quantity: 1 }], bank: {} },
      idle: clueTask(now, 10_000),
    })
    const res = await callTool('start_skilling', { skill: 'firemaking', action_id: 'normal_logs', character_id: 7 }, await ctxFor(env))
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/still running/i)
    // The clue task is untouched.
    expect(idle.active_task).not.toBeNull()
  })

  it('start_clue refuses when the scroll is not in the inventory', async () => {
    const now = Date.now()
    const { env } = mockEnv({
      save: { inventory: [], bank: { clue_scroll_master: { itemId: 'clue_scroll_master', quantity: 1 } } },
      idle: { active_task: null, last_active_at: null },
    })
    void now
    const res = await callTool('start_clue', { clue_level: 'master', character_id: 7 }, await ctxFor(env))
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/inventory/i)
  })

  const minigameTask = (now: number, elapsedMs: number) => ({
    active_task: JSON.stringify({ type: 'minigame', minigameTask: { id: 'wg_rune_defender', name: 'Grind for Rune Defender', product: 'runeforged_defender', minigame: 'warriors_guild', ticks: 18000 }, bankingEnabled: true }),
    last_active_at: now - elapsedMs,
    updated_at: now - elapsedMs,
  })

  it('claims a finished minigame via the completion endpoint, granting the unlock and clearing the slot', async () => {
    const now = Date.now()
    // wg_rune_defender = 18000 ticks = 10_800_000ms; cap-safe 20h elapsed → done.
    const { env, idle } = mockEnv({
      save: { inventory: [], bank: {} },
      idle: minigameTask(now, 20 * 60 * 60 * 1000),
    })
    const res = await callTool('claim_activity', { character_id: 7 }, await ctxFor(env))
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.claimed).toBe(true)
    expect(data.minigameTaskId).toBe('wg_rune_defender')
    expect(data.granted.some((g: any) => g.itemId === 'runeforged_defender')).toBe(true)
    expect(idle.active_task).toBeNull()
  })

  it('leaves an unfinished minigame running (in_progress, slot intact)', async () => {
    const now = Date.now()
    const { env, idle } = mockEnv({ save: { inventory: [], bank: {} }, idle: minigameTask(now, 60_000) })
    const res = await callTool('claim_activity', { character_id: 7 }, await ctxFor(env))
    const data = JSON.parse(res.content[0].text)
    expect(data.claimed).toBe(false)
    expect(data.reason).toBe('in_progress')
    expect(idle.active_task).not.toBeNull()
  })

  it('start_minigame refuses a prerequisite-gated grind when the required item is missing', async () => {
    const { env } = mockEnv({ save: { inventory: [], bank: {} }, idle: { active_task: null, last_active_at: null } })
    const res = await callTool('start_minigame', { minigame_task_id: 'wg_dragon_defender', character_id: 7 }, await ctxFor(env))
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/requires/i)
  })
})

describe('MCP unlock purchases (buy_unlock + buy_slayer_unlock)', () => {
  const TEST_SECRET = 'test-jwt-secret'
  const IDENTITY = 'identity-unlock'

  async function ctxFor(env: any) {
    const token = await signJWT({ sub: IDENTITY, provider: 'test' }, TEST_SECRET)
    return { env, authorization: `Bearer ${token}`, identity: { id: IDENTITY } } as any
  }

  // Stateful mock covering resolveCharacterId, the credit-unlock debit and the
  // slayer completion endpoint (nonce + save load/write) the unlock tools hit.
  function mockEnv(opts: { save?: any; credits?: number } = {}) {
    const captured: { saveData: string | null } = { saveData: null }
    const blob = opts.save ? gzipJsonString(JSON.stringify(opts.save)) : null
    const credits = opts.credits ?? 0
    const prepare = (sql: string) => ({
      bind: (...args: any[]) => ({
        all: async () => {
          if (sql.includes('FROM characters c') && sql.includes('total_pvp_kills')) {
            return { results: [{ id: 7, username: 'Hero', is_ironman: 0, is_one_life: 0, created_at: 1 }] }
          }
          return { results: [] }
        },
        first: async () => {
          if (sql.startsWith('SELECT id FROM characters')) return { id: 7 }
          if (sql.includes('UPDATE') && sql.includes('credits_remaining')) {
            // The atomic debit only matches when credits >= cost (last bind arg).
            const cost = Number(args[0])
            return credits >= cost ? { credits_remaining: credits - cost } : null
          }
          if (sql.includes('c.credits') && sql.includes('save_blob')) {
            return { id: Number(args[0]), owner_id: args[1], is_ironman: 0, credits, save_blob: blob ? await blob : null, save_data: null, updated_at: 1, save_revision: 0 }
          }
          if (sql.includes('save_revision FROM saves')) return { save_revision: 1 }
          return null
        },
        run: async () => {
          if (sql.startsWith('UPDATE saves')) captured.saveData = args[1]
          if (sql.includes('INSERT INTO action_nonces')) return { meta: { changes: 1 } }
          return { meta: { changes: 1 } }
        },
      }),
    })
    return { env: { DB: { prepare, batch: runBatch }, JWT_SECRET: TEST_SECRET } as any, captured }
  }

  it('buy_unlock debits credits and returns the remaining balance', async () => {
    const { env } = mockEnv({ credits: 250 })
    const res = await callTool('buy_unlock', { unlock_id: 'double_slayer_xp', character_id: 7 }, await ctxFor(env))
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.credits_remaining).toBe(150) // 250 - 100
  })

  it('buy_unlock surfaces insufficient credits', async () => {
    const { env } = mockEnv({ credits: 50 }) // < 100
    const res = await callTool('buy_unlock', { unlock_id: 'double_slayer_xp', character_id: 7 }, await ctxFor(env))
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/insufficient/i)
  })

  it('buy_slayer_unlock grants the item and debits slayer points via the server endpoint', async () => {
    const { env, captured } = mockEnv({
      save: { inventory: [], bank: {}, settings: { slayerPoints: 500 } },
    })
    const res = await callTool('buy_slayer_unlock', { unlock_id: 'slayer_helmet', character_id: 7 }, await ctxFor(env))
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.pointsSpent).toBe(400)
    expect(data.granted.some((g: any) => g.itemId === 'slayer_helmet')).toBe(true)
    // The written save shows points debited (500 - 400).
    const written = JSON.parse(captured.saveData!)
    expect(written.settings.slayerPoints).toBe(100)
  })

  it('buy_slayer_unlock refuses when slayer points are insufficient', async () => {
    const { env, captured } = mockEnv({
      save: { inventory: [], bank: {}, settings: { slayerPoints: 100 } }, // < 400
    })
    const res = await callTool('buy_slayer_unlock', { unlock_id: 'slayer_helmet', character_id: 7 }, await ctxFor(env))
    expect(res.isError).toBe(true)
    expect(captured.saveData).toBeNull() // nothing written
  })

  it('buy_slayer_unlock refuses a duplicate the character already owns', async () => {
    const { env, captured } = mockEnv({
      save: { inventory: [], bank: { slayer_helmet: { itemId: 'slayer_helmet', quantity: 1 } }, settings: { slayerPoints: 5000 } },
    })
    const res = await callTool('buy_slayer_unlock', { unlock_id: 'slayer_helmet', character_id: 7 }, await ctxFor(env))
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/already own/i)
    expect(captured.saveData).toBeNull() // no purchase written
  })

  it('buy_slayer_unlock rejects an unknown unlock id before any server call', async () => {
    const { env } = mockEnv({ save: { inventory: [], bank: {}, settings: { slayerPoints: 5000 } } })
    const res = await callTool('buy_slayer_unlock', { unlock_id: 'not_a_real_unlock', character_id: 7 }, await ctxFor(env))
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/Unknown slayer unlock/)
  })
})

describe('MCP create_character', () => {
  const TEST_SECRET = 'test-jwt-secret'
  const IDENTITY = 'identity-create'

  async function ctxFor(env: any) {
    const token = await signJWT({ sub: IDENTITY, provider: 'test' }, TEST_SECRET)
    return { env, authorization: `Bearer ${token}`, identity: { id: IDENTITY } } as any
  }

  function mockEnv({ reservedTaken = false, nameTaken = false }: { reservedTaken?: boolean; nameTaken?: boolean } = {}) {
    const prepare = (sql: string) => ({
      bind: (..._args: any[]) => ({
        first: async () => {
          if (sql.includes('FROM reserved_usernames')) return reservedTaken ? { username: 'taken' } : null
          if (sql.includes('SELECT id FROM characters WHERE username')) return nameTaken ? { id: 1 } : null
          return null
        },
        run: async () => ({ meta: { last_row_id: 42, changes: 1 } }),
      }),
    })
    return { env: { DB: { prepare, batch: runBatch }, JWT_SECRET: TEST_SECRET } as any }
  }

  it('creates a character with a valid username', async () => {
    const { env } = mockEnv()
    const res = await callTool('create_character', { username: 'Newbie_1' }, await ctxFor(env))
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.character).toMatchObject({ id: 42, username: 'Newbie_1', is_ironman: false, is_one_life: false })
  })

  it('passes the ironman / one-life flags through', async () => {
    const { env } = mockEnv()
    const res = await callTool('create_character', { username: 'IronHero', is_ironman: true, is_one_life: true }, await ctxFor(env))
    const data = JSON.parse(res.content[0].text)
    expect(data.character).toMatchObject({ is_ironman: true, is_one_life: true })
  })

  it('refuses an invalid username before touching the DB', async () => {
    const { env } = mockEnv()
    const res = await callTool('create_character', { username: 'ab' }, await ctxFor(env)) // too short
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/3.16/)
  })

  it('refuses a taken username', async () => {
    const { env } = mockEnv({ nameTaken: true })
    const res = await callTool('create_character', { username: 'TakenName' }, await ctxFor(env))
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/already taken/i)
  })

  it('seeds a baseline save row for the new character', async () => {
    // A character created via MCP must own a real save from birth — the browser
    // seeds-and-saves locally, this path never runs that, so create_character
    // writes the baseline itself. Without it the save row never exists and idle
    // XP is dropped on claim ("stuck on Spryroot"). Seeding lives here, NOT in
    // the shared loadCharacterWithSave loader, so a transient "no save" read can
    // never fabricate-and-overwrite a real save.
    const saveWrites: string[] = []
    const prepare = (sql: string) => ({
      bind: (..._args: any[]) => ({
        first: async () => null,
        run: async () => {
          if (/saves/.test(sql)) saveWrites.push(sql)
          return { meta: { last_row_id: 42, changes: 1 } }
        },
      }),
    })
    const env = { DB: { prepare, batch: runBatch }, JWT_SECRET: TEST_SECRET } as any
    const res = await callTool('create_character', { username: 'FreshOne' }, await ctxFor(env))
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.character).toMatchObject({ id: 42, username: 'FreshOne' })
    expect(data.saveSeeded).toBe(true)
    expect(saveWrites.some((s) => /saves/.test(s))).toBe(true)
  })

  it('denormalizes total_level (34) onto the new character row', async () => {
    // A fresh save starts every skill at level 1 plus Hitpoints at level 10 =
    // 33 total. The denormalized characters.total_level column defaults to 0,
    // so seeding the save must also write the real total — otherwise the new
    // character shows 0 total level on the leaderboard until its next save.
    const charUpdates: { sql: string; args: any[] }[] = []
    const prepare = (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => null,
        run: async () => {
          if (/UPDATE characters/.test(sql)) charUpdates.push({ sql, args })
          return { meta: { last_row_id: 42, changes: 1 } }
        },
      }),
    })
    const env = { DB: { prepare, batch: runBatch }, JWT_SECRET: TEST_SECRET } as any
    const res = await callTool('create_character', { username: 'TotalsOk' }, await ctxFor(env))
    expect(res.isError).toBeFalsy()
    const levelUpdate = charUpdates.find((u) => /SET total_level/.test(u.sql))
    expect(levelUpdate).toBeTruthy()
    // bind order: total_level, combat_level, characterId
    // Default save: 24 skills at level 1 + Hitpoints starting at 10 = 34.
    expect(levelUpdate!.args[0]).toBe(34)
    expect(levelUpdate!.args[2]).toBe(42)
  })
})
