# Semantic world authoring — Lumbright delivery plan

Goal: let agents author legible, inhabited regions from owned assets and canonical idle content. Prove the workflow with Lumbright inside the existing overworld.

Success requires deterministic generation, canonical resource/monster/facility parity, no missing creature fallback, connected paths and interaction approaches, collision matching measured asset bounds, bounded scenery, passing game/world checks, and personally inspected desktop/mobile renders. A green structural report does not certify visual quality.

Unknowns to resolve:
- Measure shipped model bounds and inspect building fronts in renders.
- Exercise new fishing/bowstring gathering through the authoritative server.
- Render both the isolated district and its integrated overworld placement.
- Measure real-device performance separately; software browser screenshots cannot establish mobile frame rates.

Order:
1. Derive the spatial content contract from worldActivities/world/skills/gatherTasks.
2. Build a deterministic semantic compiler with full prefab expansion and behavioral failure tests.
3. Add missing runtime gathering adapters and truthful creature visuals.
4. Author Lumbright, generate the integrated map and reproducible review views.
5. Inspect renders, fix issues, then run full checks and publish the review evidence.

Scope: authoring sources/compiler, asset metadata, validation/tests, review tooling, minimal existing-world integration and Lumbright.

Out of scope: a new MMO economy, replacing Three/Preact/PartyServer, entire-world generation, expanded idle location content, multiplayer sharding, new equipment-charge semantics, and production deployment.

Skills: delivery-loop, steps, plan-gate, scope-fence, test-driven-development, verification-before-completion; world-design rules govern visual release. Routine review and terminal checks use Cloudflare Workers Builds; GitHub Actions is a deliberately dispatched fallback. See world/authoring/README.md for build commands, evidence publication and the unchanged approval gate.
