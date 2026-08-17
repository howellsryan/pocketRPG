# SKILLS.md — PocketRPG Agent Configuration Reference

The complete map of how AI-agent context is organised in this repo: what loads when, every skill and rule in the inventory, and the practices behind them. `CLAUDE.md` stays terse because this file carries the detail; read this when adding/changing skills or rules, not on every session.

## 1) Architecture: three tiers of progressive disclosure

Agent context is priced per session. Everything here is organised so a session only pays for what it actually uses:

| Tier | Location | When it loads | Cost model |
|---|---|---|---|
| **Always-on** | `CLAUDE.md` | Every session, in full | Paid every session — keep terse, invariants and pointers only |
| **Path-scoped rules** | `.claude/rules/*.md` | Auto, when a touched file matches the rule's `paths:` globs | Paid only by sessions touching that area |
| **Skills** | `.claude/skills/*/SKILL.md` | Name + description always visible (~100 tokens total); full body loads only when the task matches the description | Near-free when dormant |

This mirrors the progressive-disclosure model Anthropic published for [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills), an open standard since December 2025 ([agentskills.io](https://agentskills.io)) adopted by OpenAI, Google, GitHub, and Cursor. Skills hot-reload — edits to `.claude/skills/` apply without restarting a session.

**Placement rule** (from the `memory-hygiene` skill): applies every session → `CLAUDE.md`. Applies to specific files → path-scoped rule. A workflow/recipe/behavioural discipline → skill. Reference detail → this file or `docs/`.

## 2) Skill inventory

Model-invoked: each skill fires when the task matches its frontmatter description. Source of truth is always the SKILL.md file itself.

### `delivery-loop` — one agent, dedicated steps *(PocketRPG-native)*
Fires at the start of every implementation task, before the first edit. Triage: **checklist** (an existing checklist fully covers it — skip the loop, apply the checklist + §11 gate) vs **stepped** (run the loop: Plan → optional Architect → Engineer / World Designer as needed → Code Review → QA, all inside the one session; each step announced on one line and closed with a ≤5-line handoff note). Code Review (the `code-review` skill run against the diff) sits between the builder steps and QA — it judges the diff itself for correctness/reuse/efficiency, FAILs loop back to Engineer and re-run until it passes, and only then does QA judge the diff against Plan's success criteria. No builder/QA/BA subagents are ever spawned — read-only Explore fan-out searches are the sole sanctioned exception. Step charters live in the skill's `steps.md` (folded from the retired `.claude/agents/` squad roster). Replaced the multi-agent squad workflow 2026-07-16 for token cost. Design record + research: `docs/delivery-workflow.md`.

### `plan-gate` — no edits until the plan exists
For **novel or multi-system work only**: engine + server + migration together, the §14 integrity boundary (auth, grants, credits, purchases, `/api/save` guards), save format, PvP settlement, the single-file build pipeline. Forces a written plan (GOAL / UNKNOWNS / SUCCESS CRITERIA / STEPS / OUT OF SCOPE) before the first edit, built from evidence (files read first), with executable success criteria and a hard stop-and-replan rule when reality contradicts the plan. Deliberately narrowed from its upstream version, which fired on any multi-edit task — routine PocketRPG work already has checklists, and a five-block plan for "add a drop" is ceremony, not safety.

### `scope-fence` — do what was asked, flag what you found
Fires on any modification of existing work. The requested change and its genuine requirements are in scope; everything else noticed along the way is flagged ("Noticed, NOT touched: …"), never silently fixed. Gray-zone tests: would X break without the extra edit (in scope); is it "while I'm here" (out); formatting churn on untouched lines (revert). Operationalises CLAUDE.md §13. Trimmed from upstream: no "Changed:" list (the diff shows it), report only emitted when something was flagged.

### `ruthless-editor` — every sentence earns its place
Fires on public-facing/persistent prose: docs, READMEs, PR bodies, reports. A separate cutting pass after drafting — per-sentence tests (needed to act? repeated? hedging? abstract-where-concrete-possible?), structural cuts (lead with outcome, kill throat-clearing), target ~30% shorter with zero information loss, with explicit guards against over-compression (clarity outranks brevity). Repo-specific payoff: `docs/game-guide.md` compiles into the chat knowledge index, so cutting it reduces per-player-chat token spend in production; PR bodies publish to Discord. Not for code, commit messages, or chat replies (§17 governs those).

### `memory-hygiene` — memory is a claim about the past
Fires when reading or writing persistent agent memory (`CLAUDE.md`, rules, skills, this file). Write side: persist decisions-with-why, corrections received, non-obvious constraints, user preferences; never what code/git already records; prune when adding; put each fact in the right tier. Recall side: grade staleness (system state ages fast, decisions slowly); fast-aging fact + consequential action → verify against live state first; live state wins disagreements and the memory gets fixed in the same breath.

### `pr-changelog` — the PR is the public changelog *(PocketRPG-native)*
Fires on every PR title/body write. Encodes CLAUDE.md §20: merged PRs auto-publish verbatim to the players' Discord `#changelog` (first ~3900 chars, HTML comments stripped). Player-facing voice, present tense, area-sectioned bodies leading with player impact, one honest line for chores, and the hard bans — no attribution, no AI/Claude mention, no session/GitHub links, no secrets/hostnames. Ends with a mandatory `ruthless-editor` cutting pass.

### `add-content` — content authoring checklist *(PocketRPG-native)*
Fires when adding/editing game content in `src/data`. Items/drops (referenced items must exist; Title Case; stackable quantity conventions; collection-log slot + regression test for uniques; server-side loot table for high-value grants), the five-step weapon special-attack recipe (moved here from CLAUDE.md §7), monster/boss conventions (boss Slayer XP multiplier, dragonfire, 3D arena auto-enable), and the after-change tail (logic tests, game-guide + `gen:knowledge`, §11 commit gate).

### `save-item-grant` — hand-edit an item into a live save *(PocketRPG-native)*
Fires when asked to add/grant/inject an item into a **specific character's** cloud save (support grants, compensation, bug repro), as opposed to authoring an in-game source (that's `add-content`). Wraps `scripts/grant-save-item.mjs`: reads the `saves` row through wrangler (prod `pocketrpg` / preview `pocketrpg-preview`), gunzips `save_blob` (gzip, not encryption), appends to `save.inventory` only, re-gzips and writes back. The safety rules are the point — always ask the requester for the character id and confirm the item by name **and** id, the `UPDATE` is guarded on the `save_revision` it read, the run aborts under a PvP/co-op/world save lock, a pre-change snapshot goes to gitignored `.save-backups/`, and the result is re-read and verified. Inventory only; credits/XP stay server-authoritative (§14). Logic in `scripts/lib/saveItemGrant.mjs`, covered by `tests/saveItemGrant.test.ts`.

### `action-animation` — showing the player their action *(PocketRPG-native)*
Fires when adding/changing an on-screen animation for a player action (a combat swing, a mining strike, a fishing cast) or editing `src/utils/actionSprites.js` / `src/utils/inkwright.js` / any stage component / the `.ink-*` or `.inkc-*` CSS. Encodes the one law — **an animation's speed IS the action's own cadence**, never a constant, reaching CSS only as an inline custom property — and the choice between the two LIVE stages built on it, both the same drawn "Inkwright" figure: `InkwrightCombatStage` (armed per style, facing a mirrored enemy) for combat, `InkwrightStage` (working a resource) for skilling. `ActionSpriteStage` (a tool-glyph lane) was combat's first presentation, is superseded, and stays in the repo unrendered — its event/timing plumbing (`swingsFromCombatEvents` etc.) is exactly what `InkwrightCombatStage` still consumes, unchanged. Carries the traps each paid for once. Combat: a miss is still a swing, a multi-hit special is ONE swing, the target keys on both swings, read a boss's current FORM not its top-level style, co-op gates on the viewer's own `characterId`. Skilling: scale strike COUNT not tempo, never drive motion off tick-quantised `progress`, gate the payoff on a completed action, and build the stage in the chunked screen because the shared panel is core. Rollout state and the per-skill recipe: `docs/action-animations.md`. Not for the open world's 3D GLB clips (different renderer, stricter impact-frame constraint — `src/utils/combatWindup.js`).

### `procgen-creature` — blend-shell creature authoring *(PocketRPG-native)*
Fires when authoring/editing `src/data/creatures3d.json` (procedural arena monsters) or `src/data/hero3d.json` (procedural hero + composable equipment) specs (`docs/procedural-3d-plan.md`). Spec + rig field reference verified against `src/3d/*.js` (incl. the humanoid arms rig and equipment add/override composition), the 24-primitive budget, DESIGN.md-derived palette rules (warm figurine on parchment), the Phase 2 shader gotchas (NoColorSpace palette, thin-part blend cap, buried tuck), and the mandatory visual gate: `node scripts/render-proc.mjs <id>` / `--hero [equip,...]` renders idle/attack/hit/death PNGs headlessly, and no spec is committed unseen. Not for GLB/imported model assets.

> **No generative 3D pipeline.** New arena content is authored procedurally via `procgen-creature` (creatures) or built from the CC0 Quaternius packs (hero/weapons/outfits, §12). PocketRPG does **not** use the Tripo API (or any text/image-to-3D generation service) for new assets, and there is no such skill — do not add one or reach for a `TRIPO_API_KEY`. The one legacy GLB still served from `/api/tripo-assets/` R2 (King Black Dragon) is a runtime asset, not a route for generating more.

### `threejs-{fundamentals,geometry,materials,lighting,textures,animation,loaders,shaders,postprocessing,interaction}` — Three.js API reference *(vendored, MIT)*
Ten compact single-file skills vendored verbatim from [`CloudAI-X/threejs-skills`](https://github.com/CloudAI-X/threejs-skills) (MIT), each a quick-start + patterns + perf-notes reference for one Three.js area, audited against r160+. Raw-API how-to references (vs the higher-altitude design docs). Directly relevant to PocketRPG's embedded 3D (§12): `threejs-loaders` (GLB/R2 asset loading), `threejs-animation` (GLTF/combat-arena motion), `threejs-materials`/`threejs-lighting`/`threejs-textures` (hero + monster rendering). The rest are latent reference. Unmodified copies — re-sync by re-cloning upstream.

## 3) Path-scoped rule inventory

| Rule | Scope (`paths:`) | Contents |
|---|---|---|
| `.claude/rules/pvp.md` | `src/engine/pvp*`, `world/server/pvp*`, `world/shared/pvpArea.ts`, `src/data/pvpBots.json`, `functions/api/leaderboard.js` | The Wilderness: the attack gate, the one swing function, death drops, combat logout, bot system |
| `.claude/rules/mcp.md` | `functions/api/mcp.js`, `functions/_lib/mcp/**`, OAuth paths, consent screen, MCP tests | MCP architecture, bridge tools vs save-intents, schema/tools/test trio |
| `.claude/rules/chat.md` | `functions/api/chat.js`, `functions/_lib/chat/**`, `ChatWidget.jsx`, `docs/game-guide.md`, `scripts/gen-chat-knowledge.cjs` | Chatbot model chain, progressive tool exposure, write gating + action fee, spend budgets, knowledge index |
| `.claude/rules/testing.md` | `tests/**` | Bug-fix-first, test-in-same-diff, move-logic-out-of-JSX, no mirror-list/source-regex tests, the CI gates |

## 4) Authoring practices (for new skills/rules)

- **Only encode what pushes the agent away from its defaults.** A skill restating obvious good practice wastes its trigger and its tokens. Careful planning on complex tasks is a default; a *plan format and stop-rule* is not.
- **The description is the contract.** It is the only part always in context, so it alone decides when the body loads. State the trigger AND the non-trigger ("Do not use for…"). Over-triggering is the classic failure mode — it taxes every session and dilutes trust in skills generally.
- **Small and composable beats monolithic** (philosophy borrowed from [mattpocock/skills](https://github.com/mattpocock/skills), the source of several patterns here). One skill per workflow; skills may reference each other (`pr-changelog` → `ruthless-editor`).
- **Prune the overlap in the same change.** When a skill/rule supersedes CLAUDE.md lines, delete them then (CLAUDE.md §0/§13). Duplicated guidance is paid twice and drifts into contradiction.
- **Exact examples over abstractions.** Agents pattern-match; the JSON snippet in `add-content` outperforms a paragraph describing the schema.
- **When a SKILL.md grows unwieldy, split** into referenced files loaded on demand (tier 3 of progressive disclosure).

## 5) Single-agent delivery and token economy

- Delivery is **single-agent**: the `delivery-loop` skill runs roles as steps inside one session sharing one continuous context. Multi-agent squads were retired 2026-07-16 — spawns re-load always-on context cold, re-read files already in context, and multiply spend ~4–15× for sequential build work that never parallelises in practice (research + design record: `docs/delivery-workflow.md`).
- Step charters live in `.claude/skills/delivery-loop/steps.md`, folded from the retired `.claude/agents/` roster. They stay pointer-heavy — citing CLAUDE.md §s and path-scoped rules instead of duplicating them.
- Read-only **Explore**-type agents remain the cheap tool for broad fan-out searches — they keep file dumps out of the main context and return only conclusions. That is the only sanctioned subagent use in delivery work; writes stay single-threaded in the session.
- In-session discipline (output shaping, effort routing, narrow reads) is CLAUDE.md §17 and applies always; local sessions can add Headroom compression (`HEADROOM.md`).
- The game applies the same economics server-side: the help chatbot exposes tools progressively via `search_tools` instead of declaring its full ~50-tool surface per call (`.claude/rules/chat.md`) — the in-repo precedent for why this structure works.

## 6) Maintenance

- These four upstream-derived skills (`plan-gate`, `scope-fence`, `ruthless-editor`, `memory-hygiene`) were adapted 2026-07-09 — triggers narrowed and reports trimmed to fit §17; they are not verbatim upstream copies. Re-syncing with upstream means re-applying those adaptations.
- A skill that keeps misfiring → fix its description first, body second.
- New skill/rule → add it to the inventory here and to the CLAUDE.md §13 list in the same change.
- Everything here follows `memory-hygiene`: dated where it will age, pruned when added to, verified before being trusted.

Further reading: [Anthropic — Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) · [Agent Skills open standard](https://agentskills.io) · [mattpocock/skills](https://github.com/mattpocock/skills) (user-invoked vs model-invoked split, composability, `writing-great-skills`).
