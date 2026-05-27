# Building PocketRPG: a tick-based RPG that runs on £0 a month

*27 May 2026*

I've been building an idle/simulation RPG called PocketRPG for a while now. It's a menu-driven fantasy game in the OSRS lineage — combat, skilling, gathering, raids, clues, minigames, the lot — that ticks along at 600ms whether you're staring at it or not. It runs in a browser, it's mobile-first but plays properly on desktop, and the entire production stack costs me nothing until it gets popular enough to start charging me, at which point I'll happily pay the bill.

This post is the long version of "how is it actually built". It's aimed at people who write software, so I'm not going to apologise for the SQL. I'll talk about the architecture, why the server owns the things that matter, how I've leaned on Cloudflare's free tiers without painting myself into a corner, the save model, PvP, the economy, and the bits that bit me along the way. I'm deliberately not posting anything that's a key or a secret, so where something is sensitive I'll describe the mechanism and leave the magic numbers out.

## The shape of the thing

The client is Preact. Not React — Preact. It's a few KB, it's fast, and for a UI that's basically "lists, grids, and a combat screen" I never once wished I had the full React runtime. State lives in a Preact context with hooks, the game logic lives in pure modules with no UI imports, and the two only meet at the screen layer.

That separation isn't decoration. The rule in the repo is hard: `src/engine/` is pure game logic and imports nothing from the UI. The combat formulas, the XP curve, the loot rolls — all of it is deterministic and testable in isolation. The tick is 600ms, every gameplay rounding uses `Math.floor`, and the same inputs always produce the same outputs. That determinism is what lets me write regression tests that actually mean something, and it's the same property that makes server-side PvP possible later (more on that further down).

Build-wise it's Vite for dev and the normal build, plus a TypeScript transpile step that feeds a custom concatenator. The production artifact is a **single `index.html`** — every module transpiled and stitched together into one file, Tailwind injected via CDN, ready to be served as a static asset. Offline-first means offline-first: one file, no module waterfall, no flash of nothing while a dozen chunks resolve over a flaky mobile connection.

The catch with concatenating everything into one scope is that every top-level declaration has to be globally unique, or you get a duplicate-identifier syntax error that takes the whole app down. So there's a `check:single` step that parses the output and fails the build if two modules both declared a top-level `formatGold` or whatever. It's caught me more than once. I'd rather the CI catch it than a player.

## Why everything lives on Cloudflare

The whole backend is Cloudflare Pages plus Pages Functions plus D1. That's it. No VPS, no container, no Redis, no separate API box.

- **Pages** serves the static app. Static bandwidth and requests are effectively unmetered on the free plan, which for a single-file SPA is exactly what you want.
- **Pages Functions** are the API. Every endpoint under `/api/*` is a function. On the free plan you get a daily request budget (100k/day at time of writing), which sounds tight until you realise an idle game shouldn't be chatting to the server constantly — and mine doesn't.
- **D1** is the database. It's SQLite at the edge. The free tier gives you a few GB of storage and a daily allowance of rows read and rows written. Note that: it bills you on *rows*, not on time or connections.

That last point quietly shaped the entire data design, and I'll come back to it. The headline is that I can run a real game — auth, cloud saves, a leaderboard, a player economy, PvP — for £0/month, and the architecture doesn't have to change when I outgrow the free tier. It's the same Pages, the same Functions, the same D1; I just start paying for the volume. There's no "rewrite it for scale" cliff edge, because the design already respects the constraints that scale would impose anyway.

Deploys are git-driven. Push to the branch, Cloudflare builds and ships it. There's a preview environment bound to its own D1 database (`pocketrpg-preview`) and a production one, so I can break things on preview against real-ish data without touching anyone's account. The `wrangler.toml` wires the bindings; secrets (JWT signing key, OAuth client secrets, Stripe keys) live in the Pages dashboard, never in the repo.

## The conscious decision: the client is a liar

Here's the thing that drives most of the interesting design. **I treat the browser as hostile.** Not because my players are villains — most aren't — but because anything that lives in client memory can be edited, and a game economy with an editable client has no economy at all.

So the model is: the client is allowed to *compute and display* progression, but it is not allowed to *commit* anything that matters. XP ticking up while you grind, coins from a common drop, your HP bar — fine, the client does that locally and it feels instant. But the moment something economically meaningful happens — a boss unique, a raid drop, a clue reward, a credit purchase, a PvP loot transfer — the server is the only thing allowed to write it, and the server validates it from first principles.

This sounds obvious written down. In practice it's a constant discipline, because the lazy path is always "just trust the save blob the client sends up". I went through a hardening pass specifically to close that gap, and the result is a clean split:

- `PUT /api/save` is a **sync channel for non-economy state**. UI settings, current theme, which task you're on, your HP. When a save comes in, the server doesn't blindly store it — it diffs the incoming blob against the server's own copy and rejects any increase in protected items (boss/raid/clue uniques) that didn't come through a legitimate path. Items that legitimately drop from monsters and clues client-side are on an allowlist and pass; anything else trying to materialise in your bank gets dropped on the floor.
- Anything that grants a protected reward goes through a dedicated **action-completion endpoint** — `/api/actions/monster/complete`, `/api/actions/raid/complete`, `/api/actions/clue/complete`, and friends. These are the *only* authoritative grant paths. They validate every reward item against the canonical drop table for that source. Ask for a raid unique from a monster that doesn't drop it and you get a 403, not a shiny new item.

The mental model I settled on is three zones in the save: server-owned (XP, bank, inventory, equipment, slayer points — never accepted from the client), client-owned (UI fiddle, current action, theme), and replicated-but-revalidated (your levels, which must match what the server recomputes from the XP it's holding). The client can say whatever it likes about its combat level; the server recomputes it and ignores the claim.

## Save heavy, but row-cheap

An idle game has to save constantly. You can close the tab at any second and you expect to come back to exactly where you were. So the client saves on a tight cadence and on every meaningful event — a kill, a clue completion, a minigame finish, a level up — plus a heartbeat every 30 seconds while an active task is running.

"Save constantly" against a database that bills you per row written is a problem if you're naive about it. The way I keep it cheap is that a save is **one row**. Each character has exactly one row in `saves`, and a save write is one `UPDATE`. I'm not writing a row per inventory slot or per skill; the whole game state is a single JSON document, gzipped into a blob column. Compression knocks a typical save down by a big chunk, and there's a hard ceiling so a corrupted or bloated blob can't try to store a novel.

The integrity story is optimistic concurrency on a `save_revision` counter. Every save carries the revision it thinks it's editing; the write is a compare-and-swap:

```sql
UPDATE saves
   SET save_blob = ?, save_data = ?, updated_at = ?, save_revision = save_revision + 1
 WHERE character_id = ? AND save_revision = ?
```

If `meta.changes` comes back zero, somebody else moved the world on (another tab, another device) and this write is stale. The server returns a 409 with the current revision, the client pulls fresh and retries. There's no auto-merge and no grace window, and that's deliberate — last-write-wins on a game state is how you let a stale background tab quietly stomp the raid drop you earned thirty seconds ago in the foreground. I'd rather fail loud and re-pull.

There's one more trick worth mentioning. Some state is **monotonic** and must never go backwards — boss kill counts, your collection log, the nonces that stop an action being replayed. If those lived in the save blob, a last-write-wins moment (or a backup restore) could silently reset your kill count from 500 to 10. So I pulled them out of the blob into their own tables:

- `kill_counts` — incremented with `kill_count = kill_count + 1` server-side. It only ever goes up.
- `collection_log` — append-only, composite primary key `(character_id, item_id, source_type, source_id)` so a replay is an idempotent no-op instead of a duplicate.
- `action_nonces` — every protected action carries a single-use nonce; the server `INSERT … ON CONFLICT DO NOTHING`s it *before* doing anything else. If the row already existed, it's a replay and the action is refused. Because the nonce lives in its own table, it stays consumed even if the save blob is rolled back. Replay defence that depends on the thing you're defending being trustworthy isn't defence.

There's also a separate `character_idle_state` table that is the authoritative answer to "when were you last active and what were you doing", and the server stamps it with *its own* clock. Trusting the client's clock for offline progression is an invitation to set your system time forward a week and come back rich.

Finally, a small thing I'm quietly pleased with: hot reads don't parse the blob. The leaderboard and the PvP combat-level band need `total_level` and `combat_level` for thousands of characters. Rather than `LEFT JOIN saves` and `JSON.parse` a blob in a Worker for every row, those two values are denormalised onto the `characters` table and kept current on save. The leaderboard is then a plain indexed `SELECT`. That's the row-cost discipline showing up again — cheap reads, no parsing, no joins on the hot path.

## The table layout

The schema grew through nineteen migrations, but it's small and boring, which is the goal. The spine:

- `oauth_identities` — one row per Google/GitHub login. This is the "account".
- `characters` — one identity owns many characters. Unique, case-insensitive usernames. Carries the denormalised `total_level`/`combat_level`, the ironman/one-life flags, credit balance, and `active_match_id` (the PvP lock — more shortly).
- `saves` — 1:1 with characters. Gzipped blob, revision counter, server timestamp.
- `character_idle_state` — authoritative last-active and current task.
- `collection_log`, `kill_counts`, `action_nonces` — the monotonic/dedup tables described above.
- `audit_events` — a durable log of every high-value mutation: credit grants and spends, protected reward claims, PvP settlements, trading-post movements. Cloudflare's `console.log` is ephemeral and unsearchable, which is useless when a player opens a "where did my drop go" ticket. Audit events are an actual table I can query.
- `stripe_events` + `purchase_grants` — payment idempotency and a per-transaction ledger, so a Stripe webhook retry can't double-grant and support can answer "did this person get what they paid for" without log-diving.
- `trading_post_offers` — the entire player economy, one table.
- `pvp_waiting_room`, `pvp_matches`, `pvp_invitations`, `pvp_intents` — PvP.

Everything is indexed for the access pattern it actually has, and the partial indexes do a lot of quiet work — e.g. "one active match per character" is enforced by a `UNIQUE` index `WHERE status = 'active'`, so a second active match for either side fails on the constraint rather than on application logic I have to remember to write.

## Auth: OAuth in, stateless JWT out

I didn't want to be in the password business. There's no password storage, no reset-email flow, no "we leaked your bcrypt hashes" headline waiting to happen. You sign in with Google or GitHub and that's the whole menu.

The flow is textbook three-leg OAuth, hand-rolled on Workers with no SDK. Hitting `/api/auth/google` (or `/github`) generates a random state nonce, drops it in a short-lived `oauth_state` cookie (`HttpOnly; Secure; SameSite=Lax`, ten-minute life), and redirects you to the provider. The redirect URI is built from the incoming request's host rather than hardcoded, so the same code works on preview and prod without config. On the callback the state cookie is checked against the query param, the code is exchanged for an access token using the provider client secret, and the provider's stable user ID (`sub` on Google, `id` on GitHub) becomes the identity key.

Sessions are stateless JWTs, signed HS256 via the Web Crypto API — no JWT library, just `crypto.subtle`. The token carries the identity row ID, the provider, and a display name, with a 30-day expiry. Stateless was a conscious call: it means a protected request is verified with a signature check and zero database round-trips, which keeps the per-request row cost at nothing and scales sideways for free. `requireAuth` pulls the bearer token, verifies the signature and expiry, and hands the rest of the endpoint a known identity. Characters hang off that identity by `owner_id`.

I'll be honest about the trade-off, because that's more useful than pretending there isn't one: a stateless 30-day JWT held client-side is lovely for scaling and slightly awkward for revocation. Moving it to an `HttpOnly` cookie and adding a token-version check for instant revocation is on the list. It's a real item, not a finished one, and I'd rather say so than imply the security model is finished when it's merely deliberate.

## PvP, and why the tick matters so much

PvP is the part where the determinism investment pays off, and also the part where I had to be most honest with myself about what's actually achievable on free infrastructure.

The core principle: **the engine is server-authoritative and shared.** There's a single pure-logic module, `pvpEngine.js`, that runs both in the client (to render a responsive view) and inside the Pages Function (as the source of truth). Clients don't send "I hit you for 14". They send **intents** tagged with a tick number — "eat the food in slot 3", "queue a special", "switch to my second weapon" — and the server applies them and produces the next authoritative state. The client is a thin renderer over state it doesn't own.

Because the engine is deterministic, the server can resolve a tick with no ambiguity. Within a tick, intents apply in a fixed order (`tick_number`, then `character_id`, then a per-character sequence number), then timers tick, then *both* attacks resolve simultaneously off the snapshot taken at the start of resolution — neither player gets to "see" the other's hit before their own lands. If you both die on the same tick, the lower character ID wins. None of that is a coin flip; it's the same every time, which is exactly what you need when two clients and a server all have to agree on what happened.

The 600ms tick is the heartbeat of the whole game, and in PvP it becomes the unit of fairness. Everything — attack speed, freeze duration, stun length, special-attack energy regen — is measured in ticks, not wall-clock milliseconds, so latency doesn't change the outcome, only when you see it. That's the difference between a combat system and a reaction-time contest on whoever has the better wifi.

Concurrency on the match is, again, optimistic. Both clients poll and try to advance the tick; the advancing `UPDATE` carries `WHERE current_tick = ?`. Whoever lands first wins the tick, the other gets `changes === 0`, re-reads, and carries on. No locks, no leader election, no extra infrastructure — just the database arbitrating, which is the one component both clients already share.

The lock that keeps PvP honest against the rest of the game is `characters.active_match_id`. While it's set, `/api/save`, `/api/idle`, and `/api/purchase` all refuse to write that character. Your inventory during a match lives inside the match's state and is written back atomically when it ends. That's how loot transfer can be trustworthy: the loser's tradeable items move to the winner's bank in the same atomic batch that ends the match, with coins special-cased to transfer even though they're flagged untradeable everywhere else, and a forfeit routed through the exact same path as a death.

Now the honesty. **Version one is HTTP polling**, roughly every 600ms, and on a mobile connection that means the state you're looking at is 600–1500ms stale. It's "near-real-time", not real-time, and I'm not going to pretend a poll loop feels like a fighting game. The reason it's polling is that it costs nothing and it's correct, and correct-but-slightly-laggy beats real-time-but-exploitable every day. The upgrade path is already designed: move the match loop into a Durable Object behind a WebSocket. Same engine, same schema, same UI — I swap the transport and nothing else. I built it so that the slow, free version and the fast, paid version are the same game, because rewriting combat twice is a mug's game.

## The economy is small on purpose

The single most important economic decision in PocketRPG is that **there is almost no player-to-player economy**, and that's by design.

Think about why MMO economies inflate: the world spawns infinite common goods, players auto-sell them to each other, and the gold supply balloons. So I just didn't build that. The trading post — one table, `trading_post_offers` — only accepts three categories of item onto its order book: **boss uniques, raid uniques, and clue rewards.** The genuinely rare stuff. Everything else falls into one of two buckets: common items with a shop value get **instant-sold to the game** at a fixed price (a sink the world absorbs, no player on the other side), and everything beyond that is flat-out untradeable.

It's a single gate function that decides this — untradeable items are rejected outright, order-book items (the uniques) are allowed onto the book, and anything else with a shop value goes to the instant-sell path. The same check guards both listing and search, server-side, so a client can't talk an item onto the market it has no business listing.

The order book itself is a proper escrow system. Listing an offer debits your coins or items *first*, writes them into escrow on your save, and only then inserts the offer and runs matching against the opposing side — cheapest sells first for a buyer, best bids first for a seller, with price improvement refunded inline. If the matching pass falls over after escrow, there's a compensating refund so you're never debited for an offer that didn't take. Partial fills accumulate into `coins_pending`/`items_pending` and you collect them later. Concurrent fills against the same resting offer are handled with conditional, relative `UPDATE`s — `quantity_remaining = quantity_remaining - ? WHERE quantity_remaining >= ?` — so if two buyers race for the last unit, the second one's write affects zero rows, raises an "offer changed" signal, and the matcher simply moves to the next offer. No double-spend, no lock.

There's even a deliberate gold sink baked into the exits: you can "instant-sell" an existing listing, which detaches it from you, leaves it resting in the book at its original price for someone else to buy, and pays you out at 80%. The missing 20% just evaporates. Sinks like that are the only thing standing between a game economy and runaway inflation, and a small, unique-only economy gives me very few places where inflation can even start.

Ironman accounts, naturally, can't touch any of it — the whole point of an ironman is self-sufficiency, and the server enforces that rather than relying on the client to hide a button.

## Responsive: desktop is the good view, mobile is the compact one

PocketRPG started life mobile-first and for a long time it stretched horribly on a desktop — full-width nav tabs marooned across a 1440px viewport, single-column everything, no hover affordances. The responsive work fixed that with a rule I stuck to rigidly: **additive only, mobile DOM untouched.**

Every desktop change is a Tailwind breakpoint prefix or a `hidden md:block` / `md:hidden` toggle. Nothing about the mobile layout changes byte-for-byte; desktop is layered on top at `md:` (768px), which is the single activation point where the bottom tab bar becomes a side navigation rail, single columns become master/detail, and the grids fan out. Inventory goes from 4 columns on a phone to 10 on a wide screen; the bank goes to 12; active combat splits into a three-pane layout — monster on the left, log and actions in the middle, inventory/prayers/spells on the right — so on a desktop you can actually see the fight instead of scrolling through it.

The framing I kept reminding myself of is that I'm *not* centring a phone frame on a big monitor. Desktop should feel like a real desktop game: side nav, multi-column, hover and keyboard support, Esc-to-close on modals. Mobile stays the compact, thumb-friendly, 44px-tap-target experience it always was. Same components, same logic, different amount of room. Because it's all CSS and conditional layout rather than forked screens, there are no new logic tests for any of it — the engine doesn't know or care how wide your screen is.

A couple of things bit me here and are worth flagging if you do the same: when a scrolling combat log becomes a grid child, you need `min-h-0` on the container or the auto-scroll silently dies; and hover styles need wrapping in `@media (hover: hover)` or they get "stuck" on touch devices after a tap. Neither is hard, both are invisible until a real device shows you.

## CI/CD, and keeping it boring

The pipeline is intentionally dull. GitHub Actions runs on every push and PR: install, then `npm run ci`, which is the full build, the single-file rebuild, and the `check:single` duplicate-identifier guard. The logic regression tests (Vitest, logic-only, deterministic) gate the build via a `prebuild` hook, so you can't even produce a build with red tests. Deployment is Cloudflare Pages watching the repo — preview branch to the preview environment and its own database, main to production. There's no Jenkins box, no deploy script I have to babysit, no staging server humming away costing money.

The commit gate I hold myself to is the same one the CI runs, so "works on my machine" and "passes CI" are the same statement. For a generated single-file artifact with global-scope constraints, that duplicate-identifier check has earned its keep more than any glamorous test ever has.

## What I'd tell someone starting this

A few things crystallised while building this that I'd hand to anyone doing something similar:

**Pick the constraint that the free tier imposes and design to it from day one.** For me it was "D1 bills per row", and once I internalised that, the one-row save, the denormalised leaderboard columns, and the stateless JWT all fell out naturally. The free tier didn't limit the design; it improved it.

**Decide what the server owns before you write a line of it.** Retrofitting authority onto a system that trusted the client is genuinely painful — I know because I did some of it. The split between "client computes for feel" and "server commits for truth" is the whole game.

**Make the slow, free version and the fast, paid version the same code.** PvP polling now, Durable Objects later, one engine throughout. The day I need to scale is the day I change a transport and a billing plan, not the day I rewrite the game.

**Be deterministic.** It's the foundation everything else stands on — the tests, the PvP fairness, the ability to reason about a tick at all.

PocketRPG is still very much a work in progress, and there are real items still open — the JWT-to-cookie move, the WebSocket PvP upgrade, more economy sinks as the player base grows. But the bones are good, it costs me nothing to run, and when it does start costing me something, that'll be because enough people are playing to make the bill a nice problem to have.

If you want to come and break it, the game's live. Bring an editor and have a go at the client — the server's expecting you.
