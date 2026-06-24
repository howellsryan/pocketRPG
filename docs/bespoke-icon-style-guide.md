# PocketRPG Bespoke Icon Style Guide

> The contract that keeps ~900 hand-authored icons looking like one set instead of 900.
> Every bespoke SVG in `src/assets/icons/` MUST follow this. Filename = entity id (e.g. `bronze_dagger.svg`).

## Canvas
- **viewBox**: `0 0 512 512`, square. No `width`/`height` attrs (the renderer sizes them).
- **Safe area**: keep all content within `[56, 456]` on both axes (~11% padding). Long items (swords, bows) may extend to `[40, 472]` on their long axis only.
- **Composition**: single hero object, centered, presented at a **3/4 / 45° angle** for weapons & tools, **front-on** for consumables, gems, runes, currency, and emblems.

## Colour & shading (OSRS-style rendered look)
- **Goal: evoke the OSRS item-sprite idiom** — recognizable silhouette, canonical tier palette, a 3/4 viewing angle, and *rendered* (smoothly shaded) surfaces with a bright specular highlight. We author **original art in that style**, never tracing/copying Jagex sprites.
- **Gradient shading is the default**: each surface uses a `<linearGradient>` (blades/bars/limbs, light→dark along the top-left light axis) or `<radialGradient>` (gems/runes/round metal, bright spot up-left). Add a small solid specular shape for the metal "glint."
- **Gradient ids MUST be globally unique** — prefix every gradient id with the entity id (e.g. `id="bronze_dagger_blade"`). All icon bodies share one DOM id namespace once injected, so an unprefixed `id="g"` collides across icons.
- **Light source**: top-left. Highlights up/left, shadows down/right.
- **Outline**: every silhouette carries a dark contour `#1a1410`, `stroke-width="13"`, `stroke-linejoin="round"`, `stroke-linecap="round"` (OSRS sprites have a crisp dark outline). Put the stroke on the shape (or a group) — do not draw a separate outline shape.
- **Tradeoff**: gradients add ~0.2–0.4 KB/icon vs. flat. Acceptable for the OSRS look; revisit only if the full ~900-set bundle gets heavy.
- **Palette** (reuse so tiers stay coherent across the whole set):

Tier palette mirrors OSRS metal conventions so a player reads the tier at a glance:

| Family | base | light | shade |
|---|---|---|---|
| Bronze | `#b87333` | `#e6a85f` | `#7a4a1e` |
| Iron | `#6e747e` | `#9aa0aa` | `#41454d` |
| Steel | `#bcc6d2` | `#eef3f8` | `#7f8893` |
| Mithril (blue) | `#3a52c8` | `#7d92f0` | `#23337e` |
| Adamant (green) | `#3f8a5a` | `#74c98e` | `#246b3c` |
| Rune (teal) | `#2fd0c0` | `#aef5ec` | `#1a8a7e` |
| Dragon (red) | `#c0392b` | `#ff6b5a` | `#7a1d14` |
| Gold | `#ffcf33` | `#fff0a0` | `#c48f12` |
| Wood (oak) | `#b07a3e` | `#d6a766` | `#6f4a23` |
| Nature green | `#3fa64a` | `#8fe08f` | `#246b2c` |
| Fire orange | `#e8743a` | `#ffb27a` | `#a8431a` |
| Ruby red | `#d11a2a` | `#ff6b78` | `#8a0f1c` |
| Coal | `#3b424b` | `#5a636e` | `#1c2026` |
| Glass/mana | `#7fd0ef` | `#cdeefb` | `#3f8fb8` |
| Goblin skin | `#6b8e23` | `#9fc24e` | `#46611a` |

## Structure conventions
- Wrap the whole icon in one `<g>` so a future tint/glow hook can target it.
- Order shapes back-to-front; rely on painter's order, avoid `z`-tricks.
- Keep paths simple — prefer `rect`/`circle`/`polygon`/short `path`. Target **≤ 2 KB per icon** after SVGO.
- No `id`s, no `class`es, no inline `style`, no `<defs>` unless a potion gradient genuinely needs it (then give the gradient a globally-unique id prefixed with the entity id).

## Per-category cues (so categories read at a glance)
- **Weapons**: 45° angle, blade up-right, pommel down-left. Metal tier sets blade colour.
- **Armour**: front-on silhouette of the piece (breastplate, helm, etc.).
- **Ores**: rough rock with 2–3 embedded metallic flecks of the metal's colour.
- **Bars**: trapezoid ingot, top face lighter.
- **Logs**: 2–3 stacked cylinders, visible end-grain rings.
- **Food**: the cooked item, warm tone, no plate.
- **Potions**: rounded glass vial, liquid coloured by potion type, cork/stopper on top.
- **Runes**: rounded talisman stone, tinted by element, with a simple etched glyph.
- **Gems**: faceted stone, front-on, 3 facet tones.
- **Currency**: small stack/cluster.
- **Monsters**: head/bust portrait, front-on, expressive.
- **Skill emblems**: the skill's tool/symbol, on the skill's accent colour family.
