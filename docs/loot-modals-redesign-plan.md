# Loot Modal Redesign — Implementation Plan

> **Status:** Plan only. Hand-off document for the implementing agent.
> **Branch:** `claude/loot-modals-design-plan-eHFsY`
> **Source design:** `PvP Modal.html` (Anthropic design package `uf-5Lx4hbuHLZq3Wj5n_1w`).

---

## 1. Goal

Unify the game's three end-of-activity "loot" modals behind **one shared
component**, restyle them to match the supplied `PvP Modal.html` design, and add
a **blood-red "death" state** that replaces the gold theme whenever the player
dies — in idle, PvP, or PvE.

The three modals today:

| Context | File | Current implementation |
|---|---|---|
| **PvE** kill / raid loot | `src/screens/CombatScreen.jsx` (`lootModal`, render ~L2776) | Shared `Modal`, gold accents, "Fight Again"/"Run Away". **No modal on player death** — death is only an `addToast('You died!')` at L455 / L483. |
| **PvP** match end | `src/screens/PvpCombatScreen.jsx` (`endModal`, render ~L1029) | Shared `Modal`, "🏆 Victory" / "💀 Defeat", lists won loot. **Does not show both characters' HP.** |
| **Idle** catch-up report | `src/App.jsx` (`idleResult`, render ~L2270) | Bespoke inline `<div>` (not the shared `Modal`), gold/green gradient header, has a `idleResult.died` branch (~L2480). Carries idle-only sections (XP summary, supplies, quests). |

### Decisions already locked with the user

1. **Design source:** the pasted `PvP Modal.html` is authoritative for layout/visuals.
2. **PvE death:** reuse the loot modal in a **red "death" variant** (no brand-new modal type).
3. **Shared scope:** shared component provides the **modal shell + header (gold/blood states) + loot-item list**. The idle modal keeps its extra sections (XP / supplies / quests) *inside* that shell. (Lowest-risk option — do **not** fully fold idle's bespoke content into the component.)
4. **Red scope on death:** **header + accents** switch gold → blood-red. Body stays neutral dark.
5. **PvP:** the end modal must render **both characters' HP** as in the design's "matchup" strip.

---

## 2. What the design gives us (`PvP Modal.html`)

The reference is a single React/Babel prototype. Relevant structure (ignore the
`tweaks-panel.jsx` editor harness — it is prototype-only and must NOT be ported):

- **Overlay** `.pvp-overlay` — full-bleed dim + blur, centred, click-out to close.
- **Modal** `.pvp-modal` with two theme modifiers:
  - `--win` → gold radial/linear background, gold rim, gold glow.
  - `--loss` → **blood-red** background `linear-gradient(180deg,#1c1010,#0e0909)` + `rgba(224,86,75,.18)` radial wash, red rim `rgba(224,86,75,.45)`.
- **Hero** `.pvp-hero`:
  - Circular **seal** (`.pvp-seal--win` gold / `.pvp-seal--loss` red) with an ornate conic-gradient ring and a masked **trophy** (win) / **skull** (loss) icon.
  - Status line: `Tick {n} · {dmg} dmg dealt`.
  - Big gradient **title**: "Victorious" / "Defeated".
  - Subtitle: `{opp} has fallen before you` / `{opp} has slain you`.
- **Matchup strip** `.pvp-matchup` — 3-col grid `Opponent | VS | You`. Each side:
  label, name, `X/Y HP` (green `#7ce88a`; turns red `#e0564b` + `.dead` when that
  fighter is at 0), an **HP bar** (`enemy` = red gradient, `self` = green
  gradient), and `{risk} at risk`.
- **Loot list** `.pvp-loot`:
  - Header title "✦ Loot Plundered" (win) / "Items Lost" (loss) + signed total `+/-{gp} gp` (gold / red).
  - Rows `.pvp-lrow` (`--lost` red variant): masked icon, name, optional `×qty`, signed `+/-{gp} gp`.
- **Actions** `.pvp-actions`: ghost "⚔ Fight Again" (win only) + primary "Return to PvE".
- **Decoration:** spinning conic "rays" (win only), a particle burst, pop-in keyframes, top-right close button.

### Colour mapping (design → PocketRPG CSS vars)

`src/index.css` already defines: `--color-gold #d4a017`, `--color-gold-light #f0c040`,
`--color-gold-dim #8b6914`, `--color-blood #8b1a1a`, `--color-blood-mid #6b1414`,
`--color-blood-light #c0392b`, `--color-void* `, `--color-hp-green #27ae60`,
`--color-hp-red #c0392b`, `--color-parchment`.

The design uses a slightly brighter ember red (`#e0564b`) than `--color-blood-light`
(`#c0392b`). **Add two tokens** to `:root` in `src/index.css` so the design reads exactly
and we keep "no hard-coded hex in components":

```css
--color-blood-ember: #e0564b;   /* loss accent text / rim */
--color-blood-glow:  rgba(224,86,75,.18);  /* loss background wash */
```

Reuse existing gold tokens for the win theme. HP-bar gradients (per-side green/red)
get dedicated classes (below) rather than the percentage-based `HPBar` colouring.

---

## 3. Architecture

### 3.1 New shared component — `src/components/LootResultModal.jsx`

A single presentational component that renders the **shell + themed header + loot
list**, with everything else passed in as props/children. It wraps the existing
`Modal` for portal/scroll/escape behaviour, OR re-implements the overlay if we
want the design's bespoke rim/animation (see §3.3 for the recommended approach).

**Proposed prop contract:**

```jsx
<LootResultModal
  theme="gold" | "blood"        // gold = win/normal loot; blood = death/defeat
  icon="trophy" | "skull" | <emoji/custom>
  title="Victorious"            // big gradient title
  status="Tick 166 · 284 dmg dealt"   // optional small status line
  subtitle="maxpurebot has fallen before you"  // optional
  loot={[{ itemId|name, icon, quantity, gp, lost? }]}  // null/[] hides list
  lootTitle="✦ Loot Plundered"  // header label
  lootTotal={4_300_000}          // signed-rendered using `theme`/`lost`
  lootSigned="+" | "-"          // sign + colour for totals/rows
  primaryAction={{ label, onClick }}
  secondaryAction={{ label, onClick }}  // optional (e.g. Fight Again / Run Away)
  onClose={fn}
>
  {children}   // optional extra content slot, rendered ABOVE the loot list
               // (used by PvP matchup strip + idle's XP/supplies/quests)
</LootResultModal>
```

Rationale for `children` slot: keeps idle's heavy, idle-specific sections out of
the component (decision #3) while still giving them the unified shell + header +
loot styling. PvP injects its **matchup strip** through the same slot.

**Sub-pieces to export from the same file (or small siblings):**

- `LootResultRow` — one `.pvp-lrow` row (icon via existing `GameIcon`, name, qty, signed gp). Reused by all three consumers so loot rows look identical everywhere.
- `MatchupHpStrip` — the two-fighter HP block (see §3.2). Lives here (or in `PvpCombatScreen` if we decide it is PvP-only); recommended **here** so it is reusable and testable, but it is only *used* by PvP for now.

**Icon strategy:** the design uses `game-icons` masked SVGs (`trophy`, `skull`,
etc.). PocketRPG already has `GameIcon` + `itemIcons` + `gameIconsData`. Use
`GameIcon` for item rows. For the hero seal trophy/skull, use the existing icon
system if those glyphs exist; otherwise fall back to emoji (🏆 / 💀) which the
current modals already use — **do not** add a new icon-fetch path. Confirm glyph
availability in `gameIconsData` during implementation; keep the
`typeof gameIconsData !== 'undefined'` guard (per CLAUDE.md §12).

### 3.2 PvP both-character HP — `MatchupHpStrip`

The data already exists in `PvpCombatScreen`: `pair.self` and `pair.opp` carry
`{ username, hp, maxHP, equipment }`, and there are helpers `getCombatantTotalRisk`,
`formatCompactCoins`, `formatPvpRank` (used today by `CompactHpBadge`). At match
end the loser's `hp` is `0`.

`MatchupHpStrip` mirrors the design's `.pvp-matchup`:

- Two sides (Opponent / You), each: label, `username`, `hp/maxHP HP` (green; red +
  `.dead` styling when `hp <= 0`), an HP bar, and `Total Risk` / rank line.
- The HP bar uses **side-fixed colours** (opponent = red gradient, self = green
  gradient) per the design — distinct from the percentage-based `HPBar` component.
  Add `.loot-hp`, `.loot-hp--enemy`, `.loot-hp--self` classes (see §3.3).

This replaces the missing two-fighter display in the PvP end modal. The existing
in-fight `CompactHpBadge` (top of `PvpCombatScreen`) can stay as-is, or optionally
be refactored later to share `MatchupHpStrip` — **out of scope** for this change.

### 3.3 Styling approach (single-file-build safe)

Per CLAUDE.md §9 (Tailwind utilities + CSS vars, avoid `/N` opacity, avoid inline
styles unless truly dynamic) and the existing `.cb-*` pattern in `src/index.css`:

- Put the modal's **structural / decorative CSS** (rim, seal, gradients, hp-bar
  gradients, pop animation, optional rays/particles) in `src/index.css` under a
  `.loot-modal*` namespace, themed by a `--win` / `--loss` (or `data-theme`)
  modifier — exactly how the design splits `--win`/`--loss`.
- Drive colours from the CSS vars in §2 (gold tokens + the two new blood tokens),
  not raw hex, so the gold→blood swap is a single class toggle.
- Keep dynamic-only values (e.g. HP bar `width: {pct}%`) as inline styles — that is
  the sanctioned exception.
- **Decoration scope:** the spinning **rays** and **particle burst** are
  nice-to-have. Recommend implementing the **static** look (gradients, seal, rim,
  pop-in) first; gate rays/particles behind a follow-up or a `prefers-reduced-motion`
  check. They are pure decoration and must never block the loot/HP content.

---

## 4. Step-by-step implementation

### Phase 0 — Tokens & shared CSS
1. Add `--color-blood-ember` and `--color-blood-glow` to `:root` in `src/index.css`.
2. Add the `.loot-modal*` style block to `src/index.css`: shell, `--win`/`--loss`
   theme variants, hero seal, title gradients, matchup layout, `.loot-hp--enemy/--self`
   bar gradients, `.loot-lrow`(+`--lost`) rows, action buttons, pop-in keyframe.
   Mirror the class structure of the design's `.pvp-*` rules but namespaced and
   var-driven.

### Phase 1 — Shared component
3. Create `src/components/LootResultModal.jsx` implementing §3.1 (shell + themed
   header + loot list + actions + `children` slot), exporting `LootResultRow` and
   `MatchupHpStrip`.
4. **Register in the build** (CLAUDE.md §9 + §12): add `'components/LootResultModal.js'`
   to `sourceFiles` in `build_single.cjs`, placed with the other components (e.g.
   right after `components/Modal.js` / `components/HPBar.js` at ~L88–89). It is
   used by both core-adjacent (`App.jsx`) and chunked screens, so it must live in
   **core** (it already will, since only `screens/*` go in `GAME_CHUNK_FILES`).
   Ensure top-level names are globally unique (`LootResultModal`, `LootResultRow`,
   `MatchupHpStrip`).

### Phase 2 — PvP end modal (the headline change)
5. In `src/screens/PvpCombatScreen.jsx`, replace the `endModal` JSX (~L1029–1095)
   with `LootResultModal`:
   - `theme = endModal.youWon ? 'gold' : 'blood'`.
   - `icon = youWon ? 'trophy' : 'skull'`, `title = youWon ? 'Victorious' : 'Defeated'`.
   - `subtitle` from opponent username (`{opp} has fallen before you` / `… has slain you`).
   - `status` from tick + damage if available (optional; fall back to omitting).
   - Pass `<MatchupHpStrip self={pair.self} opp={pair.opp} .../>` as `children`.
   - `loot`: **win** → `aggregateLootEntries(endModal.loot.added)` rendered as gained (`+`);
     **loss** → `aggregateLootEntries(endModal.loot.dropped)` rendered as lost (`-`).
     *Confirmed:* the client loot summary carries both `added`/`addedValue` and
     `dropped`/`droppedValue` (`pvpEndSummary.js` / `buildEndModalFromResponse` L346),
     so the design's "Items Lost" list is fully populated — no need for a fallback summary.
   - Preserve the **writeback-warning** branch (`!endModal.writebackOk`) and the
     `handleCloseEndModal` flow (it does async cleanup — keep it as the close/primary handler).
   - Primary action "Return to PvE". **Omit "⚔ Fight Again"** — *confirmed:* there is no
     rematch/requeue entry point from the PvP end modal today; only "Return to PvE" exists.
6. Verify `aggregateLootEntries` / `getLootIcon` / `formatLootEntry` / `getEndLootTotal`
   still feed the rows (reuse them to build the `loot` prop), or move that mapping
   into `LootResultRow`.

### Phase 3 — PvE loot + PvE death
7. In `src/screens/CombatScreen.jsx`, replace the `lootModal` JSX (~L2776–2876)
   with `LootResultModal` in `theme="gold"`:
   - Title = monster/raid name + "defeated!"/"complete!"; icon = monster emoji or trophy.
   - `loot` from `lootModal.loot` (reuse `isHighValueDrop` styling — map "high value"
     to a row highlight prop on `LootResultRow`).
   - Keep `loading` spinner state, the **Skip / Skip raid** `titleRight` action, and
     the "Run Away"/"Fight Again" buttons → map to secondary/primary actions.
8. **Add the PvE death modal** (decision #2). At the two non-one-life death sites
   (`CombatScreen.jsx` L455 and L483), instead of only toasting:
   - Set new state `deathModal` = `{ monster, cause }` (`cause` = "slain"/"incinerated").
   - Render `LootResultModal theme="blood" icon="skull" title="Defeated"` with subtitle
     from `cause`/monster, **no loot list** (or an empty one), primary action
     "Continue" that closes + respawns (the existing `updateHP(getMaxHP())` already runs).
   - Leave the **one-life** path (`triggerOneLifeDeath`) untouched — it has its own flow.
   - Confirm there isn't a competing full-screen one-life death overlay that would
     double up; only the non-one-life branch gets the new modal.

### Phase 4 — Idle modal
9. In `src/App.jsx`, wrap the idle results modal (~L2270) in `LootResultModal`
   (shared shell + header + loot list), keeping its idle-only sections (XP summary,
   supplies, quests, cloud-override notice, boss/raid warning) as `children`:
   - `theme = idleResult.died ? 'blood' : 'gold'` (decision #4 — death turns it red).
   - When `died`, header icon = skull, title reflects death; keep the existing
     "☠️ You died during idle combat!" supplies note or fold it into the subtitle.
   - Map any idle loot (`itemsGained`) into the shared loot list via `LootResultRow`
     so it matches PvE/PvP.
   - Preserve all gating conditions on the wrapper
     (`!skipSaving && !gameLocked && pvp.phase !== 'in_match' && Date.now() >= suppressIdleModalUntil`)
     and the `closeIdleResultModal` handler.
   - Note: this modal is bespoke (`<div>`, inline styles) and content-heavy — port
     carefully; the shell adoption is mostly the outer frame + header + the loot
     rows, not the inner idle analytics.

### Phase 5 — Tests, build, polish
10. Add/extend a logic test if any non-trivial pure helper is introduced (e.g. a
    `formatSignedGp` / loot-aggregation helper). The modals themselves are UI; keep
    logic testable and out of the JSX where reasonable. (Most of this change is
    presentational, so test surface is small — do not over-test rendering.)
11. Run the **commit gate** (CLAUDE.md §11): `npm test && npm run build && npm run
    rebuild && npm run check:single` (or `npm run ci && npm test`). `check:single`
    is critical here — three screens + a new shared component touch the single-file
    build; watch for duplicate top-level identifiers across core + chunk.
12. Do **not** commit the generated root `index.html` (build artifact).

---

## 5. Files touched

| File | Change |
|---|---|
| `src/index.css` | New `--color-blood-ember`/`--color-blood-glow` tokens + `.loot-modal*` style block. |
| `src/components/LootResultModal.jsx` | **New** shared component (`LootResultModal`, `LootResultRow`, `MatchupHpStrip`). |
| `build_single.cjs` | Register `components/LootResultModal.js` in `sourceFiles`. |
| `src/screens/PvpCombatScreen.jsx` | Swap `endModal` JSX → `LootResultModal` + `MatchupHpStrip` (both-character HP). |
| `src/screens/CombatScreen.jsx` | Swap `lootModal` JSX → `LootResultModal`; add blood-red PvE **death modal**. |
| `src/App.jsx` | Wrap idle results modal in shared shell; blood-red header when `idleResult.died`. |
| `tests/**` | Optional: regression for any extracted pure helper. |

---

## 6. Risks & watch-outs

- **Single-file build (§12):** unique top-level names across core *and* chunk; the
  new component must be in core (App uses it). Run `check:single`.
- **`handleCloseEndModal` (PvP) does async writeback cleanup** — keep it wired to
  close/primary; don't replace with a naive `setEndModal(null)`.
- **Idle modal is the hairiest** — bespoke markup, many conditional sections, strict
  open-gating. Adopt the shell without disturbing those conditions or the
  `IdleResultProgressCard`/XP/supplies internals.
- **One-life death** must keep its dedicated flow; only non-one-life PvE death gets
  the new modal.
- **Loss-side loot for PvP:** resolved — `endModal.loot.dropped` + `droppedValue` are
  available client-side, so "Items Lost" renders from real data.
- **Decoration (rays/particles)** is optional and must respect `prefers-reduced-motion`;
  ship the static themed look first. (Only open design choice — see hand-off note.)
- **Tap targets ≥ 44px** for all action buttons (§9).
- **No `/N` Tailwind opacity** — use the CSS-var colours (§9).

---

## 7. Suggested commit sequence

1. `feat(ui): add blood tokens + shared loot-modal styles` (index.css).
2. `feat(ui): add LootResultModal shared component + build registration`.
3. `feat(pvp): show both-fighter HP + adopt LootResultModal on match end`.
4. `feat(combat): adopt LootResultModal for loot + add PvE death modal`.
5. `feat(idle): adopt shared loot-modal shell + blood-red death state`.

Run the full commit gate before each push; push to
`claude/loot-modals-design-plan-eHFsY`.
