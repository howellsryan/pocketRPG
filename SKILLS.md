# PocketRPG instruction inventory

AGENTS.md is the canonical root contract; CLAUDE.md is a thin entry point.
Read this inventory when routing domain work or changing instructions. Host loading
varies: matching Claude rules may load automatically, but Codex/ChatGPT/GitHub-only
sessions must read the applicable rules and local skill bodies explicitly.

## Shared workflows

The lock owns delivery-loop, memory-hygiene, plan-gate, scope-fence,
systematic-debugging, verification-before-completion and test-driven-development.
Install and use them via [docs/agent-workflows.md](docs/agent-workflows.md); edit
shared sources centrally. Do not restore local forks or edit generated directories.

## Project-owned skills

Their SKILL.md descriptions and bodies own triggering and procedure.

### `ruthless-editor` — every sentence earns its place
Fires on public-facing/persistent prose: docs, READMEs, PR bodies, reports. A separate cutting pass after drafting — per-sentence tests (needed to act? repeated? hedging? abstract-where-concrete-possible?), structural cuts (lead with outcome, kill throat-clearing), target ~30% shorter with zero information loss, with explicit guards against over-compression (clarity outranks brevity). Repo-specific payoff: `docs/game-guide.md` compiles into the chat knowledge index, so cutting it reduces per-player-chat token spend in production; PR bodies publish to Discord. Not for code, commit messages, or chat replies (§17 governs those).

### `pr-changelog` — the PR is the public changelog *(PocketRPG-native)*
Fires on every PR title/body write. Encodes AGENTS.md §19: merged PRs auto-publish verbatim to the players' Discord `#changelog` (first ~3900 chars, HTML comments stripped). Player-facing voice, present tense, area-sectioned bodies leading with player impact, one honest line for chores, and the hard bans — no attribution, no AI/Claude mention, no session/GitHub links, no secrets/hostnames. Ends with a mandatory `ruthless-editor` cutting pass.

### `add-content` — content authoring checklist *(PocketRPG-native)*
Fires when adding/editing game content in `src/data`. Items/drops (referenced items must exist; Title Case; stackable quantity conventions; collection-log slot + regression test for uniques; server-side loot table for high-value grants), the five-step weapon special-attack recipe (moved here from AGENTS.md §7), monster/boss conventions (boss Slayer XP multiplier, dragonfire, 3D arena auto-enable), and the after-change tail (logic tests, game-guide + `gen:knowledge`, §11 commit gate).

### `save-item-grant` — hand-edit an item into a live save *(PocketRPG-native)*
Fires when asked to add/grant/inject an item into a **specific character's** cloud save (support grants, compensation, bug repro), as opposed to authoring an in-game source (that's `add-content`). Wraps `scripts/grant-save-item.mjs`: reads the `saves` row through wrangler (prod `pocketrpg` / preview `pocketrpg-preview`), gunzips `save_blob` (gzip, not encryption), appends to `save.inventory` only, re-gzips and writes back. The safety rules are the point — always ask the requester for the character id and confirm the item by name **and** id, the `UPDATE` is guarded on the `save_revision` it read, the run aborts under a PvP/co-op/world save lock, a pre-change snapshot goes to gitignored `.save-backups/`, and the result is re-read and verified. Inventory only; credits/XP stay server-authoritative (§14). Logic in `scripts/lib/saveItemGrant.mjs`, covered by `tests/saveItemGrant.test.ts`.

### `action-animation` — showing the player their action *(PocketRPG-native)*
Fires when adding/changing an on-screen animation for a player action (a combat swing, a mining strike, a fishing cast) or editing `src/utils/actionSprites.js` / `src/utils/inkwright.js` / any stage component / the `.ink-*` or `.inkc-*` CSS. Encodes the one law — **an animation's speed IS the action's own cadence**, never a constant, reaching CSS only as an inline custom property — and the choice between the two LIVE stages built on it, both the same drawn "Inkwright" figure: `InkwrightCombatStage` (armed per style, facing a mirrored enemy) for combat, `InkwrightStage` (working a resource) for skilling. A tool-glyph lane renderer was combat's first presentation, was superseded, and is deleted — its event/timing plumbing (`swingsFromCombatEvents` etc., `src/utils/actionSprites.js`) is NOT deleted and is exactly what `InkwrightCombatStage` still consumes, unchanged; that table's `tool` field is the deleted renderer's old glyph key, so read `.motion` instead. Carries the traps each paid for once. Combat: a miss is still a swing, a multi-hit special is ONE swing, the target keys on both swings, read a boss's current FORM not its top-level style, co-op gates on the viewer's own `characterId`. Skilling: scale strike COUNT not tempo, never drive motion off tick-quantised `progress`, gate the payoff on a completed action, and build the stage in the chunked screen because the shared panel is core. Rollout state and the per-skill recipe: `docs/action-animations.md`. Not for the open world's 3D GLB clips (different renderer, stricter impact-frame constraint — `src/utils/combatWindup.js`).

### `procgen-creature` — blend-shell creature authoring *(PocketRPG-native)*
Fires when authoring/editing `src/data/creatures3d.json` (procedural arena monsters) or `src/data/hero3d.json` (procedural hero + composable equipment) specs (`docs/procedural-3d-plan.md`). Spec + rig field reference verified against `src/3d/*.js` (incl. the humanoid arms rig and equipment add/override composition), the 24-primitive budget, DESIGN.md-derived palette rules (warm figurine on parchment), the Phase 2 shader gotchas (NoColorSpace palette, thin-part blend cap, buried tuck), and the mandatory visual gate: `node scripts/render-proc.mjs <id>` / `--hero [equip,...]` renders idle/attack/hit/death PNGs headlessly, and no spec is committed unseen. Not for GLB/imported model assets.

> **No generative 3D pipeline.** New arena content is authored procedurally via `procgen-creature` (creatures) or built from the CC0 Quaternius packs (hero/weapons/outfits, §12). PocketRPG does **not** use the Tripo API (or any text/image-to-3D generation service) for new assets, and there is no such skill — do not add one or reach for a `TRIPO_API_KEY`. The one legacy GLB still served from `/api/tripo-assets/` R2 (King Black Dragon) is a runtime asset, not a route for generating more.

### `threejs-{fundamentals,geometry,materials,lighting,textures,animation,loaders,shaders,postprocessing,interaction}` — Three.js API reference *(vendored, MIT)*
Ten compact single-file skills vendored verbatim from [`CloudAI-X/threejs-skills`](https://github.com/CloudAI-X/threejs-skills) (MIT), each a quick-start + patterns + perf-notes reference for one Three.js area, audited against r160+. Raw-API how-to references (vs the higher-altitude design docs). Directly relevant to PocketRPG's embedded 3D (§12): `threejs-loaders` (GLB/R2 asset loading), `threejs-animation` (GLTF/combat-arena motion), `threejs-materials`/`threejs-lighting`/`threejs-textures` (hero + monster rendering). The rest are latent reference. Unmodified copies — re-sync by re-cloning upstream.

## 3) Path-scoped rule inventory

| Rule | Scope (`paths:`) | Contents |
|---|---|---|
| `.claude/rules/gameplay-engine.md` | `src/engine/**`, `src/state/gameState.jsx`, `src/db/saveload.js`, plus the server-side combat/kill-count/slayer/daily-task mirrors | Holdings/banking, quest gates, prayer/combo, boss adds + shared-record combat, world minions, hard mode, Grim Reaper, Slayer, Kingdom of Royals, Construction unlocks, Daily Tasks, journeys/teleports |
| `.claude/rules/coop-raids.md` | `functions/api/coop/**`, `world/server/CoopBossRoom.ts`, the co-op client/engine files | Co-op boss fights + raid parties: WebSocket push protocol, save-lock/heartbeat rules, kill-settlement idempotency, chat/loot broadcasts |
| `.claude/rules/server-authority.md` | `functions/api/**`, `functions/_lib/**`, `worker/**`, `src/db/saveload.js` | Production security model: every server-authoritative surface, the admin portal, audit events, item-loss safety net, save-lock mechanics |
| `.claude/rules/ui-styling.md` | `src/utils/theme.js`, `src/utils/itemIconResolve.js`, `src/index.css`, related icon/theme files | Theme system (light/dark, semantic tokens), single item-icon resolver |
| `.claude/rules/single-file-build.md` | `build_single.cjs`, `src/3d/**`, 3D asset build/render scripts | Eval-time TDZ traps, code-split/chunk rules, the 3D/GLB asset pipeline |
| `.claude/rules/pvp.md` | `src/engine/pvp*`, `world/server/pvp*`, `world/shared/pvpArea.ts`, `src/data/pvpBots.json`, `functions/api/leaderboard.js` | The Wilderness: the attack gate, the one swing function, death drops, combat logout, bot system |
| `.claude/rules/mcp.md` | `functions/api/mcp.js`, `functions/_lib/mcp/**`, OAuth paths, consent screen, MCP tests | MCP architecture, bridge tools vs save-intents, schema/tools/test trio |
| `.claude/rules/chat.md` | `functions/api/chat.js`, `functions/_lib/chat/**`, `ChatWidget.jsx`, `docs/game-guide.md`, `scripts/gen-chat-knowledge.cjs` | Chatbot model chain, progressive tool exposure, write gating + action fee, spend budgets, knowledge index |
| `.claude/rules/world-design.md` | `world/zones/**`, `world/scripts/gen-*.mjs`, `world/client/src/editor/**`, terrain/scatter/props/scene files | Zone-authoring quality bar for the open world |
| `.claude/rules/testing.md` | `tests/**` | Bug-fix-first, test-in-same-diff, move-logic-out-of-JSX, no mirror-list/source-regex tests, the CI gates |
| `.claude/rules/video.md` | `video/**`, `tests/videoRecipe.test.ts` | The `video/**` clip capture/render pipeline traps |

## Maintenance

Keep always-relevant orientation and gates in AGENTS.md; path-specific contracts
in rules, task recipes in skills and detailed references in docs. Prune superseded
instructions in the same change. Preserve unique constraints before consolidating.
Descriptions state trigger and non-trigger, not a shortcut around reading the body.
Add new skills/rules to this inventory and route them from the relevant root section.
Read only matching references; no fixed metadata-token or cache-saving guarantee.
