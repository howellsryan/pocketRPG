# PvP Bot System — Design & Implementation Plan

> Status: design proposal. Goal: populate the PvP lobby with always-available
> AI bots that players can fight for loot, **without breaking the existing
> human-vs-human PvP system**. Bots play near-optimally (smart eating, prayer,
> special-attack-to-kill, weapon swapping for burst).

---

## 0. Decisions already locked (from product owner)

1. **Infra**: No new always-on compute. Combat ticks are driven by the human
   client's existing `POST /api/pvp/match/[id]/tick` calls. The bot only needs
   to "think" *inside* tick processing — it does not self-drive.
2. **Loser keeps nothing**: a player who loses to a bot loses their tradeable
   risked gear (true PvP risk / item sink). Untradeables are not affected.
3. **Reward = server-rolled loot box**: when a player wins vs a bot, the server
   rolls a loot box immediately at match end (no separate "open" action needed).
   Contents: ~70% coins (1k–10k), ~28% coins (10k–50k), ~2% rare Zesta unique
   item (equal split across three items). The box and its Zesta items are
   **bound — not tradeable** (box never exists as an inventory item; contents
   go straight to winner's bank server-side). Bot gear is **not** transferred
   to the winner; the bot's save is simply reset from template.
   Three new unique items introduced as rewards:
   - `zesta_longsword` — slash weapon, attack speed 4 (scimitar speed), 60 att
     req, same combat stats as Dragon Longsword, special `overpower` at 25
     energy (150% max hit). Reuses existing `overpower` spec type.
   - `zesta_vest` — body armour, 45 def req, same defence stats as Adamant
     Platebody, +10 melee strength bonus.
   - `zesta_skirt` — legs armour, 45 def req, same defence stats as Adamant
     Plateskirt, +8 melee strength bonus.
   All three go into a new **"PvP"** collection log category.
4. **Matchmaking UX**: bots appear in the normal waiting-room list. Sending an
   "invite" to a bot **immediately starts the match** (server auto-accepts on
   the bot's behalf).
5. **Template system**: bots are defined by reusable templates so many builds
   can be added. The first template is the build below.

---

## 1. Recommendation (TL;DR)

**Build bots as real `characters` + `saves` rows that flow through the existing
PvP system, with a thin "bot adapter" intercepting exactly four seams.** Do
**not** build a separate offline bot system.

A separate offline system would have to re-implement matchmaking, the
deterministic tick engine, the inventory lock, loot transfer, and ranks — all
of which already exist and are server-authoritative. Duplicating them guarantees
drift and bugs, and risks regressing the human PvP path. By making bots *real
characters*, every existing guarantee (one-active-match lock, deterministic
ordering, loot transfer, save integrity) applies to them for free. The only new
code is: keep them visible, auto-accept, give them a brain, and reset them after
each fight.

```
Human client ──invite──▶ /api/pvp/invitations ──(target is bot)──▶ create match now
     │
     │  poll/drive
     ▼
/api/pvp/match/[id]/tick ──(a combatant is a bot)──▶ computeBotIntent() ──▶ merge
     │                                                  into intents ──▶ processPvpTick()
     ▼
terminal ──▶ finalizeTerminalMatch (loot transfer, existing) ──▶ resetBotSave()
```

---

## 2. Current PvP system — what we're building against

(Full file map in the appendix.) Key facts that drive the design:

- **Server-authoritative & deterministic.** The entire combat sim runs in
  `src/engine/pvpEngine.js#processPvpTick(state, intents, itemsData, now)`. The
  client never simulates; it only submits *intents* and *drives ticks*.
- **Flow**: `POST /api/pvp/waiting` (join lobby) → `GET /api/pvp/waiting` (list
  opponents in combat-level ±10 band) → `POST /api/pvp/invitations` (invite) →
  `POST /api/pvp/invitations/[id]/accept` (recipient accepts → match created).
- **Match creation** (`accept.js`): validates CB band + account type + both
  saves fresh (≤15s), builds combatants via `buildCombatantFromSave`, inserts
  `pvp_matches` (active), sets both `characters.active_match_id` (the global
  inventory lock), clears waiting rows.
- **Tick loop** (`match/[id]/tick.js`): paced at 600ms (+75ms grace). Pulls
  pending `pvp_intents` where `tick_number <= state.tick+1 AND applied=0`,
  ordered `tick_number, character_id, character_seq`, runs `processPvpTick`,
  persists `state_json`. On terminal → `finalizeTerminalMatch` →
  `applyLootTransfer` → mark `completed`, bump winner `total_pvp_kills`.
- **Intents** (`match/[id]/intent.js`): `forfeit`, `queue_special`,
  `change_stance`, `change_combat_spell`, `toggle_prayer`, `equip`, `unequip`,
  `eat`, `drink_potion`. Validated server-side (energy, rune cost, prayer level,
  **protection prayers blocked**).
- **Combatant runtime** (per side, in `state.combatants[id]`): `hp/maxHP`,
  `stats`, `equipment`, `inventory`, `stance`, `spell`, `activePotions`,
  `activeCombatPrayer`, `attackTimer`, `eatCooldown`, `potionCooldown`,
  `specialAttackEnergy`, `specialAttackQueued`, `combatType`.
- **Anti-abuse already present**: weapon swap → `attackTimer = max(timer,
  newWeaponSpeed)`; eat → `attackTimer = max(timer, speed+1)`; spec energy regen
  +10/30s capped 100; simultaneous death → lower `characterId` wins; protection
  prayers disabled.
- **Cleanup is request-driven** (`sweepStaleRows`): waiting rows expire after
  30s no-heartbeat; active matches abort after 15s no-tick; invites expire 60s.
  **This is the seam that fights "always online" — see §3.1.**
- **Schema**: `characters(id, owner_id, username, …, active_match_id,
  total_pvp_kills, combat_level [denormalized, migration 0012])`;
  `saves(character_id, base64/save_blob, hash, updated_at)`; plus
  `pvp_waiting_room`, `pvp_matches`, `pvp_invitations`, `pvp_intents` (0008).
- **Save payload shape** (decoded JSON): `{ stats: {skill:{level,xp}},
  equipment: {slot:item}, inventory: [{itemId,quantity,charges?}],
  settings:{combatStance}, player:{currentHP}, … }`.

---

## 3. The four seams (all the new behavior lives here)

### 3.1 Always-online presence (lobby visibility)

**Problem**: the waiting room is heartbeat-gated; `sweepStaleRows` deletes rows
older than 30s. Bots have no client to heartbeat.

**Recommended**: make bot presence *virtual* — do **not** keep bots in
`pvp_waiting_room` at all. Instead, in `GET /api/pvp/waiting`, after fetching
live human rows, **UNION in all `is_bot=1` characters whose `combat_level` is
within the caller's ±10 band**. This keeps the sweeper untouched and means bots
are always listed with zero maintenance. Mark each bot row in the response with
`is_bot: true` so the client can badge it.

> Alternative considered: seed permanent waiting rows and exempt `is_bot` from
> the sweep `DELETE`. Works, but couples bot visibility to a mutable table and a
> sweeper carve-out. The query-UNION is simpler and stateless. **Use UNION.**

Bots must still satisfy the same invite-time CB band check (they do — they have
a real `combat_level`).

### 3.2 Auto-accept (invite → instant match)

**Interception point**: `POST /api/pvp/invitations` (`invitations/index.js`).
When `to_character` is a bot:

1. Skip the normal "insert pending invitation" path.
2. Run match-creation **immediately** on the bot's behalf and return the new
   `match_id` to the inviter.

**Required refactor**: extract the match-creation core from
`invitations/[id]/accept.js` into a shared helper, e.g.
`functions/_lib/pvpMatchCreate.js#createMatch(env, { fromChar, toChar, now })`.
Both the human accept path and the bot auto-accept path call it. The helper:

- For a bot side, **bypass the ≤15s save-staleness check** (bot saves are static
  templates). Keep it for the human side.
- Everything else identical: CB band re-check, account-type check, build
  combatants, atomic insert with the cross-column active guard, set both
  `active_match_id`, clear any waiting rows.

The human's client then proceeds exactly as today: it gets `match_id` and starts
calling `GET /match/[id]` + `POST /match/[id]/tick`.

### 3.3 Server-side bot AI (the brain)

**Interception point**: `POST /api/pvp/match/[id]/tick.js`, just before
`processPvpTick`.

Add a pure engine module `src/engine/pvpBotAI.js`:

```js
// Returns an array of intent actions the bot should take this tick, in order.
// Pure & deterministic: no I/O, no Date.now (receive `now` if needed).
export function computeBotIntents(state, botCharacterId, itemsData, profile) { … }
```

In the tick handler: if `character_a` or `character_b` is a bot, call
`computeBotIntents(...)`, wrap each returned action as an in-memory intent
`{ character_id: botId, tick_number: state.tick+1, character_seq: <high>,
action: … }`, and **merge it into the `intents` array passed to
`processPvpTick`**. Because `processPvpTick` already sorts by
`tick_number, character_id, character_seq`, in-memory injection is deterministic
and needs **no DB writes** for bot intents. (Do not persist bot intents to
`pvp_intents` — it adds a write per tick for no benefit; the state snapshot is
the source of truth.)

**The bot must read everything it needs from `state`** — both combatants' HP,
timers, energy, equipment, inventory, the opponent's `combatType`/equipped
weapon — all of which are in `state.combatants`. See §5 for the AI policy.

> Why this beats a "bot client": a fake client would have to authenticate, poll,
> and race the human's ticks over the network. Running the brain inside the
> single authoritative tick call is simpler, deterministic, unit-testable, and
> impossible to desync.

### 3.4 Post-match reset + loot box grant

**Interception point**: wherever a match involving a bot leaves `active` —
i.e. `finalizeTerminalMatch` (terminal) **and** the abort paths in
`sweepStaleRows` (human disconnect) and the aborted-on-save-conflict branch.

**`applyLootTransfer` is skipped entirely for bot matches.** Instead:

- **Human wins vs bot**: `rollBotLootBox()` (pure fn in
  `src/engine/pvpBotRewards.js`) is called server-side. Its contents go into
  the human's bank via `fillBank`. If a Zesta unique was rolled, a
  `collection_log` row is inserted. Bot save is reset from template.
- **Bot wins vs human**: the human's tradeable gear is stripped via
  `splitInventoryByTradeable` (loser keep only untradeables). The stripped
  items are simply discarded (sinked). Bot save is reset from template.
- **Abort (disconnect/save-conflict)**: inventories untouched (same as today);
  bot save is reset from template.

`resetBotSave(env, botId)` in `functions/_lib/pvpBot.js`:
- Rebuilds the save payload from the bot's `bot_template_id` (reads
  `pvpBots.json`), gzip-encodes it, and upserts `saves` for the bot.
- Always clears `active_match_id` (existing code already does on
  terminal/abort — just ensure reset runs on every exit path for bots).

Centralize "is this character a bot?" in `pvpBot.js` (`isBotCharacter(env, id)`
or carry the `is_bot` flag already loaded in the handlers' SELECTs to avoid
extra queries).

---

## 4. Data model & seeding

### 4.1 Migration `0023_pvp_bots.sql`
```sql
ALTER TABLE characters ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
-- Optional but recommended: a stable pointer from a bot character to the
-- template that defines it, so resets and rebuilds are reproducible.
ALTER TABLE characters ADD COLUMN bot_template_id TEXT;
CREATE INDEX IF NOT EXISTS idx_characters_is_bot ON characters(is_bot) WHERE is_bot = 1;
```

### 4.2 System owner + bot accounts
- Create one system `oauth_identities` row (e.g. provider `system`,
  provider_user_id `pvp-bots`) to own all bots. Bots are normal (not Ironman /
  not One-Life), so they pass account-type gates.
- Each bot = one `characters` row (`is_bot=1`, `bot_template_id` set,
  denormalized `combat_level` computed from the template via
  `getCombatLevelFromSave`) + one `saves` row holding the template payload.

### 4.3 Bot templates (the reusable system)
Store templates as static content data: `src/data/pvpBots.json` (treat as
immutable content, like other `src/data/*`). One entry per bot:

```jsonc
{
  "id": "ranger_pure_v1",
  "username": "Ranger",            // display name in the lobby (unique)
  "aiProfile": "balanced_pure",     // selects an AI policy in pvpBotAI.js
  "stats": {                         // skill levels → XP via experience.js at seed time
    "attack": 60, "strength": 99, "defence": 1,
    "ranged": 99, "magic": 99, "hitpoints": 99, "prayer": 1
  },
  "equipment": {
    "weapon": "magic_shortbow", "ammo": "dragon_arrows",
    "legs": "black_dhide_chaps", "neck": "amulet_of_fury",
    "head": "halo", "hands": "cryptbound_gloves", "feet": "climbing_boots",
    "cape": "fire_cape", "body": "decorative_top"
  },
  "inventory": [
    { "itemId": "super_combat_potion", "quantity": 1 },
    { "itemId": "dragon_dagger", "quantity": 1 },
    { "itemId": "dragon_battleaxe", "quantity": 1 }
    // remaining slots filled with manta_ray up to the 28-slot limit
  ]
}
```

> **Verify item ids against `src/data/items.json`** before seeding (Decision 0
> requires non-unique items; CLAUDE.md §8 requires every referenced item to
> exist). Use Title Case names, existing ids.

### 4.4 Seeding mechanism
Saves are gzipped/encoded blobs, so seed via a **Node script**
(`scripts/seedPvpBots.cjs`) that: builds the save payload from a template, sets
each skill's XP from its level via `src/engine/experience.js`, encodes it with
the existing save codec (`functions/_lib/saveCodec.js` / the client save
encoder), and upserts `oauth_identities` + `characters` + `saves`. The script is
idempotent (keyed on `username` / `bot_template_id`) so it can re-run to add or
refresh bots. Document it in CLAUDE.md §10.

---

## 5. Bot AI policy (near-optimal play)

`src/engine/pvpBotAI.js` is **pure logic** (lives in `src/engine/`, no UI
imports, deterministic, unit-testable per CLAUDE.md §3). Each tick it inspects
`state` and emits an ordered list of intent actions. Reuse the existing engine
formulas (`src/engine/formulas.js`) for max hit / accuracy / DPS so the bot's
predictions match the real sim exactly.

Per-tick decision pipeline (highest priority first):

1. **Survival / eat timing.** Estimate incoming damage over the opponent's next
   swing window from their max hit × hit-chance against the bot's defence, and
   their `attackTimer`. Eat a `manta_ray` when
   `hp - predictedIncoming <= eatThreshold` **and** the bot can afford the
   3-tick eat delay without dying — i.e. eat *early* when the opponent could
   otherwise kill through the eat. (Mirror the "tick eat / safe" intuition: eat
   when the opponent's potential next hit ≥ current hp minus a safety margin.)
2. **Kill push (take risks when it can win).** Compute the opponent's effective
   HP and the bot's available burst:
   - If a queued **special** can plausibly bring the opponent to ≤0 this swing
     (e.g. `dragon_dagger` double-hit, or `magic_shortbow` snapshot) and energy
     ≥ cost → **`queue_special`** and skip eating this tick even at some risk.
   - If the opponent is low and a **slow, high-max-hit** weapon
     (`dragon_battleaxe`, speed 6) has a realistic chance to one-shot where the
     fast weapon can't → **`equip` the battleaxe** to attempt the kill, then
     swap back to `magic_shortbow`/`dragon_dagger` for sustained DPS. Account
     for the swap penalty (`attackTimer = max(timer, newSpeed)`).
3. **Special-attack-to-kill only.** Never spend spec for chip damage. Queue a
   special only when (a) it can kill, or (b) energy is capped and dumping a
   cheap `dragon_dagger` spec (25) is free value. Track `specialAttackEnergy`
   from state; respect regen (+10/30s).
4. **Prayer.** Activate the best affordable damage prayer for the bot's combat
   type (e.g. Rigour for ranged, Piety for the melee burst phase). Switch when
   swapping weapon type. Protection prayers are disabled in PvP v1 — do not
   attempt them (the intent endpoint rejects them anyway).
5. **Potion.** Drink `super_combat_potion` at fight start / when its boost has
   decayed (`activePotions` ticks), to keep effective melee stats high for the
   dagger/axe burst.
6. **Default.** Otherwise keep attacking with the primary DPS setup
   (`magic_shortbow`, `rapid` stance) — emit nothing / maintain stance.

**AI profiles** let templates tune aggression (e.g. `eatThreshold`,
risk tolerance, preferred kill weapon) without code changes. Start with one
profile (`balanced_pure`) and parameterize.

**Determinism note**: the bot must not introduce its own RNG. All randomness
stays inside `processPvpTick`. The AI only chooses *actions*; given the same
`state` it always returns the same intents → fully reproducible & testable.

---

## 6. Things that must keep working (regression guardrails)

- **Human-vs-human is untouched** when neither side is a bot: every interception
  is gated on `is_bot`. Add a test asserting a human/human match creates a
  pending invitation (no auto-accept) and ticks with zero bot intents.
- **One-active-match lock**: a bot can only be in one fight at a time — the
  existing cross-column unique index + `active_match_id` enforce this. Add a
  test: two humans inviting the same bot → second gets `character_in_active_match`.
- **Abort/disconnect**: if the human stops ticking, `sweepStaleRows` aborts the
  match after 15s and frees the bot; `resetBotSave` must run on that path too.
- **Save integrity**: bots route through the same loot-transfer + save writes;
  the `save_revision` / total-level-floor guards still apply to the human side.
- **Leaderboard / ranks**: decide whether bots count. Recommend **excluding
  `is_bot` from leaderboards and the PvP rank ladder** (filter in the rank
  query) so bots don't occupy human ranks. (Open Item B.)

---

## 7. Step-by-step guide for the implementing agent

Work on branch `claude/pvp-bot-system-design-dmW9A`. Run the commit gate
(`npm run ci && npm test`) before every commit (CLAUDE.md §11).

1. **Schema** — add `migrations/0023_pvp_bots.sql` (§4.1). Wire it into the
   migration runner the same way 0022 is wired.
2. **Templates** — add `src/data/pvpBots.json` with the `ranger_pure_v1` build
   (§4.3). Validate every item id exists in `src/data/items.json` and is
   non-unique; fill inventory to the 28-slot cap with `manta_ray`.
3. **Seed script** — `scripts/seedPvpBots.cjs` (§4.4): build save payload, set
   XP from levels via `experience.js`, encode via the save codec, upsert system
   identity + character (`is_bot=1`, computed `combat_level`, `bot_template_id`)
   + save. Make idempotent. Add an npm script `seed:bots`.
4. **Bot helpers** — `functions/_lib/pvpBot.js`: `isBotCharacter`,
   `loadBotTemplate(templateId)`, `resetBotSave(env, botId)`.
5. **Seam 1 (visibility)** — in `functions/api/pvp/waiting.js` `GET`, UNION
   `is_bot` characters within the caller's ±10 band into the response; tag
   `is_bot: true` (§3.1).
6. **Refactor match creation** — extract `createMatch` into
   `functions/_lib/pvpMatchCreate.js`; have `accept.js` call it; add a
   `skipStaleCheckFor` option for the bot side (§3.2).
7. **Seam 2 (auto-accept)** — in `invitations/index.js` `POST`, when
   `to_character.is_bot`, call `createMatch` immediately and return `match_id`
   instead of creating a pending invite (§3.2).
8. **Seam 3 (AI)** — add `src/engine/pvpBotAI.js#computeBotIntents` (§5). In
   `match/[id]/tick.js`, if a combatant is a bot, compute and merge bot intents
   in-memory before `processPvpTick` (§3.3). No DB writes for bot intents.
9. **Seam 4 (reset)** — call `resetBotSave` on every path that ends/aborts a
   bot match: `finalizeTerminalMatch`, the save-conflict abort branch, and the
   `sweepStaleRows` abort branch (§3.4).
10. **Leaderboard exclusion** (if chosen) — filter `is_bot` from rank/leaderboard
    queries (§6, Open Item B).
11. **Client/UI** — badge bot rows in the waiting list; on "invite" to a bot,
    expect an immediate `match_id` and jump straight into the match screen.
    (Reuse existing PvP match UI — no new combat UI needed.) Keep any new screen
    out of `GAME_CHUNK_FILES` rules per CLAUDE.md §12 if applicable.
12. **Tests** (`tests/**`, deterministic logic only):
    - `pvpBotAI`: eats at threshold; queues spec only when lethal; swaps to
      battleaxe for a lethal hit then back; picks correct prayer; respects spec
      energy/regen.
    - auto-accept: invite to bot → active match, no pending invite row.
    - human/human unchanged: invite stays pending; tick injects no bot intents.
    - reset: after terminal/abort, bot save equals template, `active_match_id`
      cleared.
    - one-active-match: second inviter to a busy bot is rejected.
13. **Docs** — update CLAUDE.md §10 (PvP rules) to document bots, the seed
    script, the template format, and the four seams.
14. **Commit gate & push** — `npm run ci && npm test`, then push to the branch.

---

## 8. Open items to confirm before/while building

- **A. ~~Untradeable equipped pieces.~~** Resolved — loot box replaces gear
  transfer entirely. The bot's equipment is irrelevant to rewards.
- **B. Leaderboard/ranks.** Confirm bots should be excluded from the PvP rank
  ladder and total-level leaderboard (recommended).
- **C. Bot win-rate / difficulty.** The AI as specified is near-optimal and will
  be hard to beat. Consider a per-profile difficulty knob (reaction delay, eat
  threshold, spec aggression) so early bots are beatable while the player base
  is small.
- **D. Number & spread of bots.** One bot per combat-level band leaves gaps.
  Decide how many templates/bands to seed initially so most players see at least
  one fightable bot in their ±10 window.

---

## Appendix — key files

| Area | Path |
|---|---|
| Tick engine (sim) | `src/engine/pvpEngine.js` (`processPvpTick`, `resolveSwing`) |
| Combat formulas | `src/engine/formulas.js`, `src/engine/combatant.js` |
| Special attacks | `src/engine/pvpSpecialAttacks.js` |
| Waiting room | `functions/api/pvp/waiting.js` |
| Invitations | `functions/api/pvp/invitations/index.js`, `…/[id]/accept.js` |
| Match loop | `functions/api/pvp/match/[id]/tick.js`, `…/intent.js` |
| Match/save helpers | `functions/_lib/pvpMatch.js`, `functions/_lib/pvp.js` |
| Loot transfer | `functions/_lib/lootTransfer.js` |
| Combat level | `functions/_lib/combatLevel.js`, `functions/_lib/saveSummary.js` |
| Ranks | `functions/_lib/pvpRanks.js` |
| Schema | `migrations/0008_pvp.sql`, `0009`, `0012`, `0013` |
| Item data | `src/data/items.json` · Prayers `src/data/prayers.json` |

### New files this plan introduces
- `migrations/0023_pvp_bots.sql`
- `src/data/pvpBots.json`
- `src/engine/pvpBotAI.js`
- `functions/_lib/pvpBot.js`
- `functions/_lib/pvpMatchCreate.js` (refactor target)
- `scripts/seedPvpBots.cjs`
- `tests/pvpBotAI.test.ts` (+ seam tests)
