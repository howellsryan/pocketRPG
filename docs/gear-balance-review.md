# Gear Balance Review

Companion to `scripts/economy-benchmark.cjs`. The new `scripts/gear-benchmark.cjs`
scores every equippable item's combat value and flags where acquisition difficulty
and power have come apart. This doc records what it found, what was fixed, and the
recommended follow-up tranches.

## The tool

```
node scripts/gear-benchmark.cjs                       # writes reports/gear-benchmark.{md,json}
node scripts/gear-benchmark.cjs --target-level=200 --triangle-tolerance=1.35
```

For a maxed player it assembles a greedy best-in-slot loadout per style, computes
DPS against one style-neutral target (magic level == defence level, so no style is
favoured), and reports:

- **Combat-triangle parity** — BiS DPS for melee / ranged / magic and their ratio.
- **Dominated items** — a not-harder, not-pricier item beats this one on *both* DPS
  and defence, so it is never worth equipping (dead content).
- **Value inversions** — a much cheaper item lands within 5% of a pricey item's DPS
  while being at least as tanky (the Kodai-vs-Shroud problem).
- **Per-slot rankings** — every item per (style, slot) by marginal DPS.

Combat maths mirror `src/engine/formulas.js` + `combatPrimitives.js` (max hits,
attack/defence rolls, hit chance, the magic-damage multiplier). They are
re-implemented in the script, not imported, to keep it a dependency-free CJS report
like economy-benchmark; the block under "Combat maths" is the thing to update if the
engine formulas change.

## Headline findings

**The combat triangle is not even.** Ranged and magic BiS out-DPS melee by ~55%:

| Style | BiS weapon | DPS |
|---|---|---:|
| melee | Blade of Saeldor | ~7.5 |
| ranged | Bow of Faerdhinen | ~11.6 |
| magic | Trident of Venom (powered staff) | ~12.6 |

Melee's best weapons cap out well below the other two styles' at level 99.

**Price/difficulty is widely decoupled from power.** The tool flags ~200 dominated
items and ~40 value inversions. The offenders cluster:

- **Prestige weapons statted below cheap staples.** Shadow of Tumaken (1.5B,
  req 85) is beaten by the Sanguine Staff (150M). Nearly every Dragon-tier and
  godsword melee weapon is out-DPS'd by a far cheaper alternative.
  (The Twisted Longbow is *not* one of these — it has `scalesWithMagic`, so its
  damage climbs against high-magic targets; the benchmark now models that and
  rates it alongside the Bow of Faerdhinen.)
- **A handful of cheap over-performers set the DPS bar for their whole style:**
  Kaelor's Crossbow (~98k), Magic Shortbow (~800), Zesta Longsword (120k),
  Abyssal Tentacle (1.7M), Archmage Wand (1M).
- **Magic damage % is mispriced.** It is the strongest DPS lever (it multiplies max
  hit, and Shadow of Tumaken *triples* worn magic damage), yet the cheap Shardglass
  set carries the game's highest values (body +10%, set +22%) while the "premier"
  Kodai robes carried only +2%/piece.

## Fixed in this change

**Kodai magic-robe tier** — the flagship value inversion. Kodai (req 75 boss unique)
was only +7 magic attack over the Shroud robe (req 55) for ~37× the price, and had
*worse* magic defence. Buffed to be the decisive best-in-slot mage set:

| Item | magic atk | magic def | magic dmg % |
|---|---|---|---|
| Kodai Hat | 4 → **16** | 5 → **30** | 2 → **3** |
| Kodai Robe Top | 35 → **50** | 26 → **45** | 2 → **4** |
| Kodai Robe Bottom | 26 → **38** | 20 → **35** | 2 → **3** |

Plus a **full-set bonus: +30% magic accuracy** (`combatSetBonuses.js`, 3-piece
armour-only). Kodai now leads magic body/legs on marginal DPS, and the set bonus
makes it the definitive mage setup.

**Shardglass magic damage rebalanced to a +10% set** (was +22%): helmet 5 → 2,
body 10 → 5, legs 7 → 3 — matching Kodai's new +10% set so the two premier magic
armours share the top of the magic-damage ladder rather than the cheap Shardglass
set running away with it.

**Ancient Maul** (102M, was out-DPS'd by cheaper weapons): sped up 6 → 5 ticks and
given the gargoyle maul's `triple_hit` "Quake" special attack, restoring it as a
worthwhile crush weapon for its price.

**Black dragonhide** now out-defends Red on every axis (body and legs), fixing the
higher-tier set being the weaker one.

## Recommended follow-up (needs a deliberate pass, not applied here)

Weapon DPS and magic-damage % changes ripple into PvE boss kill-times and
server-authoritative PvP (§10), so they were left for a scoped pass rather than a
drive-by. In priority order:

1. **Lift melee's ceiling** so BiS melee DPS lands within the triangle tolerance of
   ranged/magic — raise the top melee weapons' strength bonus, or shorten the fastest
   ones' speed, rather than nerfing ranged/magic.
2. **Re-tier prestige weapons to their price.** Twisted Longbow, Shadow of Tumaken,
   Ancient Maul, the godswords and Dragon-tier uniques should out-DPS the cheap
   staples that currently beat them. Set the cheap over-performers as the mid-tier
   baseline and raise the premier uniques above it.
3. **Kingdom of collectors.** 2nd Age items carry placeholder `shopValue`
   (2,147,483,647 = INT32_MAX) yet mid-tier stats — decide if they are prestige
   cosmetics (leave stats, fix the sentinel price) or BiS (raise stats).

## Tool limitations (so the flags are read correctly)

- **Ammo is not matched to a launcher.** The ammo rankings pick the best strength
  regardless of bolt/arrow/javelin compatibility, so those flags overstate the case.
- **Set bonuses are not modelled.** Combat-set items (`combatSetBonuses.js`) are
  excluded from the flags because a piece can look weak in isolation yet be BiS in a
  full set (Void, Masari, Shardglass).
- **Cosmetic / skill capes** show as "dominated" by the Max Cape — expected; combat
  stats are not their purpose.
- Prayer, special attacks, and gear-swapping are out of the DPS model.
