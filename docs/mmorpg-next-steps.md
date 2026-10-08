# PocketRPG MMORPG delivery order

The semantic pipeline covers all fourteen towns in one continuous overworld, with separate caves and boss instances. Beta visual approval covers authored composition and interface presentation. The first live acceptance gate remains Lumbright on a phone with two players and verified save/return to idle. Authored map coverage does not establish that live proof.

## 1. Prove the starter experience

Walk arrival → gathering → a fight → cooking → banking → leaving → returning in the actual client. Make the next useful action visible through named services, short objectives and readable feedback. Check each town’s supported bindings and explicit deferrals against its idle contract; begin live loop testing in Lumbright. The semantic compiler and rendered review establish authored content and composition; they do not exercise the live HUD, server simulation or persistence.

## 2. Gate release on mobile and recovery outcomes

Measure load time, frame-time percentiles, memory, network traffic and server tick time while moving through the populated world on representative phones. Exercise background/resume, connection loss, logout, reconnect, a crashed session, bank/craft transactions and return to idle. Test two real characters gathering and fighting together.

Check existing checkpoints, session locks, grant flushing and item provenance before changing them. Define the allowed recovery/loss window for a crashed simulation owner. Set device and population targets from measurements; do not publish capacity estimates from terrain size or a software-rendered screenshot.

## 3. Decide who owns MMO progression

**An architecture decision is required before expanding the economy.** The current [save endpoint](../functions/api/save.js) intentionally trusts client-computed idle XP, coins and ordinary drops. World combat being authoritative does not make imported idle wealth authoritative.

Choose either separate MMO characters/economy, or move progression in both modes to server-owned actions and durable grants/ledgers. If both modes share scarce items, the latter needs a shared progression contract, offline catch-up policy, migration and reconciliation plan. Do not try to repair this boundary with item-increase checks on the existing save blob: those break legitimate idle progression.

Resolve this before widening trade, auctions, competitive rankings or valuable public rewards. The existing server-authoritative trade endpoint alone cannot establish scarcity for client-created wealth.

## 4. Protect hubs and complete canonical activities

Add server-enforced civic protection and pursuit/leash rules before claiming banks, homes or travel hubs are safe. Validate animated actor envelopes across idle, attack, hit and death against scenery bounds and interaction approaches. Test lure attempts, narrow roads and return spawns. A wander rectangle is not a pursuit boundary.

The thirteen expanded regions explicitly defer 102 canonical bindings: 69 missing creature models, nine facility adapters, 18 processing adapters, five encounters requiring dedicated instances and one probabilistic resource adapter. Add the actual species and actions, preserving tools, inputs, yields, XP, depletion and ownership rules. A visual model alone does not implement an activity.

## 5. Give players reasons to meet

Build named NPCs, short local quests, parties/group objectives, transparent resource rules and one repeatable public encounter outside the boss rooms. Verify contribution, XP, loot ownership, leaving and reconnecting. Connect the starter loop to a useful next destination. Keep instances for authored caves, bosses and dungeons; continuous geography does not require every encounter to share one room.

## 6. Bound simulation work spatially

**The simulation needs restructuring before dense world population.** Current [AOI](../world/server/aoi.ts) scans every entity for each player. [WorldZone](../world/server/WorldZone.ts) initially welcomes players with the complete dynamic snapshot and still runs whole-zone NPC ticks.

Add a spatial index, nearby welcome snapshots, consistent relevance filtering for events, and activity tiers for unobserved NPCs. Preserve deterministic respawns and durable milestones when regions sleep. Stream and cull client content by region; introduce asset detail levels and explicit phone render budgets.

Separate authored geography from simulation ownership. Split ownership into multiple regional actors with durable character handoff when measured load requires it. A continuous map can cross those boundaries.

## 7. Choose infrastructure from the measured workload

Keep Three.js, TypeScript and PartyServer for the current beta and live acceptance testing. Compare optimized Cloudflare actors with a regional Node/Colyseus service if sustained simulation, crowded events, regional placement, tick drift or cost becomes limiting.

Consider PostgreSQL when the selected economy needs transactional ownership/trade guarantees that the current persistence design cannot provide. Consider a game-engine migration only if native distribution/editor tooling is a strategic requirement or measured client problems remain after bounded rendering. Neither a new MMO label nor the existing 600 ms combat cadence justifies a framework replacement by itself.

## 8. Refine all fourteen regions through one publication process

Refine the authored towns through the [semantic authoring workflow](../world/authoring/README.md), canonical idle contracts, measured asset bounds and integrated visual review. Each needs a distinct landmark, connected streets, useful supported activities, discovery and travel purpose. Record missing activities as deferrals. Validate protected hubs and hunting buffers before claiming safe towns.

Improve organic ground/river edges, building variety, local storytelling and named NPC identities before increasing entity density or promoting the beta. Record rejected candidates and their corrections. Extend publication gates to include live gameplay, phone performance and persistence evidence. D1 map overrides must go through the same approval process; a bundled artifact does not prove which map is live.

The July [map investigation](single-world-map-investigation.md) contains historical island/preview phases and capacity assumptions. Current [zone registration](../world/server/zones.ts) is the authority for what is served today. Update those older design documents as each migration replaces their assumptions.
