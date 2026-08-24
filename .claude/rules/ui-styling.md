---
paths:
  - "src/utils/theme.js"
  - "src/utils/itemIconResolve.js"
  - "src/utils/iconTints.js"
  - "src/index.css"
  - "src/data/bespokeIcons.json"
  - "src/data/gameIcons.json"
  - "src/components/GameIcon.jsx"
  - "world/client/src/itemIcon.ts"
  - "tests/theme.test.ts"
  - "tests/itemIconParity.test.ts"
---

# UI Theming & Icon Resolution

Path-scoped rule — auto-loads when touching themes or item-icon resolution.
See `CLAUDE.md` §9 for the pointer and the universal styling rules kept there.

- **Themes**: the game ships light (parchment) + dark (iron) via `data-theme` on `<html>`. Screens read the **semantic layer** (`--surface-*`, `--text-*`, `--hairline`, `--accent*`), never the raw `--fm-*` palette, which is frozen because names like `--fm-parch` are load-bearing in both themes at once. Preference is `light|dark|system` in `src/utils/theme.js`; **localStorage is the authority** (the save is locked during co-op/world, so a mid-fight change would revert) and `settings.theme` is only a cross-device mirror. First paint is stamped by a `<head>` stanza in `build_single.cjs`. Full rules + the always-dark allowlist: `DESIGN.md` §3.1, guarded by `tests/theme.test.ts`.
- **An item has ONE icon, resolved in ONE place**: `resolveItemIcon` (`src/utils/itemIconResolve.js`), used by `GameIcon.jsx` and the open world's `world/client/src/itemIcon.ts`. Order is bespoke art (`bespokeIcons.json`, keyed by item id, `BESPOKE_ALIAS` for variants sharing one body) → the tinted `gameIcons.json` glyph from `getItemIconKey`/`getItemIconTint` → placeholder. **Never give a client its own resolver** — the world had one, and because it stopped at bespoke-or-emoji while `items.json` no longer carries `icon`, every item without hand-authored art rendered a literal "❔" out there. Neither icon map may be imported by the resolver: both are passed in, because the world lazy-loads them on world entry (a static import moves `gameIcons.json`'s 325 KiB into its initial bundle) and the single-file build ships them in the game chunk. Tints are `var(--token)` from `src/index.css`; the world loads no stylesheet and rasterises ground loot from a standalone `data:` SVG, so it resolves each through `resolveIconTint` (`src/utils/iconTints.js`) — new token used by a tint → add it there, `tests/itemIconParity.test.ts` fails on drift from the CSS.
