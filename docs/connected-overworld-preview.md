# Connected overworld preview

All fourteen cities remain districts of one continuous Eldermoor overworld. Walking between cities does not allocate another room. Pastures, caves and boss lairs use separate, capacity-limited numbered instances.

## Test through the idle game

Open the Worker preview, sign in and select your character. Open Map → Enter the world, or Help → Enter the world. Entry saves first and stays in the same tab. New arrivals start in Lumbright; returning characters resume their world position. Finish an active co-op session before entering.

In the world, open the compass map, choose a named city and select Walk to. Journeys prefer painted roads and retain their entire path rather than stopping after 64 tiles. Destination details show a compass bearing and tile distance. Tap the ground to change course. Floating location overlays and town-name signposts are removed to keep the scene and mobile chat clear.

Select a named entrance to enter a pasture or lair. Passing its tile without selecting it leaves the character in the overworld. Admission checks use live server progress and existing quest/kill gates. Room allocation, a successful serialized grant flush and the saved arrival happen before the source player is removed. Failed admission or saving keeps the character in the source world.

Return doorways lead outside, away from entrance tiles and monster wander rectangles. Leave world in world settings returns to the referring idle deployment, with a Workers preview fallback.

## Geography and current limits

The entrances are near Lumbright (Cow Pasture), Varrick (Grondar), Draynar (Fiend Pit and Dragon Roost) and Faloden (Zaryth). The existing Dragon Roost remains one shared room containing green, red and black dragons. Its Draynar entrance does not establish canonical geographical parity for the red/black dragon regions; splitting those habitats is a follow-up.

All fourteen towns now use semantic content contracts, connected gateways and authored homes, streets and working yards. Supported resources, creatures and services follow canonical idle identities. The thirteen expanded regions explicitly defer 102 activities whose assets or gameplay adapters are missing. This beta does not certify production MMORPG art quality, live multiplayer capacity, phone frame rate, or full idle/world activity and equipment-perk parity.

The architecture keeps Preact/Three.js and Cloudflare Workers/Durable Objects. Larger populations still need measured mobile budgets, spatial actor activation and regional simulation partitioning before release beyond beta. The connected geography and travel flow are the first playable slice.

## Authoring and review

Edit regional semantic sources and generators, then regenerate maps. Entrance approaches reject scenery and encounter conflicts; road connections avoid monster wander. Cross-zone tests cover every registered return.

Cloudflare captures 329 regional desktop, portrait and integrated world views, 22 Lumbright experience views, four rat states and five goblin states using real scene layers and components. Experience renders are auth-free and do not establish that OAuth or live multiplayer was exercised. Each town requires a current-source receipt with complete regional coverage; Lumbright additionally requires experience coverage and creature review. Normal CI retains generated-file drift checks; candidate regeneration is confined to unreferenced review candidates.

D1 editor overrides take precedence over bundled maps. The earlier preview Cow Pasture return-exit adjustment is complete; its edited scenery was preserved. This town expansion makes no gameplay database writes. Production overrides and maps are outside this preview deployment.

## Progression boundary before wider release

Idle activities currently retain their catch-up clock during a world visit. Decide and implement a single progression clock before economy expansion; this slice does not redefine idle activity ownership.

Explicit Leave world now preserves the player and writer on failed grant or position saves, and waits for the server acknowledgement. Unexpected disconnect settlement still uses the older departure path. Kill-count and daily-task writes remain separate best-effort operations: they need transactional, idempotent settlement before claiming end-to-end progression durability or production MMORPG readiness. An audit-only outage no longer requeues already committed grant rewards. Admission rechecks room capacity after awaited reads. Unload beacons are ignored while admission or explicit logout owns the in-flight save, so they cannot remove or checkpoint the retained source player concurrently.

The world starts with inventory panels closed so the scene and entrance signs stay visible. The world map initially shows places and entrances; banks, skilling and monsters are optional filters.

## Review coverage follow-up

The approval fingerprint includes regional sources, measured assets, instance definitions, scene and entry sources, map categories, item/minimap icon sources, idle icon datasets and resolvers, GameIcon, entry styling/staging and procedural creature modules. Treat future renderer dependencies as fingerprint inputs when they are introduced; this explicit list is not an automatically resolved dependency graph. The town capture comparison manifest records which native frames were personally inspected or reused with identical PNG digests.

## Preview map override rollback

Before changing the preview Cow Pasture exit, the complete revision-10 `def_json` was archived as Git blob `614b4ef023870efbc7eaad33011b843a83efa3ef` in this repository. Retrieve it through the Git blob API to restore the authored map. The preview-only update is conditional on revision 10 and the old return coordinates; if the lease no longer matches, inspect the editor changes before applying anything. A rollback must likewise check the current revision and preserve intervening editor work.

## Mobile performance pass

The client caches deterministic ambient waypoints per 4.5-second leg and loads each villager model once per scene. Villagers outside the camera and nearby shadow area stop advancing their animation mixers; chimney smoke receives conservative bounds and pauses outside the view. Nearby shadow casters remain active. Hidden skeletons still incur scene traversal, so this is not complete regional activation.

Phones start at a maximum 1.25 drawing pixels per screen pixel, without multisample antialiasing, with a 512-pixel shadow map. Sustained slow frames can reduce drawing resolution to one pixel per screen pixel. Resolution stays at that level until a reload; isolated hitches and background gaps do not count. This is a frame-cadence heuristic: browser power-saving caps can also trigger it. HUD text keeps its normal CSS resolution.

Queued movement carries elapsed time across segment boundaries instead of discarding it after a slow frame. Server movement and combat keep their existing 600ms tick.

For diagnosis, enter normally, then add `?perf=1` to the world URL. Browser `window.__worldPerformance` reports mean FPS/frame time, 95th-percentile and worst frame intervals, draw calls, triangles, resolution, shadow size, ping round-trip time and queued steps. It contains no session token or character data.

Device acceptance still needs a signed-in route through Lumbright, across the x=192 terrain-chunk boundary, with combat, pinch zoom, instance travel and background/resume. Check frame percentiles, loading pauses, battery and temperature on a midrange Android and iPhone. Further work should target measured chunk-construction hitches, touch hover raycasts, dormant scene attachment, initial server snapshot interest filtering and crowded HUD overlays.

### Measured rendering workload

Cloudflare Chromium used the same 390 × 844 mobile viewport, device scale factor 3, gameplay camera at zoom 1.3/yaw 0 and snapshot state before and after the pass. The framebuffer changed from 780 × 1688 to 487 × 1055: about 61% fewer drawing pixels. Shadow-map dimensions changed from 1024 to 512. The HUD keeps its CSS resolution.

| Overworld tile | Draw calls before → after | Resident geometries before → after | Submitted triangles in both |
| --- | --- | --- | --- |
| 178,120, Lumbright arrival | 324 → 291 | 140 → 107 | 530,750 |
| 182,145, southern approach | 203 → 170 | 108 → 75 | 283,222 |
| 192,120, chunk boundary | 266 → 234 | 134 → 102 | 366,539 |

These are scene workload measurements, not handset frame rates or moving chunk-construction measurements. The first candidate was rejected because disabling villager mesh culling increased submitted triangles; the final client keeps separate camera and shadow culling. Native captures and their original PNG digests are recorded in the current Lumbright review.
