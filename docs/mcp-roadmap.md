# PocketRPG MCP roadmap

North star (chosen): a **full autoplayer** — the agent can eventually see the
whole game and *play* it (train skills, manage gear, progress quests, fight
monsters/bosses, PvP), with results computed server-side. This document is the
phased plan to get there. The deployed surface lives in `functions/api/mcp.js`
and `functions/_lib/mcp/**`; see `CLAUDE.md` §15 for the auth/scope summary.

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

- `fight_monster` / boss / raid simulation via `combat.js` + `combatant.js`
  (server-rolled, like the existing completion endpoints but driving the whole
  fight).
- Dungeoneering (`dungeoneeringTokens.js`).
- PvP intents (`pvpEngine.js` is already server-side — extend tool coverage).

## Cross-cutting

- **Audit**: every T2/T3 mutation emits an audit event.
- **Replay safety**: nonce-claim per mutation (extend `action_nonces`).
- **Tests**: golden/deterministic engine tests per new intent; schema + resource
  regression tests (`tests/mcpServer.test.ts`).
- **Context hygiene**: keep large content (items/monsters) as compact indexes +
  `inspect_*` detail tools so reads don't flood the model's context.
- **Scope discipline**: tools take intents; the server computes. Never expose raw
  save writes (`CLAUDE.md` §14).
