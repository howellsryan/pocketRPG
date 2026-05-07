# PocketRPG Responsive Desktop UI — Implementation Plan

This document captures the phased plan for converting PocketRPG from a
mobile-only layout to a fully responsive layout that adapts to desktop and
wide-screen displays.

## Goal

The current app is built mobile-first and stretches awkwardly on desktop:
no max-width container, BottomNav tabs spread across the full viewport, all
grids hardcoded for mobile dimensions, no hover/keyboard affordances.

We are not centring a "phone frame" on desktop. We are making it feel like a
real desktop game UI: side navigation, master/detail screens, multi-column
grids, hover and keyboard support — while leaving the mobile experience
unchanged.

## Strategy

- **Tailwind defaults** (`sm` 640 / `md` 768 / `lg` 1024 / `xl` 1280 / `2xl` 1536). The Tailwind CDN supports them out of the box; no custom config required.
- **`md:` (768px) is the desktop activation point** — that's where BottomNav becomes SideNav, master-detail layouts kick in, and modals become inline panels where appropriate.
- **Additive only.** Every change is a `md:` prefix or a `hidden md:block` / `md:hidden` toggle. Mobile DOM is byte-for-byte identical for Phases 1, 2, 3 and 5. Phase 4 re-arranges parents but keeps the same children.

## Breakpoint cheat sheet

| Prefix | Min width | Role |
|--------|-----------|------|
| (none) | 0–639px   | Mobile (current). Bottom nav, single column. |
| `sm:`  | ≥640px    | Wider phones / phone landscape. Cosmetic. |
| `md:`  | ≥768px    | **Desktop activation.** SideNav, master-detail. |
| `lg:`  | ≥1024px   | Inventory 4→8 cols, Bank 4→10. |
| `xl:`  | ≥1280px   | Bank 12 cols, Combat 3-pane. |

## Phases

Each phase is independently shippable. Mobile is never broken at any checkpoint.

### Phase 1 — Shell + SideNav (small, ~1–2h) ✅

**Status:** complete in PR #399.

- New `src/components/navTabs.js` — single source of truth for nav tabs.
- New `src/components/SideNav.jsx` — desktop nav rail (`hidden md:flex`, `w-44 lg:w-52`, icons + labels, `aria-current` on active).
- `src/components/BottomNav.jsx` gets `md:hidden` and reads from `NAV_TABS`.
- `src/App.jsx` shell becomes `flex-col md:flex-row`; SideNav sits left of an inner column wrapping Header/main/BottomNav.
- `src/components/Header.jsx` gets `md:px-6 md:py-3`.
- `build_single.cjs` registers the two new modules in dependency order.

### Phase 2 — Inventory / Bank / Equipment grids (small, ~1h)

Use the new horizontal real estate.

- `src/screens/InventoryScreen.jsx:451` — `grid-cols-4` → `grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-10`.
- `src/screens/BankScreen.jsx:403` — `grid-cols-4` → `grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12`.
- `src/screens/EquipmentScreen.jsx:228-310` — wrap paperdoll Card + Bonuses Card in `md:grid md:grid-cols-2 md:gap-4 md:items-start` (paperdoll scales rather than fixed-width per user choice). Inner Bonuses grid becomes `grid-cols-2 lg:grid-cols-4`.
- `src/screens/HomeScreen.jsx:49` — skill grid `grid-cols-2` → `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5`.

No new components. No `build_single.cjs` changes.

### Phase 3 — Combat 3-pane (medium, ~3–4h)

Active combat splits into three panes at md+:

```
[ Monster card | Combat log + actions | Inventory / Spells / Prayers ]
```

- `src/screens/CombatScreen.jsx:1619-1620` — wrap active-combat root in `md:grid md:grid-cols-[1fr_1.2fr_1fr] md:gap-4`. Centre column needs `min-h-0` for the combat log auto-scroll.
- Surface Inventory / Prayers / Potions panels inline at md+, suppress the modal triggers there. **Per user direction, replace the modals on desktop with the inline panels** rather than keeping both.
- Picker monster lists at `:1304` get `lg:grid lg:grid-cols-2 xl:grid-cols-3`.
- PvP gating: 3-pane wrap applies to PvE only — `PvpCombatScreen.jsx` keeps single-column for now.

### Phase 4 — Master-detail screens (medium, ~3–4h)

Long single-column lists become "list left, detail right" at md+.

- New `src/components/TwoPaneLayout.jsx` — shared wrapper. Below md: stacked, detail only when selected (current behaviour). At md+: `md:grid md:grid-cols-[minmax(280px,360px)_1fr] md:gap-4`.
- Factor `SharedItemModal` body into a new `ItemDetailPanel` so both modal and inline pane render the same content.
- `src/screens/GeneralStoreScreen.jsx`, `src/screens/QuestsScreen.jsx`, and `src/screens/SkillingScreen.jsx` adopt `<TwoPaneLayout>`.
- `build_single.cjs` registers `TwoPaneLayout.js` and the extracted `ItemDetailPanel.js`.

### Phase 5 — Hover, cursor, keyboard polish (small, ~1h)

- New `src/hooks/useEscapeKey.js` — Esc-to-close hook, registered in `build_single.cjs` before `Modal.js`.
- `src/components/Modal.jsx` — Esc handler; `max-w-lg` → `max-w-lg md:max-w-2xl` (or accept a `size` prop).
- Other custom modals (`QuestXpChoiceModal`, `BuyCreditsModal`, `IdleCombatSetupModal`, `SharedItemModal`) get the same Esc treatment.
- `src/components/Button.jsx` — explicit `cursor-pointer`. Optional `active:scale-[0.98] md:transition-transform` for desktop press feedback.
- `src/index.css` — wrap hover-only effects in `@media (hover: hover)` to prevent sticky-hover on touch devices.

## Component decisions

- **Two nav components, one shared `tabs` source.** BottomNav and SideNav have meaningfully different layout, accessibility, and styling (safe-area-inset, aria-roles). Trying to do both inside one component bloats the JSX and makes future tweaks harder. Cost is trivially small.
- **`<TwoPaneLayout list={...} detail={...}>`** as a shared component to avoid duplicating `md:grid-cols-[minmax(280px,360px)_1fr]` in 3 screens.
- **Modals stay as modals** (don't try to inline everything). They get a `md:max-w-2xl` bump and Esc-to-close. For desktop master-detail screens we render the modal *body* inline via the extracted detail panel, but the modal component itself is unchanged.

## Risks

1. **`build_single.cjs` ordering.** `processFile` strips imports and concatenates by source order. New modules must be registered **before** their first user. Forgetting this surfaces as `ReferenceError` at runtime — `npm run check:single` catches duplicate identifiers but not missing ones.
2. **Combat screen scroll.** `logRef` (`CombatScreen.jsx:1747`) auto-scrolls. When the parent becomes `md:grid`, the log container needs `min-h-0` or the auto-scroll silently breaks.
3. **PvP shares CombatScreen.** Phase 3 must gate the 3-pane wrap to PvE only.
4. **Sticky hover on touch.** Hover styles need `@media (hover: hover)` so they don't persist on tablet taps.
5. **State coupling.** SideNav and BottomNav consume the same props from `App.jsx` (`screen`, `navigate`, `isInCombat`, `addToast`). No extra wiring needed.

## Testing strategy

UI changes only — no new logic tests. Per phase, run:

```
npm run ci  # = npm test && npm run build && npm run rebuild && npm run check:single
```

Then a manual matrix at four widths in DevTools: **375 / 640 / 768 / 1280**:

- **Phase 1:** at 375 only BottomNav; at 768+ only SideNav; nav disabled during combat with toast on disabled click.
- **Phase 2:** Inventory / Bank / Equipment column counts match the table; nothing overflows; mobile slots remain ≥44px.
- **Phase 3:** at 375 single column unchanged; at 1280 three panes, log scrolls, no horizontal scroll. PvP entry still single-column.
- **Phase 4:** at 375 modal flow preserved; at 1280 detail renders inline and modal does not appear.
- **Phase 5:** Esc closes any modal; hover only on real hover devices.

## Effort summary

| Phase | Effort | Status |
|-------|--------|--------|
| 1 — Shell + SideNav                   | ~1–2h | ✅ shipped (PR #399) |
| 2 — Inventory / Bank / Equipment grids | ~1h   | next |
| 3 — Combat 3-pane                     | ~3–4h | pending |
| 4 — Master-detail screens             | ~3–4h | pending |
| 5 — Hover / cursor / keyboard         | ~1h   | pending |

**Total:** ~10–13 hrs of focused work, shippable in 5 separate PRs. Mobile parity preserved at every checkpoint.

## Confirmed answers (locked in)

1. **Paperdoll width on desktop:** scales (no fixed 280px column).
2. **Prayers / Potions on desktop:** built for desktop use — replace modal triggers with inline panels rather than keeping both.
3. **SideNav at md+:** icons + labels at all desktop widths (no collapsed icon-only mode).
4. **`SCREENS.LEADERBOARD` labelled "Settings":** intentional; the page will host more than leaderboards in future. Leave as-is.
