# Mobile Combat Screen — Redesign Implementation Guide

> **Scope: MOBILE ONLY.** This guide redesigns the mobile combat experience to
> match the artsy fantasy direction already shipped for the Home Screen (PR #536)
> and described in the Claude Design handoff. **Desktop combat must not change.**
> Every change is gated so the existing `isDesktopCombatLayout` (≥1250×600) render
> path is byte-for-byte unaffected.

---

## 0. Source material

The design was produced in Claude Design and handed off as an HTML/CSS/JS
prototype. The authoritative intent lives in the chat transcript and these
prototype files (for reference only — **do not copy verbatim**, they are React 18
+ Babel + Iconify-CDN mocks, not Preact):

- `Combat Screen.html` — mobile shell + all `cb-*` CSS (the visual spec).
- `combat-mobile.jsx` — mobile component tree (select / combat / info / raid / idle sheets).
- `combat-core.jsx` — shared helpers: `ItemArt` (masked gradient art), `HpBar`, `StyleChip`, `DropTable`, `StatGrid`, `useCombatSim`, `Celebration`.
- `combat-data.js` — mock world data (icon names, stats). Useful only as an icon/intent reference.

Confirmed answers from the design chat (chat2.md):

- **Format:** mobile phone **and** desktop — but this task is mobile only.
- **Combat model:** idle / auto-battle (watch it play out, tweak settings). Death is prevented while food is equipped.
- **Info content:** combat stats + max hit, attack style & weakness, full drop table with rates.
- **Raids:** multi-stage boss-room progression, unique reward table, best/avg time + KC.
- **Loud moment:** big celebration on rare drop / boss kill.
- **Variations:** one polished direction (no A/B).
- **Art:** reuse the masked game-icons treatment, consistent with Home.

---

## 1. Design language to inherit (already real in the codebase)

PR #536 shipped the exact system in production Preact. Reuse it — do **not**
reinvent:

| Concern | Existing asset | Notes |
|---|---|---|
| Colour tokens | `src/index.css` `:root` | `--color-gold #d4a017`, `--color-gold-light #f0c040`, `--color-parchment #f5e6c8`, `--color-void`, `--color-xp-bar #3cb043`, blood/mana tokens. |
| Fonts | `--font-display` Cinzel, `--font-body` Nunito, `--font-mono` JetBrains Mono | Already loaded. |
| Masked gradient art | `src/components/SkillEmblem.jsx` + `src/utils/skillArt.js` | `skillEmblemMask(iconKey)` builds an **offline** `mask-image` from `gameIcons.json`; `skillArtTreatment(accent)` returns the metallic gradient + glow. This is the design's `ItemArt`/`artLook`, already ported. |
| SVG glyphs | `src/components/GameIcon.jsx` + `src/data/gameIcons.json` | Inline SVG, offline. |
| CSS card/emblem/xp classes | `src/index.css` (`.skill-card`, `.skill-emblem`, `.xp-track/.xp-fill`, `.welcome-card`, `.hero-band`, `.section-head`, `.rune-btn`) | Pattern to mirror for combat. |
| Reward celebration | `src/components/RewardRevealOverlay.jsx` (+ `src/utils/rewardReveal.js`) | Already used by `App.jsx`. Prefer this over the design's bespoke `Celebration` for the "loud & proud" rare-drop moment. |

**Offline-first rule (CLAUDE.md §2, §1 experience goals):** the prototype loads
icons from `api.iconify.design`. **Do not.** All glyphs must be vendored into
`src/data/gameIcons.json` and rendered via `GameIcon` / `SkillEmblem`.

---

## 2. Architecture & the desktop firewall

All combat UI lives in **`src/screens/CombatScreen.jsx`** (~2,750 lines). It is a
single component with shared JSX branched by **`isDesktopCombatLayout`** (local
state, set true when `window.innerWidth >= 1250 && window.innerHeight >= 600`;
see lines ~220 and ~284–298). Note this is *separate* from the global
`useIsDesktop()` hook (768px) — combat uses its own 1250px gate.

**The firewall rule for this task:**

1. Any new markup must render **only when `!isDesktopCombatLayout`**, OR be a drop-in
   restyle of a block that is already mobile-exclusive (e.g. the mobile action
   button grid at ~2182–2257, already wrapped `${isDesktopCombatLayout ? 'hidden' : 'flex'}`).
2. Do **not** edit the desktop-only branches: the 3-col grid (`grid-cols-[minmax(220px,1fr)…]`, ~1870),
   the inventory pane (`${isDesktopCombatLayout ? 'flex' : 'hidden'}`, ~1984),
   the inline gear paperdoll (~1938), or inline prayer toggles (~2017–2109).
3. The **monster/raid picker** (~1450–1661) currently uses a *responsive Tailwind grid*
   (`md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`) shared by both. To keep desktop
   identical, split it: render the **new artsy mobile picker when the viewport is
   below the desktop combat breakpoint**, and keep the **existing picker markup for
   md+ / desktop**. The cleanest seam is a `isDesktopCombatLayout` branch around the
   picker body, mirroring the combat-view pattern. (Desktop already shows the
   responsive grid; preserve it byte-for-byte.)
4. Modals/sheets (info, raid, idle setup, loot) are shared by both layouts today.
   Restyling them changes desktop too. **Decision needed (see §9): either (a) keep
   modal chrome shared and only restyle the inner content lightly, or (b) gate a
   new slide-up sheet to mobile and leave the desktop `Modal` path untouched.**
   Recommended: **(b)** — introduce the mobile slide-up sheet behind `!isDesktopCombatLayout`,
   keep the existing `<Modal>` render for desktop.

### Functionality that MUST be preserved (do not touch the handlers)

These are wired to real game state via `useGame()` and the tick engine. Restyle
the *presentation*, keep the *handlers/props*:

| Feature | Handler / state | Line ~ |
|---|---|---|
| Start a fight | `startFight(monster)` | 1544 |
| Start a raid | `startRaid(raid)` | 1631 |
| Stance | `updateCombatStance(s)`, `combatStance` | 1494–1503 |
| Idle setup open | `setIdleSetupMode('food'|'prayer'|'potion')` → `IdleCombatSetupModal` | 1459–1490, 1690 |
| Monster info | `setSelectedMonsterInfo(monster)` | 1593 |
| Raid info | `setSelectedRaidInfo(raid)` | 1649 |
| Lock checks | `checkBossRequirements`, `checkRaidRequirements`, `getSlayerLevel`, slayer task match | 1535–1579 |
| KC display | `bossKillCounts`, `raidKillCounts` | 1587, 1644 |
| Back out of fight | `stopAndBack()` | 1050, 1858 |
| Eat | `handleEatItem(itemId)` | 1063 |
| Potion | `handlePotion(itemId)` | 1131 |
| Equip / gear | `handleEquipItem(itemId)`, equipment modal | 1194 |
| Special attack | `handleSpecialAttack()` (real — has energy/cost) | 1103 |
| Cast spell | `setShowSpellModal(true)` (magic weapon only) | 1958 |
| Prayer | `handlePrayer(prayerId)`, prayer modal | 1285 |
| Rare-drop critical save | `requestCriticalPushSave(..., RARE_DROP)` | 911 |
| Live HP bars | `HPBar` (monster + player), `combat.monster.currentHP`, `currentHP`, `getMaxHP()` | 1891, 1922 |
| Combat log / kills / kills-hr | existing log ref + kill stats | 2143–2174 |
| PvP | `PvpCombatScreen`, `PvpLobbyModal`, error boundary | 1440, unchanged |

> ⚠️ The design's `Gear / Special / Cast` were placeholders. In the real app
> **Special and Cast are fully functional** (energy cost, magic-only gating). Keep
> them functional — restyle only.

---

## 3. Icon strategy (the largest data task)

The prototype references ~50 game-icons glyphs by hyphenated name
(`dragon-head`, `death-skull`, `wyvern`, `temple-gate`, `potion-ball`, …). Our
offline `gameIcons.json` currently holds only the **99 skill-set glyphs** (keys are
**underscored**, e.g. `crossed_swords`). Most combat glyphs are **missing** and
monsters carry only **emoji** today (`MONSTER_ICONS` map at line 129; categories
`.icon` at 37–127; raids `raid.icon`).

### 3a. Vendor the missing glyphs

Follow the existing pipeline in `docs/game-icons-migration-plan.md` and the shape
of `src/data/gameIcons.json` (`{ "<key>": { "viewBox": "...", "body": "<svg paths>" } }`).
Add the glyphs below (download from game-icons.net, normalise to underscored keys,
strip to `<path>` bodies). Group into a clear PR section.

**UI / chrome glyphs**

| Need | Suggested key | Used for |
|---|---|---|
| Info | `info` | monster/raid info buttons |
| Play | `play_button` | boss/raid "enter" affordance |
| Fast-forward | `fast_forward_button` | Skip 1h pill |
| Diamond | `cut_diamond` | gems pill |
| Check | `check_mark` | idle-on indicator, raid requirements |
| Cancel | `cancel` | sheet close |
| Gears | `gears` | Gear action |
| Lightning | `lightning_arc` | Special action |
| Meat | `meat` | Eat action / food |
| Potion | `potion_ball` | Potion action |

(Existing & reusable: `crossed_swords`, `death_skull`, `flame`, `prayer`,
`crystal_ball`, `hearts`, `shield`, `muscle_up`, `high_shot`, `rune_stone`?→verify.)

**Attack-style / weakness glyphs (chips)**

| Style | Key | Colour |
|---|---|---|
| Melee | `gladius` | `#e0564b` |
| Ranged | `high_shot` | `#7bbf52` |
| Magic | `crystal_ball` | `#9b6cff` |

**Monster / category / raid emblems** — the big set. **Decided: author a unique
glyph for all 98 monsters** (maximum polish). The category map below is still
required as the **fallback chain** (covers any monster missing art, new monsters
added later, and category headers themselves), but every current monster in
`MONSTER_ART` should get its own glyph key. Practically: vendor a distinct
game-icons.net glyph per `monsters.json` id and list it in `MONSTER_ART`
(`monsterId -> { icon, accent }`); use the area accent unless a monster reads
better with its own. Suggested category mapping (fallback + headers):

| Category (`COMBAT_CATEGORIES.key`) | Accent | Glyph key |
|---|---|---|
| `training` | `#cdd6e0` | `crossed_swords` |
| `slayer` | `#c0453b` | `death_skull` |
| `bossing` (God Wars) | `#d8b13a` | `crowned_skull` |
| `dagganoth_kings` (Nagadoth) | `#e0564b` | `horned_skull` |
| `wilderness` | `#8a7ae6` | `spectre` |
| `dragons_lair` | `#46a7c4` | `dragon_head` |
| `venomcoil_matriarch` | `#3fb56b` | `wyvern` |
| `fight_caves` (Ember Pits) | `#ef6b3a` | `flame` |
| `blighted_gauntlet` | `#46a0e0` | `lightning_arc` |
| `sunken_crypts` | `#7f8c95` | `dungeon_gate` |
| `ashveil_highlands` | `#8db04a` | `cut_palm` |
| `ironhold_fortress` | `#9aa3ac` | `anvil` |
| `verdant_wilds` | `#5fae5f` | `wolf_trap` |

Raids (`raids.json`): map each `raid.id` to a glyph (`temple_gate`,
`ancient_columns`, `stone_tower`, …) + the violet raid accent `#9b6cff`.

> **Effort note (decided scope):** authoring ~98 per-monster glyphs + the
> category/raid/UI/style glyphs is the bulk of the work — budget for it. Vendor in
> batches by category, verify each renders offline, and keep the category-fallback
> chain so the screen is never blank if a glyph is missed. This is the single
> largest line item in the redesign; consider splitting glyph-vendoring into its
> own PR ahead of the UI work.

### 3b. Add a combat-art resolver util

Mirror `src/utils/skillArt.js`. Create `src/utils/combatArt.js`:

```js
import gameIcons from '../data/gameIcons.json'

export const CATEGORY_ART = { /* key -> { icon, accent } from table above */ }
export const MONSTER_ART  = { /* monsterId -> { icon, accent } overrides (bosses first) */ }
export const RAID_ART     = { /* raidId -> { icon, accent } */ }
export const STYLE_ART     = {            // attackStyle -> chip glyph + colour
  stab:  { icon: 'gladius', color: '#e0564b' },
  slash: { icon: 'gladius', color: '#e0564b' },
  crush: { icon: 'gladius', color: '#e0564b' },
  ranged:{ icon: 'high_shot', color: '#7bbf52' },
  magic: { icon: 'crystal_ball', color: '#9b6cff' },
}

// monster -> { icon, accent } with category fallback, then a neutral default
export function getMonsterArt(monster, categoryKey) {
  return MONSTER_ART[monster.id]
    || CATEGORY_ART[categoryKey]
    || { icon: 'crossed_swords', accent: '#cdd6e0' }
}
```

Reuse `skillEmblemMask` + `skillArtTreatment` from `skillArt.js` (or factor them
into a shared `art.js` if you prefer; keep `SkillEmblem` working). The combat
emblem can literally be `<SkillEmblem iconKey={art.icon} accent={art.accent} … />`.

---

## 4. Real-data field mapping (prototype → game data)

The prototype's mock fields differ from `monsters.json` / `raids.json`. Map them:

| Prototype (`combat-data.js`) | Real source | Notes |
|---|---|---|
| `mon.hp` | `monster.hitpoints` | |
| `mon.att` | `monster.stats.attack` | |
| `mon.def` | `monster.stats.defence` | |
| `mon.cb` | `monster.combatLevel` | |
| `mon.maxHit` | derive via engine | use the same max-hit calc the combat engine uses; or read from combat state once a fight starts. For the info sheet, compute from `monster.stats.strength` + `strengthBonus` per CLAUDE.md melee formula, or surface the engine's value. |
| `mon.style` | `monster.attackStyle` (`stab/slash/crush/ranged/magic`) | map stab/slash/crush → "Melee" label via `STYLE_ART`. |
| `mon.weakness` | **derive at runtime** (decided) | Compute from `monster.defenceBonus` — the **lowest** of `stab/slash/crush/(melee group)`, `ranged`, `magic` is the weakness. Collapse stab/slash/crush into a single "Melee" weakness. No `monsters.json` change. Add a helper `getMonsterWeakness(monster)` in `combatArt.js` returning `'melee'|'ranged'|'magic'`, mapped to a chip via `STYLE_ART`. |
| `mon.kc` | `bossKillCounts[id]` / slayer counts | already available. |
| `mon.drops` | `monster.drops[]` (`itemId`, `quantity`, `chance`) | resolve names/icons through `itemsData[itemId]`; render rates as `%`. |
| `mon.unique` | derive from drops flagged rare, or from collectionLog uniques | the prototype's gilded "Unique Drop" panel can group the lowest-chance / boss-unique drops. Confirm grouping rule (§9). |
| raid `rooms/bosses` | `raid.bosses[]` → `monstersData[bossId]` | progression timeline. |
| raid `bestTime/avgTime/kc` | `raidKillCounts[raid.id]` (decided) | **Hide the Best/Average time tiles** — timing isn't tracked and we're not adding telemetry. Show only the **Completions (KC)** tile from `raidKillCounts[raid.id]`. Keep the tile grid layout balanced for a single stat (or center it). |

---

## 5. CSS — add a mobile combat block to `src/index.css`

Append a self-contained section after the Home Screen block, mirroring the
prototype's `cb-*` classes but using repo CSS vars. Keep it scoped with a `cb-`
prefix to avoid clashes (and so it can be unit-checked by `npm run check:single`).
Port these class clusters from `Combat Screen.html`:

- **Toolbar:** `.cb-top`, `.cb-pill`, `.cb-pill--skip/--gem`, `.cb-top__hp`.
- **Headings:** `.cb-h1` (gold gradient text), `.cb-h1sub`.
- **Idle row:** `.cb-idlerow`, `.cb-idle`, `.cb-idle.is-on`, `.cb-idle__chk`.
- **Stance selector:** `.cb-styles`, `.cb-styleseg`, `.cb-styleseg.is-on` (gilded).
- **Area list:** `.cb-area`, `.cb-area--raid`, `.cb-area__head/__glow/__icon/__txt/__name/__blurb/__count/__raidtag/__chev`, `.cb-chev`.
- **Monster row:** `.cb-mon`, `.cb-mon__art/__body/__name/__stats/__meta/__cb/__kc/__info`.
- **Fight view:** `.cb-back`, `.cb-fight__head/__id/__name/__chips/__cb`, `.cb-hpblock`, `.cb-hplabel`, `.cb-logwrap`, `.cb-logline` (+ `--sys/--hit/--dmg/--eat/--kill/--loot/--unique`), `.cb-kstats`, `.cb-kstat`, `.cb-actions`, `.cb-act` (+ `--green/--violet/--dim`), `.cb-killflash`.
- **Sheets:** `.cb-overlay`, `.cb-sheet`, `.cb-sheet--raid/--idle`, `.cb-sheet__grab/__hero/__emblem/__glow/__name/__sub/__chips/__scroll/__sec`.
- **Raid sheet:** `.cb-raid__tag/__times/__time/__tk/__tv`, `.cb-rooms`, `.cb-room` (+ rail/dot/line/icon/body/right/status), `.cb-reqs`, `.cb-req`, `.cb-raid__enter`.
- **Idle sheet:** `.cb-idlehead`, `.cb-x`, `.cb-idledesc`, `.cb-idlelist`, `.cb-fooditem` (+ art/body/name/heal/sub/btn), `.cb-done`.
- **Shared (from `combat-core.jsx` CSS):** `.cb-stylechip`, `.cb-hp/__fill/__sheen/__txt`, `.cb-drops/__row`, `.cb-unique*`, `.cb-statgrid/.cb-stat`.

Substitutions when porting:
- Replace literal `#f5e6c8`/`#d4a017`/etc. with `var(--color-parchment)` / `var(--color-gold)` where a token exists (per CLAUDE.md §9 — prefer tokens, no `/N` opacity modifiers, use solid vars).
- Drop the `.phone`/`.notch`/`.statusbar` shell — that's the prototype's device frame; the real app already renders inside its own chrome.
- Min tap target 44×44 (CLAUDE.md §9): the info button (`.cb-mon__info` 34px in the proto) must grow to ≥44px, and idle/stance/action buttons need ≥44px height.
- Respect existing scrollbar styling already in `index.css`.

---

## 6. Components — reuse first, then add minimal shared pieces

Per CLAUDE.md §9, reuse `src/components/` before inventing wrappers.

- **Reuse:** `SkillEmblem` (monster/area emblems & glow), `GameIcon` (chips, pills,
  drop rows), `HPBar` (already used), `Modal` (desktop path), `IdleCombatSetupModal`
  (idle config — already feature-complete), `RewardRevealOverlay` (celebration).
- **Add (only if needed), small & registered in `build_single.cjs`:**
  - `components/CombatStyleChip.jsx` — the style/weakness chip (proto `StyleChip`).
  - `components/DropTable.jsx` — drop rows + gilded unique panel (proto `DropTable`),
    if the inline JSX in the info sheet grows too large.
  - A mobile `CombatSheet.jsx` slide-up wrapper (proto `.cb-sheet`) **gated to mobile**,
    if you choose §2 decision (b).
- **Single-file build safety (CLAUDE.md §12):** every new top-level component must
  have a globally-unique name and be appended to the `sourceFiles` array in
  `build_single.cjs` (the components block at lines ~86–109, keep ordering
  conventions: e.g. after `SkillEmblem.js`). Then `npm run check:single` must pass.

---

## 7. Step-by-step implementation phases

Each phase is independently shippable and keeps desktop untouched.

**Phase 0 — Foundations (no UI change)**
1. Vendor glyphs into `gameIcons.json` (§3a). Verify each renders via a throwaway
   `GameIcon` check (don't commit the harness).
2. Add `src/utils/combatArt.js` (§3b) with category/raid/style maps + fallback.
3. Append the `cb-*` CSS block to `src/index.css` (§5).
4. `npm run check:single` + `npm test` to confirm nothing regressed.

**Phase 1 — Mobile monster/raid select**
5. Wrap the picker body (lines ~1453–1661) so that **mobile** renders the new
   artsy layout and **desktop keeps the current responsive grid**. New mobile markup:
   - `.cb-h1` "Choose a Monster" + `.cb-h1sub` count (`monsterCount`/`raidCount` equivalents from real data).
   - `.cb-idlerow` → the three idle toggles, still calling `setIdleSetupMode('food'|'prayer'|'potion')`; show `is-on` state from `idleCombatSetup`.
   - `.cb-styles` stance selector → still `updateCombatStance`.
   - `.cb-arealist` of `.cb-area` rows from `COMBAT_CATEGORIES`; expand/collapse via existing `toggleSection`/`collapsedSections`. Single-boss & raid areas get a play affordance; multi-monster areas expand into `.cb-mon` rows.
   - `.cb-mon` rows → `startFight(monster)` on row tap, `.cb-mon__info` → `setSelectedMonsterInfo`. **Preserve** lock/slayer/TASK/KC logic exactly (1535–1589).
   - Raids list → `.cb-area--raid`; tap opens `setSelectedRaidInfo` (info) and the "Enter Raid" CTA in the sheet calls `startRaid`. Keep PvP entry block (1664) unchanged below.
6. Verify desktop picker pixel-identical (resize ≥1250px); verify all locks/KC/slayer badges still show.

**Phase 2 — Mobile live combat view**
7. Restyle the mobile (`!isDesktopCombatLayout`) portions of the combat view
   (1856–2259) only: back button, fight header with emblem + style/weakness chips +
   CB→info, two `.cb-hpblock` HP bars (reuse `HPBar` or the `.cb-hp` markup),
   `.cb-logwrap` log, `.cb-kstats`, `.cb-actions` grid.
8. The action grid replaces the existing mobile button rows (the block already
   `${isDesktopCombatLayout ? 'hidden' : 'flex'}`): Eat→`handleEatItem` path,
   Potion→`handlePotion`/modal, Gear→equipment modal, Special→`handleSpecialAttack`
   (gate on weapon spec + energy, **keep functional**), Cast→`setShowSpellModal`
   (magic-only), Prayer→prayer modal. Tone classes `--green/--violet/--dim` per state.
9. Keep raid-progress indicator (1895) and slayer indicator (1926) — restyle to match.

**Phase 3 — Sheets (mobile slide-ups)**
10. Per §2 decision (b): render mobile slide-up sheets when `!isDesktopCombatLayout`,
    keep `<Modal>` for desktop. Sheets to build:
    - **Info sheet** (`.cb-sheet`): hero emblem + name + style/weakness chips,
      `.cb-statgrid` (CB/HP/MaxHit/Att/Def/KC), `Drop Table` + gilded `Unique` panel.
    - **Raid sheet** (`.cb-sheet--raid`): best/avg/KC tiles, `.cb-rooms` chamber
      timeline from `raid.bosses`, requirements chips, reward table, "Enter Raid" → `startRaid`.
    - **Idle sheet:** prefer keeping `IdleCombatSetupModal` (already complete) but,
      if restyling, present food/potion/prayer pickers with `.cb-fooditem` rows.
      Don't change its selection state shape (`idleCombatSetup`).

**Phase 4 — Loud & proud celebration**
11. On rare drop / boss kill (the existing `RARE_DROP` critical-save path, ~911,
    and `MONSTER_KILL`), fire `RewardRevealOverlay` (already wired in `App.jsx` via
    `rewardReveal.js`). Confirm the trigger event exists in the combat tick events;
    reuse the existing reveal rather than the prototype's `Celebration`. If a
    bespoke gold-rays celebration is wanted, port `combat-core.jsx`'s `Celebration`
    as `components/CombatCelebration.jsx` (mobile-gated) — but reuse is preferred.

**Phase 5 — QA & gate**
12. Run the full commit gate (§8). Manually verify the acceptance list (§10).

---

## 8. Build / test / commit gate (CLAUDE.md §11, §12)

Before any commit:

```
npm test && npm run build && npm run rebuild && npm run check:single
# or: npm run ci && npm test
```

- `npm run rebuild` regenerates the single-file `index.html` — **do not** hand-edit
  it; it follows from source + `build_single.cjs`. Don't commit `index.html` in a
  normal PR (CLAUDE.md §13).
- `check:single` enforces unique top-level identifiers — critical because new
  components are concatenated into one scope.
- Add/adjust **logic-only** regression tests for any new util (`combatArt.js`
  mapping/fallback). UI is not unit-tested here; rely on manual QA for layout.

---

## 9. Open decisions (resolve before/while building)

_Resolved:_

- ✅ **Weakness chip** — **derive at runtime** from the lowest `defenceBonus.*`
  (stab/slash/crush collapse to "Melee"). No data change. See §4 + `getMonsterWeakness`.
- ✅ **Raid best/avg time** — **hide those tiles**, show only Completions (KC). No
  timing telemetry. See §4.
- ✅ **Per-monster art** — **author a unique glyph for all 98 monsters**; keep the
  category map as fallback + headers. See §3a.

_Still open:_

1. **Modal vs mobile sheet:** keep shared `Modal` chrome (less code, slight desktop
   restyle) or introduce mobile-gated slide-up sheets (zero desktop change)?
   *Recommended: mobile-gated sheets.*
2. **Max hit in info sheet:** surface the engine's computed value, recompute from
   formula, or omit until a fight starts?
3. **Unique-drop grouping:** what defines a monster's "unique" set — a flag on
   drops, the collection-log uniques, or the N lowest-chance drops?
4. **Skip 1h / gems pills:** the prototype's toolbar shows a "Skip 1h" and gems
   pill. Confirm these map to existing features (skip-hour purchase, credits/gems)
   or should be omitted on the combat screen.

> Per the session brief, raise these via a quick question rather than guessing on
> anything that changes economy/progression or stored data shape.

---

## 10. Acceptance criteria

- [ ] Desktop combat (≥1250×600) is visually **unchanged** (diff the rendered
      desktop view before/after; no desktop-branch edits).
- [ ] Mobile monster/raid select matches the design: gold gradient heading, idle
      toggle row, gilded stance selector, collapsible area cards with masked
      emblems + glow, monster rows with HP·Att·Def·CB·KC and info button.
- [ ] All functional paths preserved: start fight/raid, stance, idle setup, info,
      locks (slayer/boss/raid), TASK + KC badges, PvP entry.
- [ ] Mobile live combat: animated HP bars, colour-coded log, kills + kills/hr,
      action grid with Eat/Potion/Gear/Special(functional)/Cast(magic-only)/Prayer.
- [ ] Info & raid sheets show stats, max hit, style/weakness, full drop table with
      rates, gilded unique panel, raid chamber timeline + rewards.
- [ ] Rare drop / boss kill triggers the celebration overlay.
- [ ] All icons render **offline** (no Iconify/CDN requests); fallbacks never blank.
- [ ] Tap targets ≥44×44px.
- [ ] `npm test && npm run build && npm run rebuild && npm run check:single` all pass.

---

## 11. File-change summary

| File | Change |
|---|---|
| `src/data/gameIcons.json` | + ~30–40 vendored combat/UI glyphs (offline SVG bodies). |
| `src/utils/combatArt.js` | **new** — category/monster/raid/style art maps + `getMonsterArt` fallback. |
| `src/index.css` | + mobile combat `cb-*` CSS block (ported & tokenised). |
| `src/screens/CombatScreen.jsx` | mobile-gated restyle of picker, combat view, sheets, celebration trigger. **No desktop-branch edits.** |
| `src/components/CombatStyleChip.jsx`, `DropTable.jsx`, `CombatSheet.jsx`, `CombatCelebration.jsx` | **new (optional)** — only if inline JSX grows unwieldy; register in `build_single.cjs`. |
| `build_single.cjs` | register any new components in `sourceFiles`. |
| `tests/**` | + logic tests for `combatArt.js`. |
| `docs/mobile-combat-redesign-implementation.md` | this guide. |
