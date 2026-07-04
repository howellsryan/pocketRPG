# MCP Read-Ability Review — Chatbot Context Gaps

> **Status: implemented.** §2a (enriched `summarizeSave`: total level/XP, combat level,
> combat type, attack speed, prayer cap, aggregated equipment bonuses, best-case max hits),
> §2b (`get_bank`), §4 (`get_daily_tasks`), and the §3 allowlist additions
> (`get_account`, `get_idle_combat_setup`, `search_market`, `list_market_listings`,
> `my_offers`, `get_leaderboard`) all shipped. `get_combat_stats` was intentionally skipped
> as redundant with the §2a enrichment. The analysis below is retained as the design record.


Scope: what read data the in-game help chatbot (`/api/chat`, §16) can pull from the MCP
surface to answer player questions about *their own character*, and where it falls short.

The chatbot is restricted to a read-only allowlist (`CHAT_TOOL_ALLOWLIST` in
`functions/_lib/chat/prompt.js`). Two independent gaps exist:

1. **Allowlist gaps** — read tools that already exist on the MCP server but are not
   exposed to the chatbot.
2. **Data gaps** — facts the player asks about that *no* tool returns, because
   `get_character_state` (via `summarizeSave` in `functions/_lib/mcp/summary.js`) never
   computes them, even though the engine helpers to do so already exist.

---

## 1. Current chatbot read surface

Allowlisted today (13 tools):
`get_character_state`, `get_slayer_task`, `get_quests`, `get_active_activity`,
`get_collection_log`, `get_kill_counts`, `get_farm`, `inspect_item`, `inspect_monster`,
`list_items`, `list_monsters`, `list_skill_actions`, `get_reference`.

Existing MCP **read** tools NOT given to the chatbot:
`get_account`, `get_leaderboard`, `search_market`, `list_market_listings`, `my_offers`,
`get_idle_combat_setup`, `list_characters`.

What `get_character_state` returns today (`summarizeSave`):
`coins`, `combatStance`, `currentHP`, `prayerPoints`, `dungeoneeringTokens`, per-skill
`{ level, xp }`, worn `equipment` (id + name only), `inventory` (id + name + qty),
`inventoryUsed`, `inventoryCapacity`, and **`bankUniqueItems` (a count only)**.

---

## 2. Data gaps in `get_character_state` (highest value — the player's own numbers)

These are all things the user asked about. The engine already exposes every helper needed;
the summary simply doesn't call them.

| Missing datum | Player question it unblocks | Engine helper that already exists |
|---|---|---|
| **Bank contents** (only a unique-item *count* is returned today) | "do I have any sharks in my bank?", "how many oak logs do I have banked?" | raw `state.bank` in the save |
| **Total level** | "what's my total level?", "how far off max total am I?" | sum of `getLevelFromXP` per skill (`experience.js`) |
| **Total XP** | "what's my total XP?" | sum of `stats[*].xp` |
| **Combat level** | "what's my combat level?" | `combatLevelFromStats(stats)` (`combatLevel.js`) |
| **Aggregated equipment bonuses** (attack/defence by style, melee/ranged/magic strength) | "what are my melee bonuses?", "what's my magic damage %?" | `getEquipmentBonuses(equipment, itemsData)` (`equipment.js`) |
| **Max hits** (melee/ranged/magic for current gear + stats + stance) | "what's my max hit?", "max hit with my current setup?" | `effectiveStrength`+`meleeMaxHit`, `rangedMaxHit`, `magicMaxHit` (`formulas.js`) |
| **Prayer pool max** (only current `prayerPoints` is returned, not the cap = Prayer level) | "how much prayer do I have left?" | Prayer level from `stats.prayer` |
| **Combat type / attack speed of worn weapon** | "am I set up for melee or magic?" | `getCombatType`, `getAttackSpeed`, `getAttackStyle` (`equipment.js`) |

### Recommendation 2a — enrich `summarizeSave` (extend existing, no new tool)
Add computed fields to the `get_character_state` payload:

```js
totalLevel, totalXp, combatLevel,
prayerPointsMax,            // = Prayer level
equipmentBonuses,          // getEquipmentBonuses(equipment, itemsData)
maxHits: { melee, ranged, magic },  // per current stance + gear
combatType, attackSpeed
```

All of this is pure, deterministic, and reuses `src/engine` — no new logic, no duplication
(honours §14 / the MCP "never duplicate game logic" rule). The max-hit block is the marquee
answer the chatbot currently *cannot* give at all.

Note: `summarizeSave` has a regression test; update it in the same change.

### Recommendation 2b — expose bank contents
`bankUniqueItems` (a bare count) is the single biggest miss: the chatbot literally cannot say
what a player has banked. Options, in preference order:

- **Add a dedicated `get_bank` read tool** (paged/searchable), because a full bank can be
  large and the summary should stay compact. Shape:
  `get_bank({ query?, limit?, character_id? }) → { total, items: [{ itemId, name, quantity }] }`,
  reusing `itemName`/`withItemName` for resolution. A `query` substring keeps token cost bounded
  and directly serves "do I have X banked?".
- Or include a **top-N bank preview** in `get_character_state` and point the model at `get_bank`
  for the rest.

---

## 3. Allowlist-only gaps (tool exists, just not exposed to chat)

These need only an entry in `CHAT_TOOL_ALLOWLIST` — all are already read-only.

| Tool | Player question it unblocks | Notes |
|---|---|---|
| `get_account` | "how many credits do I have?", "what's my PvP kill count?" | Credit balance + PvP kills. Safe, read-only. |
| `get_idle_combat_setup` | "what food/prayers am I fighting with?", "will I heal in my idle fight?" | Surfaces configured food/potions/prayers and `foodInStock`. High relevance for "why am I dying" questions. |
| `search_market` | "how much is a rune scimitar worth?", "what's the going price for X?" | Trading-post bid/ask. Big value for economy questions. |
| `list_market_listings` | "what's cheap on the market right now?" | Aggregated order book, no identity exposed. |
| `my_offers` | "what offers do I have open?" | Player's own trading-post offers. |
| `get_leaderboard` | "what rank am I?", "who's top total level?" | Public metric; ranks by total level or boss KC. |

`list_characters` is likely unnecessary — the chatbot's `character_id` is pinned server-side
(§16), so multi-character selection isn't a chat concern.

**Recommendation:** add `get_account`, `get_idle_combat_setup`, `search_market`,
`list_market_listings`, `my_offers`, `get_leaderboard` to the allowlist. Confirm the trading-post
reads behave for ironman characters (reads should be fine; only writes are blocked).

---

## 4. Candidate net-new read tools

Beyond enriching existing ones:

- **`get_bank`** (see 2b) — the clearest new tool.
- **`get_combat_stats`** — if we'd rather not bloat `get_character_state`, a dedicated
  "combat dossier" tool: effective levels, equipment bonuses, max hits (all 3 styles),
  accuracy roll, combat level, combat type. Powered entirely by `formulas.js` +
  `equipment.js` + `combatLevel.js`. Lets the chatbot answer "am I strong enough for
  \<boss\>?" by combining this with `inspect_monster`.
- **`get_daily_tasks`** (read) — surfaces today's 5 tasks + completion/credit state
  (§4). A very common "what are my dailies?" question; a read endpoint already exists
  (`GET /api/daily-tasks`) to bridge to.

---

## 5. Suggested priority

1. **Enrich `summarizeSave`** with total level, total XP, combat level, equipment bonuses,
   max hits, prayer max (§2a). Biggest answer-quality win, zero new surface area.
2. **`get_bank`** read tool (§2b) — closes the "what's in my bank" hole.
3. **Allowlist** `get_account`, `get_idle_combat_setup`, `search_market` (§3) — cheap, high-traffic.
4. Then `list_market_listings`, `my_offers`, `get_leaderboard`, and the optional
   `get_combat_stats` / `get_daily_tasks` tools.

Every item above reuses existing `src/engine` helpers or existing endpoints — none require new
game logic, and none touch the write surface, so the "read-only chatbot" invariant holds.

---

## 6. Implementation checklist (per the MCP extension rule)

- Enriching `summarizeSave`: edit `functions/_lib/mcp/summary.js` + its regression test. Pass
  `itemsData` in for `getEquipmentBonuses`/max-hit computation.
- New read tool (`get_bank` / `get_combat_stats` / `get_daily_tasks`): add to `schema.js`
  (metadata + JSON Schema, `READ(...)` annotation) **and** `tools.js` (dispatch), plus a test —
  the parity test enforces schema ↔ dispatch lockstep. Prefer a bridge to the existing
  `/api/*` handler where one exists (daily tasks); otherwise a pure read off the decoded save.
- Chatbot exposure: add the tool name to `CHAT_TOOL_ALLOWLIST` in
  `functions/_lib/chat/prompt.js` (read tools only — never a write tool).
- Commit gate per §11.
