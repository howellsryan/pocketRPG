# PocketRPG MCP roadmap

North star (chosen): a **full autoplayer** — the agent can eventually see the
whole game and *play* it (train skills, manage gear, progress quests, fight
monsters/bosses), with results computed server-side. **PvP is explicitly out of
scope** (owner decision) — it stays in the game client and is never exposed via
MCP. This document is the phased plan to get there. The deployed surface lives
in `functions/api/mcp.js` and `functions/_lib/mcp/**`; see `CLAUDE.md` §15 for
the auth/scope summary.

## The constraint that shapes everything

Per `CLAUDE.md` §14, PocketRPG is **client-authoritative**: XP, coins and most
skilling/idle loot are computed in the browser and persisted via `/api/save`.
There is no server game engine today. The server is only authoritative for
reward grants, purchases, credits, trading post, PvP and idle/offline *claims*.

But `src/engine/**` is **pure and deterministic** (no UI imports). That is the
key: to let an agent *act*, we run the existing engine **server-side** to apply
intents to the save deterministically. This is a net security upgrade over the
client-authoritative path, but it is real work — hence the phasing.

Authority tiers used below:
- **T1 Read** — no writes.
- **T2 Existing server-authoritative write** — thin tool over an endpoint that
  already exists.
- **T3 New server-side compute** — run the pure engine server-side to mutate the
  save. Tools take *intents*; the server computes the result. Never raw save
  writes. All T2/T3 writes emit audit events (§14).

## Phase A — See everything (in progress)

Context + read. Mostly reading `src/data/*.json` and the save.

- [x] `instructions` advertised at `initialize`.
- [x] MCP **resources**: `pocketrpg://reference/{mechanics,items,monsters,shop,
      skills,spells,prayers,quests,clues,minigames,raids,farming}` and live
      `pocketrpg://character/{id}/{state,bank}`.
- [x] `inspect_item`, `inspect_monster`; item-id→name resolution in results.
- [x] Tool annotations (`readOnlyHint`, titles).
- [ ] Follow-ups: `get_equipment` detail with bonuses, `get_slayer_task`,
      drop-table-by-item ("where does X drop?"), quest/skill requirement checks.

## Phase B — Wire existing server-authoritative actions (T2) — done

Thin bridge tools over endpoints that already exist. Risk low — they enforce
auth/ownership/PvP-lock/ironman/audit/save-revision server-side.

- [x] Trading post: `search_market`, `my_offers`, `place_offer`, `cancel_offer`,
      `collect_offer`, `instant_sell_offer`, `sell_item`
      (`functions/api/trading-post/*`). Results enriched with item names.
- Deferred deliberately:
  - Reward-claim/completion endpoints (`functions/api/actions/**`) are
    nonce-bound to a completion event the *client* computed — not meaningfully
    agent-callable on their own. They become Phase C/D where the **server**
    simulates the completion and grants the loot.
  - `claim_idle_rewards` likewise needs server-derived idle rates → Phase C.
  - `reset_one_life` is an account-reset footgun; left out of the agent surface.

## Phase C — Play via the engine (T3) — in progress

The first real server-authority growth. "apply intent → save" tools that mutate
the decoded save server-side via the pure engine. Shared groundwork landed:
`functions/_lib/mcp/intents.js` (pure, golden-tested) + `applySaveIntent` in
tools.js (resolve+own character → PvP-lock guard → loadCharacterWithSave →
intent → writeSave → audit). Throw-before-write gives atomicity.

- [x] **Increment 1 — inventory/gear (no value created):** `deposit_to_bank`,
      `withdraw_from_bank`, `equip_item`, `unequip_item`. Reuse the proven
      `game/inventory.js` helpers + engine `equipment.js`; enforce 28-slot cap
      and skill/quest equip requirements. Golden tests in `tests/mcpIntents.test.ts`.
- [x] **Increment 2 — idle skilling (value):** `start_skilling`,
      `get_active_activity`, `claim_activity`. Runs the idle engine over the
      elapsed window server-side and applies XP/loot/supply-drain to the save
      (`applyIdleResult` mirrors the client load-time application so the two
      paths can't drift). Safe against double-grant because cloud clients treat
      the server `character_idle_state` clock as authoritative and resync from
      it; the claim resets `last_active_at`. `start_skilling` auto-claims a
      pending supported task and refuses to clobber an unsupported one.
- [x] **Increment 3 — all non-combat idle skills:** gathering
      (woodcutting/mining/fishing, via `simulateIdleSkilling`'s gathering path)
      plus agility, thieving and hunter (their own simulators + apply branches:
      coins-to-inventory for agility/thieving, reward-table items to bank for
      hunter). Generalised `buildIdleTask` / `runIdleTask` / `applyIdleResult`
      dispatch by task type. Golden + deterministic tests in `tests/mcpIntents.test.ts`.
- [x] **Increment 4 — quests:** `get_quests` (read: completed / startable-now /
      locked-with-reasons + quest points) and `start_quest` (validates
      eligibility via `quests.js` `checkQuestEligibility`, resolving the
      combat/"any" XP choice up front via an `xp_skill` arg). A quest is a timed
      idle task on the single idle slot; `claim_activity` runs
      `simulateQuestIdleCascade` server-side to record the completion, grant
      fixed + chosen XP, bank coins and unlock quest-gated items. `skip_hour`
      now also advances the idle clock an hour, so the skipped time materialises
      on the next claim (it previously only debited the credit). Golden tests in
      `tests/mcpIntents.test.ts`.

Still client-only (other systems / Phase D): combat & slayer (`simulateIdleCombat`
— food/death), farming patches, prayer, magic, construction, dungeoneering, and
the material-gathering `gather` tasks.

## Phase D — Full autoplayer (T3, heaviest)

- [x] **Increment 1 — idle combat (`start_fight`):** server-rolled combat vs
      normal monsters via the pure `simulateIdleCombat`, applied to the save by
      `runCombatTask` (combat XP across the 6 skills, food/potion/ammo/rune/
      charge consumption, post-fight inventory + banked loot, HP). It reuses the
      single idle slot, so `claim_activity`/`get_active_activity` now handle
      combat too. Safety: bosses/raids are refused (the simulator already blocks
      them), and **One-Life accounts are refused** from starting or MCP-claiming
      a fight — combat death never wipes here (HP resets, the fight stops,
      rewards up to the killing blow are kept); One-Life death stays in the
      client. Slayer-task credit is deliberately left client-side for now
      (`slayerTask = null`). Golden tests in `tests/mcpIntents.test.ts`.
- [x] **Increment 2 — boss & raid kills (`kill_boss` / `kill_raid`):** rather
      than driving a full tick-by-tick fight, this uses the in-game credit-gated
      instant-kill **skip** — debit the boss/raid skip cost via `/api/skip-hour`,
      then grant through the existing server-rolled completion endpoints
      (`/api/actions/monster|raid/complete`). Loot RNG, kill counts, collection
      log and reward-source validation all stay server-authoritative; no combat
      sim is trusted. Credit-free combat-based kills also landed — see below.
- [x] **Increment 2b — combat-based boss kills (`fight_boss`):** a headless
      runner (`functions/_lib/mcp/bossFight.js`) drives the real engine
      (`createCombatState` + `processCombatTick`) tick-by-tick, tracking HP and
      auto-eating the configured idle food, until the boss or the player dies. A
      win grants through the normal server-rolled completion endpoint (no
      credits); a loss/death grants nothing but still consumes the food used.
      Deliberately CONSERVATIVE — no prayers, potions or special attacks — so a
      simulated win is always genuinely achievable (never over-credits an
      unearnable kill). Magic setups and One-Life accounts are refused (use
      `kill_boss` / the client). Combat-based *raids* (multi-boss) remain a
      future extension; `kill_raid` (credit skip) covers raids today.
      Seeded-RNG golden tests in `tests/mcpBossFight.test.ts`.
- [x] **Increment 3 — dungeoneering:** train it as a normal idle skill
      (`start_skilling` skill=`dungeoneering`) to earn XP + tokens
      (`simulateIdleSkilling` + `applyIdleResult`), and `claim_dungeoneering_reward`
      spends tokens to unlock gear via `/api/actions/dungeoneering/complete`
      (level + token-balance validated, `planDungeoneeringReward`). Golden tests
      in `tests/mcpIntents.test.ts`.
- **PvP — out of scope (will not build).** Per owner decision, the MCP server
  does not expose PvP. No matchmaking, match-state reads or move-submission
  tools; PvP stays entirely in the game client. Do not add PvP tooling here.

## Cross-cutting

- **Audit**: every T2/T3 mutation emits an audit event.
- **Replay safety**: nonce-claim per mutation (extend `action_nonces`).
- **Tests**: golden/deterministic engine tests per new intent; schema + resource
  regression tests (`tests/mcpServer.test.ts`).
- **Context hygiene**: keep large content (items/monsters) as compact indexes +
  `inspect_*` detail tools so reads don't flood the model's context.
- **Scope discipline**: tools take intents; the server computes. Never expose raw
  save writes (`CLAUDE.md` §14).
