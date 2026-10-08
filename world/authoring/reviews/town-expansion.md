# Town expansion visual review — 8 October 2026

This iteration approves fourteen authored districts for the existing draft PR preview. It does not approve a production MMORPG or establish seamless mobile movement. The scope is a connected overworld with readable town approaches, existing supported gameplay bindings, named instance entrances and an agent authoring/review pipeline.

## Authoring and release contract

Regional sources, placements, prefabs and asset policy compile into generated zones and a 348 × 213 overworld. Contracts derive gathering, combat and facility identities from the idle game. Supported bindings retain their canonical identities; unsupported activities are explicitly deferred instead of receiving invented rewards or substitute monsters. Compilation checks routes, footprints, placement bounds and density budgets. Integration replaces owned authored prefixes; it does not silently open blocked terrain or discard out-of-bounds content.

The pipeline is: author regional intent → compile and check semantic contracts → capture desktop, portrait and integrated-world views in Cloudflare → inspect native images → fix rejected work → capture the final source again → record current-hash receipts → run freshness, release, root CI and world checks → deploy the PR preview. A build passing does not establish visual quality. Source fingerprints enumerate scene/icon/entry dependencies explicitly; this is not a complete automatically discovered transitive dependency graph.

The initial generic quadrant composition was rejected. The final sources add residential lanes, cottage enclosures, workyards, local resource approaches, carts, wells, smoke, fortifications and biome palettes. Lumbright remains the reference district. Other districts have their own sources and semantic contracts, though they still share many assets.

## Final native evidence

All 360 final PNG records have matching inspection digests: 329 regional views, 22 Lumbright entrance/travel/entry views and nine creature states. The primary agent inspected 217 current native images; 143 images reuse exact full-PNG SHA-256 matches to recorded prior personal native inspections. Images above the transport cap were viewed as both unscaled 640 × 800 halves. Reuse provenance, capture commits, builds, full digests and per-view criticism are in [town-capture-comparison.json](town-capture-comparison.json).

The five capture batches share source tree `b2f3e866e82221b0bc1e791ea85534ccb4d372ba`. Their commits differ only in temporary capture selection; final delivery restores the unforced review runner. Capture galleries still display the pending status that existed before personal inspection. The versioned regional receipts are the subsequent, narrowly scoped beta approvals.

| Region | Props | Deferred bindings | Required regional views | Evidence |
| --- | ---: | ---: | ---: | --- |
| lumbright | 266 | 0 | 49 | [Native captures](https://37b5df1b-pocketrpg-world-review.rlh.workers.dev/79b148b0de3cfc36320f586a99138f8cf01f4c56/) |
| varrick | 84 | 11 | 22 | [Native captures](https://37b5df1b-pocketrpg-world-review.rlh.workers.dev/79b148b0de3cfc36320f586a99138f8cf01f4c56/) |
| faloden | 83 | 12 | 28 | [Native captures](https://37b5df1b-pocketrpg-world-review.rlh.workers.dev/79b148b0de3cfc36320f586a99138f8cf01f4c56/) |
| ardounne | 80 | 13 | 25 | [Native captures](https://28cf7eeb-pocketrpg-world-review.rlh.workers.dev/2b62de569bb88d19ee9e0686dda18b61e287fade/) |
| draynar | 62 | 4 | 22 | [Native captures](https://28cf7eeb-pocketrpg-world-review.rlh.workers.dev/2b62de569bb88d19ee9e0686dda18b61e287fade/) |
| alkarid | 65 | 6 | 25 | [Native captures](https://28cf7eeb-pocketrpg-world-review.rlh.workers.dev/2b62de569bb88d19ee9e0686dda18b61e287fade/) |
| edgevale | 68 | 7 | 19 | [Native captures](https://6f0a6a05-pocketrpg-world-review.rlh.workers.dev/47e4a8084d5b076fceb47fafbe7b7e79c3e72eb4/) |
| barlock | 35 | 4 | 25 | [Native captures](https://6f0a6a05-pocketrpg-world-review.rlh.workers.dev/47e4a8084d5b076fceb47fafbe7b7e79c3e72eb4/) |
| catherra | 67 | 7 | 19 | [Native captures](https://6f0a6a05-pocketrpg-world-review.rlh.workers.dev/47e4a8084d5b076fceb47fafbe7b7e79c3e72eb4/) |
| seerhold | 68 | 12 | 16 | [Native captures](https://29bd75f9-pocketrpg-world-review.rlh.workers.dev/1840c3b0d74df11b2473d736488a1e2908696a7f/) |
| brimhollow | 61 | 6 | 19 | [Native captures](https://29bd75f9-pocketrpg-world-review.rlh.workers.dev/1840c3b0d74df11b2473d736488a1e2908696a7f/) |
| canifel | 65 | 7 | 13 | [Native captures](https://29bd75f9-pocketrpg-world-review.rlh.workers.dev/1840c3b0d74df11b2473d736488a1e2908696a7f/) |
| camlann | 74 | 8 | 19 | [Native captures](https://1ca35ee2-pocketrpg-world-review.rlh.workers.dev/d0ec4bf37d7164975d15f02b71bed862e34395d9/) |
| portsarin | 69 | 5 | 28 | [Native captures](https://1ca35ee2-pocketrpg-world-review.rlh.workers.dev/d0ec4bf37d7164975d15f02b71bed862e34395d9/) |

Regional sources total 1,147 props. The thirteen added towns have 100-prop or 150-prop caps, at most 18 props per 8 × 8 block, and two or four ambient walkers. Lumbright has its separate 320-prop cap. These are authoring budgets, not measured frame-time guarantees.

## Rejections and corrections

- Faloden's fortification wall and towers now align; its trees no longer intrude on the protected review approach.
- Ardounne's wine access and sign placement, Draynar's direction sign and grove, and marsh ground painting were corrected.
- The Draynar cave approach previously hid the hero's legs under foreground pines. Its corridor is now open. A ten-tree revision exceeded its density allowance; the final south grove uses eight trees and passes compilation.
- The cave goblin no longer substitutes a floating Goleling. It has a hunched green biped silhouette, ears, snout, leather equipment and a blade, with idle/attack/hit/death/walk evidence. Alternating limb locomotion is enabled only for eligible two-legged procedural creatures; the weapon is presentation, not a combat rule change.
- Ordinary green/red/black dragon presentation was reduced while retaining existing gameplay footprints. Bounds tests cover static orientations; they do not establish the animated extent during pursuit.
- Seerhold and Port Sarin bank approaches moved away from nearby dragon spawn/wander bounds; Port Sarin's cart shifted to clear its approach. This proves static separation only.
- Nearby named entrances take priority in location guidance. Caves, pasture and boss lairs retain separate instances with visible named access and outside return positions.
- Entry review staging follows the root build, waits for font readiness, and includes ready/saving/error presentation. Spawn fallback checks reject invalid positions and avoid mutating shared spawn data.

## Canonical parity limits

The thirteen additional regions account for 53 resource bindings (34 active, 19 deferred), 83 combat bindings (nine active, including four physical instance-access bindings, and 74 deferred), and 31 facilities (22 active, nine deferred). There are 102 exact regional deferrals:

| Reason | Count |
| --- | ---: |
| Missing creature presentation | 69 |
| Processing adapter | 18 |
| Facility adapter | 9 |
| Dedicated instance required | 5 |
| Probabilistic resource adapter | 1 |

These counts describe regional gathering/combat/facility coverage, not all MMO gaps. Quests, agility, raids, portable activities, equipment and charged-tool behavior also need deliberate treatment. Unsupported altar, sawmill, plank-processing, nest/seaweed/gem behavior remains available through the idle game rather than acquiring fake world interactions. Existing legacy wilderness boss placements remain until their dedicated instance work is completed.

## Critical beta limitations

The world is substantially more readable, but is below the requested high-quality MMORPG bar. Broad uniform paving, sparse grass/sand, rectangular terrain transitions, stepped river/coast edges and repeated cottages still dominate some views. Direction boards are oversized. Decorative ranger walkers add movement but do not provide dialogue, quests, jobs or social gameplay. Cottage/castle exteriors do not establish usable interiors.

Specific remaining camera/presentation issues are recorded per image: Lumbright's west-gate direction board hides part of the hero; Ardounne's foreground wine-area roof hides the lower body; some pine tips/flora touch avatar outlines; Edgevale and Canifel arrival walkers overlap the avatar at a sampled pose. Port Sarin's stove flame appears immediately behind the hero's head. Water appears over the middle/continuation of plank crossings in waterfront views; bridge height/water masking needs polish. These are beta limitations, not silently passed production quality.

Enemy wander rectangles do not constrain pursuit. Static off-road placement, relocated banks and smaller dragons do not establish protected town space. Lure behavior, full animated bounds and civic protection need server rules and regression coverage.

The capture fixes simulation sampling, but asset-load scene ordering and a few rig timers/phases still permit nondeterminism. Follow-up work should seed by stable actor identity, stabilize asset/scene ordering and record browser/renderer provenance. Exact PNG reuse here is based on actual matching bytes, not an assumption of deterministic rendering.

No live phone FPS, movement/network latency or loading measurements were obtained. Two-player gathering/combat/banking, reconnect/background recovery and signed-in save/return-to-idle remain unverified. Auth-free staged entry screens prove legibility, not a successful authenticated handoff.

## Next production gates, in order

1. Protect civic areas on the server and implement pursuit leashes with full animated creature extents. Add lure/return and bank-access regressions before claiming safe towns.
2. Complete canonical creature presentations and real facility, processing and probabilistic-resource adapters. Verify actual inputs, yields, XP, equipment and charged tools against idle identities.
3. Establish one progression clock and explicit offline policy across idle/world play. Add atomic session ownership, idempotent durable grants and crash recovery. Respect the existing client-trusted idle save boundary; do not add save-item-increase policing.
4. Measure real phone frame times, movement latency, load times and growing player populations. Then refine spatial indexes, relevant welcome/event payloads and dormant simulation tiers. Partition regional actors only when measurements justify it, with durable ownership/handoff designed first.
5. Replace repetitive block composition with organic shores, layered terrain, distinct town architecture, named interactive NPCs, local objectives and purposeful inter-town journeys; re-run native inspection on every changed fingerprint.
6. Exercise the end-to-end two-player loop and signed-in save/return/background/reconnect on supported phones, then widen access in measured stages.

The current Preact/Three.js/Cloudflare stack can support this beta. There is no evidence requiring a framework replacement now; server authority, content adapters, authoring quality and measured simulation/load budgets are the immediate architecture and workflow work.

This delivery changes repository source and preview artifacts only. It does not merge the PR, deploy production or write gameplay database overrides.
