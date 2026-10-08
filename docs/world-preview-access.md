# World access in production and preview

The world remains preview-only after this branch merges. Production hides the
Map/Settings entry, boss lairs and Wilderness, omits the world client from static
assets, and refuses world handoffs, sessions, editor/count APIs and sockets.
Idle co-op bosses and raids retain their existing routes and authentication.

`npm run build:site:preview` explicitly sets `POCKETRPG_BUILD_ENV=preview` and
`EnableWorldBeta=true`. Both are required to bake entry flags and stage the world
client. Ordinary builds default off, regardless of branch name or a stale
`EnableWorldBeta` variable. Preview can use a source commit from `main`.

Runtime admission requires `WORLD_BETA_ENABLED="true"` and a valid non-production
`APP_BASE_URL`. Production config sets the flag to `"false"`; preview sets it to
`"true"`. Live-game request and deployment origins are denied even if the flag
is accidentally enabled. Missing configuration fails closed. Local settings,
query parameters and saved world tokens cannot opt in.

`POST /api/world/leave` remains authenticated exit-only cleanup while disabled.
It departs only the character identified by the world token and retains grant
flushes, checkpoints, combat logout rules and save-lock release. Do not gate this
cleanup or bypass world save locks.

Releasing the world to production requires a deliberate change to this policy,
production asset staging and the origin guard, with renewed release verification.
Setting a runtime flag alone does not release it.
