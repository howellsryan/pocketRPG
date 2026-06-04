# Implementation Plan — Tier-Based Icon Colouring

> **Audience:** an AI agent implementing this end-to-end. Follow the steps **in order**.
> Do not improvise or refactor anything outside the three files named below.
> Every code block here is meant to be pasted **exactly**.

## 1. Goal (what we are building)

Item icons in the game currently get their colour ("tint") from the item's
**type** (weapon → parchment, food → green, etc.). We are adding **tier-based
colouring** so an item's metal/material tier decides its icon colour:

| Tier / item                                          | Colour            | CSS variable          |
| ---------------------------------------------------- | ----------------- | --------------------- |
| Runeforged                                           | very light blue   | `--tier-runeforged`   |
| Dragon                                               | red               | `--tier-dragon`       |
| Bronze                                               | brown             | `--tier-bronze`       |
| Iron                                                 | grey              | `--tier-iron`         |
| Steel                                                | silver            | `--tier-steel`        |
| Mithril                                              | dark blue         | `--tier-mithril`      |
| Adamant                                              | green             | `--tier-adamant`      |
| Cryptbound (all)                                     | black (near)      | `--tier-cryptbound`   |
| Kodai                                                | light blue        | `--tier-kodai`        |
| Robin Hood hat, Rangers tunic, Pathfinder boots      | green             | `--tier-ranger`       |

There is exactly **one** place that decides an item icon's colour: the
`getItemIconTint(item)` function in `src/utils/itemIcons.js`. Every item icon
(`<GameIcon item={...} />`) calls it when no explicit `color` prop is passed, so
editing this one function colours item icons everywhere (inventory, bank,
armoury, item detail panels, drop tables). **You do not need to touch any screen
or component.**

## 2. Files you will edit (only these three)

1. `src/index.css` — add the new tier colour CSS variables.
2. `src/utils/itemIcons.js` — add the tier-tint logic to `getItemIconTint`.
3. `tests/itemIcons.test.ts` — add regression tests.

**Do NOT edit** `index.html` (it is a generated build artifact — never commit it),
any `src/screens/**` or `src/components/**` file, or `src/data/items.json`.

---

## 3. Step 1 — Add CSS variables (`src/index.css`)

Open `src/index.css`. Near the top there is a `:root { ... }` block listing
colour variables. Find this line (it is the last colour variable before the
font variables):

```css
  --color-hp-red: #c0392b;
```

**Immediately after that line**, paste this block:

```css

  /* Equipment tier tints (icon colouring) — see docs/tier-icon-colouring-plan.md */
  --tier-runeforged: #b7e4ff;
  --tier-dragon: #d23b2f;
  --tier-bronze: #b87333;
  --tier-iron: #8c8c8c;
  --tier-steel: #cdd2d8;
  --tier-mithril: #3550c4;
  --tier-adamant: #3aa55f;
  --tier-cryptbound: #3d3d3d;
  --tier-kodai: #4db8e8;
  --tier-ranger: #4a8c3a;
```

> Note on "black": pure `#000000` is nearly invisible on the game's dark icon
> backgrounds, so cryptbound uses a near-black dark grey `#3d3d3d` that still
> reads as black. Do not change it to pure black.

Save the file. Do not touch anything else in this file.

---

## 4. Step 2 — Add tier logic (`src/utils/itemIcons.js`)

Open `src/utils/itemIcons.js`. Near the bottom there is a section that starts
with the comment `// ─── Tint by type ───` and contains a `TYPE_TINT` object
followed by the exported `getItemIconTint` function. You will make **two**
additions in this file.

### 4a. Add the tier table + helper

Find this exact line:

```js
// ─── Tint by type ─────────────────────────────────────────────────────────────
```

**Immediately above that line**, paste this entire block:

```js
// ─── Tier-based equipment tint ────────────────────────────────────────────────
// An item's metal/material tier decides its icon colour so the inventory reads
// at a glance. Matched on the leading segment of the item id. The FIRST matching
// rule wins, so the most specific (named uniques) are checked before the generic
// metal-prefix rules. Returns a CSS color string, or null if the item has no
// tier (so the caller falls back to the type-based tint).
function getTierTint(item) {
  const id = item.id || ''

  // Named uniques (most specific first)
  if (id.startsWith('cryptbound')) return 'var(--tier-cryptbound)'
  if (id.startsWith('kodai'))      return 'var(--tier-kodai)'
  if (id === 'robin_hood_hat' || id === 'rangers_tunic' || id === 'pathfinder_boots') {
    return 'var(--tier-ranger)'
  }

  // Metal / material tier prefixes. Each rule matches ids whose first segment is
  // the tier word (e.g. "bronze_dagger"). `dragon_bones` is excluded so it keeps
  // its bone-grey tint; "dragonstone*" ids never match because they begin with
  // "dragonstone_", not "dragon_".
  if (id.startsWith('runeforged_')) return 'var(--tier-runeforged)'
  if (id.startsWith('dragon_') && id !== 'dragon_bones') return 'var(--tier-dragon)'
  if (id.startsWith('bronze_'))  return 'var(--tier-bronze)'
  if (id.startsWith('iron_'))    return 'var(--tier-iron)'
  if (id.startsWith('steel_'))   return 'var(--tier-steel)'
  if (id.startsWith('mithril_')) return 'var(--tier-mithril)'
  if (id.startsWith('adamant_') || id === 'adamantite_ore') return 'var(--tier-adamant)'

  return null
}

```

### 4b. Call the helper at the top of `getItemIconTint`

Find this exact function header and its first line:

```js
export function getItemIconTint(item) {
  if (!item) return 'var(--color-parchment)'
```

Change it to (add the two new lines after the `if (!item)` guard):

```js
export function getItemIconTint(item) {
  if (!item) return 'var(--color-parchment)'
  // Tier colouring takes priority over the type-based tint below.
  const tierTint = getTierTint(item)
  if (tierTint) return tierTint
```

Leave the rest of `getItemIconTint` (the `currency`/`charm`/`bones`/etc.
overrides and the final `TYPE_TINT` return) exactly as it is. Save the file.

> Why this order works: tier items are equipment, ammo, bars and ores. None of
> the existing special-case overrides below (currency, charm, herb, bones, rune,
> seed, potion) apply to a tier-equipment id, **except** `dragon_bones`, which we
> deliberately exclude from the dragon rule so it still falls through to the
> existing `endsWith('_bones')` rule and stays grey.

---

## 5. Step 3 — Add regression tests (`tests/itemIcons.test.ts`)

Open `tests/itemIcons.test.ts`.

### 5a. Update the import

Find this line:

```ts
import { getItemIconKey } from '../src/utils/itemIcons.js'
```

Replace it with:

```ts
import { getItemIconKey, getItemIconTint } from '../src/utils/itemIcons.js'
```

### 5b. Add a new test block

Find the very last line of the file — it is the closing of the `describe`:

```ts
})
```

(That is the final `})` on the last line of the file.) **After that line**, paste
this entire block:

```ts

describe('getItemIconTint — tier colouring', () => {
  const cases: [string, string][] = [
    ['runeforged_platebody', 'var(--tier-runeforged)'],
    ['dragon_scimitar',      'var(--tier-dragon)'],
    ['dragon_full_helm',     'var(--tier-dragon)'],
    ['bronze_dagger',        'var(--tier-bronze)'],
    ['iron_platebody',       'var(--tier-iron)'],
    ['steel_scimitar',       'var(--tier-steel)'],
    ['mithril_kiteshield',   'var(--tier-mithril)'],
    ['adamant_platelegs',    'var(--tier-adamant)'],
    ['adamantite_ore',       'var(--tier-adamant)'],
    ['cryptbound_gloves',    'var(--tier-cryptbound)'],
    ['kodai_hat',            'var(--tier-kodai)'],
    ['kodai_robe_top',       'var(--tier-kodai)'],
    ['robin_hood_hat',       'var(--tier-ranger)'],
    ['rangers_tunic',        'var(--tier-ranger)'],
    ['pathfinder_boots',     'var(--tier-ranger)'],
  ]

  for (const [id, expected] of cases) {
    it(`${id} resolves to ${expected}`, () => {
      expect(getItemIconTint(itemsData[id])).toBe(expected)
    })
  }

  it('dragon_bones keeps its bone-grey tint (not dragon red)', () => {
    expect(getItemIconTint(itemsData.dragon_bones)).toBe('#a0a0a0')
  })

  it('dragonstone (a gem) is NOT coloured as dragon tier', () => {
    expect(getItemIconTint(itemsData.dragonstone)).not.toBe('var(--tier-dragon)')
  })

  it('returns the parchment fallback for null input', () => {
    expect(getItemIconTint(null)).toBe('var(--color-parchment)')
  })
})
```

Save the file.

---

## 6. Step 4 — Validate (required commit gate)

Run these commands from the repo root, **in order**. Every one must pass before
committing. (This is the project's required commit gate, from `CLAUDE.md` §11.)

```bash
npm test
npm run build
npm run rebuild
npm run check:single
```

If `npm test` reports a failure, **stop and read the failure**:

- If a tier test failed, re-check that you pasted Step 1 and Step 2 exactly
  (a typo in a `var(--tier-...)` name is the most likely cause).
- If the failing test is `every item resolves to a present glyph` or any other
  pre-existing test, you accidentally changed something you should not have —
  re-read Steps 3/4 and revert anything outside `getItemIconTint`.

**Do not commit while any check is failing.** Do not edit a test to make it pass
unless the test itself was mistyped relative to this document.

---

## 7. Step 5 — Commit and push

You are already on the branch `claude/tier-icon-colouring-plan-AgwVv`. Confirm,
stage only the three source files, commit, and push.

```bash
git add src/index.css src/utils/itemIcons.js tests/itemIcons.test.ts
git commit -m "Add tier-based colouring for item icons"
git push -u origin claude/tier-icon-colouring-plan-AgwVv
```

**Important:**
- Do **not** `git add` `index.html` or any other file. If `git status` shows
  `index.html` as modified (the build may regenerate it), do **not** stage it.
- If `git push` fails due to a network error, retry up to 4 times with waits of
  2s, 4s, 8s, 16s between attempts.
- Do **not** open a pull request unless explicitly asked.

---

## 8. Definition of done

- [ ] `src/index.css` has the 10 new `--tier-*` variables.
- [ ] `src/utils/itemIcons.js` has the `getTierTint` helper and calls it at the
      top of `getItemIconTint`.
- [ ] `tests/itemIcons.test.ts` has the new `getItemIconTint — tier colouring`
      describe block and all its tests pass.
- [ ] `npm test`, `npm run build`, `npm run rebuild`, `npm run check:single` all
      pass.
- [ ] The three files are committed and pushed to
      `claude/tier-icon-colouring-plan-AgwVv`.
- [ ] `index.html` was **not** committed.
