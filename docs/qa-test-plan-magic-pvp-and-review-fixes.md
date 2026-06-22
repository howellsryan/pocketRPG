# Manual Test Plan — Magic in PvP + Codebase-Review Fixes

**Branch under test:** `claude/rpg-game-codebase-review-n2ck54`
**Author (QA):** Senior Quality Engineer
**Date:** 2026-06-22
**Status:** Pre-merge verification

---

## 1. Purpose & Scope

This plan covers manual, behaviour-level verification of everything changed on this branch before it merges to `main`. Automated coverage is green (1808 logic tests, single-file build check, Vite build), so this plan focuses on **user-facing behaviour and integration paths that unit tests cannot fully prove** — especially the PvP magic flow (server-authoritative, multi-client) and behaviour-preserving refactors.

### Changes in scope

| ID | Change | User-facing? | Risk |
|----|--------|--------------|------|
| C1 | Magic combat enabled in PvP (PR #608) — spell selector, rune consumption, powered staves, mid-fight spell switching | **Yes (high surface)** | **High** |
| C2 | `change_combat_spell` rune validation now credits an equipped elemental staff | Yes | Medium |
| C3 | Combat-level formula consolidated; client now applies the `max(3, …)` floor | Yes (low-level accounts) | Medium |
| C4 | Boss/raid content gates extracted from `CombatScreen` (behaviour-preserving) | Yes (regression risk) | Medium |
| C5 | Master clue reward data fix: `torstol` (non-existent) → `thornspire` | Yes | Low |
| C6 | New unit tests + doc updates | No | None |

### Out of scope
- C6 (tests/docs) — no manual testing.
- Non-magic PvP mechanics not touched by this branch (melee/ranged damage formulas, special attacks, prayer drain, loot transfer) — covered only by the **smoke regression** in §7, not exhaustively.
- Idle/offline economy, skilling, trading post — unaffected; smoke only.

---

## 2. Test Environment & Prerequisites

| Item | Requirement |
|------|-------------|
| Build | Branch tip; run `npm run build && npm run rebuild` and serve the single-file `index.html`, OR `npm run dev`. |
| Backend | Cloudflare Pages Functions + D1 reachable (PvP is server-authoritative). PvP bots seeded (`npm run seed:bots`). |
| Devices | 1× desktop browser **and** 1× mobile viewport (or real phone) — the spell selector has separate desktop-card and mobile-panel UIs. |
| Accounts | **Account A** (primary tester), **Account B** (sparring partner) within combat level ±10 of A, neither Ironman nor One-Life. A PvP **bot** in the band is an acceptable substitute for Account B for most magic cases. |

### Test-data setup (Account A)
Prepare a character that can exercise every magic branch:
- **Magic level ≥ 59** (to cast Wind Strike L1, Fire Bolt L35, Fire Blast L59).
- In bank/inventory: a **non-powered magic weapon** (`Staff of Air`), an **elemental staff** of a different element (`Staff of Fire`), and a **powered staff** (`Trident of Venom`).
- Runes: a stack of `air_rune`, `fire_rune`, and a **deliberately small** stack (e.g. 3) of one rune to force a mid-fight out-of-runes case.
- `save.settings.activeCombatSpell` pre-set to **Fire Bolt** (to verify match-start seeding).

### Reference data (for expected results)
- **Wind Strike** — L1, runes `{air_rune:1}`, base 2.
- **Fire Bolt** — L35, runes `{fire_rune:5, air_rune:2}`, base 12.
- **Fire Blast** — L59, runes `{fire_rune:5, air_rune:3}`, base 16.
- **Elemental staves**: Staff of Fire → supplies `fire_rune`; Staff of Air → `air_rune`; Staff of Water → `water_rune`; Staff of Earth → `earth_rune`.
- **Powered staves** (no spell/no runes, scale off magic level): Trident of Venom, Shadow Of Tumaken, Sanguine Staff.

---

## 3. Risk-Based Priority & Exit Criteria

- **P0** = blocks merge if failing. **P1** = must pass or have a tracked waiver. **P2** = nice to have.
- **Exit criteria to merge:** all P0 PASS, all P1 PASS or waived with owner sign-off, no new crash/console-error in any flow exercised.

---

## 4. C1 — Magic Combat in PvP (P0/P1)

> Run each case once on **desktop** and once on **mobile** unless noted. Record the actual max hit / rune counts where the expected column references them.

### TC-C1-01 — Spell selector visibility (non-powered magic weapon) · P0
**Pre:** Account A equips **Staff of Air**, enters a PvP match.
**Steps:** Observe the combat UI on desktop (card) and mobile (quick-actions panel).
**Expected:** A **Spell selector** (🔮/Cast) is visible and shows the currently-selected spell. Selecting it lists spells the player meets the magic level for.
**Fail if:** selector missing, empty, or lists spells above the player's magic level.

### TC-C1-02 — Spell selector hidden for powered staff · P0
**Pre:** Account A equips **Trident of Venom**, enters a PvP match.
**Expected:** **No** spell selector is shown (powered staves auto-cast). The player attacks with magic with no spell/rune selection.
**Fail if:** a spell selector appears, or attacks do 0 damage.

### TC-C1-03 — Match-start spell seeding · P0
**Pre:** `activeCombatSpell` = Fire Bolt; equip Staff of Air; enough runes.
**Steps:** Enter match, do not change spell, begin attacking.
**Expected:** The combatant opens casting **Fire Bolt** (the saved spell), not a default/none. Damage is consistent with Fire Bolt (base 12 + magic scaling), not 0.
**Fail if:** fight starts with no spell / 0 damage, or a different spell than saved.

### TC-C1-04 — Standard spell consumes runes per cast · P0
**Pre:** Staff of Air, Fire Bolt selected, note exact `fire_rune` and `air_rune` counts.
**Steps:** Let several casts land; after the match (or via inventory readout) compare rune counts.
**Expected:** Each successful cast removes **5 fire + 2 air** runes. After N casts, runes dropped by exactly N×(5,2). Damage applied each cast.
**Fail if:** runes not consumed, consumed by the wrong amount, or consumed when no cast occurred.

### TC-C1-05 — Elemental staff supplies its rune free · P1
**Pre:** Equip **Staff of Fire**; select Fire Bolt; carry `air_rune` only (**0 fire_rune**).
**Expected:** Casts succeed; **only air_rune** is consumed (2 per cast); fire_rune stays 0 and is never required. Damage applies normally.
**Fail if:** cast blocked for missing fire runes, or fire runes consumed (can't go below 0).

### TC-C1-06 — Out-of-runes blocks the cast (`no_runes`) · P0
**Pre:** Staff of Air, Fire Bolt, only **3 air_rune** carried (and ≥5 fire) — air runs out first.
**Steps:** Attack until air runes are exhausted.
**Expected:** Once runes are insufficient, the cast is **blocked** — that swing deals **0 damage** and a "no runes / out of runes" indication is surfaced. No negative rune counts. Combat continues (opponent can still hit you).
**Fail if:** the game lets you cast with negative/zero runes, crashes, or the match desyncs.

### TC-C1-07 — Powered staff scales off magic level, no runes · P1
**Pre:** Equip **Trident of Venom**, carry **no runes**.
**Expected:** Attacks land for non-zero damage scaling with magic level; **no runes consumed**; no "no runes" block ever.
**Fail if:** blocked for runes, or 0 damage.

### TC-C1-08 — Change spell mid-fight · P0
**Pre:** Staff of Air; start on Fire Bolt with runes for both Fire Bolt and Wind Strike.
**Steps:** Mid-match, switch to **Wind Strike** via the selector.
**Expected:** Selection updates optimistically; subsequent casts use **Wind Strike** (consumes `air_rune:1`, base-2 damage profile). Switch does not stall your attack timer abnormally.
**Fail if:** switch ignored, still casting old spell, or applies the wrong rune cost.

### TC-C1-09 — Change spell blocked when ineligible · P1
**Pre:** Staff of Air; attempt to switch to a spell above your magic level, or one you lack runes for (no staff coverage).
**Expected:** Switch is rejected with the correct reason (`insufficient_magic_level` / `insufficient_runes`); the previously-selected spell remains active.
**Fail if:** the UI lets you select an invalid spell and then casts 0 / desyncs.

### TC-C1-10 — Clear spell selection · P2
**Pre:** Staff of Air with a spell selected.
**Steps:** Clear the selected spell (null).
**Expected:** Allowed; with no spell and a non-powered weapon, magic attacks do not cast (0 dmg / prompts to pick a spell) — consistent, no crash.

### TC-C1-11 — All three magic styles fight · P1
**Pre:** For each of the magic combat styles available with a magic weapon, enter a match.
**Expected:** `combatType` resolves to magic from the equipped weapon and the fight proceeds; no style silently does nothing.

### TC-C1-12 — Magic vs. opponent of each type (parity) · P1
**Steps:** Fight a magic build against a melee opponent and (if available) be fought *by* a magic opponent (bot).
**Expected:** Damage, rune consumption, and death/loot resolution all behave; magic is not free damage and not zero damage; the match reaches a normal terminal state (win/lose/forfeit) with correct loot rules.

---

## 5. C2 — `change_combat_spell` Rune Validation (Staff Credit) (P1)

### TC-C2-01 — Switch allowed when staff supplies the only missing rune · P1
**Pre:** Equip **Staff of Fire**; inventory has `air_rune ≥ 2`, **0 fire_rune**; magic ≥ 35.
**Steps:** Switch to **Fire Bolt**.
**Expected:** Switch **succeeds** (staff covers fire runes). This is the exact nit fixed — previously it was wrongly blocked.
**Fail if:** rejected with `insufficient_runes`.

### TC-C2-02 — Switch blocked without staff and missing runes · P1
**Pre:** **No staff** (e.g. Staff of Air equipped, which does not supply fire); `air_rune ≥ 2`, **0 fire_rune**.
**Steps:** Switch to Fire Bolt.
**Expected:** Rejected with `insufficient_runes`; prior spell stays active.
**Fail if:** switch allowed (would then cast 0 / desync).

### TC-C2-03 — Validation matches the cast path · P1
**Steps:** Any case where the switch is *allowed*, then actually cast.
**Expected:** Whatever the validator allows, the cast also succeeds (no "allowed to select but can't cast" mismatch), and vice-versa.

---

## 6. C3 — Combat Level Floor & Matchmaking (P1)

### TC-C3-01 — Fresh/low account shows CB 3 minimum · P1
**Pre:** A brand-new or very-low-stat character (all combat stats level 1, HP 10).
**Steps:** Check the combat level shown on the Home screen / character readout.
**Expected:** Combat level reads **3** (the floor), **not 1 or 2**. This is the intended client change.
**Fail if:** displays 1/2, or differs from the server's value.

### TC-C3-02 — Client display == server matchmaking value · P1
**Steps:** For several characters across the range (low, mid, maxed), compare the CB shown in-client vs. the CB used by PvP matchmaking / shown in the lobby.
**Expected:** Identical for every account. The ±10 lobby band is computed from the same number the client displays.
**Fail if:** any account's client CB ≠ server CB (would cause confusing "out of band" matchmaking).

### TC-C3-03 — Quest combat-level gate consistency · P2
**Pre:** A quest with a combat-level requirement, on a low-CB account near the threshold.
**Expected:** Eligibility (lock/unlock and the "Combat level N (have M)" reason) uses the floored value consistently with what's displayed.

### TC-C3-04 — Maxed account regression · P1
**Pre:** Maxed combat account (all 99).
**Expected:** Combat level still computes **126** (no off-by-one from the refactor). Mid-range accounts unchanged vs. pre-merge `main`.

---

## 7. C4 — Boss/Raid Content Gates (Behaviour-Preserving Regression) (P1)

> The gating logic was moved out of `CombatScreen` into a pure module. Verify no gate changed.

### TC-C4-01 — Slayer-level gate · P1
**Pre:** A boss/monster with a Slayer requirement; account **below** it.
**Expected:** Attempting to fight is blocked with toast **"Need Slayer level N to fight {name}"**. Raising Slayer to the requirement unlocks it.

### TC-C4-02 — Quest gate shows quest name · P1
**Pre:** A monster with a `questRequirement` not yet completed.
**Expected:** Blocked with **"Complete {Quest Name} to fight {name}"** (human-readable quest name, not a raw id). Completing the quest unlocks it.

### TC-C4-03 — Ashen Crucible kill-count prereq · P1
**Pre:** Account that has **never** killed Ember Tyrant.
**Steps:** Try to start **Ashen Crucible**.
**Expected:** Blocked with **"Defeat Ember Tyrant first to unlock Ashen Crucible"**. After **one** Ember Tyrant kill, Ashen Crucible becomes available.

### TC-C4-04 — Crimson Night Theatre raid gate · P1
**Pre:** "A Night at the Theatre" quest **not** completed.
**Steps:** Try to start the **theatre_of_blood** raid.
**Expected:** Blocked with **"Complete A Night at the Theatre to access Crimson Night Theatre"**. Completing the quest unlocks it.

### TC-C4-05 — Ungated content still starts · P1
**Pre:** A boss/raid with no requirements, met account.
**Expected:** Fight/raid starts normally — the refactor did not over-lock anything. Spot-check 2–3 unrelated bosses and 1 unrelated raid.

---

## 8. C5 — Master Clue Reward Data Fix (P2)

### TC-C5-01 — Master clue rewards a valid herb · P2
**Pre:** Account able to complete a **master** clue scroll.
**Steps:** Complete one or more master clues; inspect rewards (repeat to hit the herb roll).
**Expected:** When the herb reward rolls, the player receives **Thornspire** (a real, named, bankable item) — never a blank/unknown/"torstol" item, and never an item that silently fails to bank.
**Fail if:** any reward shows as missing/blank or fails to enter inventory/bank.

### TC-C5-02 — Collection log / bank integrity · P2
**Expected:** The Thornspire reward stacks/banks correctly and appears with its proper name and icon.

---

## 9. Cross-Cutting Regression & Smoke (P1)

### TC-R-01 — PvP lifecycle smoke · P1
Enter lobby → match against Account B / bot → fight to a natural end (win, loss, **forfeit**) → confirm loot transfer / bot-loot rules and that save/idle/purchase writes were locked during the match and unlock after.

### TC-R-02 — Non-magic PvP unaffected · P1
Run one melee and one ranged PvP match: damage, special attack (energy 100 → regen +10/30s), eating, potions, and offensive-prayer drain still behave (protection prayers remain disabled). Equipment swap mid-fight adds **no** attack delay.

### TC-R-03 — PvE combat smoke · P1
Fight a regular monster and one boss in normal (non-PvP) combat: eating, combo food, special attack, prayer, and loot modal all work — confirms the `CombatScreen` extraction didn't disturb the screen.

### TC-R-04 — No console errors · P1
Across all flows above, the browser console shows **no** new errors/warnings (especially no module/import errors from the new `combatLevel.js` / `combatRequirements.js` / `runes.js` wiring).

### TC-R-05 — Mobile layout · P2
Spell selector, combat quick-actions, and gate toasts render within safe areas on a phone viewport (no clipping by status bar / home indicator).

---

## 10. Defect Reporting & Sign-off

**For each failure record:** TC ID, device, account CB, exact steps, expected vs. actual, screenshot/video, console log, and whether reproducible.

### Sign-off checklist
- [ ] All **P0** cases PASS (TC-C1-01/02/03/04/06/08).
- [ ] All **P1** cases PASS or waived with owner sign-off.
- [ ] No new crashes or console errors in any exercised flow.
- [ ] PvP magic verified on **both** desktop and mobile.
- [ ] Combat-level display matches server matchmaking for low / mid / maxed accounts.
- [ ] Content-gate regressions (TC-C4-*) confirmed unchanged from `main`.

**QA verdict:** ☐ Approve for merge ☐ Approve with waivers ☐ Block

---

### Appendix — Mapping tests → code (for triage)
- C1/C2 → `functions/_lib/pvpMatch.js`, `functions/api/pvp/match/[id]/intent.js`, `src/engine/combatPrimitives.js` (`resolveMagicSwing`), `src/engine/runes.js`, `src/screens/PvpCombatScreen.jsx`, `src/data/spells.json`.
- C3 → `src/engine/combatLevel.js`, `src/utils/helpers.js`, `src/engine/quests.js`, `functions/_lib/combatLevel.js`.
- C4 → `src/engine/combatRequirements.js`, `src/screens/CombatScreen.jsx`.
- C5 → `src/data/clues.json`, `src/engine/clueScrolls.js`.
</content>
