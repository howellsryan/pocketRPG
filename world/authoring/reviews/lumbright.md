# Lumbright connected-world visual review

Current evidence: https://8f96b93b-pocketrpg-world-review.rlh.workers.dev/a18f51c19fb8098d7245590fa07f794fb88702cc/
Current source fingerprint: 2e40f2097d62f2a08e80a7cf7ca943c830eaceb509993702fba637913f5cf40e

The connected-world pass preserves Lumbright’s canonical gathering, combat and facility contract. It adds named semantic road signs, five physical instance entrances, safe return approaches, road-preferring city journeys, destination details and idle-game entry. Source controls remain in regional semantics and generators, with checked-in outputs regenerated from them.

Rejected experience passes had HUD panels covering entrance names, missing review fonts/icons, crowded default map markers and dark entrance symbols. The revised client starts with inventory closed, puts phone guidance above the bottom controls, stages real entry styles/Forge artwork and paints the real HUD icons. The map begins with cities and entrances and explicitly labels quick travel as a preview convenience. The Dragon Roost arrival initially put its return name behind the phone vitals; the generator, overworld admission coordinate and review camera were moved together to the clearer four-tile approach. Both desktop and phone experience frames were inspected at native dimensions.

The screenshot comparison manifest records original PNG SHA-256 digests. Byte-identical composition frames reuse their prior native inspection; changed composition frames were personally inspected again. The 22 experience states cover five desktop/portrait entrance pairs, five portrait returns, desktop/portrait journeys and destination maps, and three entry/save-error states. Full captures are linked in the immutable Cloudflare gallery. Existing checked-in JPG contact sheets are historical evidence for the original scene, not current travel UI approval.

Verdict: approved only for the connected-world beta composition and interface legibility. This is not approval of production MMORPG quality or end-to-end gameplay.

### Remaining criticism and release gates

Road signs and entrance names are legible, but the instance entrances still use generic freestanding frames and simple cave recesses. Replace them with site-specific landscaping and art before claiming an immersive finished world. The river and terrain edges are visibly geometric, paved spaces are broad, the building kit is repetitive and ambient villagers still lack names, dialogue and local objectives. The other thirteen districts retain procedural dressing and have not received Lumbright’s semantic composition pass. Do not mass-generate more scenery until a real starter loop is demonstrated.

The location panel currently names the nearest city anchor, not the canonical district that owns a resource. At the Lumbright pasture it can say Near Al-Karid; the entrance name remains Lumbright Cow Pasture. Regional ownership labels need an authored geography contract.

Software Chromium captures prove layout and scene presentation, not phone frame time, live OAuth, multiplayer or durable economy behavior. Run a signed-in two-player gathering/combat/banking loop, phone loading/frame-time measurements, instance entry/return and explicit Leave world/save recovery before widening access. Unexpected disconnect settlement, idle catch-up during a world visit and best-effort kill-count/daily writes remain separate architecture work; explicit-save regression tests do not certify those paths.

The fingerprint covers this change’s modified scene and UI sources but omits some transitive icon/minimap/entry staging dependencies. Expand that dependency list before future edits to those sources rely on an unchanged receipt. Source fingerprint approval is a review guard, not a numerical substitute for criticism.

## Historical Lumbright scene review

The first candidate was rejected despite passing its structural checks. Broad flat paving dominated the town; crop rows were sparse; the pasture was a dirt rectangle; the bank chest sat in the road; and several portrait cameras missed the monsters they were meant to show. The castle roof obscured the ruins view.

Baseline: https://github.com/howellsryan/pocketRPG/actions/runs/37426807857/artifacts/11395775621.

The second pass set the bank into a courtyard, filled ordered crop rows, restored a grass pasture with a physical opening, framed the gateways and bridge, and moved review cameras to usable approaches. The rat has a shared idle/world visual rather than a cow fallback; it remains readable at its 0.45-tile world scale. The existing crab is 0.7 tiles tall. All four rat states were personally inspected.

Second-pass evidence: https://github.com/howellsryan/pocketRPG/actions/runs/37455779168/artifacts/11409109435.

That pass still failed integrated route review: the west and south roads ended on grass, and minor dirt trails painted over the town paving. The corrected source declares its canonical neighboring destinations. Its connectors stay outside the protected regional stamp and enter neighboring towns on their cardinal streets. A generator gate now requires a contiguous painted, walkable connection through the boundary to each destination. A trial south approach to Varrick encountered an existing lumbermill footprint; the final connector uses the west approach. No building collision was cleared to make it pass.

Final source fingerprint: 22a89e87a91f9ef941882f4e5d1872373b7967062a63cf9d12d438d5198a62e3.
Final evidence: https://github.com/howellsryan/pocketRPG/actions/runs/37458602909/artifacts/11411341323.
Verdict: approved for the existing beta scene example; production MMORPG release remains unapproved.

Every one of the 49 full-size captures was personally inspected: overview; arrival, market and kitchen; fields and river; quarry, ruins and hollow; shore, granary and goblins; west/south gateways and bridge; bulls and chickens. Desktop, portrait and integrated variants were reviewed for every close view. The bank has a clear courtyard approach; fieldwork stays visible in portrait; the ruins camera avoids the keep's roof; every monster pocket presents its bound creature; and the integrated entrances meet their external roads. The rat remains recognizable at gameplay scale. Its attack, death, hit and idle renders were checked separately.

The supported contract contains five gathering identities, seven combat identities and bank/stove facilities, with no missing or extra bindings. Deferred spatial activities and portable actions remain explicitly outside that parity scope. Shared timing/stacking mechanics are exercised by server tick tests; not every idle equipment bonus is implemented.

The final candidate passed npm run ci (4,953 idle tests plus builds and required checks), npm run world:check (1,014 world tests plus required builds), focused compiler/server tests, asset/browser-error checks and the complete capture run. Approval of this fingerprint does not come from those test totals. It records the inspected scenes and their remaining limitations.

Permanent contact sheets and the overview/rat renders are alongside this document. The full PNG/JPEG captures and evidence manifest are in the Actions artifact. Integrated arrival submits 582,824 triangles in the software renderer. The earlier baseline submitted 854,588, but that difference includes corrected preview AOI as well as rendering changes and cannot establish a device frame rate.

## Approval scope and remaining criticism

A scene approval covers composition and legibility within the current stylized world beta. It cannot certify a production MMORPG or live usability. The terrain and river remain geometric; towns reuse a small building kit; encounter areas have little narrative detail; and villagers have no quest/dialogue identity. These are visible constraints, not results a numerical budget can dismiss.

Before promoting the world beyond beta, test the real phone client with its HUD, picking and action feedback; walk the complete gathering/combat/banking loop with another player; and verify save/return to the idle game. The software browser renderer does not establish a mobile frame rate. No server simulation, persistence or multiplayer behavior is exercised by scene captures.

Build the next district only after that loop works. Add route signs, named NPCs and local objectives through explicit semantic/runtime adapters. Improve organic terrain edges and local asset variety before mass-populating the map.
