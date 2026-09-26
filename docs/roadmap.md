# PocketRPG Roadmap — Q4 2026 and beyond

> Living document. Written 2026-09-06 against the repo as it stands. Amend in place as items ship; don't fork a second roadmap file.
>
> Scope discipline: every line item here is a *candidate*, not a commitment. Sequencing is a recommendation; the ordering rationale is in §7.

## 1) How to read this

Sizes are calibrated to this project's actual delivery cadence (single session, AI-assisted, `npm run ci` gate per §11):

| Size | Wall clock | Shape |
|---|---|---|
| **XS** | Minutes–1h; several per day | Data-only or one-screen change. `add-content` skill covers most of them. |
| **S** | Half a day | One system, one screen, a handful of tests. |
| **M** | ~1 day | New subsystem inside existing architecture. Engine + UI + tests. |
| **L** | ~1 week | New subsystem *and* new server surface / migration / save-shape change. |
| **XL (epic)** | 2+ weeks | New pillar. Multi-phase, own build guide, own progress log — the open world's shape. |

Every implementation item runs the `delivery-loop` skill. Anything touching `functions/api/**`, the save blob, or the single-file build additionally runs `plan-gate` first.

**Design constraint on every item below**: it must be playable *idle*. If a feature only works when the player is watching, it's the wrong feature for this game — or it needs an idle expression before it ships (see §5).

## 2) Where we are (2026-09-06)

Grounded from the repo, not memory:

- **Content**: 771 items · 119 monsters (52 bosses) · 4 raids · 10 minigames · 168 quests · 17 non-combat skills + combat skills · 137 daily tasks · 14 towns in `world.json`.
- **Systems shipped**: Slayer (masters, unlocks, block list), Construction perks, Dungeoneering, Summoning, Farming, Kingdom of Royals, Hard Mode, Grim Reaper, clue scrolls (medium→master), collection log, Trading Post (real player order book with instant-sell), leaderboard, daily tasks, account modes (Ironman / Grindman / One Life), offline catch-up + credit skips.
- **Multiplayer**: co-op boss rooms + raid parties (server-authoritative DO, 10% loot gate), PvP Wilderness inside the open world.
- **Open world**: 8 zones (`cow_pasture`, `lumbright`, `overworld`, `dragon_roost`, `fiend_pit`, `grondar_lair`, `zaryth_throne`, `wilderness`) with movement, gathering, combat, floor loot, chat, presence, gear visuals.
- **Platform**: single Cloudflare Worker, D1, OAuth, Stripe credits, MCP server + in-game AI helper, iOS/Capacitor build path.

That is a *lot* of surface. The roadmap's job is not to add pillars for their own sake — it's to (a) close the OSRS-shaped holes players will notice, (b) deepen the idle loop that is our actual USP, and (c) give the endgame somewhere to go.

## 3) Gap analysis vs OSRS

What OSRS has that we don't, ranked by "will a returning OSRS player notice this is missing".

| OSRS system | Our state | Verdict |
|---|---|---|
| **Pets** (boss/skilling pets) | **None.** Zero pet items, no pet slot, no collection-log pet category. | **Highest-value easy win in the game.** Pets are the OSRS grind's emotional payload and cost almost nothing to build. |
| **Achievement Diaries** | None. | Big. We have 14 towns already authored — diaries give them purpose and gate meaningful QoL rewards. |
| **Combat Achievements** | None. | Big. Free endgame goal structure over 52 existing bosses. |
| **Beginner / Easy clues** | Clues start at **medium**. | The low-end onboarding rung is missing. XS to fill. |
| **Sound & music** | **None at all.** No audio anywhere. | Cheap, transformative for feel. Ship muted-by-default. |
| **Skilling bosses** | Autumntodt (Wintertodt) only. | Tempoross/Zalcano analogues are proven idle-friendly loops. |
| **Wave/endurance endgame** (Inferno, Colosseum) | None. | The one thing that makes maxed gear *mean* something. |
| **Rotation bosses** (Zulrah/Vorkath style) | Bosses have forms/adds but no prayer-rotation puzzle. | Medium. Tests the gear+prayer system we already have. |
| **Group Ironman** | Ironman, Grindman, One Life — no group mode. | Social retention, moderate server work. |
| **Friends / clan chat** | World zone chat + co-op chat only. Nothing persistent. | The social floor is missing. |
| **Leagues / seasonal worlds** | None. | The single biggest retention lever in modern OSRS. Epic-sized. |
| **Bounty Hunter / Deadman** | Wilderness only. | Later; PvP population is the gate, not the code. |
| **Sailing** (OSRS's next skill) | None. | Uniquely suited to idle — see §5. |
| **Grand Exchange** | Trading Post covers it (order book, both sides, instant-sell). | **Closed.** Needs polish (price history), not rebuild. |
| **Barrows** | `Cryptbound Champions` raid appears to cover the rotating-set fantasy. | Verify before scheduling anything; likely closed. |
| **Quest cape / skill capes** | Skill capes + Max cape exist. Quest cape unclear. | XS to close if missing. |

## 4) Gaps that aren't OSRS gaps — they're product gaps

Things every good idle game has that we don't:

- **No push notifications.** We ship a PWA manifest and an iOS build, and we are a game *about* coming back. "Your bank is full", "task complete", "raid party forming" are the return hooks. This is the highest-ROI retention item on the list.
- **No offline summary worth reading.** Catch-up computes; it doesn't *narrate*. A "while you were away" report (XP bars, notable drops, level-ups, what stopped you) is the moment the loop pays off.
- **No goal tracking.** `trainingPlanner.js` already answers "how many X to level N" for the MCP tool and the chatbot — but the player can't see it in the UI without asking a chatbot. Surface it as a first-class goal tracker.
- **No dry-streak visibility.** We have kill counts and a collection log; players want "247 kills since last unique, drop rate 1/512". Pure UI over existing data.
- **No automation rules.** The idle genre's ceiling feature: let players *program* the sim (see §5).

## 5) Idle-native opportunities (our actual differentiation)

OSRS content is the vocabulary; idle is the grammar. Where we can go that OSRS structurally cannot:

**A. Expeditions / voyages (idle-only content).** Multi-hour committed runs the player *cannot* watch: pick a destination, a loadout and supplies, come back in 4/8/12h for a resolved narrative + loot table. Risk/reward tuned so a failed expedition loses supplies, not gear. This is the idle answer to "what do I do overnight", and it's the natural home for a **Sailing** skill (§6, XL) — voyages, cargo, ship upgrades, sea bosses.

**B. Programmable idle (rule builder).** "Eat at 50% HP · switch prayer when boss enters phase 2 · bank when full · stop at Slayer task complete · abort if food out." The engine is deterministic, so rules are simulable and testable. This turns gear/consumable knowledge into *expressed* skill during offline time — the genre's highest-value mechanic (Melvor's auto-eat, Idle Champions' formations) and something OSRS bans outright.

**C. Loadout autopilot.** `gearOptimizer.js` + `dpsCalculator.js` already search loadouts analytically. One tap: "gear me for this boss from my bank". Already-built maths, not yet a player-facing button.

**D. Sim-before-you-commit.** Show expected kills/hour, expected loot value/hour and death probability *before* the player starts an 8-hour idle run. The analytical twin exists; the UI doesn't.

**E. Asynchronous social.** Co-op needs both players online. Idle needs it not to. Guild/clan shared goals ("the clan mines 1M ore this week"), asynchronous boss "assists", and offline-contributing group content are the idle-shaped version of a clan.

**F. Seasons over prestige.** Prestige (wipe for a multiplier) fights the OSRS register. **Leagues** — fresh save, relic picks, area unlocks, a 6-week leaderboard, rewards ported home cosmetically — gets the same retention without insulting the grind.

## 6) The roadmap

### Month 1 — "Make the grind feel good" (feel, retention, cheap OSRS holes)

Theme: nothing here is architecturally risky. This is a month of high-frequency shipping.

| # | Item | Size | Why now |
|---|---|---|---|
| 1.1 | **Pets** — boss + skilling pet drop rolls, pet slot, collection-log pet category, follower rendered on the combat stage & in the world | M | Biggest emotional gap. Rides `collectionLog.json` + existing drop tables. |
| 1.2 | **Sound & music** — hitsplat ticks, level-up jingle, rare-drop chime, ambient per-screen bed; muted default, one settings toggle | M | The game currently has zero audio. |
| 1.3 | **Push notifications** — web-push + iOS: bank full, idle session ended, task complete, raid party invite | M | Return hook. PWA + Capacitor paths already exist. |
| 1.4 | **"While you were away" report** — narrated offline summary with XP bars, notable drops, level-ups, stop reason | S | Turns catch-up maths into the payoff moment. |
| 1.5 | **Beginner + Easy clue tiers** | XS | Closes the low-end clue rung. `add-content` only. |
| 1.6 | **Dry-streak counters** — kills since last unique + drop rate, per collection-log slot | XS | Pure UI over existing kill counts. |
| 1.7 | **Goal tracker** — pin a target level/item; surface `trainingPlanner` output in-UI with ETA | S | Logic already exists for the chatbot. |
| 1.8 | **Gear-me-up button** — one-tap `gearOptimizer` best-in-bank loadout per fight | S | Analytical twin already shipped. |
| 1.9 | **Pre-run projection** — expected kills/hr, loot/hr, death risk before starting an idle session | S | Uses `dpsCalculator`. |
| 1.10 | **Quest cape + completionist checks** (verify, then fill) | XS | Cheap prestige capstone. |
| 1.11 | **Bank tabs, placeholders, saved searches** | S | Long-tail QoL; 771 items is past the point where one flat bank works. |

**Month 1 exit criteria**: a returning player hears the game, gets told when to come back, sees what happened while away, and can name a pet after 900 dry kills.

### Month 2 — "Give the endgame somewhere to go" (structure + new content)

| # | Item | Size | Why now |
|---|---|---|---|
| 2.1 | **Combat Achievements** — tiered per-boss tasks across all 52 bosses, tier rewards (teleport, drop-rate QoL, cosmetic) | M | Free goal structure over content we already own. |
| 2.2 | **Achievement Diaries** — Easy/Medium/Hard/Elite per town across the 14 `world.json` regions; rewards = travel QoL, better gather rates, bank access | L | Gives the gazetteer purpose. Touches many systems; run `plan-gate`. |
| 2.3 | **The Colosseum** — 12-wave endurance gauntlet, idle-able but **credit-skip disabled** (matches #1003 precedent), escalating modifiers, capstone weapon reward | L | The missing "what is max gear FOR" answer. |
| 2.4 | **Rotation boss** (Zulrah/Vorkath analogue) — phase-cycled style switching that rewards prayer/gear rules, not reflexes | M | Perfect fit for the rule builder in Month 3. |
| 2.5 | **Skilling bosses ×2** — Tempoross (Fishing) + Zalcano (Mining/Smithing) analogues, joining Autumntodt | M | Proven idle-shaped skilling content; extends a minigame frame that already exists. |
| 2.6 | **Slayer depth** — superior slayer monsters, boss tasks, task streak rewards | M | Slayer is our best retention loop; it's under-built vs OSRS. |
| 2.7 | **Friends list + clan chat** (persistent, cross-session) | M | The social floor. Prerequisite for 3.x guild work. |
| 2.8 | **Trading Post price history + charts** | S | The order book exists; players can't see the market. |
| 2.9 | **New boss batch** — 3–4 mid-tier bosses filling the level 70–90 gear gap | M | `add-content` throughput; keeps the drip going between big items. |

**Month 2 exit criteria**: a maxed player has a named list of things they haven't done yet, and a reason to log in that isn't XP.

### Month 3 — "Idle as the differentiator" (the stuff OSRS can't ship)

| # | Item | Size | Why now |
|---|---|---|---|
| 3.1 | **Rule builder (programmable idle)** — condition→action rules for combat/skilling/banking, simulated against the deterministic engine, with a dry-run preview | L | The genre-defining feature. Needs Month 2's rotation boss to have something worth programming against. |
| 3.2 | **Expeditions** — 4/8/12h committed offline runs with supply loadouts, resolved narrative + loot on return | L | The overnight answer. Foundation for Sailing. |
| 3.3 | **Group Ironman** | M | Social mode with a defined ruleset; server-authoritative shared bank is the real work. |
| 3.4 | **Guild/clan shared goals** — weekly asynchronous clan objectives that idle time contributes to | M | Async social; depends on 2.7. |
| 3.5 | **Raid #5** | L | Cadence item; the raid substrate (§20/§21) makes this repeatable now. |
| 3.6 | **Open world Phase 6–8 continuation** — more zones, processing skills in-world, armour visuals (per `docs/open-world-next-phases-scope.md`) | L | Keeps the world from being a 2-week spike that stalls. Explicitly budgeted, not opportunistic. |

**Month 3 exit criteria**: the game does something OSRS cannot, and it's the reason people describe us to a friend.

### Beyond — the epics (2+ weeks each, one at a time)

**E1. Leagues / Seasons (XL, ~3 weeks).** Fresh seasonal character, relic picks at milestones, region unlocks, accelerated rates, a 6-week leaderboard, cosmetic-only rewards ported to the main account. The single strongest retention structure in the genre and the only "prestige" that respects the OSRS register. Needs: seasonal save partition, separate leaderboard scope, relic modifier layer in the engine, season lifecycle jobs. Run this only after the Month 1–2 content base is deep enough for a league to feel different, not thinner.

**E2. Sailing (XL, ~2–3 weeks).** A new skill, delivered as the mature form of Expeditions (3.2): ships, crew, cargo, port trade routes, sea bosses, storm risk. Voyages resolve on the clock, so it is *natively* idle in a way no OSRS skill is — and it's the OSRS skill players are actively excited about. Sequence strictly after 3.2 so the voyage substrate is proven cheap.

**E3. Open world as the primary surface (XL, ongoing).** The menu game and the 3D world are currently two products sharing a save. The epic is convergence: quests playable in-world, world bosses, in-world co-op, deep-links from menu travel into zones. Own build guide, own progress log — the existing pattern.

**E4. Mobile store launch (L→XL).** `docs/app-store-deployment-plan.md` and the go-live runbook already exist. This is a release-engineering epic, not a feature one, and it should be scheduled deliberately once Month 1's audio + notifications land (an App Store build with no sound and no notifications reviews badly).

**E5. PvP expansion (XL, gated on population).** Bounty Hunter targets, seasonal Deadman-style event. Do not build until the Wilderness has a measurable concurrent population — code is not the bottleneck here.

## 7) Sequencing rationale

1. **Feel before features.** Audio, notifications and the away-report change how every existing hour of content lands. Shipping a fifth raid to a silent game with no return hook is worse value than shipping sound.
2. **Structure before more content.** Combat Achievements and Diaries multiply 52 bosses and 14 towns we already paid for. New bosses are cheap to add *after* there's a frame that makes them count.
3. **Differentiation last, deliberately.** The rule builder and Expeditions are the most defensible features, and the most likely to be built wrong without a mature content base under them.
4. **One epic in flight at a time.** The open world took 2 weeks; the failure mode is starting E1 and E2 concurrently and finishing neither.

## 8) Explicitly not doing

- **A second PvP path.** `world/shared/pvpArea.ts` is the only gate (CLAUDE.md §10). Migration 0035 deleted the old one; don't rebuild it.
- **Prestige-with-a-multiplier.** Fights the brand register. Leagues instead.
- **Server-side engine revalidation of the save blob.** §14 is a deliberate architecture, not a gap. Move rewards to authoritative endpoints instead.
- **Loot boxes / gacha.** Anti-reference in `PRODUCT.md`. Credits stay time-skip and convenience.
- **Real-money player trading.**

## 9) Open questions for the developer

1. **Barrows**: does `Cryptbound Champions` already deliver the rotating-set fantasy, or is there room for a dedicated Barrows-shaped minigame?
2. **Quest cape**: shipped, or a gap? (`src/utils/completion.js` tracks Max cape; quest completion capstone unverified.)
3. **Audio appetite**: full ambient beds per screen, or SFX-only? SFX-only halves 1.2 and keeps the bundle small.
4. **Leagues save model**: separate character slot vs. save partition — decides whether E1 is 2 weeks or 4.
5. **Rule builder ceiling**: how far do we let automation go before the grind stops feeling earned? This is a design line, not an engineering one, and it should be drawn before 3.1 starts.
