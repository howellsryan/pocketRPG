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

**The combat triangle is uneven — but the outlier is magic, not weak melee.** Each
style's number is a *full max-gear loadout* (best weapon plus every strength /
magic-damage source across all armour and accessory slots), not a bare weapon:

| Style | BiS loadout (weapon) | DPS |
|---|---|---:|
| melee | Blade of Saeldor + full Grondar/Ferocious/Torment/Berserker | ~8.3 |
| ranged | 2nd Age Bow + Dragon Arrow + full gear | ~8.6 |
| magic | Trident of Venom (powered staff) + full mage gear | ~13.0 |

Melee and ranged are within ~4% of each other (Grondar's strength/accuracy buff,
below, closed most of the earlier gap). Magic leads because powered staves
(Trident) scale their base hit with magic level (42 at level 99), fire every 3 ticks,
and cost no ammo. Melee's only structural disadvantage is that ranged gets a strength
slot (arrows/bolts) melee has no equivalent for — a small gap, not the ~55% the
first draft reported. That earlier gap was a **tool bug**: the ranged loadout was
firing a +150-strength Dragon Javelin from a bow that cannot use javelins. The
benchmark now enforces ammo compatibility (`ammoKind` vs the weapon's `ammoType`),
so a self-contained weapon like the crystal bow gains nothing from the ammo slot.

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

**Grondar (Bandos) tank set** — the chestplate/tassets/boots carried a defensive
budget but a near-zero strength/accuracy one (chestplate +4 str, tassets +2 str,
boots +4 str, 0 accuracy on all three), so cheaper alternatives like Shardglass
Plate Body (+10 str) and Spiked Manacles (+8 str, +10 accuracy) out-DPS'd the boss
unique. Buffed to lead every rival in their slot on both axes:

| Item | melee strength | accuracy (stab/slash/crush) |
|---|---|---|
| Grondar Chestplate | 4 → **14** | 0 → **14** |
| Grondar Tassets | 2 → **10** | 0 → **10** |
| Grondar Boots | 4 → **9** | 0 → **11** |

This also closed most of the melee/ranged gap: melee's max-gear DPS rose from
~7.5 to ~8.3, now within 4% of ranged's ~8.6.

## Recommended follow-up (needs a deliberate pass, not applied here)

Weapon DPS and magic-damage % changes ripple into PvE boss kill-times and
server-authoritative PvP (§10), so they were left for a scoped pass rather than a
drive-by. In priority order:

1. **Rein in magic's lead, or lift melee/ranged to match.** Magic (~12.7) sits well
   above melee (~7.5) and ranged (~8.6) because powered staves scale with level, hit
   every 3 ticks and cost no ammo. Decide whether powered-staff base damage should be
   toned down or the other two styles' ceilings raised. Melee and ranged themselves
   are close enough to leave alone.
2. **Re-tier prestige weapons to their price.** Shadow of Tumaken, the godswords and
   Dragon-tier uniques should out-DPS the cheap staples that currently beat them
   (Kaelor's Crossbow, Zesta Longsword, Abyssal Tentacle, Archmage Wand). Set the
   cheap over-performers as the mid-tier baseline and raise the premier uniques above
   it. (Twisted Longbow and Ancient Maul are already handled.)
3. **Kingdom of collectors.** 2nd Age items carry placeholder `shopValue`
   (2,147,483,647 = INT32_MAX) yet mid-tier stats — decide if they are prestige
   cosmetics (leave stats, fix the sentinel price) or BiS (raise stats).

## Tool limitations (so the flags are read correctly)

- **Set bonuses are not modelled** in the loadout DPS (Kodai's +30% magic accuracy,
  the Shardglass/Void/Masari multipliers). Combat-set items (`combatSetBonuses.js`)
  are also excluded from the dominated/inversion flags, because a piece can look weak
  in isolation yet be BiS once the full-set bonus applies.
- **Cosmetic / skill capes** show as "dominated" by the Max Cape — expected; combat
  stats are not their purpose.
- Prayer, special attacks, and gear-swapping are out of the DPS model.
