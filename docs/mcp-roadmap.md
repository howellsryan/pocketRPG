# PocketRPG MCP Server — Roadmap & Surface

Status of the MCP server (`functions/api/mcp.js`) that lets AI assistants
inspect characters and run server-authoritative + save-intent actions. See
`CLAUDE.md §15` for the extension rules and `docs/mcp-gap-plan.md` for the
closure plan this surface was built from.

## Shipped tools (58)

Reads do not change state; writes are annotated `WRITE` in
`functions/_lib/mcp/schema.js`. Every advertised tool has a dispatch handler
and a test (parity enforced by `tests/mcpServer.test.ts`).

### Account & orientation
- `list_characters`, `create_character`, `get_account`, `logout`
- `get_character_state`, `get_collection_log`, `get_kill_counts`, `get_leaderboard`

### Reference / browse (read-only)
- `inspect_item`, `inspect_monster`, `list_skill_actions`, `list_items`, `list_monsters`
- `get_reference` — topics: mechanics, shop, skills, spells, prayers, quests,
  clues, minigames, raids, farming, construction, gather

### Economy
- `buy_item`, `sell_item` (inventory/bank source), `skip_hour`
- Trading post: `search_market`, `list_market_listings`, `my_offers`,
  `place_offer` (inventory/bank source), `cancel_offer`, `collect_offer`,
  `instant_sell_offer`
- Bank/gear: `deposit_to_bank`, `withdraw_from_bank`, `equip_item`, `unequip_item`
- Unlocks: `buy_unlock` (credits), `buy_slayer_unlock` (slayer points)

### Idle / timed activities (single idle slot)
- `start_skilling` (gathering + production skilling, agility, thieving, hunter,
  dungeoneering), `start_gather`, `start_clue`, `start_minigame`
- `get_active_activity`, `claim_activity`
- Quests: `get_quests`, `start_quest`, `queue_quest`, `remove_from_queue`

### Combat
- `get_idle_combat_setup`, `set_idle_combat_setup`
- `start_fight` (normal monsters; credits the active Slayer task)
- `kill_boss`, `fight_boss` (melee/ranged/magic simulation), `kill_raid`,
  `claim_dungeoneering_reward`

### Instant skilling (save intents, no idle slot)
- `train_prayer` (bury/scatter/altar bones)
- `train_construction`, `unlock_construction_perk`
- `cast_magic` (High Alchemy, Superheat, Enchant, Tan Leather, Plank Make,
  Curse, Stun)

### Farming (patch system)
- `get_farm`, `plant_seed`, `harvest_patch`, `harvest_all`

### Slayer
- `get_slayer_task` (current task + master eligibility + reward `unlocks`),
  `assign_slayer_task`, `skip_slayer_task`

## How actions are implemented

- **Bridge tools** call the real `/api/*` handler via
  `functions/_lib/mcp/bridge.js`, so auth, PvP locks, audit, nonces and
  collection-log writes run unchanged. Used for every already-server-authoritative
  action: purchases, boss/raid/clue/minigame completions, trading post, slayer
  unlocks, character creation, skip-hour/credit spends.
- **Save intents** (`functions/_lib/mcp/intents.js`) are pure mutations of the
  decoded save, used only where no endpoint exists (idle-sim claims, bank/gear
  moves, instant prayer/construction/magic training, farming, idle-combat setup).
  They reuse `src/engine/*` helpers (e.g. `applyTaskResult`, `farming.ts`,
  `runes.js`, `construction.js`) — never re-deriving game logic.

## Deliberately excluded (client-only / out of scope)

- **PvP** — server-authoritative under `/api/pvp/*`, its own lockdown rules.
- **Manual / offline special attacks** — PvE specials are manual-trigger only,
  no automatic firing (see `CLAUDE.md §7`).
- **One-Life combat** — combat that can permanently wipe an account is refused;
  it is handled in the client where death is explicit.
- **Account billing / Stripe** — credit purchases happen outside MCP.

(`fight_boss` simulates melee, ranged and magic setups; only a magic setup with
no active combat spell selected is refused — pick a spell or use a powered staff
in the client.)

## Deferred / future

- **Item-creation charging.** Idle/offline loot, crafted/smithed/cooked products
  and skill capes are client-authoritative by design (`CLAUDE.md §14`); MCP does
  not try to police economy/item increases, matching the offline-first model.
