---
paths:
  - "src/payments/**"
  - "server/billing/**"
  - "tests/payments*.test.ts"
---

# Payments Subsystem

Example rule — replace with a real subsystem in your codebase (auth, real-time sync, a plugin/extension system, a matchmaking engine, whatever has enough internal complexity to deserve its own loaded-on-demand doc). This file auto-loads only when a session touches one of the `paths:` globs above, so it's the place for detail that would otherwise bloat `CLAUDE.md`.

A good rule covers:

- **Architecture**: how the pieces fit together, in enough detail that an agent doesn't have to re-derive it by reading five files.
- **Non-obvious invariants**: the constraint that isn't visible from any single file (e.g. "amounts are always integer cents, never floats"; "webhook handlers must be idempotent because the provider retries").
- **Gotchas**: the thing that looks like a bug but isn't, or the thing that looks fine but is a bug.
- **The recipe** for the most common change to this subsystem (e.g. "adding a new payment provider means touching these three files, in this order").
- **Pointers**, not copies: link to the one file that's the actual source of truth for a formula or schema rather than restating it here (restatements drift out of sync).

Keep each rule scoped tightly enough that it's genuinely relevant every time its `paths:` match — a rule that's only sometimes useful for its own scope is a sign the scope is too broad.
