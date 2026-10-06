# Connected overworld preview

All fourteen cities remain districts of one continuous Eldermoor overworld. Walking between cities does not allocate another room. Pastures, caves and boss lairs use separate, capacity-limited numbered instances.

## Test through the idle game

Open the Worker preview, sign in and select your character. Open Map → Enter the world, or Help → Enter the world. Entry saves first and stays in the same tab. New arrivals start in Lumbright; returning characters resume their world position. Finish an active co-op session before entering.

In the world, open the compass map, choose a named city and select Walk to. Journeys prefer painted roads and retain their entire path rather than stopping after 64 tiles. The location and destination panel shows a compass bearing and tile distance. Tap the ground to change course; Stop journey cancels walking. Lumbright's semantic road signs start journeys to Draynar, Alkarid and Varrick.

Destination details contain clearly labelled Preview quick travel. It is a testing convenience enabled only by the preview Worker binding; the server refuses it in production and during combat. It is no longer presented as a free Magic spell.

Select a named entrance to enter a pasture or lair. Passing its tile without selecting it leaves the character in the overworld. Admission checks use live server progress and existing quest/kill gates. Room allocation, a successful serialized grant flush and the saved arrival happen before the source player is removed. Failed admission or saving keeps the character in the source world.

Return doorways lead outside, away from entrance tiles and monster wander rectangles. Leave world in world settings returns to the referring idle deployment, with a Workers preview fallback.

## Geography and current limits

The entrances are near Lumbright (Cow Pasture), Varrick (Grondar), Draynar (Fiend Pit and Dragon Roost) and Faloden (Zaryth). The existing Dragon Roost remains one shared room containing green, red and black dragons. Its Draynar entrance does not establish canonical geographical parity for the red/black dragon regions; splitting those habitats is a follow-up.

Lumbright has a semantic content contract and reviewed scenery. The other thirteen city districts still use the existing procedural dressing. This preview does not certify their final MMORPG art quality, live multiplayer capacity, phone frame rate, or full idle/world activity and equipment-perk parity.

The architecture keeps Preact/Three.js and Cloudflare Workers/Durable Objects. Larger populations still need measured mobile budgets, spatial actor activation and regional simulation partitioning before release beyond beta. The connected geography and travel flow are the first playable slice.

## Authoring and review

Edit regional semantic sources and generators, then regenerate maps. Entrance approaches reject scenery and encounter conflicts; road connections avoid monster wander. Cross-zone tests cover every registered return.

Cloudflare captures the original 49 Lumbright views plus 22 experience views using real scene layers and components. Experience renders are auth-free and do not establish that OAuth or live multiplayer was exercised. Current-source approval must list both sets of views. Normal CI retains generated-file drift checks; candidate regeneration is confined to unreferenced review candidates.

D1 editor overrides take precedence over bundled maps. The preview Cow Pasture override needs only its return exit metadata updated to the new safe Lumbright road; retain its edited scenery. Production overrides and maps are outside this preview deployment.

## Progression boundary before wider release

Idle activities currently retain their catch-up clock during a world visit. Decide and implement a single progression clock before economy expansion; this slice does not redefine idle activity ownership.

Explicit Leave world now preserves the player and writer on failed grant or position saves, and waits for the server acknowledgement. Unexpected disconnect settlement still uses the older departure path. Kill-count and daily-task writes remain separate best-effort operations: they need transactional, idempotent settlement before claiming end-to-end progression durability or production MMORPG readiness. An audit-only outage no longer requeues already committed grant rewards. Admission rechecks room capacity after awaited reads. Unload beacons are ignored while admission or explicit logout owns the in-flight save, so they cannot remove or checkpoint the retained source player concurrently.

The world starts with inventory panels closed so the scene and entrance signs stay visible. Portrait journey guidance sits above the bottom controls and hides while a HUD pane is open. The world map initially shows places and entrances; banks, skilling and monsters are optional filters.

## Review coverage follow-up

The approval fingerprint covers this change’s scene, entry, guidance and map sources, but is not a complete transitive renderer dependency graph. Add itemIcon/minimap/mapCategories, idle icon data and resolvers, GameIcon and the entry CSS staging build script to fingerprint inputs before relying on the receipt for future edits to those dependencies. The native screenshot comparison manifest records exactly which frames were inspected or reused as byte-identical evidence.

## Preview map override rollback

Before changing the preview Cow Pasture exit, the complete revision-10 `def_json` was archived as Git blob `614b4ef023870efbc7eaad33011b843a83efa3ef` in this repository. Retrieve it through the Git blob API to restore the authored map. The preview-only update is conditional on revision 10 and the old return coordinates; if the lease no longer matches, inspect the editor changes before applying anything. A rollback must likewise check the current revision and preserve intervening editor work.
