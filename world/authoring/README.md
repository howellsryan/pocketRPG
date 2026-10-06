# Semantic world authoring

Lumbright is the first complete region source. Its resources, creatures and facilities are bindings to the idle game. This pipeline compiles those bindings with paths, reusable building fronts, fields, scenery, collision and ambient life into the existing Three/PartyServer world.

## Cloudflare review

Routine semantic review runs in **Cloudflare Workers Builds** on the separate `pocketrpg-world-review` service. It has no gameplay API, D1 or Durable Objects. Its static evidence page can have an immutable version URL; the game preview cannot because it hosts Durable Objects.

Build command: `npm run world:review:cloudflare`. Deploy command: `npx wrangler deploy --config wrangler.review.jsonc`. The trigger watches semantic inputs and review infrastructure on `world/*` and `main`. Author world changes on a `world/` branch. Dependency caching is enabled. The first setup is on `world/semantic-lumbright`; these commands become available to other branches when the implementation reaches their base.

The build bootstraps pinned skills, runs the evidence-validator tests, installs the world dependencies, runs `npm run ci` and `npm run world:check`, checks generated-file freshness, and captures the four rat states and all 49 world views. Cloudflare's Ubuntu 24.04 image is not root: Chromium libraries are downloaded with isolated writable apt state/cache and extracted inside the build directory, without installing host packages. Both pinned Playwright browser revisions are retained. The rendering/capture implementation and source fingerprint are unchanged.

The published gallery includes full PNGs, JPEG previews, contact sheets, the capture manifest, source commit/hash, semantic audit, review receipt and generated maps. The build records Cloudflare's commit SHA through the existing capture metadata and suppresses base64 image log chunks. Prior capture directories are cleared. Missing views, wrong viewport sizes, source/commit mismatches and missing rat states fail publication.

An evidence build may publish a candidate with **visual approval pending**. Inspect every full-size required view, criticize it and update the versioned receipt only after review. Capture success does not self-approve. `build:site` runs `author:release` before staging assets, so the game deployment rejects missing or stale visual approval. This receipt only proves the scope stated in it; it cannot certify a production MMORPG.

Open the gallery's exact commit path and confirm its manifest. Keep its immutable Cloudflare version URL in the next review receipt. The service's root shows the latest build; another deployment can replace that root. Preserve selected review images in source control and download complete evidence when long-term retention is required.

`.github/workflows/semantic-world-review.yml` is a manual fallback (`workflow_dispatch`), so semantic edits no longer start the expensive GitHub capture job. Deliberately dispatching the fallback still uses GitHub minutes. Other existing GitHub jobs are separate from this migration.

Cloudflare has its own allowance: Workers Builds currently includes 3,000 monthly minutes on Free or 6,000 on Paid, with Paid overage at $0.005/minute and a 20-minute build timeout. See [Cloudflare limits and pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/). This moves review execution off GitHub; it does not make compute unlimited.

## Run the pipeline locally

From the repository root, install both dependency sets. Node 22.18 or newer is required for asset-registry type stripping.

```sh
npm ci
npm --prefix world ci
npm --prefix world run author:contract -- lumbright
npm --prefix world run author:build
npm --prefix world run author:check
npm run ci
npm run world:check
npx playwright install --with-deps chromium
npm --prefix world exec -- playwright install chromium
node scripts/render-proc.mjs dustpaw_rat --out world/preview-shots/creatures
npm --prefix world run author:review
```

The root and world packages currently pin different Playwright versions, so both browser revisions are installed. Cloudflare performs the same checks and publishes the screenshots and audit as a browsable gallery. The manual GitHub fallback preserves an artifact.

Use `author:build -- <region_id>` for another source. The overworld integration currently stamps Lumbright; a second region needs an explicit approved integration location rather than silently overwriting another town.

## Sources and outputs

| Source | Responsibility |
| --- | --- |
| `regions/lumbright.json` | Design intent, named places, orthogonal route graph, lots, encounter pockets, spatial bindings, density and review views |
| `prefabs.json` | Complete reusable sets: scenery, collision rectangles, ground, semantic points/resources/encounters, exits and ambient life |
| `asset-policy.json` | Curated shipped assets and whether each is solid; the compiler measures their actual GLB bounds |
| Idle `worldActivities/world/skills/monsters` data and `GATHER_TASKS` | Location membership, action identities and owning mechanics |
| Idle `items.json` | Item identity and stackability |

Generated `zones/lumbright.json`, `zones/overworld.json`, `assets.generated.json` and `reports/lumbright.json` are committed for normal runtime/build use. Edit the semantic sources and regenerate. `author:check` catches stale outputs. The legacy `gen-lumbright.mjs` now delegates to this pipeline and cannot restore the obsolete map.

The contract explicitly lists deferred spatial activities and portable idle actions. New, unclassified activity families fail until an adapter policy is chosen. Gathering/combat/facility parity is scoped explicitly; it does not certify every idle activity as playable outdoors.

The audit includes canonical membership, footprint boxes, named points, canonical road connections, review cameras, counts and explicit budgets. `visualApproval: pending` is intentional: numerical validity cannot certify composition.

## Agent authoring order

1. Read the canonical contract and the location's lore. Write a short design intent and a newcomer loop. Do not add resources because another game puts them in its starter town.
2. Place a visible dominant landmark and named hubs/approaches. Reserve safe routes and open interaction approaches before building lots. Width-three roads and width-one optional trails are supported; diagonal connections need orthogonal waypoints.
3. Declare boundary gateway connections to every canonical travel neighbor. The compiler requires reserved, walkable roads at the gateway and boundary. Overworld integration protects the region's paint and validates a continuous road to each destination. Place complete prefabs. `turns` rotates all local layers in quarter turns and namespaces instance identities. Per-model `rot`/scale control the actual mesh. Native fronts are verified in renders, not guessed from bounding boxes.
4. Bind resources with `skill:<skill>:<action>`, `gather:<task>` or `facility:<facility>`. Bind encounters with `combat:<monster>`. Multiplicity is authored; identity and membership come from owning data.
5. Dress purposeful pockets: ordered crop rows, work yards, framed paths, shore detail and clustered woodland. Use seeded groves for edges and ground cover, never a uniform map-wide prop lottery.
6. Add ambient villagers in entirely walkable rectangles. The current cheap ambient walker interpolates straight lines; a rectangle with an obstacle is rejected to prevent villagers crossing walls.
7. Compile, inspect every review view at full resolution, fix the source and repeat. Inspect the integrated overworld too: a standalone scene does not establish the final terrain/paint composition.

The compiler refuses missing/extra content, unknown assets, species without a GLB/procedural identity, blocked or unreachable points and approaches, any blocked tile in a combat wander rectangle, roads passing through meshes, unfit groves, and exceeded global/local budgets. Thin, rotated, edge-anchored fences occupy the tiles their asymmetric mesh actually touches.

Supported runtime resources are product-producing mining/woodcutting/fishing actions and repeatable gathering tasks without inputs or payment. Unsupported canonical bindings fail explicitly. Other spatial systems (Slayer masters, quests, agility, hunter, dungeon entrances, shrines, sawmills and processing gather tasks) need dedicated adapters; portable idle crafting is not fabricated as an outdoor node.

## Lumbright contract

The generated report is authoritative. At the time of this source it binds clay, copper, rune essence, shrimps and bowstring fieldwork; a bank and cooking range; Arcane Adept, Bogling Sprite, Cave Goblin, Dustpaw Rat, Field Chicken, Pasture Bull and Stoneback Crab. Decorative woodland yields no logs. There is no invented tin node or smithy.

The beginner loop is square/bank → fields → shrimp bank → kitchen → bank. Copper/clay and ruins have optional trails. The bull paddock has a real opening; no required route intersects combat wander areas. The map remains 64×64 so its existing inline stamp stays clear of neighboring towns.

The server resolves new `fishing_spot` and `gather_site` objects, validates adjacency and verb, and mints canonical products through existing session provenance. Shrimp tool timing uses the shared idle helper. Bowstring fieldwork grants no XP and follows item-owned stackability. Mining/tree depletion is preserved; fishing and fieldwork have no invented depletion wait. Charged-tool perks are excluded until charge consumption and settlement are implemented. The world does not yet reproduce all idle equipment XP/yield bonuses.

## Visual release gate

`author:review` captures every authored close view at desktop 1280×800, portrait 390×844, and the translated overworld location, plus an overview. Every bound resource, monster and facility must have explicit close-view coverage; an overview-only camera set fails compilation. It waits for all props, statics, scatter, ambient, creature and hero loads, uses the real gameplay camera/shadows, and fails on missing assets or browser errors. The command checks generated-file freshness and builds the current client before capture. Snapshots settle animations at a fixed ambient time and render one frame; the interactive preview retains its animation loop. Integrated gameplay views use the server's settled AOI rule. The preview deliberately has no server simulation or gameplay HUD.

Look at composition, recognizable silhouettes, entrances/fronts, collision against visible shapes, floats/intersections, road continuity, repeated blocks, lighting, occlusion at portrait width, and whether every pocket communicates its purpose. Check that each regional entrance meets a continuous painted, walkable route to its canonical neighboring destination. Review the rat's idle/attack/hit/death renders and its world size. Record specific criticism and corrections; do not approve a contact sheet by its existence.

Approval is a versioned `reviews/lumbright.json` receipt with `sourceHash`, `verdict: approved`, `reviewedBy`, `evidenceUrl`, and the desktop overview plus all `desktop:<id>`/`mobile:<id>`/`integrated:<id>` close-view identities. Run `author:release` to reject missing/stale review evidence. Changing canonical data, assets, composition, renderer or capture code invalidates the fingerprint. A report does not self-approve.

Painted terrain uses exact sparse tiles with the base surface's corner heights, diagonals and smooth normals. Complete scenery and scatter meshes are instanced in spatial batches. Rendered counters and source budgets guide scene complexity. SwiftShader is a software renderer; these screenshots cannot prove a phone frame rate, multiplayer load, accessibility of the live HUD, or a full MMO's production readiness. Playtest the actual world on a phone and with other players before promoting it beyond the existing beta.

## Editor coexistence

The visual map builder understands the new object types and preserves their identities through placements, inspectors and stamps. Its local-storage stamps remain a separate manual tool. The source-controlled semantic prefab format owns the complete generated layers. Do not save an experimental D1 override and assume a bundled-map change reached the live game: overrides take precedence. The auth-free preview reads bundled JSON directly so review evidence stays reproducible.

## Next expansion

Prove the starter loop in a live beta session, including save/return to idle. Then author one connected neighboring region with the same contract/gates. Add dedicated quest/dialogue/route-sign adapters and reusable district templates before increasing map area. Add real mobile and multiplayer performance gates before scaling population. No framework replacement is required for this authoring pipeline.

See the [Lumbright review](reviews/lumbright.md) for rejected candidates, inspected evidence and approval limits. The [MMORPG delivery order](../../docs/mmorpg-next-steps.md) covers live proof, progression ownership and simulation scaling.
