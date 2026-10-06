# PocketRPG MMORPG delivery order

The current runtime already exposes one overworld with instanced boss lairs. Keep that useful shape. The next milestone is a demonstrated Lumbright session on a phone that supports two players and survives save/return to the idle game. Expanding map area cannot substitute for that proof.

## 1. Prove the starter experience

Walk arrival → gathering → a fight → cooking → banking → leaving → returning in the actual client. Make the next useful action visible through named services, short objectives and readable feedback. Check every Lumbright binding against the idle contract. The semantic compiler and rendered review establish authored content and composition; they do not exercise the live HUD, server simulation or persistence.

## 2. Gate release on mobile and recovery outcomes

Measure load time, frame-time percentiles, memory, network traffic and server tick time while moving through the populated world on representative phones. Exercise background/resume, connection loss, logout, reconnect, a crashed session, bank/craft transactions and return to idle. Test two real characters gathering and fighting together.

Check existing checkpoints, session locks, grant flushing and item provenance before changing them. Define the allowed recovery/loss window for a crashed simulation owner. Set device and population targets from measurements; do not publish capacity estimates from terrain size or a software-rendered screenshot.

## 3. Decide who owns MMO progression

**An architecture decision is required before expanding the economy.** The current [save endpoint](../functions/api/save.js) intentionally trusts client-computed idle XP, coins and ordinary drops. World combat being authoritative does not make imported idle wealth authoritative.

Choose either separate MMO characters/economy, or move progression in both modes to server-owned actions and durable grants/ledgers. If both modes share scarce items, the latter needs a shared progression contract, offline catch-up policy, migration and reconciliation plan. Do not try to repair this boundary with item-increase checks on the existing save blob: those break legitimate idle progression.

Resolve this before widening trade, auctions, competitive rankings or valuable public rewards. The existing server-authoritative trade endpoint alone cannot establish scarcity for client-created wealth.

## 4. Give players reasons to meet

Build named NPCs, short local quests, parties/group objectives, transparent resource rules and one repeatable public encounter outside the boss rooms. Verify contribution, XP, loot ownership, leaving and reconnecting. Connect the starter loop to a useful next destination. Keep instances for authored caves, bosses and dungeons; continuous geography does not require every encounter to share one room.

## 5. Bound simulation work spatially

**The simulation needs restructuring before dense world population.** Current [AOI](../world/server/aoi.ts) scans every entity for each player. [WorldZone](../world/server/WorldZone.ts) initially welcomes players with the complete dynamic snapshot and still runs whole-zone NPC ticks.

Add a spatial index, nearby welcome snapshots, consistent relevance filtering for events, and activity tiers for unobserved NPCs. Preserve deterministic respawns and durable milestones when regions sleep. Stream and cull client content by region; introduce asset detail levels and explicit phone render budgets.

Separate authored geography from simulation ownership. Split ownership into multiple regional actors with durable character handoff when measured load requires it. A continuous map can cross those boundaries.

## 6. Choose infrastructure from the measured workload

Keep Three.js, TypeScript and PartyServer for the starter proof. Compare optimized Cloudflare actors with a regional Node/Colyseus service if sustained simulation, crowded events, regional placement, tick drift or cost becomes limiting.

Consider PostgreSQL when the selected economy needs transactional ownership/trade guarantees that the current persistence design cannot provide. Consider a game-engine migration only if native distribution/editor tooling is a strategic requirement or measured client problems remain after bounded rendering. Neither a new MMO label nor the existing 600 ms combat cadence justifies a framework replacement by itself.

## 7. Expand authored regions through one publication process

Author one connected neighbor at a time. Each needs a distinct landmark, safe hub, gathering/processing loop, threat, discovery and travel purpose. Use the [semantic authoring workflow](../world/authoring/README.md), canonical idle bindings, measured asset bounds, deterministic compilation and integrated visual review.

Improve organic ground/river edges, building variety, local storytelling and named NPC identities before mass-populating the main map. Record rejected candidates and their corrections. Extend publication gates to include live gameplay, phone performance and persistence evidence. D1 map overrides must go through the same approval process; a bundled artifact does not prove which map is live.

The July [map investigation](single-world-map-investigation.md) contains historical island/preview phases and capacity assumptions. Current [zone registration](../world/server/zones.ts) is the authority for what is served today. Update those older design documents as each migration replaces their assumptions.
