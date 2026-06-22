# PocketRPG Bespoke Icon Style Guide

> The contract that keeps ~900 hand-authored icons looking like one set instead of 900.
> Every bespoke SVG in `src/assets/icons/` MUST follow this. Filename = entity id (e.g. `bronze_dagger.svg`).

## Canvas
- **viewBox**: `0 0 512 512`, square. No `width`/`height` attrs (the renderer sizes them).
- **Safe area**: keep all content within `[56, 456]` on both axes (~11% padding). Long items (swords, bows) may extend to `[40, 472]` on their long axis only.
- **Composition**: single hero object, centered, presented at a **3/4 / 45° angle** for weapons & tools, **front-on** for consumables, gems, runes, currency, and emblems.

## Colour & shading (flat, not gradients)
- **Flat 2–3 tone shading per surface**: a base tone, one lighter highlight, one darker shade. No `<linearGradient>`/`<radialGradient>`/filters — they bloat the file and break the unified look. (A single subtle gradient is allowed only for glass/liquid in potions.)
- **Light source**: top-left. Highlights up/left, shadows down/right.
- **Outline**: every silhouette carries a dark contour `#241c2b`, `stroke-width="12"`, `stroke-linejoin="round"`, `stroke-linecap="round"`. Put the stroke on the shape (or a group) — do not draw a separate outline shape.
- **Palette** (reuse so tiers stay coherent across the whole set):

| Family | base | light | shade |
|---|---|---|---|
| Bronze | `#c87f3a` | `#e6a85f` | `#9a5a22` |
| Iron | `#8a8f99` | `#b4b9c2` | `#5f646d` |
| Steel | `#b9c2cf` | `#e2e8f0` | `#888f9c` |
| Runeforged (cyan) | `#46c7b8` | `#8df0e4` | `#2a9285` |
| Gold | `#f0c040` | `#ffe08a` | `#c4912a` |
| Wood (oak) | `#a3743f` | `#c89a63` | `#6f4a23` |
| Leaf/nature | `#4caf50` | `#8bd98f` | `#2f7a37` |
| Fire/ruby red | `#e23b4a` | `#ff8a8f` | `#a81e2c` |
| Coal/onyx | `#3a3340` | `#5a5460` | `#1e1a24` |
| Glass/mana | `#5bb8e0` | `#a7e0f5` | `#2f7fae` |
| Goblin skin | `#7b9a3e` | `#a7c266` | `#52701f` |

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
