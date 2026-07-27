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
| melee | Blade of Saeldor + full Grondar/Ferocious/Torment/Berserker | ~8.5 |
| ranged | 2nd Age Bow + Dragon Arrow + full gear | ~8.6 |
| magic | Trident of Venom (powered staff) + full mage gear | ~13.0 |

Melee and ranged are within ~2% of each other (Grondar's strength/accuracy buff,
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
unique. Buffed in two passes: first to lead every direct rival in its own slot,
then again to bring accuracy up to the bar set by the best melee-armour accuracy
bonuses anywhere in the game (Gloves of Slaughter +20, Ferocious Gloves +16),
not just within-slot rivals:

| Item | melee strength | accuracy (stab/slash/crush) |
|---|---|---|
| Grondar Chestplate | 4 → **14** | 0 → 14 → **22** |
| Grondar Tassets | 2 → **10** | 0 → 10 → **16** |
| Grondar Boots | 4 → **9** | 0 → 11 → **13** |

This also closed most of the melee/ranged gap: melee's max-gear DPS rose from
~7.5 to ~8.5, now within 2% of ranged's ~8.6.

## Combat-style parity pass

The follow-up below was taken as a scoped change. The level-99 lens above could not
see the problem: it models no combat stances, no set bonuses, and one synthetic
target. Adding those (`--by-level`) showed the triangle was far wider than the
"melee ≈ ranged within 2%" reading, and that the worst spot was mid-game:

| Player level | Melee | Ranged | Magic | Ratio before → after |
|---:|---:|---:|---:|---|
| 30 | 2.56 | 2.66 | 2.91 | 1.25 → **1.14** |
| 50 | 4.24 | 4.68 | 5.35 | 1.25 → **1.26** |
| 70 | 9.08 | 8.85 | 10.58 | 2.09 → **1.20** |
| 75 | 14.69 | 15.39 | 16.36 | 1.61 → **1.11** |
| 85 | 17.39 | 19.23 | 21.00 | 1.52 → **1.21** |
| 99 | 21.74 | 22.69 | 23.59 | 1.53 → **1.09** |

Run `node scripts/gear-benchmark.cjs --by-level` to regenerate.

**What was wrong, and what changed.** Five structural causes, all fixed by buffing
rather than nerfing (the sole exception is noted below):

1. **Melee had no percentage damage lever.** Magic stacks worn `magicDamage` to
   +100% at 99, doubling its base hit; melee and ranged had only flat strength,
   diluted by the `+64` in the max-hit formula. Added `otherBonus.meleeDamage` /
   `rangedDamage` (`wornMeleeMaxHit` / `wornRangedMaxHit` in `formulas.js`), spread
   across prestige gear — Torment, Berserker Ring, Ferocious Gloves, the Grondar
   set, Avernal Defender, Max Cape. Every max-hit site routes through the helpers,
   so special attacks inherit it too.
2. **Powered staves were untierable.** `combat.js` hardcoded `floor(magic/3)+9` for
   every staff, so the Trident, Sanguine Staff and Shadow of Tumaken all hit
   identically — and `poweredStaffBaseDamage: 34` sat unread in `items.json`. That
   field is now honoured as *the staff's base damage at Magic 75*; the Trident's
   authored 34 is exactly the old curve, so absent-field staves are unchanged.
3. **The spell ladder barely grew.** Base damage stepped +1 within *and between*
   tiers (fire_bolt 12 → wind_blast 13), leaving magic flat from 40 to 74. Each
   tier is now a real step: bolt 9–15, blast 16–22, wave 28–36, surge 38–47.
4. **Bows carried no ranged strength and arrows dead-ended at level 60.** Every bow
   below Stonegale had `rangedStrength: 0`, so a mid-game ranged player's whole
   damage budget was one arrow — and arrows stopped at Dragon (+60) while bolts
   reached +135. The bow ladder now carries strength, and two arrows sit above
   Dragon: **Shardglass Arrow** (Ranged 75, crafted — Smithing 85 arrowtips from
   shardglass shards, then Fletching 85) and **Seraphic Arrow** (Ranged 85, a bulk
   `rewards.always` drop from the endgame raids, the ranged mirror of how magic
   gets its endgame runes).
5. **Weapon progression stopped mid-game.** No melee weapon above level 75 beat the
   Blade of Saeldor. The 80/90 tiers were re-statted so each is a genuine upgrade,
   and the Dungeoneering chaotic tier — previously pegged at 95% of a *tradeable*
   reference, which put a level-90 reward below a level-80 weapon — is now the top
   of its ladder, priced at 1,000,000 tokens to match.

**The two flagships now earn their price.** Shadow of Tumaken (1.5B) was a slower
Trident with the same effective cap; it is now 4 ticks with a higher base and a
+170% multiplier cap, the strongest magic weapon outright. The Twisted Longbow
(1.58B) had +20 ranged strength at 5 ticks, so a mid-tier bow beat it before its
magic-scaling multiplier even applied; at 4 ticks and +90 it dominates the
high-magic bosses its formula exists for, and stays deliberately poor elsewhere.

**One non-buff:** the 2nd Age Bow's requirement moved from Ranged 65 to 85. Its
stats are untouched — a 1.4B clue reward firing every 1.2s at level 65 was the
single cause of the 2.09 ratio through the 60s, and this is placement, not power.

## Still open

- **Melee has no flagship and no weapon between requirement 82 and 90.** Magic's
  top weapon costs 1.5B and ranged's 1.58B; melee's dearest is the 300M Scythe of
  Vythar. That gap is why band 85 sits at 1.21 — magic unlocks Shadow of Tumaken
  there and melee has nothing to answer with. Filling it is new content.
- **Attuned Duskmare Staff's description** claims it casts "one tick faster than
  any other staff"; the Archmage and Ancestral Wands are also 4 ticks. Left alone
  deliberately — fixing it means either a reword or a speed change with a
  compensating damage cut.
- **Ammunition and rune cost per hit** are not modelled, so the parity table says
  nothing about which style is cheapest to run.

## Earlier follow-up list (superseded by the pass above)

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
