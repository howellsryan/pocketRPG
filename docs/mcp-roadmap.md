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

## Phase B — Wire existing server-authoritative actions (T2)

Thin bridge tools over endpoints that already exist:

- Trading post: `list_offer`, `cancel_offer`, `collect_offer`, `instant_sell`,
  `my_offers`, `search_market` (`functions/api/trading-post/*`).
- Reward claims: clue / minigame / monster / raid / dungeoneering completion
  endpoints (`functions/api/actions/**`) and `claim_idle_rewards`
  (`functions/api/actions/idle/claim.js`).
- `reset_one_life` (`functions/api/characters/reset-one-life.js`).

Risk: low — these already enforce auth/locks/RNG/audit server-side.

## Phase C — Play via the engine (T3)

The first real server-authority growth. New "apply intent → save" endpoints that
import the pure engine:

- `start_idle_task` + `claim`, with **server-derived** rates from
  `idleEngine.js` / `skilling.js` (today the client supplies the rates).
- `equip_item` / `unequip` / `bank_item` / `withdraw` — validated via
  `equipment.js` / `inventory.js` (28-slot, requirements).
- `train_skill_session(skill, action, ticks)` — bounded deterministic run of
  `skilling.js` / `activityRunner.js`, applying XP + outputs + supply drain.
- `do_quest_step` — `quests.js` / `questIdleCascade.js`.

Shared groundwork: a server `loadSave → applyIntent(engine) → validate → save`
helper with replay protection (reuse the `action_nonces` pattern), plus audit
events. Heavy test coverage (engine is deterministic, so golden tests are easy).

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
