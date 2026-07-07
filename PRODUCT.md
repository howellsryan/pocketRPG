# Product

## Register

product

## Users

Mobile-first idle RPG players who dip in and out throughout the day — checking on offline progress, queuing up the next skilling/combat session, managing inventory and gear between short bursts of active play. Comfortable with OSRS-style systems (levels, ticks, drop tables) but playing on the go, often one-handed. The job to be done on any given screen is usually narrow and repeated often: start/stop an activity, manage inventory, check progress, gear up, fight.

## Product Purpose

PocketRPG is a menu-driven, tick-based fantasy idle RPG. It exists to deliver satisfying, low-friction progression — combat, skilling, gathering, raids, minigames, quests — that rewards both active play and offline/idle time. Success looks like a player returning session after session because the grind feels earned and legible, not because of dark-pattern retention hooks.

## Brand Personality

Grindy and nostalgic, with an adventure feel. Low-fantasy grit over high-fantasy spectacle — closer to OSRS's earned, unglamorous progression than to a heroic epic. The satisfaction comes from clean UX and interaction design as much as from lore and map/world texture. Confidence through legibility: dense information presented clearly, not dumbed down.

## Anti-references

- Flat corporate SaaS dashboards — this should read as a game world, not a productivity tool. Avoid sterile card grids, generic dashboard chrome, and SaaS-cliché components.
- Bright, candy-colored mobile gacha/F2P UI — avoid gem-shop-heavy, oversaturated, cartoonish styling that signals predatory F2P monetization.

## Design Principles

- Legibility over spectacle — dense game state (stats, inventory, combat log) must stay scannable at a glance, especially one-handed on mobile.
- Earn the fantasy through texture, not decoration — parchment/gold/blood/void palette and lore should feel load-bearing, not skinned on top of generic UI.
- Respect the tick — feedback for actions (combat hits, skilling gains, drops) should feel immediate and satisfying even though the underlying sim is on a fixed 600ms cadence.
- Never read as SaaS or gacha — every screen should pass the "does this look like a game" test, not the "does this look like a clean app" test.
- Mobile-first, thumb-first — 44×44px minimum tap targets, layouts that work one-handed, no desktop-assumed interactions.

## Accessibility & Inclusion

No formal WCAG target set. Maintain baseline good practice: solid text contrast against the parchment/void palette, `prefers-reduced-motion` alternatives for animated effects (skill pulses, toasts, hit flashes), and the existing 44×44px minimum tap target rule.
