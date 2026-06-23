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

### Phase 4a — families (templated/sets) ✅
- [x] rune ×15 (all elements) — fire_rune/nature_rune files removed
- [x] potion ×7 (attack,strength,defence,combat,prayer,ranging,magic) — prayer_potion file removed
- [x] gem ×7 + uncut_gem ×7 (sapphire..zyrite) — ruby file removed
- [x] amulet ×7 (gem-based)
- [x] arrow ×7 (metal tiers)
- [x] shortbow ×5 (wood), longbow ×3 (wood), crossbow ×5 (metal)
- [x] cape ×17 (skill capes, per-skill accent)
- [x] d_hide_body ×9, d_hide_chaps ×9 (per hide colour)

Total covered so far: **215 icons**.

## Remaining (Phase 4b — needs per-item bespoke authoring, multi-batch)
These are distinct designs that can't be templated — each needs hand-authoring.
- **Named unique weapons**: godswords, chaotic/ironclad/zesta longswords, whips, staves/wands, dragon_javelin, special boss weapons, gem/dragon bolts, thornspine/twisted bows variants.
- **Named unique armour**: robes (wizard/kodai/ancestral/2nd_age/arcanist), hats, coifs, boots, gloves, rings, necklaces, ranger/void/god sets, boss/raid uniques (dravok_s_*, gorath_s_*, torvek_s_*, verin_s_*, masari_*, gravehusk_*, etc.), slayer_defender + gloves_of_slaughter.
- **Consumables/resources cont.**: brews (lumira), super_restore, food (fish raw+cooked, meats, pies), seeds ×7, saplings ×11, herbs, planks ×3, bones ×4, feathers, leather/hides, coins(done)/coal(done).
- **Monsters**: 104 monster portraits.
- **Skills**: 16 skill emblems (mining done).
- **UI / misc**: nav glyphs, toasts, prayers, spells, farming crops, minigames, clue/collection-log markers.

> Phase 4b is the genuinely bespoke majority (~250+ unique designs incl. 104
> monsters). It cannot be completed in a single pass at acceptable quality; the
> game-icons + emoji fallback keeps every uncovered id rendering meanwhile.

## Notes
- Metal tiers come from one template + `icon-tiers.json` palette/tier table.
  Adding a tier or metal item type = a few lines, no new hand-drawing.
- Named uniques are distinct designs → individual files in Phase 4, not templates.
- Projected full-set lazy-chunk cost ≈ 300–400 KB (confirmed acceptable).
