# Tomb of Arasmus — Raid Implementation Guide

> **Audience:** an implementing agent/contributor.
> **Goal:** add a new raid, *Tomb of Arasmus* (inspired by OSRS *Tombs of Amascut*), end-to-end.
> **Status:** design approved. This is a build spec — follow it top to bottom, then run the commit gate.

---

## 0) Decisions locked in with the requester

| Topic | Decision |
|---|---|
| Unique drops | All **7 equipment uniques** (Fang, Lightbearer ring, Elidinis' ward off-hand, Masori mask/body/chaps, Tumeken's shadow staff). Cosmetic/material ToA drops are **excluded**. |
| Drop model | `rewards.unique.chance = 1/15` overall, then **weighted by OSRS relative rarity** (Fang/Lightbearer most common → Shadow rarest). |
| Roster | **4 path bosses** must all be cleared, then the **inferno-style Warden finale**. 5 monster entries total. |
| Item effects | **Stats now.** Implement a signature effect **only** where an engine hook already exists (i.e. `specialAttack` via `applySpecialAttack`). Everything else is authored as stats + listed as a TODO. |
| Skip cost | **10 credits** (`skipCost: 10`). |
| Naming | Follow the existing codebase convention: **PocketRPG-original names** + a `legacy_id` / `legacy_item_id` pointer to the OSRS source (e.g. *Chambers of Xeric → Vaults of Xyren*, *Twisted Bow → Twisted Longbow*). |

---

## 1) Why this is almost entirely data-driven

The raid system is wired so that adding entries to `src/data/raids.json` automatically flows through both the client engine and the server-authoritative grant path. Confirmed by reading the code:

- **Client engine** — `src/engine/combat.js`:
  - `createRaidCombatState(raidData, monstersData, …)` builds the run from `raidData.bosses[]`.
  - `rollRaidRewards(rewards)` rolls `rewards.always[]` then a single weighted `rewards.unique`.
  - Multi-form bosses already support "switch attack style every N hits" (`formSwitchThreshold`, `pickNextForm`) and arbitrary attack cadence (`attackSpeed`, in 600 ms ticks). **The inferno-style boss needs no new engine code.**
- **Client UI** — `src/screens/CombatScreen.jsx` imports `raids.json` and renders every raid in `Object.values(raidsData)`; no per-raid UI code.
- **Server grant path** — `functions/_lib/game/raidRewards.js` (`rollRaidRewardsById`) reads the same `raids.json`; `functions/api/actions/raid/complete.js` calls it; `functions/api/actions/_completeShared.js` validates the raid id against `Object.keys(raidsData)` (`VALID_SOURCE_IDS.raids`) and persists kill-counts + collection-log entries.
- **Item sources** — `src/engine/itemSources.js` `getRaidRewardSources()` derives "where do I get this" purely from `rewards.unique.items`.

**Net effect:** the only files that need editing are the four JSON data files (+ one regression test). No engine, API, or screen code changes are required unless you choose to implement the Fang special attack (optional, §6).

> ⚠️ **One caveat in `raids.json` today:** each canonical raid is duplicated under a second key equal to its `legacy_id` (e.g. both `vaults_of_xyren` and `chambers_of_xeric` keys exist, cross-pointing via `id`/`legacy_id`). Reproduce this pattern for the new raid (a `tomb_of_arasmus` key **and** a `tombs_of_amascut` legacy-alias key) so anything that resolves the raid by legacy id keeps working. `leaderboardFilters.js` already de-dupes canonical raids, so the alias won't double-count.

---

## 2) Naming map (OSRS → PocketRPG-original)

Use these ids/names everywhere. `legacy_id`/`legacy_item_id` carry the OSRS pointer.

### Raid
| OSRS | PocketRPG name | raid `id` | `legacy_id` |
|---|---|---|---|
| Tombs of Amascut | **Tomb of Arasmus** | `tomb_of_arasmus` | `tombs_of_amascut` |

### Monsters (4 path bosses + finale)
| OSRS | PocketRPG name | monster `id` | `legacy_id` | Role / mechanic to mirror |
|---|---|---|---|---|
| Akkha | **Khareth the Shadowbound** | `khareth_the_shadowbound` | `akkha` | Multi-form, random style switch every few attacks (light mirror of the finale). |
| Ba-Ba | **Gorroth, the Mountain-Ape** | `gorroth_the_mountain_ape` | `baba` | High-HP melee tank (crush). |
| Kephri | **Khepra, the Scarab Matron** | `khepra_the_scarab_matron` | `kephri` | Ranged/magic swapping mid-fight. |
| Zebak | **Sebakh the Devourer** | `sebakh_the_devourer` | `zebak` | Big magic/ranged hits. |
| The Wardens | **Warden of Arasmus** | `warden_of_arasmus` | `wardens` | **Inferno-style finale** (see §4). |

### Items (7 uniques)
| OSRS | PocketRPG name | item `id` | `legacy_item_id` | Slot |
|---|---|---|---|---|
| Osmumten's fang | **Fang of Osmun** | `fang_of_osmun` | `osmumtens_fang` | weapon (stab, 1H) |
| Lightbearer | **Sunbearer Ring** | `sunbearer_ring` | `lightbearer` | ring |
| Elidinis' ward | **Ward of Elidria** | `ward_of_elidria` | `elidinis_ward` | shield (off-hand) |
| Masori mask | **Masari Mask** | `masari_mask` | `masori_mask` | head |
| Masori body | **Masari Body** | `masari_body` | `masori_body` | body |
| Masori chaps | **Masari Chaps** | `masari_chaps` | `masori_chaps` | legs |
| Tumeken's shadow | **Shadow of Tumaken** | `shadow_of_tumaken` | `tumekens_shadow` | weapon (magic, 2H) |

> Confirm `ring` and `shield` are valid `slot` values in this codebase before authoring (grep `"slot":` in `src/data/items.json`). If `ring`/`shield` are not yet used, pick the closest existing slot used by other off-hand/jewellery items, or add the slot consistently (check the equipment screen + `src/engine` equip logic). **Do not invent a slot the equip code doesn't recognise.**

---

## 3) `src/data/raids.json` — raid definition

Add a canonical `tomb_of_arasmus` entry **and** a `tombs_of_amascut` legacy alias (mirror of the existing duplicate-key pattern). Canonical entry:

```jsonc
"tomb_of_arasmus": {
  "id": "tomb_of_arasmus",
  "name": "Tomb of Arasmus",
  "icon": "🏜️",
  "description": "Brave the cursed tomb of the god-king Arasmus. Defeat his four guardians and the Warden to claim the treasures within.",
  "bosses": [
    "khareth_the_shadowbound",
    "gorroth_the_mountain_ape",
    "khepra_the_scarab_matron",
    "sebakh_the_devourer",
    "warden_of_arasmus"
  ],
  "skipCost": 10,
  "rewards": {
    "always": [
      { "itemId": "coins",      "quantity": [80000, 250000], "chance": 1 },
      { "itemId": "blood_rune", "quantity": [120, 280],      "chance": 0.7 },
      { "itemId": "death_rune", "quantity": [100, 250],      "chance": 0.6 },
      { "itemId": "soul_rune",  "quantity": [50, 150],       "chance": 0.45 },
      { "itemId": "snapdrake",  "quantity": [5, 20],         "chance": 0.4 }
    ],
    "unique": {
      "chance": 0.06666666666666667,
      "items": [
        { "itemId": "fang_of_osmun",     "weight": 16 },
        { "itemId": "sunbearer_ring",    "weight": 16 },
        { "itemId": "ward_of_elidria",   "weight": 11 },
        { "itemId": "masari_mask",       "weight": 7 },
        { "itemId": "masari_body",       "weight": 7 },
        { "itemId": "masari_chaps",      "weight": 7 },
        { "itemId": "shadow_of_tumaken", "weight": 3 }
      ]
    }
  },
  "legacy_id": "tombs_of_amascut"
}
```

Then add a second top-level key `"tombs_of_amascut"` whose body is identical **except** `"id": "tomb_of_arasmus"` stays the canonical id and `"legacy_id": "tombs_of_amascut"` is kept — i.e. copy exactly how `chambers_of_xeric` mirrors `vaults_of_xyren` at the bottom of the current file (the alias key's `id` points at the canonical id).

**Drop-rate notes:**
- `chance: 0.0666…` = **1/15** overall unique chance, as requested.
- Weights mirror OSRS relative ordering: Fang & Lightbearer most common, Ward next, Masori pieces mid, Shadow rarest. Total weight = 67 ⇒ Shadow ≈ 4.5 % of uniques ≈ **1 / 335 per completion**; Fang/Lightbearer ≈ 24 % ≈ **1 / 63 per completion**. Adjust weights if you want to retune, but keep the **ordering** (Shadow rarest).
- `always[]` standard loot is tuned between the Vaults (50k–150k coins) and Theatre (100k–300k) bands; tweak to taste but keep it in that range.

---

## 4) `src/data/monsters.json` — the inferno-style finale

This is the only mechanically novel piece, and it is **pure data**. Requirement recap: *"attacks every 2 ticks, random attack-style switch every 3 hits."*

How the existing engine satisfies that (verified in `src/engine/combat.js`):
- `attackSpeed: 2` → monster attacks every 2 ticks (1.2 s). (`state.monsterAttackTimer = monster.attackSpeed`.)
- `multiForm: true` + `forms{}` → style is driven by the active form.
- `formSwitchMin: 3`, `formSwitchMax: 3` → `randomFormSwitchThreshold()` returns exactly 3, so the form switches **every 3 attacks**.
- **No** `formCycleOrder` and **no** `randomFormEveryAttack` → `pickNextForm()` falls through to a **random** form each switch (this is the "random attack style" requirement; it may repeat a style, exactly like Inferno/Olm randomness).

```jsonc
"warden_of_arasmus": {
  "id": "warden_of_arasmus",
  "name": "Warden of Arasmus",
  "boss": true,
  "raidBoss": true,
  "combatLevel": 900,
  "hitpoints": 700,
  "stats": { "attack": 250, "strength": 250, "defence": 160, "magic": 250, "ranged": 250 },
  "attackSpeed": 2,
  "attackStyle": "magic",
  "attackBonus": 250,
  "strengthBonus": 250,
  "defenceBonus": { "stab": 180, "slash": 180, "crush": 180, "magic": 180, "ranged": 180 },
  "multiForm": true,
  "formSwitchMin": 3,
  "formSwitchMax": 3,
  "initialForm": "magic",
  "forms": {
    "magic":  { "displayName": "Searing Light", "icon": "🔆", "attackStyle": "magic",  "weakness": "ranged", "maxHit": 28, "attackBonus": 250, "strengthBonus": 250, "defenceBonus": { "stab": 180, "slash": 180, "crush": 180, "magic": 180, "ranged": 180 } },
    "ranged": { "displayName": "Sand Barrage", "icon": "🌪️", "attackStyle": "ranged", "weakness": "magic",  "maxHit": 28, "attackBonus": 250, "strengthBonus": 250, "defenceBonus": { "stab": 180, "slash": 180, "crush": 180, "magic": 180, "ranged": 180 } },
    "melee":  { "displayName": "Crushing Blow", "icon": "✊", "attackStyle": "crush",  "weakness": "magic",  "maxHit": 28, "attackBonus": 250, "strengthBonus": 250, "defenceBonus": { "stab": 180, "slash": 180, "crush": 180, "magic": 180, "ranged": 180 } }
  },
  "drops": [ { "itemId": "clue_scroll_master", "quantity": 1, "chance": 0.02 } ],
  "legacy_id": "wardens"
}
```

> **Tuning note:** `attackSpeed: 2` is twice as fast as Olm (`4`). With `maxHit: 28` per form that is a *very* high DPS finale. Confirm against playtesting; if it's overtuned, drop the per-form `maxHit` (e.g. to ~20) rather than slowing the boss — the 2-tick cadence is the requested signature. `hitpoints` is bumped to 700 to compensate for the player out-DPSing via faster kills.

### Path bosses (4)
Per the requester: **reuse the stat magnitudes of existing Theatre/Chambers raid monsters**, give each a ToA-flavoured mechanic. Use these existing entries as the stat baseline (copy the `stats`, `attackBonus`, `strengthBonus`, `defenceBonus`, `hitpoints`, `attackSpeed` magnitudes, then rename + add mechanic):

| New boss | Copy baseline from | Mechanic flavour |
|---|---|---|
| `khareth_the_shadowbound` | `xarpus` (or `tekton`) | Light multi-form: `multiForm`, `formSwitchMin: 2`, `formSwitchMax: 4`, forms `melee`/`magic`. |
| `gorroth_the_mountain_ape` | `tekton` | Single-style crush tank; high `hitpoints`, `requiresDoubleKill: false`. |
| `khepra_the_scarab_matron` | `vespula` | `multiForm` ranged↔magic, `formCycleOrder: ["ranged","magic"]`. |
| `sebakh_the_devourer` | `muttadile` | High `maxHit` magic/ranged, single style. |

Author each with `boss: true`, `raidBoss: true`, a `drops: [{ "itemId": "clue_scroll_master", "quantity": 1, "chance": 0.02 }]` line (matches the other raid bosses), and a `legacy_id`. Keep `combatLevel`/`hitpoints` within the Theatre/Chambers band so the raid difficulty curve matches existing content. **No uniques on individual monster `drops[]`** — all uniques come from the raid-completion `rewards.unique` table (server-authoritative).

---

## 5) `src/data/items.json` — the 7 uniques

Author each with the **exact OSRS equipment bonuses, requirements, and store value**, using the schema below (mirrors `kodai_hat` / `twisted_longbow`). Every item must carry `legacy_item_id`, full `attackBonus`/`defenceBonus`/`otherBonus` blocks (zero-fill unused fields), `requirements`, `shopValue`, an `icon`, `isGeneralStore: false`, and `isBossUnique: true`.

> **Accuracy requirement:** the numbers below are the OSRS values to transcribe like-for-like. Before committing, **verify each bonus/requirement/value against the OSRS Wiki** (these are external game facts, not PocketRPG MCP data) and correct any field marked ⚠️. Do not ship a guessed stat.

### 5.1 Fang of Osmun (`fang_of_osmun`) — stab weapon
```jsonc
{
  "id": "fang_of_osmun", "legacy_item_id": "osmumtens_fang", "name": "Fang Of Osmun",
  "type": "weapon", "slot": "weapon", "twoHanded": false, "stackable": false,
  "attackSpeed": 5, "attackStyle": "stab",
  "attackBonus": { "stab": 55, "slash": 50, "crush": 0, "magic": 0, "ranged": 0 },
  "defenceBonus": { "stab": 0, "slash": 0, "crush": 0, "magic": 0, "ranged": 0 },
  "otherBonus": { "meleeStrength": 60, "rangedStrength": 0, "magicDamage": 0 },
  "requirements": { "attack": 82 },
  "shopValue": 2400000,           // ⚠️ confirm GE/alch-derived value used by this game's economy
  "icon": "🗡️", "isGeneralStore": false, "isBossUnique": true
  // OPTIONAL specialAttack — see §6. If implementing: add the specialAttack object here.
}
```

### 5.2 Sunbearer Ring (`sunbearer_ring`) — ring
Pure-stat ring (all combat bonuses 0 in OSRS). Signature effect (2× special-attack energy regen) is **not implemented** — see §7 TODO.
```jsonc
{
  "id": "sunbearer_ring", "legacy_item_id": "lightbearer", "name": "Sunbearer Ring",
  "type": "armour", "slot": "ring", "stackable": false,
  "attackBonus": { "stab": 0, "slash": 0, "crush": 0, "magic": 0, "ranged": 0 },
  "defenceBonus": { "stab": 0, "slash": 0, "crush": 0, "magic": 0, "ranged": 0 },
  "otherBonus": { "meleeStrength": 0, "rangedStrength": 0, "magicDamage": 0 },
  "requirements": {},
  "shopValue": 2000000,           // ⚠️ confirm
  "icon": "💍", "isGeneralStore": false, "isBossUnique": true
}
```

### 5.3 Ward of Elidria (`ward_of_elidria`) — shield / off-hand
```jsonc
{
  "id": "ward_of_elidria", "legacy_item_id": "elidinis_ward", "name": "Ward Of Elidria",
  "type": "armour", "slot": "shield", "stackable": false,
  "attackBonus": { "stab": 0, "slash": 0, "crush": 0, "magic": 15, "ranged": 0 },           // ⚠️ verify magic atk
  "defenceBonus": { "stab": 5, "slash": 5, "crush": 5, "magic": 20, "ranged": 5 },           // ⚠️ verify
  "otherBonus": { "meleeStrength": 0, "rangedStrength": 0, "magicDamage": 5 },                // ⚠️ verify magic dmg %
  "requirements": { "magic": 80, "defence": 80 },                                            // ⚠️ verify
  "shopValue": 1500000,           // ⚠️ confirm
  "icon": "🛡️", "isGeneralStore": false, "isBossUnique": true
}
```

### 5.4–5.6 Masari armour — ranged, `requirements: { ranged: 80, defence: 30 }` (⚠️ verify)
Transcribe each piece's OSRS ranged-attack / defence / ranged-strength bonuses. Skeleton (fill ⚠️ from wiki):
```jsonc
"masari_mask":  { "id":"masari_mask",  "legacy_item_id":"masori_mask",  "name":"Masari Mask",  "type":"armour","slot":"head", "stackable":false,
  "attackBonus":{"stab":0,"slash":0,"crush":0,"magic":0,"ranged":12},   // ⚠️
  "defenceBonus":{"stab":0,"slash":0,"crush":0,"magic":0,"ranged":0},   // ⚠️
  "otherBonus":{"meleeStrength":0,"rangedStrength":0,"magicDamage":0},
  "requirements":{"ranged":80,"defence":30},"shopValue":15000000,"icon":"🎭","isGeneralStore":false,"isBossUnique":true },

"masari_body":  { "id":"masari_body",  "legacy_item_id":"masori_body",  "name":"Masari Body",  "type":"armour","slot":"body", "stackable":false,
  "attackBonus":{"stab":0,"slash":0,"crush":0,"magic":0,"ranged":43},   // ⚠️
  "defenceBonus":{"stab":0,"slash":0,"crush":0,"magic":0,"ranged":0},   // ⚠️
  "otherBonus":{"meleeStrength":0,"rangedStrength":0,"magicDamage":0},
  "requirements":{"ranged":80,"defence":30},"shopValue":40000000,"icon":"🦅","isGeneralStore":false,"isBossUnique":true },

"masari_chaps": { "id":"masari_chaps", "legacy_item_id":"masori_chaps", "name":"Masari Chaps", "type":"armour","slot":"legs", "stackable":false,
  "attackBonus":{"stab":0,"slash":0,"crush":0,"magic":0,"ranged":22},   // ⚠️
  "defenceBonus":{"stab":0,"slash":0,"crush":0,"magic":0,"ranged":0},   // ⚠️
  "otherBonus":{"meleeStrength":0,"rangedStrength":0,"magicDamage":0},
  "requirements":{"ranged":80,"defence":30},"shopValue":20000000,"icon":"👖","isGeneralStore":false,"isBossUnique":true }
```
> Masori's "ranged strength % when full set" set bonus is **not** a supported engine effect → author the flat per-piece bonuses only; list the set bonus in §7 TODO.

### 5.7 Shadow of Tumaken (`shadow_of_tumaken`) — magic 2H staff
```jsonc
{
  "id": "shadow_of_tumaken", "legacy_item_id": "tumekens_shadow", "name": "Shadow Of Tumaken",
  "type": "weapon", "slot": "weapon", "twoHanded": true, "stackable": false,
  "attackSpeed": 5, "attackStyle": "magic",
  "attackBonus": { "stab": 0, "slash": 0, "crush": 0, "magic": 35, "ranged": 0 },   // ⚠️ verify
  "defenceBonus": { "stab": 0, "slash": 0, "crush": 0, "magic": 15, "ranged": 0 },   // ⚠️ verify
  "otherBonus": { "meleeStrength": 0, "rangedStrength": 0, "magicDamage": 0 },
  "requirements": { "magic": 85 },
  "shopValue": 80000000,          // ⚠️ confirm
  "icon": "🔱", "isGeneralStore": false, "isBossUnique": true
}
```
> ⚠️ **Signature gap:** the Shadow's defining "**triple the magic-damage bonus of worn gear**" passive has **no engine hook**. Options: (a) ship plain stats + §7 TODO (default, matches the "effects only where supported" decision); or (b) approximate by giving it a large flat `magicDamage` value — *check whether `otherBonus.magicDamage` is actually consumed by the magic damage formula in `src/engine/combat.js` first; if it isn't, don't fake it.* Default to (a).

---

## 6) OPTIONAL — Fang special attack (the one effect the engine supports)

`applySpecialAttack()` in `src/engine/combat.js` is the existing hook (CLAUDE.md §7). The Fang's OSRS special (*roll accuracy twice; on hit, damage range is compressed toward the middle of max*) can be approximated. **Only do this if the requester wants it; otherwise skip and add to §7 TODO.** Steps (from CLAUDE.md §7 "Adding a weapon with a special attack"):
1. Add a `specialAttack` object to `fang_of_osmun` in `items.json`:
   ```jsonc
   "specialAttack": { "type": "fang", "energyCost": 25, "description": "Strikes with deadly precision, rerolling accuracy and avoiding low hits." }
   ```
2. Implement the `type: "fang"` branch in `applySpecialAttack()` (reroll accuracy once on miss; clamp damage to ≥15% of max).
3. Add a `specLabels` entry in the combat screen handling.
Keep it in a **separate commit** so the data-only raid can ship independently.

---

## 7) `src/data/collectionLog.json` — required (CLAUDE.md §8)

In the `raids` category (`id: "raids"`), add a new section after `vaults_of_xyren`:
```jsonc
{
  "id": "tomb_of_arasmus",
  "label": "Tomb of Arasmus",
  "icon": "🏜️",
  "items": [
    "fang_of_osmun", "sunbearer_ring", "ward_of_elidria",
    "masari_mask", "masari_body", "masari_chaps", "shadow_of_tumaken"
  ]
}
```
The `section.id` **must equal** the raid `id` (`tomb_of_arasmus`) — `_completeShared.js` persists log entries under the completion `sourceId`, and `isValidEntry('raids', 'tomb_of_arasmus', itemId)` is what gates them server-side.

### Unimplemented-effect TODO list (carry into the PR description)
- Sunbearer Ring: 2× special-attack energy regen — no PvE passive-regen hook.
- Masari set: full-set ranged-strength % bonus — no set-bonus engine.
- Shadow of Tumaken: ×3 worn magic-damage passive — no multiplier hook.
- Fang of Osmun: special attack — only if §6 not done.

---

## 8) Build, test, verify

### New regression test (required by CLAUDE.md §8)
Add to the existing collection-log / raid test suite (find it via `tests/**/*collection*` or `tests/**/*raid*`). Assert:
1. Every `rewards.unique.items[].itemId` in `tomb_of_arasmus` exists in `items.json`.
2. Every `bosses[]` id exists in `monsters.json`.
3. The `collectionLog.json` `tomb_of_arasmus` section lists **exactly** the 7 unique ids (parity with the raid table).
4. `rewards.unique.chance` ≈ 1/15.
5. (If a generic "every raid unique has a collection-log slot" test already exists, the new raid must pass it — check `tests/` first and extend rather than duplicate.)

### Commit gate (CLAUDE.md §11 — do not commit on red)
```
npm test && npm run build && npm run rebuild && npm run check:single
```
(or `npm run ci && npm test`).

- `npm run check:single` matters because new top-level identifiers must stay globally unique across the single-file build — but since this change is **data-only**, there should be no new identifiers. Still run it.
- **Do not commit generated `index.html`** (build artifact, CLAUDE.md §13).

### Manual smoke (optional, via the `/run` or `/verify` skill)
Start the raid, clear all 4 path bosses, confirm the Warden switches style every 3 hits and attacks on a 1.2 s cadence, complete the raid, confirm a unique can roll into the bank and a collection-log slot fills.

---

## 9) File-change checklist

- [ ] `src/data/raids.json` — add `tomb_of_arasmus` + `tombs_of_amascut` alias key.
- [ ] `src/data/monsters.json` — add 5 monsters (4 path bosses + `warden_of_arasmus`).
- [ ] `src/data/items.json` — add 7 uniques (verify ⚠️ stats vs OSRS wiki).
- [ ] `src/data/collectionLog.json` — add `tomb_of_arasmus` section under `raids`.
- [ ] `tests/…` — add/extend raid+collection-log regression test.
- [ ] (optional) `items.json` + `src/engine/combat.js` + combat screen — Fang special attack.
- [ ] Run the commit gate; commit (exclude `index.html`); push to the feature branch.

**No changes needed** to `combat.js` engine (unless §6), `raidRewards.js`, `_completeShared.js`, `CombatScreen.jsx`, or any API route — the new raid id is picked up automatically by the data-driven plumbing described in §1.
