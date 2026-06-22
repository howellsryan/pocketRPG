# Bespoke Icon Rollout — Progress Tracker

> Source of truth for what's iconned and what's left. Update in the same change
> as the icons. Coverage = a bespoke entry exists in `src/data/bespokeIcons.json`
> (templated tier families via `icon-tiers.json`, or per-icon files in
> `src/assets/icons/`). Renderer falls back to game-icons + emoji until covered.

## Done

### Pilot (file-based)
twisted_longbow, coins, coal, iron_ore→(now templated), gold_bar→(now templated),
oak_logs→(now templated), ruby, fire_rune, nature_rune, prayer_potion, shark,
cave_goblin, mining.

### Phase 1 — metal weapons & tools (templated)
- [x] scimitar ×7 (bronze,iron,steel,mithril,adamant,runeforged,dragon)
- [x] dagger ×6 (bronze,iron,steel,mithril,adamant,dragon)
- [x] sword ×6 (bronze,iron,steel,mithril,adamant,runeforged)
- [x] longsword ×6 (bronze,iron,steel,mithril,adamant,dragon)
- [x] mace ×6 (bronze,iron,steel,mithril,adamant,dragon)
- [x] warhammer ×1 (dragon)
- [x] battleaxe ×1 (dragon)
- [x] 2h_sword ×1 (runeforged)
- [x] spear ×1 (bronze)
- [x] axe (hatchet) ×8 (bronze..dragon, gold)
- [x] pickaxe ×8 (bronze..dragon, gold)

### Phase 2 — metal armour (templated)
- [x] platebody ×6 (bronze,iron,steel,mithril,adamant,runeforged) — has arms
- [x] platelegs ×7 (bronze..dragon)
- [x] plateskirt ×4 (mithril,adamant,runeforged,dragon)
- [x] full_helm ×7 (bronze..dragon)
- [x] med_helm ×1 (runeforged)
- [x] kiteshield ×7 (bronze..dragon)
- [x] chainbody ×6 (bronze,iron,steel,mithril,runeforged,dragon)

### Phase 3 — resources (templated)
- [x] ore ×7 (tin,copper,iron,mithril,adamantite,runeforged,gold)
- [x] bar ×7 (bronze,iron,steel,mithril,adamant,runeforged,gold)
- [x] logs ×8 (oak,willow,maple,yew,magic,redwood,teak,mahogany) + coal (file)

## Remaining (Phase 4 — to be bunched later)
- **Other weapons**: godswords, chaotic/ironclad/zesta longswords, dragon_plateskirt set extras, whips, bows (shortbow/longbow/crossbow tiers), thrown/ammo (arrows, bolts, darts), staves/wands, special boss weapons (named uniques).
- **Other armour**: chaps/d'hide sets, robes (magic), boots, gloves, capes (skill capes + special), amulets/rings/necklaces, ranger/void/god sets, named boss/raid uniques (dravok_s_*, gorath_s_*, torvek_s_*, verin_s_*, masari_*, kodai, ancestral, etc.), slayer_defender + gloves_of_slaughter.
- **Consumables**: all potions/brews (per type colour), food (fish raw+cooked, meats, pies, etc.), runes (all elements), seeds, herbs.
- **Resources cont.**: gems (sapphire/emerald/diamond/dragonstone/onyx/zyrite + uncut), feathers, hides/leather, planks, bones/ashes, fishing/crafting mats.
- **Monsters**: 104 monster ids (portraits).
- **Skills**: 17 skill emblems (mining done; 16 to go).
- **UI / misc**: nav glyphs, toasts, prayers, spells, farming crops, minigames, clue/collection-log markers.

## Notes
- Metal tiers come from one template + `icon-tiers.json` palette/tier table.
  Adding a tier or metal item type = a few lines, no new hand-drawing.
- Named uniques are distinct designs → individual files in Phase 4, not templates.
- Projected full-set lazy-chunk cost ≈ 300–400 KB (confirmed acceptable).
