// Static MCP tool metadata (name / description / JSON-Schema input) returned by
// `tools/list`. Kept free of handler imports so it can be unit-tested cheaply
// and is safe to import from the lightweight discovery path. The dispatch table
// in tools.js must expose exactly these names.

const optionalCharacterId = {
  character_id: {
    type: 'integer',
    description: 'Target character id. Optional when the account has exactly one character.',
  },
}

export const TOOL_SCHEMAS = [
  {
    name: 'list_characters',
    description:
      'List the characters on the signed-in PocketRPG account (id, username, ironman/one-life flags, last save time). Use an id with the other tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_account',
    description:
      "Get the signed-in account identity and, if a character is given, that character's credit balance and PvP kill total.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
  },
  {
    name: 'get_character_state',
    description:
      "Get a summary of a character's current game state: coins, skill levels + XP, current HP, worn equipment, inventory contents and bank size.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
  },
  {
    name: 'get_collection_log',
    description:
      'List the unique items a character has obtained (boss/raid/clue/minigame uniques) and the total number of log slots.',
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
  },
  {
    name: 'get_kill_counts',
    description: "List a character's server-authoritative boss/raid kill counts.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
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
  },
  {
    name: 'skip_hour',
    description:
      "Spend credits to skip ahead. With no boss/raid id this is a 1-credit one-hour skip; a bossId or raidId charges that target's skip cost. Debits credits server-side.",
    inputSchema: {
      type: 'object',
      properties: {
        bossId: { type: 'string' },
        raidId: { type: 'string' },
        ...optionalCharacterId,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'skip_slayer_task',
    description: "Spend 1 credit to skip the character's current slayer task. Debits the credit server-side.",
    inputSchema: { type: 'object', properties: { ...optionalCharacterId }, additionalProperties: false },
  },
]

export const TOOL_NAMES = TOOL_SCHEMAS.map((t) => t.name)
