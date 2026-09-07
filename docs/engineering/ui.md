# Ui contributor reference

Read for changes in this domain. Code paths are repository-relative; numbered
sections and cross-references use the stable numbering in AGENTS.md. Explicitly
read applicable .claude/rules files when the host does not load them.

## 9) UI/Styling
- Min tap target **44×44px**. Prefer Tailwind utilities + `:root` CSS variables.
- Avoid inline `style={{}}` unless truly dynamic per render. No Tailwind `/N` opacity modifiers — use solid CSS variable colors.
- Reuse `src/components/` before new wrappers. New shared component → register in `build_single.cjs` `sourceFiles`; in-game screens also go in `GAME_CHUNK_FILES` (§12).
- **Read `DESIGN.md` before writing any CSS** (§18) — screens are skinned twice (`.cb-*` iron base + `.forge-shell` parchment override), so a neighbouring rule is never a colour template. Build new surfaces from existing screen classes + `fm-*` kit primitives; a new class of your own carries layout only. `DESIGN.md` §2, the Two-Skin Trap.
- **Themes and item-icon resolution**: path-scoped rule **`.claude/rules/ui-styling.md`** (Claude hosts may auto-load on `src/utils/theme.js`, `src/utils/itemIconResolve.js`, `src/index.css`, and related files).
- **On-screen action animation** (combat swings, skilling motions, monster art): skill **`action-animation`** + `docs/action-animations.md` — timing law, the two live stages, why skilling scales strike count not tempo, and the event-to-swing contract.

## 18) Design Context
`PRODUCT.md` (repo root) is the strategic design brief (register, users, brand personality, anti-references, design principles); `DESIGN.md` (repo root) is the visual language — base parchment/gold/void palette + the piloted FORGEMARK `fm-*` kit, both tokenised in `src/index.css` `:root`. Read both before any UI/UX design work and keep `DESIGN.md` in sync when tokens/kit change. The `/impeccable` skill payload is not yet vendored (`.github/hooks/impeccable.json` expects `.github/skills/impeccable/`) — install via `npx impeccable skills install` locally and commit.

