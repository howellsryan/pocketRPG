# Item Icon Migration Plan — Emoji → game-icons.net SVGs

> **Status**: Plan / implementation guide. Not yet implemented.
> **Scope (this phase)**: Item icons only (`src/data/items.json`, 911 items). Monsters, skills, prayers, farming, minigames, collection-log, nav and toast icons are a deliberate **follow-up phase** (see §9).

## 1) Decisions (locked)

| Decision | Choice | Notes |
|---|---|---|
| Icon source | **game-icons.net** | ~4,000 fantasy SVGs, **CC BY 3.0** (attribution required). Monochrome, single `<path>`, 512×512 viewBox. |
| Granularity | **Curated + fallback** | Specific glyph per item where one fits; otherwise fall back by `type`/`slot`/`attackStyle`. |
| Visual style | **Monochrome, recolorable** | Tint by item `type`/rarity via existing CSS color tokens (`--color-gold`, `--color-mana`, …). |
| Bundling | **Inline path-data map** | Preserves the offline-first single-file build. No external image requests. |

## 2) Current state (verified)

- Every item in `src/data/items.json` has an `icon` field holding an **emoji string** (e.g. `"icon": "⚔️"`). 911 items; emojis are heavily shared (62 items use 🏹, 58 use ⚔️, etc.).
- Icons are rendered as raw text in `<span>`s at these item-render call sites:
  - `src/components/ItemSlot.jsx:43,53` — `const emoji = item.icon || '📦'` → `<span class={iconSizeClass}>{emoji}</span>`
  - `src/components/ItemDetailPanel.jsx:14` — `<span class="text-[30px] …">{item.icon || '📦'}</span>`
  - `src/components/EquipmentPaperdoll.jsx:37-38` — uses inline `style={{ fontSize: … }}` (px), `{item.icon || '📦'}`
  - `src/screens/BankScreen.jsx:435` — `const emoji = item.icon || '📦'`
  - `src/components/IdleCombatSetupModal.jsx:181,211` — food/potion `{item.icon || …}`
  - `src/screens/SkillingScreen.jsx:764` — `<span class="text-lg">{item.icon}</span>`
  - `src/screens/FarmingScreen.jsx:147` — embeds `item.icon` in JSX
  - `src/screens/CluesScreen.jsx:332,371` — reward rows render `item.icon`
- **String-only** uses (cannot host an SVG node — see §8): `addToast(\`${item.icon} …\`)` style messages in `App.jsx`, `CluesScreen.jsx:134,149`, `FarmingScreen.jsx`, `CombatScreen.jsx`. These build a plain string, so an SVG component can't be interpolated.
- **Build model** (`build_single.cjs`): `tsc` transpiles `src/**` → `dist_tmp/`, then the script concatenates modules and **inlines each data JSON** into a top-level `const` (e.g. `const itemsData = ${itemsJSON}`). `import` lines are stripped, so components reference those globals by name. Output is a single ~1.8 MB `index.html` (which is **git-ignored** — a build artifact; never committed). Preact/Tailwind/fonts already load from CDN.
- **Precedent to mirror**: `src/utils/prayerIcons.js` is a centralized icon-resolution helper shared across screens. We replicate this pattern for items.
- No existing test asserts the `icon` field. We will add one (§7).

## 3) Target architecture

Four small, codebase-idiomatic pieces:

```
src/data/gameIcons.json        ← asset store: { "<glyphKey>": "<svg path d>", … } (only used glyphs)
src/utils/itemIcons.js         ← resolver: getItemIconKey(item) → glyphKey (curated → fallback)
src/components/GameIcon.jsx     ← renderer: <svg viewBox="0 0 512 512">…<path fill="currentColor"/>
items.json                     ← add optional "iconId" (glyphKey) to curated items
```

**Data flow:** `item` → `getItemIconKey(item)` (uses `item.iconId`, else fallback table) → `gameIconsData[key]` (path string) → `<GameIcon>` renders the SVG, tinted by `item.type`/rarity.

### Why a path-data map (not external files / sprite files)
- The single-file build inlines data; external `.svg` files or `<img src>` would break offline-first and add network requests.
- A JS/JSON map of `d` strings stores each glyph **once**, referenced by key — no duplication even though 911 items map onto ~150–300 unique glyphs.
- game-icons glyphs are single-path and compact (~1–3 KB each). Bundle cost ≈ Σ(unique used glyphs) ≈ **200–500 KB** added to `index.html`. This is the main tradeoff — see §10.

## 4) The asset store: `src/data/gameIcons.json`

Shape — keys are our own stable glyph names, values are the raw `d` attribute from the game-icons 512×512 SVG:

```json
{
  "sword":  "M...Z",
  "dagger": "M...Z",
  "bow":    "M...Z",
  "potion": "M...Z",
  "helmet": "M...Z"
}
```

**Do not hand-copy SVGs.** Use Iconify's machine-readable game-icons set as the source and extract only the glyphs we reference, via a one-off build script (`scripts/build-game-icons.cjs`):

1. `npm i -D @iconify-json/game-icons` (dev-only; not shipped).
2. Read the set JSON, look up each glyph key listed in `src/data/gameIconsManifest.json` (the curated list of game-icons names we use, e.g. `plain-dagger`, `broadsword`, `potion-ball`).
3. Iconify stores `body` (`<path …/>`) and an icon-level `viewBox`. Normalize to a single `d` (or store `body` verbatim if multi-element) and a per-icon viewBox if not 512. Write `src/data/gameIcons.json`.
4. The script also emits/refreshes `NOTICE` attribution (author per icon) — see §6.

> Keeping a `gameIconsManifest.json` (our-key → game-icons-name) means re-running the extractor is deterministic and the JSON of path data is fully regenerable. Commit both the manifest and the generated `gameIcons.json`.

## 5) Resolver + renderer

### `src/utils/itemIcons.js` (mirror of `prayerIcons.js`)

```js
import gameIconsData from '../data/gameIcons.json'

// Fallback glyph by item type, then slot/attackStyle. Tune during curation.
const TYPE_FALLBACK = {
  currency: 'coins', resource: 'ore', food: 'meat',
  ammo: 'arrow', weapon: 'sword', armour: 'breastplate', default: 'box'
}
const SLOT_FALLBACK = {
  head: 'helmet', body: 'breastplate', legs: 'legs', feet: 'boots',
  hands: 'gloves', cape: 'cape', neck: 'amulet', ring: 'ring',
  shield: 'shield', ammo: 'arrow', weapon: 'sword'
}
const STYLE_FALLBACK = { stab: 'dagger', slash: 'sword', crush: 'mace' }

export function getItemIconKey(item) {
  if (!item) return 'box'
  if (item.iconId && gameIconsData[item.iconId]) return item.iconId
  if (item.slot && SLOT_FALLBACK[item.slot]) return SLOT_FALLBACK[item.slot]
  if (item.attackStyle && STYLE_FALLBACK[item.attackStyle]) return STYLE_FALLBACK[item.attackStyle]
  return TYPE_FALLBACK[item.type] || TYPE_FALLBACK.default
}

// Tint by type/rarity → existing CSS color tokens.
const TYPE_TINT = {
  currency: 'var(--color-gold)', weapon: 'var(--color-blood-light)',
  armour: 'var(--color-mana-light)', food: 'var(--color-emerald-light)',
  resource: 'var(--color-gold-dim)', ammo: 'var(--color-parchment)',
  default: 'var(--color-parchment)'
}
export function getItemIconTint(item) {
  return TYPE_TINT[item?.type] || TYPE_TINT.default
}
```

Register `utils/itemIcons.js` in `build_single.cjs` `sourceFiles` in the utils block (next to `utils/prayerIcons.js`).

### `src/components/GameIcon.jsx`

```jsx
import gameIconsData from '../data/gameIcons.json'
import { getItemIconKey, getItemIconTint } from '../utils/itemIcons'

// `size` accepts a number (px) or a tailwind size class via `class`.
export default function GameIcon({ item, iconKey, size = 24, color, class: cls = '', title }) {
  const key = iconKey || getItemIconKey(item)
  const d = gameIconsData[key]
  // Graceful fallback: un-curated/missing glyph → render legacy emoji text.
  if (!d) return <span class={cls} style={{ fontSize: typeof size === 'number' ? `${size}px` : null }}>{item?.icon || '📦'}</span>

  const fill = color || (item ? getItemIconTint(item) : 'currentColor')
  const px = typeof size === 'number' ? size : undefined
  return (
    <svg viewBox="0 0 512 512" width={px} height={px} class={cls}
         role="img" aria-label={title || item?.name || ''} fill={fill}>
      {title || item?.name ? <title>{title || item.name}</title> : null}
      <path d={d} />
    </svg>
  )
}
```

Register `components/GameIcon.js` in `build_single.cjs` `sourceFiles` **before** `components/ItemSlot.js`.

> The legacy-emoji fallback inside `GameIcon` is intentional: it lets us land the infra and curate incrementally without any item rendering blank. Remove it once curation is complete (§9, Phase 3).

## 6) Licensing / attribution (CC BY 3.0 — required)

- Add a `NOTICE` file at repo root listing game-icons.net, the CC BY 3.0 link, and per-glyph author credits (emitted by the extractor script in §4).
- Add a short credits line to `src/screens/HelpScreen.jsx` (Help/About): "Item icons by game-icons.net (CC BY 3.0)." with the per-author list or a link to `NOTICE`.
- Do **not** add the dev dependency or the manifest to the shipped bundle beyond the generated `gameIcons.json`.

## 7) Tests (regression gate)

Add `tests/itemIcons.test.ts` (logic-only, runs under `npm run test:logic`):

1. **Every item resolves to a present glyph**: for each item in `items.json`, `gameIconsData[getItemIconKey(item)]` is defined. (Catches missing fallback glyphs and typo'd `iconId`s.)
2. **No dangling `iconId`**: every `item.iconId`, when set, exists in `gameIconsData`.
3. **No orphan glyphs** (optional, warn-only): every key in `gameIconsData` is referenced by some item or the fallback tables — keeps the bundle lean.
4. **Path sanity**: every value in `gameIconsData` is a non-empty string starting with `M`/`m`.

This makes "every item has a working icon" enforceable in CI (`npm run ci` already gates the build).

## 8) Known wrinkle: string-context emojis

SVG components can only replace emojis **inside JSX render trees**. They cannot be interpolated into plain strings such as `addToast(\`${item.icon} ${item.name}\`)` (`App.jsx`, `CluesScreen.jsx:134,149`, `FarmingScreen.jsx`, combat toasts).

**Phase-1 rule:** migrate only the JSX render sites listed in §2 to `<GameIcon>`. Leave `item.icon` (emoji) in place for string/toast contexts and as `GameIcon`'s fallback. A later phase can extend the `Toast` API to accept an icon node if we want SVGs there too (out of scope now).

## 9) Phased rollout

- **Phase 0 — Infrastructure (no visual change risk).**
  - Add dev dep + `scripts/build-game-icons.cjs` + `gameIconsManifest.json` (seed with the ~20 fallback glyph names).
  - Generate `src/data/gameIcons.json`; add `gameIcons.js` resolver + `GameIcon.jsx`.
  - Wire `build_single.cjs`: inline `gameIcons.json` (add `readSrc('data/gameIcons.json')` + `const gameIconsData = …`) and register the new util/component in `sourceFiles`.
  - Add the test from §7. Convert **one** render site (`ItemSlot.jsx`) to `<GameIcon>` to validate end-to-end (dev build + single-file build + `check:single`).
- **Phase 1 — Curation + render-site migration.**
  - Generate a draft `iconId` for all 911 items via a heuristic script (name/type keyword → game-icons name), then hand-curate high-visibility items (starter gear, common drops, currencies, potions, food, logs/ores/bars, runes, ammo). Expand `gameIconsManifest.json` accordingly and regenerate `gameIcons.json`.
  - Migrate all JSX render sites in §2 to `<GameIcon>` (note `EquipmentPaperdoll` uses px sizing — pass `size={preset.iconPx}`).
  - Keep emoji as fallback. Ship.
- **Phase 2 — Other surfaces (separate PR, out of current scope).** Monsters, prayers, farming crops, minigames, collection-log, nav/burger, toast icons.
- **Phase 3 — Cleanup.** Once coverage is complete, drop `GameIcon`'s emoji fallback and remove legacy `icon` fields (or keep solely for string/toast contexts per §8).

## 10) Risks & mitigations

| Risk | Mitigation |
|---|---|
| Bundle size growth (~200–500 KB) in single-file `index.html` | Bundle **only used** glyphs (manifest-driven); single-path monochrome icons are small; `check:single` reports KB — review before/after. |
| game-icons lacks tier variants (bronze vs iron dagger share a glyph) | Accepted by "curated + fallback"; differentiate tiers via **tint** (§5) and the quantity/name labels already shown in `ItemSlot`. |
| Attribution non-compliance (CC BY 3.0) | `NOTICE` + Help/About credit are required deliverables (§6). |
| `index.html` is git-ignored | Correct — never commit it. Verify changes via `npm run dev` and `npm run rebuild` locally. |
| Curating 911 `iconId`s is large | Script-generate a draft, curate by visibility; tests guarantee no item renders blank regardless of curation depth. |
| viewBox differences in some game-icons | Extractor normalizes/stores per-icon viewBox; `GameIcon` defaults to 512 but can read an optional per-glyph viewBox if we store one. |

## 11) File-change checklist (for the implementing agent)

- [ ] `package.json` — add devDep `@iconify-json/game-icons`.
- [ ] `scripts/build-game-icons.cjs` — extractor (manifest → `gameIcons.json` + `NOTICE`).
- [ ] `src/data/gameIconsManifest.json` — our-key → game-icons-name map.
- [ ] `src/data/gameIcons.json` — generated path-data store.
- [ ] `src/utils/itemIcons.js` — resolver + tint helpers.
- [ ] `src/components/GameIcon.jsx` — renderer.
- [ ] `src/data/items.json` — add `iconId` to curated items (script draft + manual pass).
- [ ] Render sites → `<GameIcon>`: `ItemSlot.jsx`, `ItemDetailPanel.jsx`, `EquipmentPaperdoll.jsx`, `BankScreen.jsx`, `IdleCombatSetupModal.jsx`, `SkillingScreen.jsx`, `FarmingScreen.jsx`, `CluesScreen.jsx`.
- [ ] `build_single.cjs` — inline `gameIcons.json`; register `utils/itemIcons.js` + `components/GameIcon.js` in `sourceFiles`.
- [ ] `tests/itemIcons.test.ts` — coverage + sanity gate.
- [ ] `NOTICE` + `HelpScreen.jsx` credit line.
- [ ] Gate: `npm test && npm run build && npm run rebuild && npm run check:single` (or `npm run ci && npm test`).
```
