# CLAUDE.md — <Project Name> Contributor Guide

> Accurate, terse instructions for AI/human contributors, loaded every session. When behaviour or scripts change, update this file in the same change. Keep it short — it's input-token cost on every session.

## 0) Orientation
- **Product**: <one or two sentences: what this is, who it's for>.
- **Code**: <where the main source lives, e.g. `src/`>, <where the server/backend lives, if any>, <where content/config data lives>, <where tests live>.
- **Build**: <how the deployed artifact is produced; call out anything generated/gitignored that must never be hand-edited>.
- Pass the commit gate (§X) before committing. Token discipline (§Y) applies to every session.

## 1) Snapshot
- <2-4 bullets: what kind of product this is, core technical goals (performance, latency, offline, etc.), any hard requirements (accounts, connectivity, licensing)>.

## 2) Tech Stack
- **UI / client**: <framework, styling approach, key libraries>.
- **State / persistence**: <client storage approach>.
- **Server**: <backend framework, database, auth approach, third-party integrations (payments, etc.)>.
- **Build & test**: <build tool, test runner, mobile/desktop packaging if any>.

## 3) Repository Layout
Describe each top-level source directory in one line: what it owns, and any hard boundary (e.g. "pure logic, no UI imports").

**`<client-dir>/`**:
- `<subdir>/` <what it owns> · `<subdir>/` <what it owns> · ...

**`<server-dir>/`** (if applicable):
- `<subdir>/` <what it owns> · ...

**Other**: `<migrations-dir>/` <schema changes> · `<tests-dir>/` <test layout convention> · `<scripts-dir>/` <build/seed/maintenance scripts> · `<docs-dir>/` <design docs>.

## 4) Domain Invariants
The load-bearing rules of your domain that are easy to get subtly wrong — the things a new contributor (human or agent) would otherwise have to rediscover by reading five files or hitting a bug. Examples of the *shape* this section should take (replace with your own):
- Numeric/rounding conventions (e.g. "round with `floor()`", "cap X at N").
- State machine invariants (e.g. "empty pool → feature off", "full inventory → auto-bank").
- Anything server-authoritative vs client-trusted at a fine grain that doesn't fit in the security-model section below.
- Cross-references to the single source-of-truth file for each rule, so this section stays a pointer, not a duplicate.

Keep this section a living checklist. When a bug traces back to a rule that wasn't written down, write it down here in the same change that fixes the bug.

## 5) Core Domain Model (if applicable)
Formulas, algorithms, or data models central enough that getting them wrong breaks correctness in ways tests won't obviously catch. Write them as exact, checkable statements (formula, pseudocode, or a link to the one file that implements them) — not prose descriptions that drift from the code.

## 6) Tick / Update Model (if applicable)
If your system has a simulation loop, scheduler, or tick model, document its cadence and the invariants around it here.

## 7) UI/Styling (if applicable)
- Accessibility minimums (tap targets, contrast, etc.).
- Styling system conventions (utility classes vs inline styles, design tokens).
- Where shared components live and the rule for adding new ones.

## 8) Build/Test Commands (Authoritative)
List every script a contributor or agent needs, with what each does, in the order they'd typically run them. Example shape:
- `npm test` → <what it runs>. `npm run build` → <what it produces>. `npm run <lint/typecheck>` → <what it checks>.

**Commit gate (required)** — state the exact command(s) that must pass before a commit. Don't commit with failing checks.

## 9) Generated Output Safety (if applicable)
If any part of the repo is machine-generated and gitignored (a bundled build, a lockfile-like artifact), say so explicitly here: what generates it, why it must never be hand-edited, and what to edit instead.

## 10) Agent Best Practices
- Keep changes minimal and scoped; no unrelated refactors — skill **`scope-fence`** (flag adjacent issues, don't fix them). Update tests alongside logic changes.
- **Skills** (`.claude/skills/`, auto-trigger by description; full inventory in **`SKILLS.md`**): `plan-gate` (novel/multi-system work), `scope-fence`, `memory-hygiene` (editing this file/rules), `ruthless-editor` (public-facing prose), `pr-changelog` (if you publish a changelog). Path-scoped rules live in `.claude/rules/`.
- **Comments: write very few.** Only for a non-obvious invariant/constraint the code can't express. Never narrate what code does, restate the change, or explain reasoning in comments — they cost tokens on every future read and go stale.
- Edit source of truth in `<source dirs>`; generated output follows from build scripts. Never commit generated artifacts.
- Direct user/developer/system instructions outrank this file. Update this guide in the same change when it goes stale.

## 11) <Domain-Specific Section — e.g. Multiplayer/PvP, Payments, Real-time sync>
If a subsystem is complex and high-stakes enough to need its own detailed rules, don't inline them here — put them in a path-scoped rule under `.claude/rules/` (auto-loads only when relevant files are touched) and leave a one-line pointer here. See `.claude/rules/example-rule.md` for the format.

## 12) Security / Trust Model
State plainly what the server (or any trust boundary) treats as authoritative vs what the client is trusted to compute, and why. This is the section most worth getting right and keeping current — ambiguity here is where security bugs hide. Example shape:

**Server-authoritative (never move to client):**
- Identity & auth. High-value grants. Purchases/payments. Anything that mutates shared/competitive state.

**Client-trusted (deliberate, bounded):**
- <what the client computes and why the server doesn't re-derive it>. State the guardrails that exist anyway (e.g. regression checks, replay protection) even though the value itself isn't recomputed server-side.

## 13) Token efficiency (mandatory, every session)
In-session discipline for keeping agent sessions cheap and fast. Deviate only when the user asks for more detail.

**A) Output shaping** (the most-violated rule — obey literally):
- Lead with the answer/result. No preamble, postamble, or restating the question/plan/what you just did.
- Budget ≤6 lines for routine replies; post-edit status is 1–3 lines. Exceed only when asked, or when correctness needs a table/steps/code — then still cut dead sentences.
- Never echo context the user can see (file contents you edited, tool output, diffs, commands, their request) — point to it (`file.js:146`).
- No step narration, no closing recap, no unprompted "what I changed and why".
- One idea per line; cut filler. If a sentence survives deletion without information loss, delete it.

**B) Effort routing**: minimal reasoning on routine/mechanical work; deep reasoning only for novel/ambiguous problems.

**C) Intake reduction**: read narrowly (targeted search, `Read` with offset/limit); prefer file-list results before full-content results; don't re-read files already in context or re-derive known facts; batch independent calls; fetch on demand, not just-in-case.

## 14) Design Context (if applicable)
Pointers to any product/design brief and visual-language docs, and the instruction to read them before UI/UX work.

## 15) PR titles & bodies (if you publish a changelog)
If merged PR titles/bodies auto-publish somewhere public (Discord, a release page, etc.), say so here and point to the `pr-changelog` skill. Non-negotiables regardless of the skill firing: the public voice you want, and a hard ban on any internal attribution, tooling mentions, session/ticket links, or secrets leaking into the title or body.
