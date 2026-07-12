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

### `threejs-*` — Three.js game-dev skill suite *(vendored, MIT)*
Nine-skill orchestration bundle vendored verbatim from [`majidmanzarpour/threejs-game-skills`](https://github.com/majidmanzarpour/threejs-game-skills) (MIT; `threejs-game-director/UPSTREAM_LICENSE`). Entrypoint is `threejs-game-director` (routes build-a-game / polish / AAA / release requests through the others). Phase skills: `threejs-gameplay-systems` (scaffold, core loop, game feel), `threejs-aaa-graphics-builder` (materials/shaders/VFX/scorecard), `threejs-game-ui-designer` (HUD/menus/touch UI), `threejs-debug-profiler` (render/perf/mobile fixes), `threejs-qa-release` (playtest/bot QA/prod build). Asset generators (external APIs): `threejs-3d-generator` (Tripo — same provider as our `/api/tripo-assets/` §12), `threejs-image-generator` (Gemini), `threejs-audio-generator` (ElevenLabs). Unlike the four adapted upstream skills below, these are unmodified copies — re-sync by re-cloning upstream. Their assumed scaffold (standalone Vite/TS/Three.js game) differs from PocketRPG's single-file build (§12), so treat their build/scaffold steps as reference, not literal instructions here.

### `threejs-{fundamentals,geometry,materials,lighting,textures,animation,loaders,shaders,postprocessing,interaction}` — Three.js API reference *(vendored, MIT)*
Ten compact single-file skills vendored verbatim from [`CloudAI-X/threejs-skills`](https://github.com/CloudAI-X/threejs-skills) (MIT), each a quick-start + patterns + perf-notes reference for one Three.js area, audited against r160+. Complements the game-production suite above at a lower altitude (raw API how-to vs art-direction orchestration). Directly relevant to PocketRPG's embedded 3D (§12): `threejs-loaders` (GLB/R2 asset loading), `threejs-animation` (GLTF/combat-arena motion), `threejs-materials`/`threejs-lighting`/`threejs-textures` (hero + monster rendering). The rest are latent reference. Unmodified copies — re-sync by re-cloning upstream.

## 3) Path-scoped rule inventory

| Rule | Scope (`paths:`) | Contents |
|---|---|---|
| `.claude/rules/pvp.md` | `functions/api/pvp/**`, `functions/_lib/pvp*`, `src/engine/pvp*`, `src/data/pvpBots.json`, `functions/api/leaderboard.js` | Matchmaking, save-lockdown, special-energy/equip-swap timing, magic parity, bot system |
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

## 5) Subagents and token economy

- Prefer skills + path-scoped rules over spawning subagents for this repo's size: each subagent starts cold and re-reads always-on context, so it is the expensive path.
- Exception: read-only **Explore**-type agents for broad fan-out searches — they keep file dumps out of the main context and return only conclusions.
- In-session discipline (output shaping, effort routing, narrow reads) is CLAUDE.md §17 and applies always; local sessions can add Headroom compression (`HEADROOM.md`).
- The game applies the same economics server-side: the help chatbot exposes tools progressively via `search_tools` instead of declaring its full ~50-tool surface per call (`.claude/rules/chat.md`) — the in-repo precedent for why this structure works.

## 6) Maintenance

- These four upstream-derived skills (`plan-gate`, `scope-fence`, `ruthless-editor`, `memory-hygiene`) were adapted 2026-07-09 — triggers narrowed and reports trimmed to fit §17; they are not verbatim upstream copies. Re-syncing with upstream means re-applying those adaptations.
- A skill that keeps misfiring → fix its description first, body second.
- New skill/rule → add it to the inventory here and to the CLAUDE.md §13 list in the same change.
- Everything here follows `memory-hygiene`: dated where it will age, pruned when added to, verified before being trusted.

Further reading: [Anthropic — Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) · [Agent Skills open standard](https://agentskills.io) · [mattpocock/skills](https://github.com/mattpocock/skills) (user-invoked vs model-invoked split, composability, `writing-great-skills`).
