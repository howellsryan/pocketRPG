// Static MCP tool metadata (name / description / JSON-Schema input / annotations)
// returned by `tools/list`, plus the server `instructions` advertised at
// `initialize`. Kept free of handler imports so it can be unit-tested cheaply.
// The dispatch table in tools.js must expose exactly these names.

import { EQUIP_SLOT_NAMES, SUPPORTED_IDLE_SKILLS } from './intents.js'

const IDLE_SKILLS = [...SUPPORTED_IDLE_SKILLS]

// Server-level guidance surfaced to the model on connect (MCP `instructions`).
export const SERVER_INSTRUCTIONS = `PocketRPG is a menu-driven idle/simulation fantasy RPG. These tools let you
inspect a player's account and run server-authoritative actions on their behalf.

Getting oriented:
- Call list_characters first; most tools take an optional character_id and
  auto-select when the account has a single character.
- get_character_state returns coins, per-skill level + XP, current HP, worn
  equipment and inventory (item ids include resolved names).
- Read the resources for context: pocketrpg://reference/mechanics (rules),
  /skills, /shop, /quests, and the item/monster indexes. Use inspect_item and
  inspect_monster for full details (stats, drop tables) by id.

Acting:
- buy_item, skip_hour and skip_slayer_task spend the player's coins/credits and
  take effect server-side — confirm intent before calling them.
- Trading post: search_market to price items, my_offers to see open offers,
  place_offer (buy/sell on the order book), cancel_offer/collect_offer/
  instant_sell_offer to manage them, and sell_item to sell general items at
  shop value. The trading post is blocked for ironman characters and during PvP.
- Inventory/gear: deposit_to_bank, withdraw_from_bank, equip_item and
  unequip_item move the character's own items around (no items are created).
  equip_item enforces the item's skill/quest requirements.
- Idle training: start_skilling begins a task that earns XP/items over real
  time (gathering + production skilling, agility, thieving, hunter);
  get_active_activity shows what's running; claim_activity banks the accrued
  rewards and keeps it going. Combat/farming/prayer/magic idle is still done in
  the game client.
- Quests: get_quests shows what's completed, startable now, or locked (with the
  missing requirements). start_quest begins an eligible quest — it runs for its
  duration of real time, then claim_activity grants the XP/coins and unlocks its
  quest-gated items. Quests use the single idle slot, so finish one before
  starting another activity.
- Combat: start_fight fights a normal monster idly (XP + loot rolled
  server-side over real time, using the food/potions configured in the game
  client); get_active_activity shows the fight; claim_activity collects it. The
  character can die — rewards up to the killing blow are kept, HP resets and the
  fight stops. Bosses, raids and One-Life characters are handled in the client.
- skip_hour spends a credit to advance the running idle activity by one hour;
  follow it with claim_activity to collect the skipped time.
- XP, coins and most loot are client-computed in this game, so these tools
  cannot simulate live training or combat yet; report state and take only the
  supported actions. Prefer concrete, checkable advice grounded in get_* reads.`

const optionalCharacterId = {
  character_id: {
    type: 'integer',
    description: 'Target character id. Optional when the account has exactly one character.',
  },
}

const READ = (title) => ({ title, readOnlyHint: true, openWorldHint: false })
const WRITE = (title) => ({ title, readOnlyHint: false, destructiveHint: false, openWorldHint: false })

export const TOOL_SCHEMAS = [
  {
    name: 'list_characters',
    description:
      'List the characters on the signed-in PocketRPG account (id, username, ironman/one-life flags, last save time). Use an id with the other tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ('List characters'),
  },
  {
    name: 'get_account',
    description:
      "Get the signed-in account identity and, if a character is given, that character's credit balance and PvP kill total.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
    annotations: READ('Get account'),
  },
  {
    name: 'get_character_state',
    description:
      "Get a summary of a character's current game state: coins, skill levels + XP, current HP, worn equipment, inventory contents (with item names) and bank size.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
    annotations: READ('Get character state'),
  },
  {
    name: 'get_collection_log',
    description:
      'List the unique items a character has obtained (boss/raid/clue/minigame uniques) and the total number of log slots.',
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
    annotations: READ('Get collection log'),
  },
  {
    name: 'get_kill_counts',
    description: "List a character's server-authoritative boss/raid kill counts.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
    annotations: READ('Get kill counts'),
  },
  {
    name: 'get_leaderboard',
    description:
      "Get the public leaderboard. metric 'total' ranks by total level; metric 'kc' ranks killers of a specific boss/raid (needs source_type + source_id).",
    inputSchema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['total', 'kc'] },
        source_type: { type: 'string' },
        source_id: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        offset: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
    annotations: READ('Get leaderboard'),
  },
  {
    name: 'inspect_item',
    description:
      'Get the full definition of a single item by id (name, type, equipment slot, combat bonuses, shop value, flags). Use pocketrpg://reference/items to find ids.',
    inputSchema: {
      type: 'object',
      properties: { item_id: { type: 'string', description: "The item id, e.g. 'rune_scimitar'." } },
      required: ['item_id'],
      additionalProperties: false,
    },
    annotations: READ('Inspect item'),
  },
  {
    name: 'inspect_monster',
    description:
      'Get the full definition of a single monster by id (combat level, hitpoints, stats, attack style and full drop table). Use pocketrpg://reference/monsters to find ids.',
    inputSchema: {
      type: 'object',
      properties: { monster_id: { type: 'string', description: "The monster id, e.g. 'goblin'." } },
      required: ['monster_id'],
      additionalProperties: false,
    },
    annotations: READ('Inspect monster'),
  },
  {
    name: 'buy_item',
    description:
      'Buy an item from the in-game shop for a character. Debits coins and grants the item server-side. Blocked while the character is in an active PvP match.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: "The item id, e.g. 'bronze_dagger'." },
        quantity: { type: 'integer', minimum: 1, default: 1 },
        ...optionalCharacterId,
      },
      required: ['item_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Buy item'),
  },
  {
    name: 'skip_hour',
    description:
      "Spend credits to skip ahead. With no boss/raid id this is a 1-credit one-hour skip that advances the running idle activity by an hour (follow with claim_activity to collect it); a bossId or raidId charges that target's skip cost for client-side combat. Debits credits server-side.",
    inputSchema: {
      type: 'object',
      properties: {
        bossId: { type: 'string' },
        raidId: { type: 'string' },
        ...optionalCharacterId,
      },
      additionalProperties: false,
    },
    annotations: WRITE('Skip hour'),
  },
  {
    name: 'skip_slayer_task',
    description: "Spend 1 credit to skip the character's current slayer task. Debits the credit server-side.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
    annotations: WRITE('Skip slayer task'),
  },
  {
    name: 'search_market',
    description:
      'Look up trading-post market data (best bid, best ask, quantity listed) for up to 50 items by id. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        item_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50, description: 'Item ids to price.' },
      },
      required: ['item_ids'],
      additionalProperties: false,
    },
    annotations: READ('Search market'),
  },
  {
    name: 'my_offers',
    description: "List a character's open and awaiting-collection trading-post offers, with the max slot count.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
    annotations: READ('My offers'),
  },
  {
    name: 'place_offer',
    description:
      'Place a trading-post buy or sell offer on the order book. Escrows the coins (buy) or items (sell) and matches against the book. Blocked for ironman characters and during PvP.',
    inputSchema: {
      type: 'object',
      properties: {
        offer_type: { type: 'string', enum: ['buy', 'sell'] },
        item_id: { type: 'string' },
        price: { type: 'integer', minimum: 1, description: 'Coins per item.' },
        quantity: { type: 'integer', minimum: 1 },
        ...optionalCharacterId,
      },
      required: ['offer_type', 'item_id', 'price', 'quantity'],
      additionalProperties: false,
    },
    annotations: WRITE('Place offer'),
  },
  {
    name: 'cancel_offer',
    description: 'Cancel an active trading-post offer, returning escrowed items/coins and any pending fills to the character.',
    inputSchema: {
      type: 'object',
      properties: { offer_id: { type: 'integer', minimum: 1 }, ...optionalCharacterId },
      required: ['offer_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Cancel offer'),
  },
  {
    name: 'collect_offer',
    description: "Collect a trading-post offer's pending coins/items into the character's save.",
    inputSchema: {
      type: 'object',
      properties: { offer_id: { type: 'integer', minimum: 1 }, ...optionalCharacterId },
      required: ['offer_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Collect offer'),
  },
  {
    name: 'instant_sell_offer',
    description: "Convert an active sell offer's remaining quantity to an immediate payout at the 80% instant-sell rate.",
    inputSchema: {
      type: 'object',
      properties: { offer_id: { type: 'integer', minimum: 1 }, ...optionalCharacterId },
      required: ['offer_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Instant-sell offer'),
  },
  {
    name: 'sell_item',
    description:
      "Immediately sell general-store-tier items from a character's inventory at their shop value for coins (no order book). Boss/raid/clue uniques must use place_offer instead.",
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
        ...optionalCharacterId,
      },
      required: ['item_id', 'quantity'],
      additionalProperties: false,
    },
    annotations: WRITE('Sell item'),
  },
  {
    name: 'deposit_to_bank',
    description: "Move items from a character's inventory into their bank.",
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
        ...optionalCharacterId,
      },
      required: ['item_id', 'quantity'],
      additionalProperties: false,
    },
    annotations: WRITE('Deposit to bank'),
  },
  {
    name: 'withdraw_from_bank',
    description: "Move items from a character's bank into their inventory (respects the 28-slot limit).",
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
        ...optionalCharacterId,
      },
      required: ['item_id', 'quantity'],
      additionalProperties: false,
    },
    annotations: WRITE('Withdraw from bank'),
  },
  {
    name: 'equip_item',
    description:
      "Equip an item from a character's inventory. Checks skill/quest requirements; any item already in that slot (or a conflicting 2H/shield) is returned to the inventory.",
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string' },
        ...optionalCharacterId,
      },
      required: ['item_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Equip item'),
  },
  {
    name: 'unequip_item',
    description: "Unequip the item in a given equipment slot, returning it to the character's inventory.",
    inputSchema: {
      type: 'object',
      properties: {
        slot: { type: 'string', enum: EQUIP_SLOT_NAMES },
        ...optionalCharacterId,
      },
      required: ['slot'],
      additionalProperties: false,
    },
    annotations: WRITE('Unequip item'),
  },
  {
    name: 'get_active_activity',
    description:
      "Show the character's current idle activity (what's running and for how long) and whether it can be claimed via MCP.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
    annotations: READ('Active activity'),
  },
  {
    name: 'start_skilling',
    description:
      'Start an idle training task (rewards accrue over real time, like the game). Covers gathering + production skilling, agility, thieving and hunter. Auto-claims any pending supported task first. Find ids in pocketrpg://reference/skills.',
    inputSchema: {
      type: 'object',
      properties: {
        skill: { type: 'string', enum: IDLE_SKILLS },
        action_id: { type: 'string', description: "The action/course/npc id within the skill (e.g. 'bronze_bar', 'gnome_stronghold', 'villager')." },
        ...optionalCharacterId,
      },
      required: ['skill', 'action_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Start skilling'),
  },
  {
    name: 'claim_activity',
    description:
      'Claim the rewards accrued by the running idle activity (skilling or a quest): the elapsed time is simulated server-side, XP/items/quest completions are applied, and the idle clock resets (a finished quest clears the slot; skilling keeps running).',
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
    annotations: WRITE('Claim activity'),
  },
  {
    name: 'get_quests',
    description:
      "List a character's quest progress: total quest points, completed quests, the quests they can start right now (with rewards), and the locked ones with their missing requirements. Use ids with start_quest.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
    annotations: READ('Get quests'),
  },
  {
    name: 'start_quest',
    description:
      'Start a quest the character is eligible for (checks skill/quest-point/prerequisite/combat-level requirements). It completes after its duration of real time — claim_activity collects the XP, coins and item unlocks; skip_hour advances it an hour. If the quest awards combat/"any" XP, pass xp_skill to choose where it lands.',
    inputSchema: {
      type: 'object',
      properties: {
        quest_id: { type: 'string', description: "The quest id, e.g. 'dragon_slayer_i'. Find ids via get_quests or pocketrpg://reference/quests." },
        xp_skill: { type: 'string', description: 'Skill to receive the quest\'s free combat/"any" XP choice (a combat skill for a combat choice, any skill for an "any" choice). Required only when the quest offers such a choice.' },
        ...optionalCharacterId,
      },
      required: ['quest_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Start quest'),
  },
  {
    name: 'start_fight',
    description:
      'Fight a normal monster idly: XP and loot are rolled server-side over real time, drawing on the food/potions/prayers configured in the game client. claim_activity collects the result; skip_hour advances an hour. Bosses/raids and One-Life characters are refused (use the game client). Find ids via inspect_monster / pocketrpg://reference/monsters.',
    inputSchema: {
      type: 'object',
      properties: {
        monster_id: { type: 'string', description: "The monster id, e.g. 'goblin'." },
        stance: { type: 'string', enum: ['accurate', 'aggressive', 'defensive', 'controlled'], description: 'Combat stance. Defaults to the saved combat stance.' },
        ...optionalCharacterId,
      },
      required: ['monster_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Start fight'),
  },
]

export const TOOL_NAMES = TOOL_SCHEMAS.map((t) => t.name)
