# Shared agent workflows

PocketRPG installs exact shared dependencies from `.agents/skills.lock.json`.
AGENTS.md owns root rules; `.claude/rules/` and `docs/engineering/` own domain
contracts. Project-specific skills stay checked in under `.claude/skills/`.

## Bootstrap and loading

Run `python3 tools/agent-skills.py`, then `python3 tools/agent-skills.py --check`
before implementation. Python 3.10+, Git, symlinks and initial GitHub access are
required. The bootstrap verifies the central installer's SHA-256 before execution.
Read applicable `.agents/skills/<name>/SKILL.md` files in full; delivery-loop also
requires steps.md. Generated `.claude/skills/` links expose the same dependencies.
If discovery preceded installation, read files directly for this task; a fresh
session may be needed for native menus. Never infer a workflow from its name.

| Task | Skill |
| --- | --- |
| Implementation | delivery-loop |
| Novel/multi-system work, authority boundary, save format, migration or bundle pipeline | plan-gate |
| Modifications | scope-fence |
| Broken behaviour | systematic-debugging |
| Completion, commit, PR or handoff | verification-before-completion |
| Persistent instructions or consequential recalled facts | memory-hygiene |
| Regression construction | test-driven-development |

Upstream `superpowers:test-driven-development` means the installed directory.
Code Review is the delivery-loop charter, with no missing code-review plugin.
The project constraints below supplement those shared steps.

## PocketRPG delivery contract

- One session performs Plan, optional Architect, Build (including World Designer
  where needed), Code Review, then QA. Review judges the diff; QA judges the raw
  diff against written criteria. Failures return to Build and Review before QA.
  Keep short handoff notes across compaction. No builder/QA squads; read-only
  Explore fan-out is the only sanctioned delegation.
- Plan names the AGENTS.md §14 owner of every value mutation. A new authority
  crossing requires Architect. Specify tables/fields and sequence migration before
  endpoint, schema before UI. Server-owned rewards use server RNG and audit events
  through `functions/_lib/game/audit.js`; credits never move through the save blob.
- Authenticated mutations require the session JWT (`requireAuth`). `/api/save`
  retains exactly three guards: stale writes, total-level regression and bank wipes,
  plus its session-lock mechanics. Never add economy-increase policing. Read the
  complete server-authority rule. MCP save intents use `applyTaskResult.js`.
- Engine stays pure, deterministic and UI-free; RNG follows existing patterns.
  Extract branching JSX game logic into the engine with logic tests. New content
  follows add-content; player-visible mechanics also update docs/game-guide.md,
  run `npm run gen:knowledge`, and commit the generated knowledge changes.
- Read PRODUCT.md and DESIGN.md for UI; reuse Preact components, theme variables
  and kit primitives. New components enter sourceFiles; in-game screens also enter
  GAME_CHUNK_FILES. Preserve globally unique top-level identifiers, chunk-data
  typeof guards and no eval-time cross-module reads. Read single-file-build rules.
- World Designer runs within Build for places, activities, Slayer placement,
  journey/clue routing and 3D specs. Geography/teleports stay in core; worldActivities
  stays chunk-loaded. Apply world-design and add-content. Procgen specs require
  rendered screenshot review; never commit a spec unseen.
- Debug from whole errors and reproduction, instrumenting engine/UI, client/server,
  save/D1, engine/session, DO/member and source/bundle seams before proposing fixes.
  Three failed fixes require architectural reassessment before a fourth. An eval
  throw may be build order; special-energy contexts differ (§7); an empty bar is
  <1; check item/log/authority for missing drops and DPS twin parity for damage drift.
  A flake label is not a diagnosis: rerun once to investigate, never skip/quarantine.
- QA applies TESTING.md and the testing rule: bug regression fails before the fix;
  logic changes include meaningful tests, no mirrored lists/source-regex tests.
  `npm test` always; `npm run ci` before commit. Preserve all existing runtime gates.
  Screens and 3D need actual rendered inspection (mobile viewport for UI;
  render-proc.mjs/render-arena-hero.mjs for specs); disclose an unavailable visual
  check. A green logic suite alone is not proof of the player experience.
- Final handoff names fresh evidence and unverified work, PR and a direct preview
  verified at the pushed SHA when available. PR prose follows pr-changelog and its
  ruthless-editor pass; merged PR text publishes to players.

## Restricted sessions

If bootstrap cannot run, use the lock to fetch each applicable SKILL.md and its
required resources at the exact source revision through GitHub. This is explicit
loading, not native installation. Identify the revision and disclose unavailable
resources or scripts before dependent work. Never substitute main.

## Updates and rollback

Change shared workflows in Agent-Template. Merge the central PR first, generate
`.agents/skills.lock.json` with its `scripts/create_lock.py`, compare the bootstrap
with `templates/agent-skills.py`, then install/check and run project gates. If a
squash/rebase merge changes the revision, regenerate from the merged commit.
This coordinated adoption currently pins 208d2a407de3a2b4ddbb8cc8d54a1e227dddea65;
merge Agent-Template PR 4 before merging this adoption.

Restore the previous lock and reinstall to roll back later updates. This initial
migration replaces six tracked generic skills; reverting it must also restore
those tracked files and remove their generated links. Keep all project skills.
Never enable a marketplace copy alongside the same locked dependencies.

The dedicated Agent workflows CI job checks a fresh installation, offline integrity
and preservation of a project-owned skill. Application scripts/gates remain intact.
Do not edit caches. Preserve accidental edits elsewhere before removing only the
affected revision and reinstalling. Remove a stale install.lock only after checking
that no installer is running; unmanaged discovery links are rejected, not replaced.

## Context evaluation

AGENTS.md §17 governs intake and handoffs. Use delivery-loop/measurement.md only for
an explicit evaluation; compare representative tasks at the same model/settings
and include failures/rework. Bytes are a context proxy, not token/cache telemetry.
No Astra cache-hit or cost savings have been measured by this migration. Ponytail
is not installed; the shared review asks for existing owners and simpler equivalent
solutions while preserving tests, modularity, accessibility and requested scope.
