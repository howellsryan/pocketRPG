# PocketRPG Economy Benchmark

Generated: 2026-05-10T16:39:20.221Z

## Assumptions

- Tick length: 600ms.
- Coins are valued at 1 each.
- All item rewards are valued using `item.shopValue`.
- Production net value subtracts material opportunity cost.
- Monster coins/hour assumes 100 kills/hour unless overridden.
- Raid coins/hour assumes 1 completions/hour.
- Farming herb/tree yields default to 1/1; fruit trees use fruitLimit where present, otherwise 6.

## Top activities by net coins/hour

| Category | Name | Level | Ticks | Actions/hr | EV/action | EV/kill | EV/completion | Gross coins/hr | Net coins/hr | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Combat 894 | Corrupted Gauntlet | 894 |  | 100 |  | 1,263,543 |  | 126,354,287 | 126,354,287 | Assumes 100 kills/hr. EV: Bow of Faerdhinen: 400,000; Blade of Saeldor: 400,000; Crystal Pickaxe: 75,000; Crystal Axe: 75,000; Coins: 36,750; Dragon Bones: 35,188; Crystal Helmet: 30,000; Crystal Plate Body: 30,000; +26 more |
| Combat 725 | Zulrah | 725 |  | 100 |  | 387,806 |  | 38,780,626 | 38,780,626 | Assumes 100 kills/hr. EV: Toxic Blowpipe: 100,000; Trident of the Swamp: 100,000; Serpentine Helm: 100,000; Zulrah's Scales: 60,450; Uncut Onyx: 10,273; Coins: 7,200; Ranarr Weed: 2,886; Blood Rune: 2,009; +5 more |
| Combat 580 | Kree'arra | 580 |  | 100 |  | 235,925 |  | 23,592,543 | 23,592,543 | Assumes 100 kills/hr. EV: Armadyl Chestplate: 98,878; Armadyl Chainskirt: 73,025; Armadyl Helmet: 24,438; Coins: 20,000; Armadyl Hilt: 14,297; Death Rune: 1,063; Ranarr Weed: 990; Blood Rune: 574; +16 more |
| Combat 624 | General Graardor | 624 |  | 100 |  | 170,818 |  | 17,081,823 | 17,081,823 | Assumes 100 kills/hr. EV: Bandos Chestplate: 64,311; Bandos Tassets: 43,132; Bandos Hilt: 35,642; Coins: 20,000; Bandos Boots: 1,771; Death Rune: 1,063; Ranarr Weed: 990; Blood Rune: 574; +18 more |
| Chambers of Xeric | Chambers of Xeric |  |  | 1 |  |  | 16,784,851 | 16,784,851 | 16,784,851 | Assumes 1 completions/hr \| Common EV: 198,708 \| Unique EV: 16,586,144 \| Unique table: Twisted Bow 0.500% EV 7,909,400; Ancestral Robe Top 1.500% EV 1,948,984; Ancestral Robe Bottom 1.500% EV 1,363,348; Elder Maul 1.000% EV 1,020,095; Dragon Hunter Crossbow 2.000% EV 811,943; Ancestral Hat 1.500% EV 808,709; Kodai Wand 1.000% EV 787,437; Zaryte Vambraces 1.000% EV 784,272; +3 more |
| Fletching | Make dragon bolts (10) | 84 | 3 | 2,000 | 12,000 |  |  | 24,000,000 | 15,960,000 | Product: Dragon Bolt x10 \| Materials: Feather x10, Dragon Bolt (Unf) x10 |
| Combat 596 | Commander Zilyana | 596 |  | 100 |  | 147,479 |  | 14,747,925 | 14,747,925 | Assumes 100 kills/hr. EV: Armadyl Crossbow: 66,307; Saradomin Hilt: 54,318; Coins: 20,000; Saradomin Sword: 1,341; Death Rune: 1,063; Ranarr Weed: 990; Blood Rune: 574; Soul Rune: 504; +15 more |
| Combat 650 | K'ril Tsutsaroth | 650 |  | 100 |  | 132,486 |  | 13,248,649 | 13,248,649 | Assumes 100 kills/hr. EV: Zamorak Spear: 59,250; Zamorak Hilt: 36,273; Coins: 20,000; Staff of the Dead: 11,149; Death Rune: 1,063; Ranarr Weed: 990; Blood Rune: 574; Soul Rune: 504; +16 more |
| Combat 194 | Hydra | 194 |  | 100 |  | 108,684 |  | 10,868,439 | 10,868,439 | Assumes 100 kills/hr. EV: Hydra Leather: 69,323; Ferocious Gloves: 10,200; Hydra Claw: 9,000; Hydra Bones: 7,633; Coins: 3,500; Runite Ore: 2,093; Death Rune: 1,985; Blood Rune: 1,679; +6 more |
| Combat 380 | Rune Dragon | 380 |  | 100 |  | 93,431 |  | 9,343,067 | 9,343,067 | Assumes 100 kills/hr. EV: Onyx Bolt Tips: 16,600; Coins: 15,000; Rune Bar: 12,500; Runite Ore: 9,417; Dragon Chainbody: 5,473; Dragon Kiteshield: 4,828; Dragon Platelegs: 4,029; Dragon Plateskirt: 4,027; +12 more |
| Combat 275 | Demonic Gorilla | 275 |  | 100 |  | 86,302 |  | 8,630,207 | 8,630,207 | Assumes 100 kills/hr. EV: Uncut Zenyte: 67,442; Heavy Ballista: 5,250; Ranarr Weed: 4,398; Coins: 3,000; Dragon Bones: 2,815; Snapdragon: 1,282; Death Rune: 992; Blood Rune: 718; +2 more |
| Theatre of Blood | Theatre of Blood |  |  | 1 |  |  | 8,252,613 | 8,252,613 | 8,252,613 | Assumes 1 completions/hr \| Common EV: 389,718 \| Unique EV: 7,862,895 \| Unique table: Avernic Defender 4.627% EV 3,701,895; Sanguinesti Staff 1.157% EV 1,735,263; Scythe of Vitur 0.578% EV 1,735,263; Ghrazi Rapier 1.157% EV 307,842; Justiciar Faceguard 1.157% EV 137,490; Justiciar Chestguard 1.157% EV 131,093; Justiciar Legguards 1.157% EV 114,049 |
| Smithing | Smith rune pickaxe | 86 | 5 | 1,200 | 18,685 |  |  | 22,422,000 | 7,422,000 | Product: Rune Pickaxe x1 \| Materials: Rune Bar x1 |
| Combat 338 | Adamant Dragon | 338 |  | 100 |  | 69,986 |  | 6,998,580 | 6,998,580 | Assumes 100 kills/hr. EV: Onyx Bolt Tips: 16,600; Rune Bar: 12,500; Coins: 10,000; Runite Ore: 4,708; Dragon Chainbody: 4,105; Draconic Visage: 3,679; Dragon Platelegs: 3,223; Dragon Plateskirt: 3,222; +9 more |
| Mining | Mine runite ore | 85 | 9 | 667 | 10,463 |  |  | 6,975,333 | 6,975,333 | Product: Runite Ore x1 |
| Herblore | Make combat potion | 36 | 3 | 2,000 | 4,000 |  |  | 8,000,000 | 6,724,000 | Product: Combat Potion x1 \| Materials: Harralander x1, Goat Horn Dust x1 |
| Combat 318 | Cerberus | 318 |  | 100 |  | 65,926 |  | 6,592,554 | 6,592,554 | Assumes 100 kills/hr. EV: Primordial Crystal: 32,624; Coins: 11,250; Eternal Crystal: 6,375; Death Rune: 3,780; Blood Rune: 3,014; Dragon Bones: 2,815; Ranarr Weed: 1,924; Soul Rune: 1,404; +6 more |
| Combat 303 | Dagannoth Rex | 303 |  | 100 |  | 57,323 |  | 5,732,314 | 5,732,314 | Assumes 100 kills/hr. EV: Berserker Ring: 25,412; Dagannoth Bones: 14,448; Coins: 6,500; Dragon Axe: 4,096; Rune Platebody: 1,924; Rune Platelegs: 1,896; Ranarr Weed: 990; Warriors Ring: 781; +11 more |
| Combat 303 | Dagannoth Supreme | 303 |  | 100 |  | 51,834 |  | 5,183,371 | 5,183,371 | Assumes 100 kills/hr. EV: Archers Ring: 20,704; Dagannoth Bones: 14,448; Coins: 6,500; Dragon Axe: 4,096; Rune Platebody: 1,924; Rune Platelegs: 1,896; Ranarr Weed: 990; Snapdragon: 427; +10 more |
| Combat 303 | Dagannoth Prime | 303 |  | 100 |  | 37,468 |  | 3,746,817 | 3,746,817 | Assumes 100 kills/hr. EV: Dagannoth Bones: 14,448; Coins: 6,500; Seers Ring: 6,339; Dragon Axe: 4,096; Rune Platebody: 1,924; Rune Platelegs: 1,896; Ranarr Weed: 990; Snapdragon: 427; +10 more |
| Fletching | Tip dragonstone dragon bolts (10) | 84 | 30 | 200 | 36,000 |  |  | 7,200,000 | 3,590,000 | Product: Dragonstone Dragon Bolt x10 \| Materials: Dragon Bolt x10, Dragonstone Bolt Tips x10 |
| Fletching | Make adamant bolts (10) | 61 | 3 | 2,000 | 1,590 |  |  | 3,180,000 | 2,940,000 | Product: Adamant Bolt x10 \| Materials: Feather x10, Adamant Bolt (Unf) x10 |
| Combat 276 | King Black Dragon | 276 |  | 100 |  | 28,701 |  | 2,870,111 | 2,870,111 | Assumes 100 kills/hr. EV: Coins: 12,500; Runite Ore: 7,324; Dragon Bones: 2,815; Draconic Visage: 1,840; Dragon Pickaxe: 1,429; Blood Rune: 1,076; Death Rune: 907; Soul Rune: 810; +1 more |
| Combat 318 | Brutal Black Dragon | 318 |  | 100 |  | 26,098 |  | 2,609,761 | 2,609,761 | Assumes 100 kills/hr. EV: Coins: 6,000; Black Dragon Leather: 4,182; Draconic Visage: 3,679; Runite Ore: 3,139; Dragon Bones: 2,815; Dragon Arrow: 1,447; Death Rune: 1,040; Blood Rune: 904; +6 more |
| Fletching | Tip dragonstone bolts (10) | 71 | 30 | 200 | 19,000 |  |  | 3,800,000 | 2,506,000 | Product: Dragonstone Bolt x10 \| Materials: Runite Bolt x10, Dragonstone Bolt Tips x10 |
| Magic | Enchant Dragonstone Dragon Bolts (10) | 68 | 30 | 200 | 48,000 |  |  | 9,600,000 | 2,400,000 | Product: Dragonstone Dragon Bolt (E) x10 \| Materials: Dragonstone Dragon Bolt x10 |
| Combat 150 | Lizardman Shaman | 150 |  | 100 |  | 21,142 |  | 2,114,161 | 2,114,161 | Assumes 100 kills/hr. EV: Dragon Warhammer: 5,358; Snapdragon: 4,272; Ranarr Weed: 2,749; Blood Rune: 2,153; Rune Chainbody: 1,482; Death Rune: 1,418; Kwuarm: 1,272; Coins: 875; +3 more |
| Herblore | Make strength potion | 12 | 3 | 2,000 | 1,500 |  |  | 3,000,000 | 1,950,000 | Product: Strength Potion x1 \| Materials: Tarromin x1, Limpwurt Root x1 |
| Magic | Enchant Diamond Dragon Bolts (10) | 57 | 30 | 200 | 24,000 |  |  | 4,800,000 | 1,800,000 | Product: Diamond Dragon Bolt (E) x10 \| Materials: Diamond Dragon Bolt x10 |
| Herb | Gout tuber (Herb, all 5 patches) | 36 |  | 3.75 | 2,323,530 |  | 2,323,530 | 1,742,648 | 1,742,423 | All available herb patches from farming.json. Crop: Gout Tuber x1. Growth: 1.33 hours. |
| Magic | Enchant Ruby Dragon Bolts (10) | 49 | 30 | 200 | 22,000 |  |  | 4,400,000 | 1,600,000 | Product: Ruby Dragon Bolt (E) x10 \| Materials: Ruby Dragon Bolt x10 |
| Magic | Enchant Dragonstone Bolts (10) | 68 | 30 | 200 | 26,000 |  |  | 5,200,000 | 1,400,000 | Product: Dragonstone Bolt (E) x10 \| Materials: Dragonstone Bolt x10 |
| Combat 291 | Kraken | 291 |  | 100 |  | 12,816 |  | 1,281,582 | 1,281,582 | Assumes 100 kills/hr. EV: Death Rune: 3,544; Blood Rune: 2,440; Coins: 2,000; Chaos Rune: 1,545; Ranarr Weed: 1,320; Kraken Tentacle: 879; Snapdragon: 769; Big Bones: 250; +2 more |
| Fletching | Cut ruby bolt tips (12) | 63 | 2 | 3,000 | 1,356 |  |  | 4,068,000 | 1,194,000 | Product: Ruby Bolt Tips x12 \| Materials: Ruby x1 |
| Mining | Mine gems | 75 | 20 | 300 | 3,856 |  |  | 1,156,870 | 1,156,870 | Drop EV: Uncut Onyx: 2,568; Uncut Diamond: 610; Uncut Ruby: 370; Uncut Dragonstone: 180; Uncut Sapphire: 127 |
| Fletching | Make iron bolts (10) | 39 | 3 | 2,000 | 570 |  |  | 1,140,000 | 1,060,000 | Product: Iron Bolt x10 \| Materials: Feather x10, Iron Bolt (Unf) x10 |
| Runecrafting | Craft soul rune | 90 | 2 | 3,000 | 360 |  |  | 1,080,000 | 1,047,000 | Product: Soul Rune x1 \| Materials: Rune Essence x1 |
| Combat 152 | Red Dragon | 152 |  | 100 |  | 10,276 |  | 1,027,557 | 1,027,557 | Assumes 100 kills/hr. EV: Red Dragon Leather: 2,896; Dragon Bones: 2,815; Ranarr Weed: 990; Rune Platelegs: 758; Snapdragon: 427; Rune Full Helm: 414; Chaos Rune: 303; Nature Rune: 288; +14 more |
| Fletching | Make steel bolts (10) | 46 | 3 | 2,000 | 540 |  |  | 1,080,000 | 960,000 | Product: Steel Bolt x10 \| Materials: Feather x10, Steel Bolt (Unf) x10 |
| Fletching | Cut diamond bolt tips (12) | 65 | 2 | 3,000 | 2,136 |  |  | 6,408,000 | 948,000 | Product: Diamond Bolt Tips x12 \| Materials: Diamond x1 |
| Smithing | Smelt rune bar | 85 | 4 | 1,500 | 12,500 |  |  | 18,750,000 | 943,500 | Product: Rune Bar x1 \| Materials: Runite Ore x1, Coal x8 |
| Runecrafting | Craft wrath rune | 95 | 2 | 3,000 | 303 |  |  | 909,000 | 876,000 | Product: Wrath Rune x1 \| Materials: Rune Essence x1 |
| Combat 124 | Abyssal Demon | 124 |  | 100 |  | 8,586 |  | 858,648 | 858,648 | Assumes 100 kills/hr. EV: Abyssal Whip: 2,429; Rune Chainbody: 1,482; Ranarr Weed: 990; Rune Med Helm: 556; Death Rune: 473; Snapdragon: 427; Chaos Rune: 404; Rune Platelegs: 379; +14 more |
| Runecrafting | Craft blood rune | 77 | 2 | 3,000 | 287 |  |  | 861,000 | 828,000 | Product: Blood Rune x1 \| Materials: Rune Essence x1 |
| Combat 182 | Dark Beast | 182 |  | 100 |  | 7,556 |  | 755,574 | 755,574 | Assumes 100 kills/hr. EV: Runite Ore: 1,883; Coins: 1,063; Dark Bow: 734; Rune Arrow: 702; Death Rune: 662; Ranarr Weed: 660; Snapdragon: 513; Blood Rune: 431; +5 more |
| Combat 79 | Green Dragon | 79 |  | 100 |  | 7,525 |  | 752,466 | 752,466 | Assumes 100 kills/hr. EV: Dragon Bones: 2,815; Green Dragonhide: 1,686; Ranarr Weed: 990; Snapdragon: 427; Kwuarm: 229; Irit Leaf: 212; Rune Full Helm: 207; Chaos Rune: 182; +14 more |
| castle_wars | Grind for Halo |  | 18000 | 0.3333 | 2,000,000 |  | 2,000,000 | 666,667 | 666,667 | One-shot reward \| Product: Halo x1 \| Duration: 3 hours |
| pest_control | Grind for Void Knight Set |  | 36000 | 0.1667 | 4,000,000 |  | 4,000,000 | 666,667 | 666,667 | One-shot reward \| Product: void_knight_set x1 \| Rewards: Void Knight Helm, Void Knight Top, Void Knight Robe, Void Knight Gloves \| Duration: 6 hours |
| Combat 140 | Skeletal Wyvern | 140 |  | 100 |  | 6,438 |  | 643,806 | 643,806 | Assumes 100 kills/hr. EV: Dragon Bones: 2,815; Ranarr Weed: 660; Rune Platelegs: 569; Chaos Rune: 455; Snapdragon: 427; Blood Rune: 366; Death Rune: 340; Rune Chainbody: 296; +5 more |
| Magic | Enchant Diamond Bolts (10) | 57 | 30 | 200 | 7,000 |  |  | 1,400,000 | 640,000 | Product: Diamond Bolt (E) x10 \| Materials: Diamond Bolt x10 |

## Farming

| Category | Name | Level | Ticks | Actions/hr | EV/action | EV/kill | EV/completion | Gross coins/hr | Net coins/hr | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Herb | Gout tuber (Herb, all 5 patches) | 36 |  | 3.75 | 2,323,530 |  | 2,323,530 | 1,742,648 | 1,742,423 | All available herb patches from farming.json. Crop: Gout Tuber x1. Growth: 1.33 hours. |
| Herb | Gout tuber (Herb, per patch) | 36 |  | 0.7500 | 464,706 |  | 464,706 | 348,530 | 348,485 | Per patch. Crop: Gout Tuber x1. Growth: 1.33 hours. |
| Fruit tree | Papaya (Fruit tree, all 7 patches) | 57 |  | 3.32 | 80,388 |  | 80,388 | 38,079 | 29,988 | All available fruit tree patches from farming.json. Crop: Papaya Fruit x6. Growth: 2.11 hours. |
| Fruit tree | Papaya (Fruit tree, per patch) | 57 |  | 0.4737 | 11,484 |  | 11,484 | 5,440 | 4,284 | Per patch. Crop: Papaya Fruit x6. Growth: 2.11 hours. |
| Fruit tree | Orange (Fruit tree, all 7 patches) | 39 |  | 3.32 | 5,838 |  | 5,838 | 2,765 | 2,344 | All available fruit tree patches from farming.json. Crop: Orange x6. Growth: 2.11 hours. |
| Herb | Guam (Herb, all 5 patches) | 1 |  | 3.75 | 1,405 |  | 1,405 | 1,054 | 1,035 | All available herb patches from farming.json. Crop: Guam Leaf x1. Growth: 1.33 hours. |
| Herb | Tarromin (Herb, all 5 patches) | 19 |  | 3.75 | 1,120 |  | 1,120 | 840 | 810 | All available herb patches from farming.json. Crop: Tarromin x1. Growth: 1.33 hours. |
| Herb | Marrentill (Herb, all 5 patches) | 14 |  | 3.75 | 970 |  | 970 | 728 | 660 | All available herb patches from farming.json. Crop: Marrentill x1. Growth: 1.33 hours. |
| Fruit tree | Orange (Fruit tree, per patch) | 39 |  | 0.4737 | 834 |  | 834 | 395 | 335 | Per patch. Crop: Orange x6. Growth: 2.11 hours. |
| Herb | Guam (Herb, per patch) | 1 |  | 0.7500 | 281 |  | 281 | 211 | 207 | Per patch. Crop: Guam Leaf x1. Growth: 1.33 hours. |
| Herb | Tarromin (Herb, per patch) | 19 |  | 0.7500 | 224 |  | 224 | 168 | 162 | Per patch. Crop: Tarromin x1. Growth: 1.33 hours. |
| Herb | Marrentill (Herb, per patch) | 14 |  | 0.7500 | 194 |  | 194 | 146 | 132 | Per patch. Crop: Marrentill x1. Growth: 1.33 hours. |
| Fruit tree | Banana (Fruit tree, all 7 patches) | 33 |  | 3.32 | 1,176 |  | 1,176 | 557 | 16.6 | All available fruit tree patches from farming.json. Crop: Banana x6. Growth: 2.11 hours. |
| Fruit tree | Banana (Fruit tree, per patch) | 33 |  | 0.4737 | 168 |  | 168 | 79.6 | 2.37 | Per patch. Crop: Banana x6. Growth: 2.11 hours. |
| Herb | Sagewort (Herb, per patch) | 32 |  | 0.7500 | 50 |  | 50 | 37.5 | 0 | Per patch. Crop: Sagewort x1. Growth: 1.33 hours. |
| Herb | Sagewort (Herb, all 5 patches) | 32 |  | 3.75 | 250 |  | 250 | 188 | 0 | All available herb patches from farming.json. Crop: Sagewort x1. Growth: 1.33 hours. |
| Herb | Basil (Herb, per patch) | 25 |  | 0.7500 | 30 |  | 30 | 22.5 | -7.50 | Per patch. Crop: Basil x1. Growth: 1.33 hours. |
| Fruit tree | Apple (Fruit tree, per patch) | 27 |  | 0.0625 | 48 |  | 48 | 3 | -12.4 | Per patch. Crop: Apple x6. Growth: 16 hours. |
| Herb | Basil (Herb, all 5 patches) | 25 |  | 3.75 | 150 |  | 150 | 113 | -37.5 | All available herb patches from farming.json. Crop: Basil x1. Growth: 1.33 hours. |
| Fruit tree | Apple (Fruit tree, all 7 patches) | 27 |  | 0.4375 | 336 |  | 336 | 21 | -86.6 | All available fruit tree patches from farming.json. Crop: Apple x6. Growth: 16 hours. |
| Tree | Oak (Tree, per patch) | 15 |  | 0.4091 | 34 |  | 34 | 13.9 | -86.7 | Per patch. Crop: Oak Logs x1. Growth: 2.44 hours. |
| Fruit tree | Curry (Fruit tree, per patch) | 42 |  | 0.4737 | 366 |  | 366 | 173 | -135 | Per patch. Crop: Curry Leaf x6. Growth: 2.11 hours. |
| Tree | Willow (Tree, per patch) | 30 |  | 0.4091 | 21 |  | 21 | 8.59 | -139 | Per patch. Crop: Willow Logs x1. Growth: 2.44 hours. |
| Tree | Oak (Tree, all 10 patches) | 15 |  | 4.09 | 340 |  | 340 | 139 | -867 | All available tree patches from farming.json. Crop: Oak Logs x1. Growth: 2.44 hours. |
| Fruit tree | Curry (Fruit tree, all 7 patches) | 42 |  | 3.32 | 2,562 |  | 2,562 | 1,214 | -948 | All available fruit tree patches from farming.json. Crop: Curry Leaf x6. Growth: 2.11 hours. |
| Tree | Willow (Tree, all 10 patches) | 30 |  | 4.09 | 210 |  | 210 | 85.9 | -1,391 | All available tree patches from farming.json. Crop: Willow Logs x1. Growth: 2.44 hours. |
| Tree | Maple (Tree, per patch) | 45 |  | 0.4091 | 15 |  | 15 | 6.14 | -2,025 | Per patch. Crop: Maple Logs x1. Growth: 2.44 hours. |
| Fruit tree | Palm (Fruit tree, per patch) | 68 |  | 0.4737 | 300 |  | 300 | 142 | -11,392 | Per patch. Crop: Palm Fruit x6. Growth: 2.11 hours. |
| Tree | Yew (Tree, per patch) | 60 |  | 0.4091 | 127 |  | 127 | 52 | -12,251 | Per patch. Crop: Yew Logs x1. Growth: 2.44 hours. |
| Herb | Ranarr (Herb, per patch) | 52 |  | 0.7500 | 5,498 |  | 5,498 | 4,124 | -14,344 | Per patch. Crop: Ranarr Weed x1. Growth: 1.33 hours. |
| Tree | Maple (Tree, all 10 patches) | 45 |  | 4.09 | 150 |  | 150 | 61.4 | -20,250 | All available tree patches from farming.json. Crop: Maple Logs x1. Growth: 2.44 hours. |
| Tree | Magic (Tree, per patch) | 75 |  | 0.4091 | 909 |  | 909 | 372 | -39,593 | Per patch. Crop: Magic Logs x1. Growth: 2.44 hours. |
| Herb | Ranarr (Herb, all 5 patches) | 52 |  | 3.75 | 27,490 |  | 27,490 | 20,618 | -71,719 | All available herb patches from farming.json. Crop: Ranarr Weed x1. Growth: 1.33 hours. |
| Fruit tree | Palm (Fruit tree, all 7 patches) | 68 |  | 3.32 | 2,100 |  | 2,100 | 995 | -79,745 | All available fruit tree patches from farming.json. Crop: Palm Fruit x6. Growth: 2.11 hours. |
| Tree | Yew (Tree, all 10 patches) | 60 |  | 4.09 | 1,270 |  | 1,270 | 520 | -122,515 | All available tree patches from farming.json. Crop: Yew Logs x1. Growth: 2.44 hours. |
| Tree | Magic (Tree, all 10 patches) | 75 |  | 4.09 | 9,090 |  | 9,090 | 3,719 | -395,926 | All available tree patches from farming.json. Crop: Magic Logs x1. Growth: 2.44 hours. |

## Minigames

| Category | Name | Level | Ticks | Actions/hr | EV/action | EV/kill | EV/completion | Gross coins/hr | Net coins/hr | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| castle_wars | Grind for Halo |  | 18000 | 0.3333 | 2,000,000 |  | 2,000,000 | 666,667 | 666,667 | One-shot reward \| Product: Halo x1 \| Duration: 3 hours |
| pest_control | Grind for Void Knight Set |  | 36000 | 0.1667 | 4,000,000 |  | 4,000,000 | 666,667 | 666,667 | One-shot reward \| Product: void_knight_set x1 \| Rewards: Void Knight Helm, Void Knight Top, Void Knight Robe, Void Knight Gloves \| Duration: 6 hours |
| castle_wars | Obtain decorative armour |  | 12000 | 0.5000 | 1,000,000 |  | 1,000,000 | 500,000 | 500,000 | One-shot reward \| Product: Decorative Top x1 \| Duration: 2 hours |
| mage_arena | Obtain Imbued God Cape |  | 12000 | 0.5000 | 1,000,000 |  | 1,000,000 | 500,000 | 500,000 | One-shot reward \| Product: Imbued God Cape x1 \| Duration: 2 hours |
| fishing_trawler | Grind Angler Net |  | 30000 | 0.2000 | 1,000,000 |  | 1,000,000 | 200,000 | 200,000 | One-shot reward \| Product: Angler Net x1 \| Duration: 5 hours |
| warriors_guild | Grind for Dragon Defender |  | 12000 | 0.5000 | 35,000 |  | 35,000 | 17,500 | 17,500 | One-shot reward \| Product: Dragon Defender x1 \| Duration: 2 hours |
| barbarian_assault | Grind for Fighter Torso |  | 30000 | 0.2000 | 0 |  | 0 | 0 | 0 | One-shot reward \| Product: Fighter Torso x1 \| Duration: 5 hours |
| barbarian_assault | Grind for Fighter Hat |  | 12000 | 0.5000 | 0 |  | 0 | 0 | 0 | One-shot reward \| Product: Fighter Hat x1 \| Duration: 2 hours |
| warriors_guild | Grind for Rune Defender |  | 18000 | 0.3333 | 0 |  | 0 | 0 | 0 | One-shot reward \| Product: Rune Defender x1 \| Duration: 3 hours |

## Monsters

| Category | Name | Level | Ticks | Actions/hr | EV/action | EV/kill | EV/completion | Gross coins/hr | Net coins/hr | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Combat 894 | Corrupted Gauntlet | 894 |  | 100 |  | 1,263,543 |  | 126,354,287 | 126,354,287 | Assumes 100 kills/hr. EV: Bow of Faerdhinen: 400,000; Blade of Saeldor: 400,000; Crystal Pickaxe: 75,000; Crystal Axe: 75,000; Coins: 36,750; Dragon Bones: 35,188; Crystal Helmet: 30,000; Crystal Plate Body: 30,000; +26 more |
| Combat 725 | Zulrah | 725 |  | 100 |  | 387,806 |  | 38,780,626 | 38,780,626 | Assumes 100 kills/hr. EV: Toxic Blowpipe: 100,000; Trident of the Swamp: 100,000; Serpentine Helm: 100,000; Zulrah's Scales: 60,450; Uncut Onyx: 10,273; Coins: 7,200; Ranarr Weed: 2,886; Blood Rune: 2,009; +5 more |
| Combat 580 | Kree'arra | 580 |  | 100 |  | 235,925 |  | 23,592,543 | 23,592,543 | Assumes 100 kills/hr. EV: Armadyl Chestplate: 98,878; Armadyl Chainskirt: 73,025; Armadyl Helmet: 24,438; Coins: 20,000; Armadyl Hilt: 14,297; Death Rune: 1,063; Ranarr Weed: 990; Blood Rune: 574; +16 more |
| Combat 624 | General Graardor | 624 |  | 100 |  | 170,818 |  | 17,081,823 | 17,081,823 | Assumes 100 kills/hr. EV: Bandos Chestplate: 64,311; Bandos Tassets: 43,132; Bandos Hilt: 35,642; Coins: 20,000; Bandos Boots: 1,771; Death Rune: 1,063; Ranarr Weed: 990; Blood Rune: 574; +18 more |
| Combat 596 | Commander Zilyana | 596 |  | 100 |  | 147,479 |  | 14,747,925 | 14,747,925 | Assumes 100 kills/hr. EV: Armadyl Crossbow: 66,307; Saradomin Hilt: 54,318; Coins: 20,000; Saradomin Sword: 1,341; Death Rune: 1,063; Ranarr Weed: 990; Blood Rune: 574; Soul Rune: 504; +15 more |
| Combat 650 | K'ril Tsutsaroth | 650 |  | 100 |  | 132,486 |  | 13,248,649 | 13,248,649 | Assumes 100 kills/hr. EV: Zamorak Spear: 59,250; Zamorak Hilt: 36,273; Coins: 20,000; Staff of the Dead: 11,149; Death Rune: 1,063; Ranarr Weed: 990; Blood Rune: 574; Soul Rune: 504; +16 more |
| Combat 194 | Hydra | 194 |  | 100 |  | 108,684 |  | 10,868,439 | 10,868,439 | Assumes 100 kills/hr. EV: Hydra Leather: 69,323; Ferocious Gloves: 10,200; Hydra Claw: 9,000; Hydra Bones: 7,633; Coins: 3,500; Runite Ore: 2,093; Death Rune: 1,985; Blood Rune: 1,679; +6 more |
| Combat 380 | Rune Dragon | 380 |  | 100 |  | 93,431 |  | 9,343,067 | 9,343,067 | Assumes 100 kills/hr. EV: Onyx Bolt Tips: 16,600; Coins: 15,000; Rune Bar: 12,500; Runite Ore: 9,417; Dragon Chainbody: 5,473; Dragon Kiteshield: 4,828; Dragon Platelegs: 4,029; Dragon Plateskirt: 4,027; +12 more |
| Combat 275 | Demonic Gorilla | 275 |  | 100 |  | 86,302 |  | 8,630,207 | 8,630,207 | Assumes 100 kills/hr. EV: Uncut Zenyte: 67,442; Heavy Ballista: 5,250; Ranarr Weed: 4,398; Coins: 3,000; Dragon Bones: 2,815; Snapdragon: 1,282; Death Rune: 992; Blood Rune: 718; +2 more |
| Combat 338 | Adamant Dragon | 338 |  | 100 |  | 69,986 |  | 6,998,580 | 6,998,580 | Assumes 100 kills/hr. EV: Onyx Bolt Tips: 16,600; Rune Bar: 12,500; Coins: 10,000; Runite Ore: 4,708; Dragon Chainbody: 4,105; Draconic Visage: 3,679; Dragon Platelegs: 3,223; Dragon Plateskirt: 3,222; +9 more |
| Combat 318 | Cerberus | 318 |  | 100 |  | 65,926 |  | 6,592,554 | 6,592,554 | Assumes 100 kills/hr. EV: Primordial Crystal: 32,624; Coins: 11,250; Eternal Crystal: 6,375; Death Rune: 3,780; Blood Rune: 3,014; Dragon Bones: 2,815; Ranarr Weed: 1,924; Soul Rune: 1,404; +6 more |
| Combat 303 | Dagannoth Rex | 303 |  | 100 |  | 57,323 |  | 5,732,314 | 5,732,314 | Assumes 100 kills/hr. EV: Berserker Ring: 25,412; Dagannoth Bones: 14,448; Coins: 6,500; Dragon Axe: 4,096; Rune Platebody: 1,924; Rune Platelegs: 1,896; Ranarr Weed: 990; Warriors Ring: 781; +11 more |
| Combat 303 | Dagannoth Supreme | 303 |  | 100 |  | 51,834 |  | 5,183,371 | 5,183,371 | Assumes 100 kills/hr. EV: Archers Ring: 20,704; Dagannoth Bones: 14,448; Coins: 6,500; Dragon Axe: 4,096; Rune Platebody: 1,924; Rune Platelegs: 1,896; Ranarr Weed: 990; Snapdragon: 427; +10 more |
| Combat 303 | Dagannoth Prime | 303 |  | 100 |  | 37,468 |  | 3,746,817 | 3,746,817 | Assumes 100 kills/hr. EV: Dagannoth Bones: 14,448; Coins: 6,500; Seers Ring: 6,339; Dragon Axe: 4,096; Rune Platebody: 1,924; Rune Platelegs: 1,896; Ranarr Weed: 990; Snapdragon: 427; +10 more |
| Combat 276 | King Black Dragon | 276 |  | 100 |  | 28,701 |  | 2,870,111 | 2,870,111 | Assumes 100 kills/hr. EV: Coins: 12,500; Runite Ore: 7,324; Dragon Bones: 2,815; Draconic Visage: 1,840; Dragon Pickaxe: 1,429; Blood Rune: 1,076; Death Rune: 907; Soul Rune: 810; +1 more |
| Combat 318 | Brutal Black Dragon | 318 |  | 100 |  | 26,098 |  | 2,609,761 | 2,609,761 | Assumes 100 kills/hr. EV: Coins: 6,000; Black Dragon Leather: 4,182; Draconic Visage: 3,679; Runite Ore: 3,139; Dragon Bones: 2,815; Dragon Arrow: 1,447; Death Rune: 1,040; Blood Rune: 904; +6 more |
| Combat 150 | Lizardman Shaman | 150 |  | 100 |  | 21,142 |  | 2,114,161 | 2,114,161 | Assumes 100 kills/hr. EV: Dragon Warhammer: 5,358; Snapdragon: 4,272; Ranarr Weed: 2,749; Blood Rune: 2,153; Rune Chainbody: 1,482; Death Rune: 1,418; Kwuarm: 1,272; Coins: 875; +3 more |
| Combat 291 | Kraken | 291 |  | 100 |  | 12,816 |  | 1,281,582 | 1,281,582 | Assumes 100 kills/hr. EV: Death Rune: 3,544; Blood Rune: 2,440; Coins: 2,000; Chaos Rune: 1,545; Ranarr Weed: 1,320; Kraken Tentacle: 879; Snapdragon: 769; Big Bones: 250; +2 more |
| Combat 152 | Red Dragon | 152 |  | 100 |  | 10,276 |  | 1,027,557 | 1,027,557 | Assumes 100 kills/hr. EV: Red Dragon Leather: 2,896; Dragon Bones: 2,815; Ranarr Weed: 990; Rune Platelegs: 758; Snapdragon: 427; Rune Full Helm: 414; Chaos Rune: 303; Nature Rune: 288; +14 more |
| Combat 124 | Abyssal Demon | 124 |  | 100 |  | 8,586 |  | 858,648 | 858,648 | Assumes 100 kills/hr. EV: Abyssal Whip: 2,429; Rune Chainbody: 1,482; Ranarr Weed: 990; Rune Med Helm: 556; Death Rune: 473; Snapdragon: 427; Chaos Rune: 404; Rune Platelegs: 379; +14 more |
| Combat 182 | Dark Beast | 182 |  | 100 |  | 7,556 |  | 755,574 | 755,574 | Assumes 100 kills/hr. EV: Runite Ore: 1,883; Coins: 1,063; Dark Bow: 734; Rune Arrow: 702; Death Rune: 662; Ranarr Weed: 660; Snapdragon: 513; Blood Rune: 431; +5 more |
| Combat 79 | Green Dragon | 79 |  | 100 |  | 7,525 |  | 752,466 | 752,466 | Assumes 100 kills/hr. EV: Dragon Bones: 2,815; Green Dragonhide: 1,686; Ranarr Weed: 990; Snapdragon: 427; Kwuarm: 229; Irit Leaf: 212; Rune Full Helm: 207; Chaos Rune: 182; +14 more |
| Combat 140 | Skeletal Wyvern | 140 |  | 100 |  | 6,438 |  | 643,806 | 643,806 | Assumes 100 kills/hr. EV: Dragon Bones: 2,815; Ranarr Weed: 660; Rune Platelegs: 569; Chaos Rune: 455; Snapdragon: 427; Blood Rune: 366; Death Rune: 340; Rune Chainbody: 296; +5 more |
| Combat 120 | Spiritual Mage | 120 |  | 100 |  | 4,130 |  | 412,963 | 412,963 | Assumes 100 kills/hr. EV: Dragon Boots: 1,020; Blood Rune: 517; Chaos Rune: 500; Ranarr Weed: 495; Death Rune: 473; Coins: 468; Snapdragon: 342; Mystic Robe Top: 108; +5 more |
| Combat 134 | Spiritual Warrior | 134 |  | 100 |  | 4,054 |  | 405,436 | 405,436 | Assumes 100 kills/hr. EV: Dragon Boots: 1,020; Ranarr Weed: 577; Snapdragon: 427; Coins: 400; Rune Chainbody: 356; Death Rune: 340; Rune Platelegs: 303; Blood Rune: 237; +4 more |
| Combat 160 | Smoke Devil | 160 |  | 100 |  | 4,044 |  | 404,382 | 404,382 | Assumes 100 kills/hr. EV: Ranarr Weed: 660; Occult Necklace: 623; Chaos Rune: 556; Coins: 510; Blood Rune: 431; Death Rune: 378; Rune Chainbody: 356; Snapdragon: 342; +4 more |
| Combat 113 | Spiritual Ranger | 113 |  | 100 |  | 3,598 |  | 359,753 | 359,753 | Assumes 100 kills/hr. EV: Dragon Boots: 1,020; Ranarr Weed: 495; Snapdragon: 342; Coins: 340; Rune Arrow: 322; Green Dragon Leather: 294; Chaos Rune: 265; Blood Rune: 189; +4 more |
| Combat 96 | Aberrant Spectre | 96 |  | 100 |  | 3,512 |  | 351,226 | 351,226 | Assumes 100 kills/hr. EV: Ranarr Seed: 985; Ranarr Weed: 660; Snapdragon: 427; Death Rune: 221; Chaos Rune: 182; Coins: 168; Mystic Robe Top: 144; Mystic Robe Bottom: 142; +10 more |
| Combat 111 | Gargoyle | 111 |  | 100 |  | 2,781 |  | 278,070 | 278,070 | Assumes 100 kills/hr. EV: Ranarr Weed: 577; Coins: 404; Rune Chainbody: 356; Snapdragon: 342; Chaos Rune: 265; Blood Rune: 189; Death Rune: 184; Rune Full Helm: 165; +4 more |
| Combat 115 | Nechryael | 115 |  | 100 |  | 2,731 |  | 273,101 | 273,101 | Assumes 100 kills/hr. EV: Ranarr Weed: 660; Rune Chainbody: 356; Snapdragon: 342; Death Rune: 340; Chaos Rune: 265; Coins: 244; Blood Rune: 189; Kwuarm: 127; +4 more |
| Combat 99 | Wyrm | 99 |  | 100 |  | 2,488 |  | 248,835 | 248,835 | Assumes 100 kills/hr. EV: Granite Dust: 750; Ranarr Weed: 495; Snapdragon: 342; Chaos Rune: 265; Coins: 210; Death Rune: 147; Mystic Robe Top: 108; Earth Rune: 54; +4 more |
| Combat 204 | Crazy Archaeologist | 204 |  | 100 |  | 1,947 |  | 194,747 | 194,747 | Assumes 100 kills/hr. EV: Ranarr Weed: 990; Rune Crossbow: 378; Red D'Hide Body: 186; Amulet of Power: 119; Guam Leaf: 84.3; Harralander: 66.5; Tarromin: 50.4; White Berries: 44.7; +2 more |
| Combat 76 | Blood Veld | 76 |  | 100 |  | 978 |  | 97,825 | 97,825 | Assumes 100 kills/hr. EV: Ranarr Weed: 275; Chaos Rune: 155; Death Rune: 90.7; Rune Med Helm: 89; Coins: 87.5; Blood Rune: 80.4; Irit Leaf: 70.6; Guam Leaf: 42.2; +5 more |
| Combat 20 | Dark Wizard | 20 |  | 100 |  | 878 |  | 87,756 | 87,756 | Assumes 100 kills/hr. EV: Staff of Air: 149; Staff of Water: 108; Chaos Rune: 101; Nature Rune: 84; Staff of Fire: 79.9; Staff of Earth: 47.6; Earth Rune: 37.8; Cosmic Rune: 34.9; +12 more |
| Combat 82 | Lesser Demon | 82 |  | 100 |  | 781 |  | 78,134 | 78,134 | Assumes 100 kills/hr. EV: Rune Med Helm: 223; Ranarr Weed: 198; Snapdragon: 85.4; Coins: 76.5; Kwuarm: 45.8; Irit Leaf: 42.4; Bones: 29; Cadantine: 24.6; +7 more |
| Combat 42 | Moss Giant | 42 |  | 100 |  | 693 |  | 69,260 | 69,260 | Assumes 100 kills/hr. EV: Big Bones: 250; Ranarr Weed: 99; Nature Rune: 64.8; Snapdragon: 42.7; Chaos Rune: 35.4; Limpwurt Root: 30.1; Coins: 24.8; Kwuarm: 22.9; +15 more |
| Combat 28 | Hill Giant | 28 |  | 100 |  | 648 |  | 64,755 | 64,755 | Assumes 100 kills/hr. EV: Big Bones: 250; Ranarr Weed: 99; Nature Rune: 72; Snapdragon: 42.7; Limpwurt Root: 30.1; Kwuarm: 22.9; Irit Leaf: 21.2; Death Rune: 15.1; +15 more |
| Combat 23 | Banshee | 23 |  | 100 |  | 334 |  | 33,413 | 33,413 | Assumes 100 kills/hr. EV: Ranarr Weed: 165; Irit Leaf: 35.3; Bones: 29; Chaos Rune: 20.2; Harralander: 17.7; Guam Leaf: 16.9; Coins: 16.5; Tarromin: 11.2; +5 more |
| Combat 15 | Sand Crab | 15 |  | 100 |  | 327 |  | 32,724 | 32,724 | Assumes 100 kills/hr. EV: Ranarr Weed: 99; Nature Rune: 48; Snapdragon: 42.7; Bones: 29; Kwuarm: 22.9; Irit Leaf: 21.2; Cadantine: 12.3; Coins: 10.5; +9 more |
| Combat 13 | Rock Crab | 13 |  | 100 |  | 314 |  | 31,422 | 31,422 | Assumes 100 kills/hr. EV: Ranarr Weed: 99; Snapdragon: 42.7; Nature Rune: 38.4; Bones: 29; Kwuarm: 22.9; Irit Leaf: 21.2; Cadantine: 12.3; Coins: 8.70; +9 more |
| Combat 5 | Goblin | 5 |  | 100 |  | 272 |  | 27,216 | 27,216 | Assumes 100 kills/hr. EV: Ranarr Weed: 99; Snapdragon: 42.7; Bones: 29; Kwuarm: 22.9; Irit Leaf: 21.2; Bronze Spear: 14.3; Cadantine: 12.3; Guam Leaf: 8.43; +7 more |
| Combat 27 | Giant Spider | 27 |  | 100 |  | 260 |  | 25,966 | 25,966 | Assumes 100 kills/hr. EV: Ranarr Weed: 99; Snapdragon: 42.7; Bones: 29; Kwuarm: 22.9; Irit Leaf: 21.2; Cadantine: 12.3; Guam Leaf: 8.43; Harralander: 6.64; +6 more |
| Combat 9 | Wizard | 9 |  | 100 |  | 181 |  | 18,132 | 18,132 | Assumes 100 kills/hr. EV: Chaos Rune: 30.3; Bones: 29; Nature Rune: 28.8; Earth Rune: 15.8; Air Rune: 13.6; Wizard Hat: 12.6; Staff: 11.6; Water Rune: 10.5; +6 more |
| Combat 8 | Cow | 8 |  | 100 |  | 168 |  | 16,802 | 16,802 | Assumes 100 kills/hr. EV: Cowhide: 109; Raw Beef: 30; Bones: 29; Clue Scroll (Medium): 0.0200 |
| Combat 1 | Chicken | 1 |  | 100 |  | 69 |  | 6,902 | 6,902 | Assumes 100 kills/hr. EV: Bones: 29; Raw Chicken: 20; Feather: 20; Clue Scroll (Medium): 0.0200 |
| Combat 702 | TzKal-Zuk (Jad) | 702 |  | 100 |  | 0.0200 |  | 2 | 2 | Assumes 100 kills/hr. EV: Clue Scroll (Master): 0.0200; Fire Cape: 0 |
| Combat 1400 | The Inferno (TzKal-Zuk) | 1400 |  | 100 |  | 0.0200 |  | 2 | 2 | Assumes 100 kills/hr. EV: Clue Scroll (Master): 0.0200; Infernal Cape: 0 |

## Raids

| Category | Name | Level | Ticks | Actions/hr | EV/action | EV/kill | EV/completion | Gross coins/hr | Net coins/hr | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chambers of Xeric | Chambers of Xeric |  |  | 1 |  |  | 16,784,851 | 16,784,851 | 16,784,851 | Assumes 1 completions/hr \| Common EV: 198,708 \| Unique EV: 16,586,144 \| Unique table: Twisted Bow 0.500% EV 7,909,400; Ancestral Robe Top 1.500% EV 1,948,984; Ancestral Robe Bottom 1.500% EV 1,363,348; Elder Maul 1.000% EV 1,020,095; Dragon Hunter Crossbow 2.000% EV 811,943; Ancestral Hat 1.500% EV 808,709; Kodai Wand 1.000% EV 787,437; Zaryte Vambraces 1.000% EV 784,272; +3 more |
| Theatre of Blood | Theatre of Blood |  |  | 1 |  |  | 8,252,613 | 8,252,613 | 8,252,613 | Assumes 1 completions/hr \| Common EV: 389,718 \| Unique EV: 7,862,895 \| Unique table: Avernic Defender 4.627% EV 3,701,895; Sanguinesti Staff 1.157% EV 1,735,263; Scythe of Vitur 0.578% EV 1,735,263; Ghrazi Rapier 1.157% EV 307,842; Justiciar Faceguard 1.157% EV 137,490; Justiciar Chestguard 1.157% EV 131,093; Justiciar Legguards 1.157% EV 114,049 |
| Barrows Brothers | Barrows Brothers |  |  | 1 |  |  | 280,008 | 280,008 | 280,008 | Assumes 1 completions/hr \| Common EV: 150,828 \| Unique EV: 129,180 \| Unique table: Ahrim's Robeskirt 1.042% EV 20,754; Dharok's Greataxe 1.042% EV 20,083; Ahrim's Robetop 1.042% EV 20,031; Karil's Leathertop 1.042% EV 11,229; Dharok's Platebody 1.042% EV 8,606; Dharok's Platelegs 1.042% EV 8,568; Karil's Leatherskirt 1.042% EV 4,839; Torag's Platebody 1.042% EV 3,912; +16 more |

## Skilling

| Category | Name | Level | Ticks | Actions/hr | EV/action | EV/kill | EV/completion | Gross coins/hr | Net coins/hr | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fletching | Make dragon bolts (10) | 84 | 3 | 2,000 | 12,000 |  |  | 24,000,000 | 15,960,000 | Product: Dragon Bolt x10 \| Materials: Feather x10, Dragon Bolt (Unf) x10 |
| Smithing | Smith rune pickaxe | 86 | 5 | 1,200 | 18,685 |  |  | 22,422,000 | 7,422,000 | Product: Rune Pickaxe x1 \| Materials: Rune Bar x1 |
| Mining | Mine runite ore | 85 | 9 | 667 | 10,463 |  |  | 6,975,333 | 6,975,333 | Product: Runite Ore x1 |
| Herblore | Make combat potion | 36 | 3 | 2,000 | 4,000 |  |  | 8,000,000 | 6,724,000 | Product: Combat Potion x1 \| Materials: Harralander x1, Goat Horn Dust x1 |
| Fletching | Tip dragonstone dragon bolts (10) | 84 | 30 | 200 | 36,000 |  |  | 7,200,000 | 3,590,000 | Product: Dragonstone Dragon Bolt x10 \| Materials: Dragon Bolt x10, Dragonstone Bolt Tips x10 |
| Fletching | Make adamant bolts (10) | 61 | 3 | 2,000 | 1,590 |  |  | 3,180,000 | 2,940,000 | Product: Adamant Bolt x10 \| Materials: Feather x10, Adamant Bolt (Unf) x10 |
| Fletching | Tip dragonstone bolts (10) | 71 | 30 | 200 | 19,000 |  |  | 3,800,000 | 2,506,000 | Product: Dragonstone Bolt x10 \| Materials: Runite Bolt x10, Dragonstone Bolt Tips x10 |
| Magic | Enchant Dragonstone Dragon Bolts (10) | 68 | 30 | 200 | 48,000 |  |  | 9,600,000 | 2,400,000 | Product: Dragonstone Dragon Bolt (E) x10 \| Materials: Dragonstone Dragon Bolt x10 |
| Herblore | Make strength potion | 12 | 3 | 2,000 | 1,500 |  |  | 3,000,000 | 1,950,000 | Product: Strength Potion x1 \| Materials: Tarromin x1, Limpwurt Root x1 |
| Magic | Enchant Diamond Dragon Bolts (10) | 57 | 30 | 200 | 24,000 |  |  | 4,800,000 | 1,800,000 | Product: Diamond Dragon Bolt (E) x10 \| Materials: Diamond Dragon Bolt x10 |
| Magic | Enchant Ruby Dragon Bolts (10) | 49 | 30 | 200 | 22,000 |  |  | 4,400,000 | 1,600,000 | Product: Ruby Dragon Bolt (E) x10 \| Materials: Ruby Dragon Bolt x10 |
| Magic | Enchant Dragonstone Bolts (10) | 68 | 30 | 200 | 26,000 |  |  | 5,200,000 | 1,400,000 | Product: Dragonstone Bolt (E) x10 \| Materials: Dragonstone Bolt x10 |
| Fletching | Cut ruby bolt tips (12) | 63 | 2 | 3,000 | 1,356 |  |  | 4,068,000 | 1,194,000 | Product: Ruby Bolt Tips x12 \| Materials: Ruby x1 |
| Mining | Mine gems | 75 | 20 | 300 | 3,856 |  |  | 1,156,870 | 1,156,870 | Drop EV: Uncut Onyx: 2,568; Uncut Diamond: 610; Uncut Ruby: 370; Uncut Dragonstone: 180; Uncut Sapphire: 127 |
| Fletching | Make iron bolts (10) | 39 | 3 | 2,000 | 570 |  |  | 1,140,000 | 1,060,000 | Product: Iron Bolt x10 \| Materials: Feather x10, Iron Bolt (Unf) x10 |
| Runecrafting | Craft soul rune | 90 | 2 | 3,000 | 360 |  |  | 1,080,000 | 1,047,000 | Product: Soul Rune x1 \| Materials: Rune Essence x1 |
| Fletching | Make steel bolts (10) | 46 | 3 | 2,000 | 540 |  |  | 1,080,000 | 960,000 | Product: Steel Bolt x10 \| Materials: Feather x10, Steel Bolt (Unf) x10 |
| Fletching | Cut diamond bolt tips (12) | 65 | 2 | 3,000 | 2,136 |  |  | 6,408,000 | 948,000 | Product: Diamond Bolt Tips x12 \| Materials: Diamond x1 |
| Smithing | Smelt rune bar | 85 | 4 | 1,500 | 12,500 |  |  | 18,750,000 | 943,500 | Product: Rune Bar x1 \| Materials: Runite Ore x1, Coal x8 |
| Runecrafting | Craft wrath rune | 95 | 2 | 3,000 | 303 |  |  | 909,000 | 876,000 | Product: Wrath Rune x1 \| Materials: Rune Essence x1 |
| Runecrafting | Craft blood rune | 77 | 2 | 3,000 | 287 |  |  | 861,000 | 828,000 | Product: Blood Rune x1 \| Materials: Rune Essence x1 |
| Magic | Enchant Diamond Bolts (10) | 57 | 30 | 200 | 7,000 |  |  | 1,400,000 | 640,000 | Product: Diamond Bolt (E) x10 \| Materials: Diamond Bolt x10 |
| Woodcutting | Chop magic | 75 | 9 | 667 | 909 |  |  | 606,000 | 606,000 | Product: Magic Logs x1 |
| Crafting | Tan green dragon hide | 55 | 3 | 2,000 | 1,960 |  |  | 3,920,000 | 548,000 | Product: Green Dragon Leather x1 \| Materials: Green Dragonhide x1 |
| Smithing | Smith iron pickaxe | 16 | 5 | 1,200 | 593 |  |  | 711,600 | 538,800 | Product: Iron Pickaxe x1 \| Materials: Iron Bar x1 |
| Runecrafting | Craft death rune | 65 | 2 | 3,000 | 189 |  |  | 567,000 | 534,000 | Product: Death Rune x1 \| Materials: Rune Essence x1 |
| Smithing | Smelt adamant bar | 70 | 4 | 1,500 | 2,048 |  |  | 3,072,000 | 522,000 | Product: Adamant Bar x1 \| Materials: Adamantite Ore x1, Coal x6 |
| Fletching | Attach feathers (15) | 1 | 2 | 3,000 | 210 |  |  | 630,000 | 495,000 | Product: Headless Arrow x15 \| Materials: Arrow Shaft x15, Feather x15 |
| Mining | Mine adamantite ore | 70 | 8 | 750 | 644 |  |  | 483,000 | 483,000 | Product: Adamantite Ore x1 |
| Herblore | Make super attack | 45 | 3 | 2,000 | 2,000 |  |  | 4,000,000 | 464,000 | Product: Super Attack x1 \| Materials: Irit Leaf x1, Eye of Newt x1 |
| Fishing | Fish shark | 76 | 8 | 750 | 599 |  |  | 449,250 | 449,250 | Product: Raw Shark x1 |
| Fletching | Make mithril bolts (10) | 54 | 3 | 2,000 | 310 |  |  | 620,000 | 440,000 | Product: Mithril Bolt x10 \| Materials: Feather x10, Mithril Bolt (Unf) x10 |
| Magic | Enchant Ruby Bolts (10) | 49 | 30 | 200 | 5,000 |  |  | 1,000,000 | 440,000 | Product: Ruby Bolt (E) x10 \| Materials: Ruby Bolt x10 |
| Crafting | String diamond amulet | 70 | 4 | 1,500 | 2,236 |  |  | 3,354,000 | 438,000 | Product: Diamond Amulet x1 \| Materials: Diamond x1, Gold Bar x1 |
| Runecrafting | Craft law rune | 54 | 2 | 3,000 | 123 |  |  | 369,000 | 336,000 | Product: Law Rune x1 \| Materials: Rune Essence x1 |
| Runecrafting | Craft nature rune | 44 | 2 | 3,000 | 120 |  |  | 360,000 | 327,000 | Product: Nature Rune x1 \| Materials: Rune Essence x1 |
| Cooking | Cook shark | 80 | 4 | 1,500 | 791 |  |  | 1,186,500 | 288,000 | Product: Shark x1 \| Materials: Raw Shark x1 |
| Runecrafting | Craft chaos rune | 35 | 2 | 3,000 | 101 |  |  | 303,000 | 270,000 | Product: Chaos Rune x1 \| Materials: Rune Essence x1 |
| Magic | Plank Make | 86 | 3 | 2,000 | 156 |  |  | 312,000 | 258,000 | Product: Plank x1 \| Materials: Logs x1 |
| Runecrafting | Craft cosmic rune | 27 | 2 | 3,000 | 97 |  |  | 291,000 | 258,000 | Product: Cosmic Rune x1 \| Materials: Rune Essence x1 |
| Runecrafting | Craft astral rune | 40 | 2 | 3,000 | 95 |  |  | 285,000 | 252,000 | Product: Astral Rune x1 \| Materials: Rune Essence x1 |
| Fletching | Tip diamond dragon bolts (10) | 84 | 30 | 200 | 15,000 |  |  | 3,000,000 | 244,000 | Product: Diamond Dragon Bolt x10 \| Materials: Dragon Bolt x10, Diamond Bolt Tips x10 |
| Smithing | Smelt steel bar | 30 | 4 | 1,500 | 595 |  |  | 892,500 | 243,000 | Product: Steel Bar x1 \| Materials: Iron Ore x1, Coal x2 |
| Fletching | Cut wooden stocks (10) | 9 | 2 | 3,000 | 100 |  |  | 300,000 | 219,000 | Product: Wooden Stock x10 \| Materials: Logs x1 |
| Smithing | Smelt mithril bar | 50 | 4 | 1,500 | 994 |  |  | 1,491,000 | 211,500 | Product: Mithril Bar x1 \| Materials: Mithril Ore x1, Coal x4 |
| Crafting | Spin bowstring | 10 | 3 | 2,000 | 100 |  |  | 200,000 | 198,000 | Product: Bowstring x1 \| Materials: Flax x1 |
| Woodcutting | Chop mahogany | 50 | 8 | 750 | 249 |  |  | 186,750 | 186,750 | Product: Mahogany Logs x1 |
| Fishing | Fish swordfish | 50 | 7 | 857 | 212 |  |  | 181,714 | 181,714 | Product: Raw Swordfish x1 |
| Mining | Mine coal | 30 | 6 | 1,000 | 176 |  |  | 176,000 | 176,000 | Product: Coal x1 |
| Fletching | Tip ruby dragon bolts (10) | 84 | 30 | 200 | 14,000 |  |  | 2,800,000 | 174,000 | Product: Ruby Dragon Bolt x10 \| Materials: Dragon Bolt x10, Ruby Bolt Tips x10 |
| Agility | Ardougne Rooftop | 90 | 18 | 333 | 500 |  |  | 166,667 | 166,667 |  |
| Crafting | String ruby amulet | 50 | 4 | 1,500 | 1,188 |  |  | 1,782,000 | 159,000 | Product: Ruby Amulet x1 \| Materials: Ruby x1, Gold Bar x1 |
| Crafting | Tan cowhide (hard) | 1 | 2 | 3,000 | 161 |  |  | 483,000 | 156,000 | Product: Hard Leather x1 \| Materials: Cowhide x1 |
| Fletching | String yew shortbow | 65 | 5 | 1,200 | 416 |  |  | 499,200 | 145,200 | Product: Yew Shortbow x1 \| Materials: Yew Shortbow (U) x1, Bowstring x1 |
| Fishing | Fish lobster | 40 | 6 | 1,000 | 145 |  |  | 145,000 | 145,000 | Product: Raw Lobster x1 |
| Mining | Mine gold ore | 40 | 6 | 1,000 | 144 |  |  | 144,000 | 144,000 | Product: Gold Ore x1 |
| Magic | Enchant Ruby | 49 | 30 | 200 | 1,897 |  |  | 379,400 | 141,800 | Product: Amulet of Strength x1 \| Materials: Ruby Amulet x1 |
| Mining | Mine mithril ore | 55 | 7 | 857 | 149 |  |  | 127,714 | 127,714 | Product: Mithril Ore x1 |
| Agility | Rellekka Rooftop | 80 | 20 | 300 | 400 |  |  | 120,000 | 120,000 |  |
| Magic | Spin Flax | 76 | 5 | 1,200 | 100 |  |  | 120,000 | 118,800 | Product: Bowstring x1 \| Materials: Flax x1 |
| Crafting | Tan cowhide | 1 | 2 | 3,000 | 148 |  |  | 444,000 | 117,000 | Product: Leather x1 \| Materials: Cowhide x1 |
| Fletching | Cut maple shortbow (u) | 50 | 4 | 1,500 | 91 |  |  | 136,500 | 114,000 | Product: Maple Shortbow (U) x1 \| Materials: Maple Logs x1 |
| Mining | Mine clay | 1 | 4 | 1,500 | 72 |  |  | 108,000 | 108,000 | Product: Clay x1 |
| Woodcutting | Chop teak | 35 | 7 | 857 | 121 |  |  | 103,714 | 103,714 | Product: Teak Logs x1 |
| Fletching | Make runite bolts (10) | 69 | 3 | 2,000 | 420 |  |  | 840,000 | 100,000 | Product: Runite Bolt x10 \| Materials: Feather x10, Runite Bolt (Unf) x10 |
| Mining | Mine iron ore | 15 | 5 | 1,200 | 81 |  |  | 97,200 | 97,200 | Product: Iron Ore x1 |
| Woodcutting | Chop yew | 60 | 8 | 750 | 127 |  |  | 95,250 | 95,250 | Product: Yew Logs x1 |
| Smithing | Smelt iron bar | 15 | 4 | 1,500 | 144 |  |  | 216,000 | 94,500 | Product: Iron Bar x1 \| Materials: Iron Ore x1 |
| Agility | Pollnivneach Rooftop | 70 | 23 | 261 | 350 |  |  | 91,304 | 91,304 |  |
| Fletching | Tip diamond bolts (10) | 65 | 30 | 200 | 3,800 |  |  | 760,000 | 86,000 | Product: Diamond Bolt x10 \| Materials: Adamant Bolt x10, Diamond Bolt Tips x10 |
| Cooking | Cook meat | 1 | 4 | 1,500 | 85 |  |  | 127,500 | 82,500 | Product: Cooked Meat x1 \| Materials: Raw Beef x1 |
| Fletching | Cut yew shortbow (u) | 65 | 5 | 1,200 | 195 |  |  | 234,000 | 81,600 | Product: Yew Shortbow (U) x1 \| Materials: Yew Logs x1 |
| Crafting | String emerald amulet | 31 | 4 | 1,500 | 698 |  |  | 1,047,000 | 81,000 | Product: Emerald Amulet x1 \| Materials: Emerald x1, Gold Bar x1 |
| Magic | Enchant Dragonstone | 68 | 30 | 200 | 11,259 |  |  | 2,251,800 | 76,200 | Product: Amulet of Glory x1 \| Materials: Dragonstone Amulet x1 |
| Agility | Seers' Village Rooftop | 60 | 25 | 240 | 300 |  |  | 72,000 | 72,000 |  |
| Cooking | Cook chicken | 1 | 4 | 1,500 | 66 |  |  | 99,000 | 69,000 | Product: Cooked Chicken x1 \| Materials: Raw Chicken x1 |
| Crafting | Make molten glass | 1 | 4 | 1,500 | 89 |  |  | 133,500 | 61,500 | Product: Molten Glass x1 \| Materials: Soda Ash x1, Bucket of Sand x1 |
| Fishing | Fish shrimps | 1 | 4 | 1,500 | 38 |  |  | 57,000 | 57,000 | Product: Raw Shrimps x1 |
| Fishing | Fish trout | 20 | 5 | 1,200 | 42 |  |  | 50,400 | 50,400 | Product: Raw Trout x1 |
| Smithing | Smelt bronze bar | 1 | 4 | 1,500 | 60 |  |  | 90,000 | 49,500 | Product: Bronze Bar x1 \| Materials: Tin Ore x1, Copper Ore x1 |
| Magic | Tan Leather | 78 | 5 | 1,200 | 148 |  |  | 177,600 | 46,800 | Product: Leather x1 \| Materials: Cowhide x1 |
| Agility | Falador Rooftop | 50 | 28 | 214 | 200 |  |  | 42,857 | 42,857 |  |
| Woodcutting | Chop oak | 15 | 5 | 1,200 | 34 |  |  | 40,800 | 40,800 | Product: Oak Logs x1 |
| Woodcutting | Chop tree | 1 | 4 | 1,500 | 27 |  |  | 40,500 | 40,500 | Product: Logs x1 |
| Magic | Enchant Sapphire | 7 | 30 | 200 | 594 |  |  | 118,800 | 38,600 | Product: Amulet of Magic x1 \| Materials: Sapphire Amulet x1 |
| Smithing | Smith bronze axe | 4 | 5 | 1,200 | 86 |  |  | 103,200 | 31,200 | Product: Bronze Axe x1 \| Materials: Bronze Bar x1 |
| Agility | Canifis Rooftop | 40 | 30 | 200 | 140 |  |  | 28,000 | 28,000 |  |
| Smithing | Smith bronze dagger | 1 | 5 | 1,200 | 83 |  |  | 99,600 | 27,600 | Product: Bronze Dagger x1 \| Materials: Bronze Bar x1 |
| Magic | Enchant Diamond | 57 | 30 | 200 | 2,370 |  |  | 474,000 | 26,800 | Product: Amulet of Power x1 \| Materials: Diamond Amulet x1 |
| Smithing | Smith bronze pickaxe | 4 | 5 | 1,200 | 82 |  |  | 98,400 | 26,400 | Product: Bronze Pickaxe x1 \| Materials: Bronze Bar x1 |
| Mining | Mine copper ore | 1 | 4 | 1,500 | 14 |  |  | 21,000 | 21,000 | Product: Copper Ore x1 |
| Woodcutting | Chop willow | 30 | 6 | 1,000 | 21 |  |  | 21,000 | 21,000 | Product: Willow Logs x1 |
| Mining | Mine tin ore | 1 | 4 | 1,500 | 13 |  |  | 19,500 | 19,500 | Product: Tin Ore x1 |
| Mining | Mine rune essence | 1 | 4 | 1,500 | 11 |  |  | 16,500 | 16,500 | Product: Rune Essence x1 |
| Agility | Varrock Rooftop | 30 | 33 | 182 | 90 |  |  | 16,364 | 16,364 |  |
| Fletching | Tip ruby bolts (10) | 63 | 30 | 200 | 2,800 |  |  | 560,000 | 16,000 | Product: Ruby Bolt x10 \| Materials: Adamant Bolt x10, Ruby Bolt Tips x10 |
| Fletching | Cut willow shortbow (u) | 35 | 4 | 1,500 | 30 |  |  | 45,000 | 13,500 | Product: Willow Shortbow (U) x1 \| Materials: Willow Logs x1 |
| Woodcutting | Chop maple | 45 | 7 | 857 | 15 |  |  | 12,857 | 12,857 | Product: Maple Logs x1 |
| Agility | Al Kharid Rooftop | 20 | 35 | 171 | 50 |  |  | 8,571 | 8,571 |  |
| Agility | Draynor Village Rooftop | 10 | 38 | 158 | 25 |  |  | 3,947 | 3,947 |  |
| Fletching | String maple shortbow | 50 | 4 | 1,500 | 192 |  |  | 288,000 | 1,500 | Product: Maple Shortbow x1 \| Materials: Maple Shortbow (U) x1, Bowstring x1 |
| Agility | Gnome Stronghold Course | 1 | 40 | 150 | 10 |  |  | 1,500 | 1,500 |  |
| Fletching | Make bronze bolts (10) | 9 | 3 | 2,000 | 30 |  |  | 60,000 | 0 | Product: Bronze Bolt x10 \| Materials: Feather x10, Bronze Bolt (Unf) x10 |
| Magic | Curse | 19 | 5 | 1,200 | 0 |  |  | 0 | 0 |  |
| Magic | High Alchemy | 55 | 5 | 1,200 | 0 |  |  | 0 | 0 |  |
| Magic | Stun | 80 | 5 | 1,200 | 0 |  |  | 0 | 0 |  |
| Hunter | Hunt Cow | 1 | 20 | 300 | 0 |  |  | 0 | 0 |  |
| Hunter | Hunt Wizard | 15 | 20 | 300 | 0 |  |  | 0 | 0 |  |
| Hunter | Hunt Jeweller | 35 | 20 | 300 | 0 |  |  | 0 | 0 |  |
| Hunter | Hunt Merchant | 50 | 20 | 300 | 0 |  |  | 0 | 0 |  |
| Hunter | Hunt Grim Reaper | 60 | 20 | 300 | 0 |  |  | 0 | 0 |  |
| Hunter | Hunt Master Trader | 85 | 20 | 300 | 0 |  |  | 0 | 0 |  |
| Dungeoneering | Clear novice dungeon | 1 | 500 | 12 | 0 |  |  | 0 | 0 |  |
| Dungeoneering | Clear apprentice dungeon | 10 | 500 | 12 | 0 |  |  | 0 | 0 |  |
| Dungeoneering | Clear adept dungeon | 20 | 500 | 12 | 0 |  |  | 0 | 0 |  |
| Dungeoneering | Clear journeyman dungeon | 30 | 500 | 12 | 0 |  |  | 0 | 0 |  |
| Dungeoneering | Clear expert dungeon | 40 | 500 | 12 | 0 |  |  | 0 | 0 |  |
| Dungeoneering | Clear veteran dungeon | 50 | 500 | 12 | 0 |  |  | 0 | 0 |  |
| Dungeoneering | Clear master dungeon | 60 | 500 | 12 | 0 |  |  | 0 | 0 |  |
| Dungeoneering | Clear grandmaster dungeon | 70 | 500 | 12 | 0 |  |  | 0 | 0 |  |
| Dungeoneering | Clear legendary dungeon | 80 | 500 | 12 | 0 |  |  | 0 | 0 |  |
| Dungeoneering | Clear mythic dungeon | 90 | 500 | 12 | 0 |  |  | 0 | 0 |  |
| Dungeoneering | Claim arcane necklace | 65 | 0 | 0 | 100,000 |  |  | 0 | 0 | Product: Arcane Necklace x1 |
| Dungeoneering | Claim chaotic rapier | 80 | 0 | 0 | 200,000 |  |  | 0 | 0 | Product: Chaotic Rapier x1 |
| Dungeoneering | Claim chaotic longsword | 80 | 0 | 0 | 200,000 |  |  | 0 | 0 | Product: Chaotic Longsword x1 |
| Dungeoneering | Claim chaotic maul | 80 | 0 | 0 | 200,000 |  |  | 0 | 0 | Product: Chaotic Maul x1 |
| Dungeoneering | Claim chaotic crossbow | 80 | 0 | 0 | 200,000 |  |  | 0 | 0 | Product: Chaotic Crossbow x1 |
| Dungeoneering | Claim chaotic staff | 80 | 0 | 0 | 200,000 |  |  | 0 | 0 | Product: Chaotic Staff x1 |
| Dungeoneering | Claim eagle eyed kiteshield | 80 | 0 | 0 | 200,000 |  |  | 0 | 0 | Product: Eagle Eyed Kiteshield x1 |
| Dungeoneering | Claim arcane kiteshield | 80 | 0 | 0 | 200,000 |  |  | 0 | 0 | Product: Arcane Kiteshield x1 |
| Cooking | Cook trout | 15 | 4 | 1,500 | 34 |  |  | 51,000 | -12,000 | Product: Trout x1 \| Materials: Raw Trout x1 |
| Runecrafting | Craft earth rune | 9 | 2 | 3,000 | 6 |  |  | 18,000 | -15,000 | Product: Earth Rune x1 \| Materials: Rune Essence x1 |
| Cooking | Cook lobster | 40 | 4 | 1,500 | 134 |  |  | 201,000 | -16,500 | Product: Lobster x1 \| Materials: Raw Lobster x1 |
| Runecrafting | Craft air rune | 1 | 2 | 3,000 | 4 |  |  | 12,000 | -21,000 | Product: Air Rune x1 \| Materials: Rune Essence x1 |
| Runecrafting | Craft water rune | 5 | 2 | 3,000 | 4 |  |  | 12,000 | -21,000 | Product: Water Rune x1 \| Materials: Rune Essence x1 |
| Runecrafting | Craft fire rune | 14 | 2 | 3,000 | 4 |  |  | 12,000 | -21,000 | Product: Fire Rune x1 \| Materials: Rune Essence x1 |
| Runecrafting | Craft body rune | 20 | 2 | 3,000 | 4 |  |  | 12,000 | -21,000 | Product: Body Rune x1 \| Materials: Rune Essence x1 |
| Fletching | Cut shortbow (u) | 5 | 3 | 2,000 | 16 |  |  | 32,000 | -22,000 | Product: Shortbow (U) x1 \| Materials: Logs x1 |
| Cooking | Cook swordfish | 45 | 4 | 1,500 | 196 |  |  | 294,000 | -24,000 | Product: Swordfish x1 \| Materials: Raw Swordfish x1 |
| Runecrafting | Craft mind rune | 2 | 2 | 3,000 | 3 |  |  | 9,000 | -24,000 | Product: Mind Rune x1 \| Materials: Rune Essence x1 |
| Cooking | Cook shrimps | 1 | 4 | 1,500 | 20 |  |  | 30,000 | -27,000 | Product: Shrimps x1 \| Materials: Raw Shrimps x1 |
| Smithing | Smelt gold bar | 40 | 4 | 1,500 | 124 |  |  | 186,000 | -30,000 | Product: Gold Bar x1 \| Materials: Gold Ore x1 |
| Crafting | Craft hard leather body | 28 | 5 | 1,200 | 132 |  |  | 158,400 | -34,800 | Product: Hard Leather Body x1 \| Materials: Hard Leather x1 |
| Fletching | Cut arrow shafts (15) | 1 | 2 | 3,000 | 15 |  |  | 45,000 | -36,000 | Product: Arrow Shaft x15 \| Materials: Logs x1 |
| Firemaking | Burn maple logs | 45 | 2 | 3,000 | 0 |  |  | 0 | -45,000 | Materials: Maple Logs x1 |
| Crafting | String sapphire amulet | 24 | 4 | 1,500 | 401 |  |  | 601,500 | -46,500 | Product: Sapphire Amulet x1 \| Materials: Sapphire x1, Gold Bar x1 |
| Fletching | Cut oak shortbow (u) | 20 | 3 | 2,000 | 7 |  |  | 14,000 | -54,000 | Product: Oak Shortbow (U) x1 \| Materials: Oak Logs x1 |
| Fletching | String willow shortbow | 35 | 4 | 1,500 | 92 |  |  | 138,000 | -57,000 | Product: Willow Shortbow x1 \| Materials: Willow Shortbow (U) x1, Bowstring x1 |
| Prayer | Bury bones | 1 | 3 | 2,000 | 0 |  |  | 0 | -58,000 | Materials: Bones x1 |
| Prayer | Use gilded altar (bones) | 1 | 3 | 2,000 | 0 |  |  | 0 | -58,000 | Materials: Bones x1 |
| Smithing | Smith bronze scimitar | 4 | 5 | 1,200 | 71 |  |  | 85,200 | -58,800 | Product: Bronze Scimitar x1 \| Materials: Bronze Bar x2 |
| Smithing | Smith iron axe | 16 | 5 | 1,200 | 95 |  |  | 114,000 | -58,800 | Product: Iron Axe x1 \| Materials: Iron Bar x1 |
| Firemaking | Burn willow logs | 30 | 2 | 3,000 | 0 |  |  | 0 | -63,000 | Materials: Willow Logs x1 |
| Smithing | Smith bronze bolts (unf) (10) | 9 | 4 | 1,500 | 10 |  |  | 15,000 | -75,000 | Product: Bronze Bolt (Unf) x10 \| Materials: Bronze Bar x1 |
| Fletching | String magic shortbow | 80 | 6 | 1,000 | 814 |  |  | 814,000 | -79,000 | Product: Magic Shortbow x1 \| Materials: Magic Shortbow (U) x1, Bowstring x1 |
| Firemaking | Burn logs | 1 | 2 | 3,000 | 0 |  |  | 0 | -81,000 | Materials: Logs x1 |
| Firemaking | Burn oak logs | 15 | 2 | 3,000 | 0 |  |  | 0 | -102,000 | Materials: Oak Logs x1 |
| Crafting | Cut sapphire | 20 | 3 | 2,000 | 308 |  |  | 616,000 | -112,000 | Product: Sapphire x1 \| Materials: Uncut Sapphire x1 |
| Fletching | Cut magic shortbow (u) | 80 | 6 | 1,000 | 793 |  |  | 793,000 | -116,000 | Product: Magic Shortbow (U) x1 \| Materials: Magic Logs x1 |
| Fletching | String shortbow | 5 | 3 | 2,000 | 50 |  |  | 100,000 | -132,000 | Product: Shortbow x1 \| Materials: Shortbow (U) x1, Bowstring x1 |
| Magic | Superheat Item (iron ore) | 43 | 5 | 1,200 | 144 |  |  | 172,800 | -135,600 | Product: Iron Bar x1 \| Materials: Iron Ore x1, Coal x1 |
| Smithing | Smith steel pickaxe | 31 | 5 | 1,200 | 470 |  |  | 564,000 | -150,000 | Product: Steel Pickaxe x1 \| Materials: Steel Bar x1 |
| Fletching | String oak shortbow | 20 | 3 | 2,000 | 31 |  |  | 62,000 | -152,000 | Product: Oak Shortbow x1 \| Materials: Oak Shortbow (U) x1, Bowstring x1 |
| Crafting | Craft leather chaps | 18 | 5 | 1,200 | 17 |  |  | 20,400 | -157,200 | Product: Leather Chaps x1 \| Materials: Leather x1 |
| Crafting | Craft leather body | 14 | 5 | 1,200 | 13 |  |  | 15,600 | -162,000 | Product: Leather Body x1 \| Materials: Leather x1 |
| Smithing | Smith iron bolts (unf) (10) | 18 | 4 | 1,500 | 20 |  |  | 30,000 | -186,000 | Product: Iron Bolt (Unf) x10 \| Materials: Iron Bar x1 |
| Crafting | Craft leather cowl | 9 | 4 | 1,500 | 11 |  |  | 16,500 | -205,500 | Product: Leather Cowl x1 \| Materials: Leather x1 |
| Crafting | Craft leather boots | 7 | 3 | 2,000 | 40 |  |  | 80,000 | -216,000 | Product: Leather Boots x1 \| Materials: Leather x1 |
| Crafting | Cut emerald | 27 | 3 | 2,000 | 520 |  |  | 1,040,000 | -246,000 | Product: Emerald x1 \| Materials: Uncut Emerald x1 |
| Smithing | Smith iron scimitar | 19 | 5 | 1,200 | 74 |  |  | 88,800 | -256,800 | Product: Iron Scimitar x1 \| Materials: Iron Bar x2 |
| Herblore | Make attack potion | 1 | 3 | 2,000 | 150 |  |  | 300,000 | -268,000 | Product: Attack Potion x1 \| Materials: Guam Leaf x1, Eye of Newt x1 |
| Crafting | Craft leather gloves | 1 | 3 | 2,000 | 2 |  |  | 4,000 | -292,000 | Product: Leather Gloves x1 \| Materials: Leather x1 |
| Fletching | Make bronze arrows (15) | 1 | 3 | 2,000 | 60 |  |  | 120,000 | -300,000 | Product: Bronze Arrow x15 \| Materials: Headless Arrow x15 |
| Herblore | Make ranging potion | 72 | 3 | 2,000 | 3,000 |  |  | 6,000,000 | -306,000 | Product: Ranging Potion x1 \| Materials: Dwarf Weed x1, Wine of Zamorak x1 |
| Smithing | Smith adamant pickaxe | 71 | 5 | 1,200 | 1,750 |  |  | 2,100,000 | -357,600 | Product: Adamant Pickaxe x1 \| Materials: Adamant Bar x1 |
| Fletching | Make iron arrows (15) | 15 | 3 | 2,000 | 105 |  |  | 210,000 | -360,000 | Product: Iron Arrow x15 \| Materials: Headless Arrow x15, Iron Arrowtips x15 |
| Firemaking | Burn yew logs | 60 | 2 | 3,000 | 0 |  |  | 0 | -381,000 | Materials: Yew Logs x1 |
| Fletching | Make steel arrows (15) | 30 | 3 | 2,000 | 165 |  |  | 330,000 | -480,000 | Product: Steel Arrow x15 \| Materials: Headless Arrow x15, Steel Arrowtips x15 |
| Prayer | Bury big bones | 5 | 3 | 2,000 | 0 |  |  | 0 | -500,000 | Materials: Big Bones x1 |
| Prayer | Use gilded altar (big bones) | 5 | 3 | 2,000 | 0 |  |  | 0 | -500,000 | Materials: Big Bones x1 |
| Smithing | Smith steel axe | 31 | 5 | 1,200 | 155 |  |  | 186,000 | -528,000 | Product: Steel Axe x1 \| Materials: Steel Bar x1 |
| Smithing | Smith mithril pickaxe | 51 | 5 | 1,200 | 469 |  |  | 562,800 | -630,000 | Product: Mithril Pickaxe x1 \| Materials: Mithril Bar x1 |
| Crafting | String dragonstone amulet | 80 | 4 | 1,500 | 10,878 |  |  | 16,317,000 | -667,500 | Product: Dragonstone Amulet x1 \| Materials: Dragonstone x1, Gold Bar x1 |
| Crafting | Cut ruby | 34 | 3 | 2,000 | 958 |  |  | 1,916,000 | -728,000 | Product: Ruby x1 \| Materials: Uncut Ruby x1 |
| Smithing | Smith steel bolts (unf) (10) | 33 | 4 | 1,500 | 40 |  |  | 60,000 | -832,500 | Product: Steel Bolt (Unf) x10 \| Materials: Steel Bar x1 |
| Smithing | Smith mithril axe | 51 | 5 | 1,200 | 201 |  |  | 241,200 | -951,600 | Product: Mithril Axe x1 \| Materials: Mithril Bar x1 |
| Fletching | Make mithril arrows (15) | 45 | 3 | 2,000 | 135 |  |  | 270,000 | -1,260,000 | Product: Mithril Arrow x15 \| Materials: Headless Arrow x15, Mithril Arrowtips x15 |
| Smithing | Smith steel scimitar | 34 | 5 | 1,200 | 85 |  |  | 102,000 | -1,326,000 | Product: Steel Scimitar x1 \| Materials: Steel Bar x2 |
| Smithing | Smith mithril bolts (unf) (10) | 53 | 4 | 1,500 | 70 |  |  | 105,000 | -1,386,000 | Product: Mithril Bolt (Unf) x10 \| Materials: Mithril Bar x1 |
| Herblore | Make super strength | 55 | 3 | 2,000 | 2,000 |  |  | 4,000,000 | -1,690,000 | Product: Super Strength x1 \| Materials: Kwuarm x1, Limpwurt Root x1 |
| Crafting | Craft green d'hide body | 63 | 5 | 1,200 | 4,405 |  |  | 5,286,000 | -1,770,000 | Product: Green D'Hide Body x1 \| Materials: Green Dragon Leather x3 |
| Smithing | Smith adamant axe | 71 | 5 | 1,200 | 570 |  |  | 684,000 | -1,773,600 | Product: Adamant Axe x1 \| Materials: Adamant Bar x1 |
| Smithing | Smith mithril scimitar | 54 | 5 | 1,200 | 452 |  |  | 542,400 | -1,843,200 | Product: Mithril Scimitar x1 \| Materials: Mithril Bar x2 |
| Crafting | Craft green d'hide chaps | 57 | 5 | 1,200 | 2,239 |  |  | 2,686,800 | -2,017,200 | Product: Green D'Hide Chaps x1 \| Materials: Green Dragon Leather x2 |
| Fletching | Make adamant arrows (15) | 60 | 3 | 2,000 | 630 |  |  | 1,260,000 | -2,220,000 | Product: Adamant Arrow x15 \| Materials: Headless Arrow x15, Adamant Arrowtips x15 |
| Firemaking | Burn redwood logs | 90 | 2 | 3,000 | 0 |  |  | 0 | -2,457,000 | Materials: Redwood Logs x1 |
| Crafting | Cut diamond | 43 | 3 | 2,000 | 1,820 |  |  | 3,640,000 | -2,464,000 | Product: Diamond x1 \| Materials: Uncut Diamond x1 |
| Firemaking | Burn magic logs | 75 | 2 | 3,000 | 0 |  |  | 0 | -2,727,000 | Materials: Magic Logs x1 |
| Herblore | Make magic potion | 76 | 3 | 2,000 | 350 |  |  | 700,000 | -2,920,000 | Product: Magic Potion x1 \| Materials: Lantadyme x1, Potato Cactus x1 |
| Smithing | Smith adamant bolts (unf) (10) | 73 | 4 | 1,500 | 100 |  |  | 150,000 | -2,922,000 | Product: Adamant Bolt (Unf) x10 \| Materials: Adamant Bar x1 |
| Smithing | Smith adamant scimitar | 74 | 5 | 1,200 | 1,479 |  |  | 1,774,800 | -3,140,400 | Product: Adamant Scimitar x1 \| Materials: Adamant Bar x2 |
| Herblore | Make saradomin brew | 81 | 3 | 2,000 | 600 |  |  | 1,200,000 | -3,854,000 | Product: Saradomin Brew x1 \| Materials: Toadflax x1, Crushed Bird's Nest x1 |
| Fletching | Make rune arrows (15) | 75 | 3 | 2,000 | 1,170 |  |  | 2,340,000 | -4,710,000 | Product: Rune Arrow x15 \| Materials: Headless Arrow x15, Rune Arrowtips x15 |
| Herblore | Make prayer potion | 38 | 3 | 2,000 | 3,500 |  |  | 7,000,000 | -5,146,000 | Product: Prayer Potion x1 \| Materials: Ranarr Weed x1, Snape Grass x1 |
| Crafting | Craft red d'hide body | 75 | 6 | 1,000 | 5,954 |  |  | 5,954,000 | -5,630,000 | Product: Red D'Hide Body x1 \| Materials: Red Dragon Leather x4 |
| Prayer | Bury dragon bones | 35 | 3 | 2,000 | 0 |  |  | 0 | -5,630,000 | Materials: Dragon Bones x1 |
| Prayer | Use gilded altar (dragon bones) | 35 | 3 | 2,000 | 0 |  |  | 0 | -5,630,000 | Materials: Dragon Bones x1 |
| Smithing | Smith rune axe | 86 | 5 | 1,200 | 7,401 |  |  | 8,881,200 | -6,118,800 | Product: Rune Axe x1 \| Materials: Rune Bar x1 |
| Herblore | Make super defence | 66 | 3 | 2,000 | 400 |  |  | 800,000 | -6,232,000 | Product: Super Defence x1 \| Materials: Cadantine x1, White Berries x1 |
| Herblore | Make super restore | 63 | 3 | 2,000 | 5,000 |  |  | 10,000,000 | -7,466,000 | Product: Super Restore x1 \| Materials: Snapdragon x1, Red Spiders' Eggs x1 |
| Herblore | Make super combat potion | 90 | 3 | 2,000 | 7,500 |  |  | 15,000,000 | -7,774,000 | Product: Super Combat x1 \| Materials: Torstol x1, Super Attack x1, Super Strength x1, Super Defence x1, Ranging Potion x1, Magic Potion x1 |
| Herblore | Make defence potion | 30 | 3 | 2,000 | 150 |  |  | 300,000 | -11,590,000 | Product: Defence Potion x1 \| Materials: Ranarr Weed x1, White Berries x1 |
| Fletching | Cut dragonstone bolt tips (12) | 71 | 2 | 3,000 | 7,260 |  |  | 21,780,000 | -11,817,000 | Product: Dragonstone Bolt Tips x12 \| Materials: Dragonstone x1 |
| Smithing | Smith rune scimitar | 89 | 5 | 1,200 | 14,925 |  |  | 17,910,000 | -12,090,000 | Product: Rune Scimitar x1 \| Materials: Rune Bar x2 |
| Crafting | Cut dragonstone | 55 | 3 | 2,000 | 11,199 |  |  | 22,398,000 | -13,582,000 | Product: Dragonstone x1 \| Materials: Uncut Dragonstone x1 |
| Smithing | Smith runite bolts (unf) (10) | 88 | 4 | 1,500 | 350 |  |  | 525,000 | -18,225,000 | Product: Runite Bolt (Unf) x10 \| Materials: Rune Bar x1 |
| Prayer | Bury dagganoth bones | 40 | 3 | 2,000 | 0 |  |  | 0 | -28,896,000 | Materials: Dagannoth Bones x1 |
| Prayer | Use gilded altar (dagganoth bones) | 40 | 3 | 2,000 | 0 |  |  | 0 | -28,896,000 | Materials: Dagannoth Bones x1 |

## Data quality notes

- Missing item ids treated as 0 value: daganoth_bones, dragon_bolt
- Existing item ids with 0 shopValue: crystal_shards, fighter_hat, fighter_torso, fire_cape, infernal_cape, rune_defender
