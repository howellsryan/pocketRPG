// Static MCP tool metadata (name / description / JSON-Schema input / annotations)
// returned by `tools/list`, plus the server `instructions` advertised at
// `initialize`. Kept free of handler imports so it can be unit-tested cheaply.
// The dispatch table in tools.js must expose exactly these names.

import { EQUIP_SLOT_NAMES, SUPPORTED_IDLE_SKILLS, GATHER_TASK_IDS } from './intents.js'
import { SKILL_IDS, REFERENCE_TOPIC_NAMES } from './reference.js'

const IDLE_SKILLS = [...SUPPORTED_IDLE_SKILLS]

// Server-level guidance surfaced to the model on connect (MCP `instructions`).
export const SERVER_INSTRUCTIONS = `PocketRPG is a menu-driven idle/simulation fantasy RPG. These tools let you
inspect a player's account and run server-authoritative actions on their behalf.

IMPORTANT — PocketRPG is its OWN game, not Old School RuneScape (OSRS) or
RuneScape. Item names, monster stats, drop tables, XP rates, level
requirements, shop prices, quests and mechanics are PocketRPG-specific and
often differ from RuneScape. Do NOT rely on OSRS/RuneScape knowledge and do NOT
search the web for game data: every statement about items, monsters, skills,
drops, quests, prices or mechanics must come from these tools and resources.
Look values up with list_items, list_monsters, list_skill_actions,
inspect_item, inspect_monster and get_reference. If the data isn't available
through a tool, say so plainly rather than guessing or filling it in from
another game.

Getting oriented:
- Call list_characters first; most tools take an optional character_id and
  auto-select when the account has a single character.
- get_character_state returns coins, per-skill level + XP, current HP, worn
  equipment and inventory (item ids include resolved names).
- Browse the game content with tools (these work in every client, unlike
  resources): list_skill_actions (trainable options per skill), list_items and
  list_monsters (search the catalogues by name), inspect_item / inspect_monster
  (full stats + drop tables by id) and get_reference (mechanics, shop, spells,
  prayers, quests, clues, minigames, raids, farming). The same data is also
  published as pocketrpg://reference/* resources if your client reads them.

Acting:
- buy_item, skip_hour and skip_slayer_task spend the player's coins/credits and
  take effect server-side — confirm intent before calling them.
- Slayer: get_slayer_task shows the current task, slayer points, tasks completed
  and each master's eligibility; assign_slayer_task gets a new task from a master
  (none may be active and the character must meet the master's requirements);
  skip_slayer_task spends a credit to drop the current task. Actually killing the
  task's monster is done through the normal combat flow (start_fight/the client).
- Trading post: search_market to price items, my_offers to see open offers,
  place_offer (buy/sell on the order book), cancel_offer/collect_offer/
  instant_sell_offer to manage them, and sell_item to sell general items at
  shop value. The trading post is blocked for ironman characters and during PvP.
- Inventory/gear: deposit_to_bank, withdraw_from_bank, equip_item and
  unequip_item move the character's own items around (no items are created).
  equip_item enforces the item's skill/quest requirements.
- Idle training: start_skilling begins a task that earns XP/items over real
  time (gathering + production skilling, agility, thieving, hunter);
  start_gather starts a field-gathering task (bowstrings, herbs, seaweed, etc.
  — no level requirement); get_active_activity shows what's running;
  claim_activity banks the accrued rewards and keeps it going.
  Combat/farming/prayer/magic idle is still done in the game client.
- Quests: get_quests shows what's completed, startable now, or locked (with the
  missing requirements). start_quest begins an eligible quest — it runs for its
  duration of real time, then claim_activity grants the XP/coins and unlocks its
  quest-gated items. Quests use the single idle slot, so finish one before
  starting another activity. When a startable quest has an xpChoice (a free
  combat/"any" XP reward), ask the player which skill should receive it before
  starting and pass it as xp_skill — never default it to attack or choose for
  them. To chain quests, start the first with start_quest then queue the rest
  with queue_quest (up to queueMax); they auto-start in order. get_quests shows
  the current queue; remove_from_queue drops one.
- Idle combat setup: idle fights and fight_boss auto-use the character's
  configured food, potions and prayers. get_idle_combat_setup shows them (and
  how many are in stock); set_idle_combat_setup changes them (food/potions
  replace the list; prayers set/clear a slot). Configure food before fighting so
  the character can heal.
- Combat: start_fight fights a normal monster idly (XP + loot rolled
  server-side over real time, using the configured idle food/potions/prayers);
  get_active_activity shows the fight; claim_activity collects it. The character
  can die — rewards up to the killing blow are kept, HP resets and the fight
  stops. If no food is configured/in stock, start_fight returns a warning and
  does not start until you retry with confirm_no_food: true — relay that to the
  player first. One-Life characters fight in the client.
- Bosses & raids: kill_boss / kill_raid spend the target's skip cost in credits
  for an instant kill, then grant the server-rolled loot, kill count and
  collection-log uniques — confirm the credit spend first. fight_boss instead
  simulates the actual fight (no credits): you win only if your gear/food are
  strong enough, and it consumes the food used.
- Dungeoneering: train it like any skill (start_skilling skill="dungeoneering")
  to earn XP and tokens, then claim_dungeoneering_reward spends those tokens to
  unlock dungeoneering gear.
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
    name: 'logout',
    description:
      "Explain how to disconnect this connector and switch PocketRPG accounts. For security the server cannot delete the OAuth token your AI client holds, so this returns the steps to remove/reconnect the PocketRPG connector in your client and sign in as a different account (the token also expires on its own within 30 days). Use this when the player asks to log out or change accounts.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ('Logout / switch account'),
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
    name: 'list_skill_actions',
    description:
      "Browse PocketRPG's skills and their trainable options. With no skill, returns every skill (id, name, option count). With a skill, returns that skill's actions/courses/npcs with their level requirement, ticks and XP — the ids to pass to start_skilling.",
    inputSchema: {
      type: 'object',
      properties: {
        skill: { type: 'string', enum: SKILL_IDS, description: 'Skill id, e.g. \'mining\'. Omit for an overview of all skills.' },
      },
      additionalProperties: false,
    },
    annotations: READ('List skill actions'),
  },
  {
    name: 'list_items',
    description:
      "Search PocketRPG's item catalogue by name (and optionally type) to find item ids. Returns compact rows (id, name, type, stackable, shopValue); pass an id to inspect_item for full stats. This is the canonical item list — do not assume items from other games exist.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive substring matched against item name and id. Omit to list everything (paged by limit).' },
        type: {
          type: 'string',
          enum: ['ammo', 'armour', 'currency', 'food', 'junk', 'potion', 'quest', 'resource', 'rune', 'seed', 'tool', 'weapon'],
          description: 'Optional item type filter.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max rows to return (default 50).' },
      },
      additionalProperties: false,
    },
    annotations: READ('List items'),
  },
  {
    name: 'list_monsters',
    description:
      "Search PocketRPG's monster catalogue by name to find monster ids (also flags bosses). Returns compact rows (id, name, combatLevel, hitpoints, boss); pass an id to inspect_monster for stats and the full drop table. This is the canonical monster list — do not assume monsters from other games exist.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive substring matched against monster name and id. Omit to list everything (paged by limit).' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max rows to return (default 50).' },
      },
      additionalProperties: false,
    },
    annotations: READ('List monsters'),
  },
  {
    name: 'get_reference',
    description:
      'Read a PocketRPG reference dataset by topic so you can answer from canonical game data instead of guessing. Topics: mechanics (rules), shop, skills, spells, prayers, quests, clues, minigames, raids, farming.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: REFERENCE_TOPIC_NAMES, description: 'Which reference dataset to return.' },
      },
      required: ['topic'],
      additionalProperties: false,
    },
    annotations: READ('Get reference'),
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
    name: 'get_slayer_task',
    description:
      "Get a character's slayer status: the current task (monster, kills remaining/total, progress %, points awarded on completion), slayer points balance, slayer + combat level, tasks completed, the points multiplier on the next completed task, the skip costs, and every slayer master with whether the character meets its requirements. Read-only.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
    annotations: READ('Get slayer task'),
  },
  {
    name: 'assign_slayer_task',
    description:
      "Get a new slayer task from a slayer master (the in-game 'get task'). Picks an eligible monster from that master's pool and assigns it. Refused if the character already has an active task, or doesn't meet the master's combat/slayer requirements. Find master ids and eligibility via get_slayer_task. No points or loot are granted here — only on completing the task by killing its monster in combat.",
    inputSchema: {
      type: 'object',
      properties: {
        master_id: { type: 'string', description: "The slayer master id, e.g. 'turael'. See get_slayer_task for ids and eligibility." },
        ...optionalCharacterId,
      },
      required: ['master_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Assign slayer task'),
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
    name: 'list_market_listings',
    description:
      'List all active trading-post offers aggregated by item. Shows best buy/sell prices and total offer counts per item. Read-only, no player identity exposed.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: READ('List market listings'),
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
        source: { type: 'string', enum: ['inventory', 'bank'], description: 'For sell offers, where to escrow the items from. Defaults to inventory. Ignored for buy offers.' },
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
      "Immediately sell general-store-tier items at their shop value for coins (no order book), sourcing from the character's inventory (default) or bank. Boss/raid/clue uniques must use place_offer instead.",
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
        source: { type: 'string', enum: ['inventory', 'bank'], description: 'Where to sell the items from. Defaults to inventory.' },
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
    name: 'start_gather',
    description:
      "Start an idle field-gathering task (bowstrings, herbs, seaweed, soda ash, etc.). No skill level required. Items accrue over real time and are collected via claim_activity. Log→plank conversion (gpCost tasks) is not yet supported. Valid task_id values: " + GATHER_TASK_IDS.join(', ') + '.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', enum: GATHER_TASK_IDS, description: "The gather task id, e.g. 'gather_bowstring', 'catch_newts', 'pick_white_berries'." },
        ...optionalCharacterId,
      },
      required: ['task_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Start gather task'),
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
      "List a character's quest progress: total quest points, completed quests, the quests they can start right now (with rewards), the locked ones with their missing requirements, and the current quest `queue` (with queueMax). Use ids with start_quest / queue_quest. A startable quest that lets the player choose where its XP goes carries an `xpChoice` field (type + the skills to choose from) — ask the player which skill before starting or queueing it.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
    annotations: READ('Get quests'),
  },
  {
    name: 'start_quest',
    description:
      'Start a quest the character is eligible for (checks skill/quest-point/prerequisite/combat-level requirements). It completes after its duration of real time — claim_activity collects the XP, coins and item unlocks; skip_hour advances it an hour. If the quest awards a combat/"any" XP choice (see the quest\'s `xpChoice` in get_quests), ASK THE PLAYER which skill should receive it and pass that as xp_skill — do not default to attack or pick for them. Calling without xp_skill on such a quest fails with the list of valid skills rather than guessing.',
    inputSchema: {
      type: 'object',
      properties: {
        quest_id: { type: 'string', description: "The quest id, e.g. 'dragon_slayer_i'. Find ids via get_quests or pocketrpg://reference/quests." },
        xp_skill: { type: 'string', description: 'Skill that should receive the quest\'s free combat/"any" XP choice (a combat skill for a combat choice, any skill for an "any" choice). Required when the quest offers such a choice — set it to the skill the player chose, never a hardcoded default.' },
        ...optionalCharacterId,
      },
      required: ['quest_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Start quest'),
  },
  {
    name: 'queue_quest',
    description:
      'Add a quest to the character\'s quest queue so it auto-starts after the active quest (and any earlier queued quests) finishes — up to queueMax (see get_quests). The quest must be startable now (queueing cannot bypass requirements) and not already active/queued/completed. If it offers a combat/"any" XP choice, ASK THE PLAYER which skill and pass xp_skill — do not default. Start the first quest with start_quest, then queue the rest.',
    inputSchema: {
      type: 'object',
      properties: {
        quest_id: { type: 'string', description: 'The quest id to queue. Find ids via get_quests.' },
        xp_skill: { type: 'string', description: 'Skill to receive this quest\'s free combat/"any" XP choice, if it has one. Set it to the player\'s pick; required for choice quests.' },
        ...optionalCharacterId,
      },
      required: ['quest_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Queue quest'),
  },
  {
    name: 'remove_from_queue',
    description: "Remove a quest from the character's quest queue (does not affect the quest currently in progress).",
    inputSchema: {
      type: 'object',
      properties: {
        quest_id: { type: 'string', description: 'The quest id to remove from the queue.' },
        ...optionalCharacterId,
      },
      required: ['quest_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Remove from queue'),
  },
  {
    name: 'get_idle_combat_setup',
    description:
      "Show the character's idle-combat supplies: the food, boost/restore potions and protection/combat prayers that idle fights and fight_boss auto-use, each with how many the character currently owns (inventory + bank). foodConfigured/foodInStock flag whether the character can heal while fighting.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
    annotations: READ('Get idle combat setup'),
  },
  {
    name: 'set_idle_combat_setup',
    description:
      "Configure the character's idle-combat supplies (used by start_fight and fight_boss). Each field is optional: omit to leave it unchanged. food/potions REPLACE the current list (pass [] to clear); protection_prayer/combat_prayer set or clear (null) a prayer slot. Validates item categories and that prayers fit their slot and the character's Prayer level. Find ids with list_items (type 'food'/'potion') and get_reference topic='prayers'. This only records which of the character's own supplies to auto-use — it creates nothing.",
    inputSchema: {
      type: 'object',
      properties: {
        food: {
          type: 'array',
          description: 'Replacement food list (each is consumed when HP is low). [] clears it.',
          items: {
            type: 'object',
            properties: {
              item_id: { type: 'string' },
              quantity: { type: 'integer', minimum: 1, description: 'Max to use this fight.' },
            },
            required: ['item_id', 'quantity'],
            additionalProperties: false,
          },
        },
        potions: {
          type: 'array',
          description: 'Replacement potion list (boost/restore potions). [] clears it.',
          items: {
            type: 'object',
            properties: {
              item_id: { type: 'string' },
              quantity: { type: 'integer', minimum: 1 },
            },
            required: ['item_id', 'quantity'],
            additionalProperties: false,
          },
        },
        protection_prayer: { type: ['string', 'null'], description: "Protection prayer id (e.g. 'protection_from_magic'), or null to clear the slot." },
        combat_prayer: { type: ['string', 'null'], description: 'Combat (stat-boost) prayer id, or null to clear the slot.' },
        ...optionalCharacterId,
      },
      additionalProperties: false,
    },
    annotations: WRITE('Set idle combat setup'),
  },
  {
    name: 'start_fight',
    description:
      "Fight a normal monster idly: XP and loot are rolled server-side over real time, drawing on the character's idle food/potions/prayers (configure them with set_idle_combat_setup). claim_activity collects the result; skip_hour advances an hour. Bosses/raids and One-Life characters are refused (use the game client). If no idle food is configured or in stock, the fight is NOT started and a warning is returned instead — relay it to the player and only retry with confirm_no_food: true if they accept the death risk. Find ids via inspect_monster / pocketrpg://reference/monsters.",
    inputSchema: {
      type: 'object',
      properties: {
        monster_id: { type: 'string', description: "The monster id, e.g. 'goblin'." },
        stance: { type: 'string', enum: ['accurate', 'aggressive', 'defensive', 'controlled'], description: 'Combat stance. Defaults to the saved combat stance.' },
        confirm_no_food: { type: 'boolean', description: 'Set true to start the fight even though no healing food is configured/in stock (the character may die). Only after the player has accepted the risk.' },
        ...optionalCharacterId,
      },
      required: ['monster_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Start fight'),
  },
  {
    name: 'kill_boss',
    description:
      "Kill a boss by spending its skip cost in credits (the in-game instant-kill skip), then receive the server-rolled loot, kill count and collection-log entries. Debits credits server-side — confirm intent first. Find boss ids via inspect_monster / pocketrpg://reference/monsters.",
    inputSchema: {
      type: 'object',
      properties: {
        monster_id: { type: 'string', description: "The boss monster id, e.g. 'deepmaw_kraken'." },
        ...optionalCharacterId,
      },
      required: ['monster_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Kill boss'),
  },
  {
    name: 'fight_boss',
    description:
      "Fight a boss for real — the whole fight is simulated over the combat engine (no credits spent), auto-eating your configured idle food. On a win you receive the server-rolled loot, kill count and collection-log uniques; a loss or death grants nothing (but still consumes the food used). Conservative: no prayers/potions/special attacks, so if it reports a loss you may still win in the client. Magic setups and One-Life characters aren't supported here (use kill_boss / the client). Find boss ids via pocketrpg://reference/monsters.",
    inputSchema: {
      type: 'object',
      properties: {
        monster_id: { type: 'string', description: "The boss monster id, e.g. 'deepmaw_kraken'." },
        ...optionalCharacterId,
      },
      required: ['monster_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Fight boss'),
  },
  {
    name: 'kill_raid',
    description:
      "Clear a raid by spending its skip cost in credits, then receive the server-rolled raid loot, kill count and collection-log entries. Debits credits server-side — confirm intent first. Find raid ids via pocketrpg://reference/raids.",
    inputSchema: {
      type: 'object',
      properties: {
        raid_id: { type: 'string', description: "The raid id, e.g. 'chambers_of_xeric'." },
        ...optionalCharacterId,
      },
      required: ['raid_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Kill raid'),
  },
  {
    name: 'claim_dungeoneering_reward',
    description:
      'Spend dungeoneering tokens to unlock a piece of dungeoneering gear. Tokens are earned by training dungeoneering (start_skilling with skill="dungeoneering"). Checks the dungeoneering level and token balance. Find reward action ids via pocketrpg://reference/skills (dungeoneering actions with category "reward").',
    inputSchema: {
      type: 'object',
      properties: {
        action_id: { type: 'string', description: "The reward action id, e.g. 'unlock_chaotic_rapier'." },
        ...optionalCharacterId,
      },
      required: ['action_id'],
      additionalProperties: false,
    },
    annotations: WRITE('Claim dungeoneering reward'),
  },
]

export const TOOL_NAMES = TOOL_SCHEMAS.map((t) => t.name)
