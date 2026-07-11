---
paths:
  - "tests/**"
---

# Testing rules (auto-loads when editing tests)

How this repo keeps logic proven. Full strategy + phased plan: `docs/testing-strategy-review.md` and `docs/testing-strategy-delivery-plan.md`. `TESTING.md` maps features to test files.

- **Bug fix => the failing test lands in the same PR, written first.** Reproduce, watch it go red, then fix. No fix without a test that would have caught it.
- **New/changed behaviour => a test in the same diff.** CI's changed-lines gate (`scripts/check-diff-coverage.cjs`) requires >=90% of the source lines a PR adds to be covered - so untested new logic fails the gate, not review.
- **If you can't test logic where you're writing it, move the logic.** The node harness can't import Preact-wired JSX, so `src/App.jsx` / screens / `src/state` are untestable by construction. Put new logic in `src/engine` or `functions/_lib` and call it from the UI. The UI-line ratchet (`scripts/check-ui-ratchet.cjs`) fails if that zone grows.
- **Never turn a red test green by widening its expectation** to match new output, unless you state in the PR why the new behaviour is correct. A test that just mirrors current output isn't a test.
- **No real clock in tests** - use `vi.setSystemTime` / fake timers. UTC-boundary logic (daily reset) flakes otherwise.
- **No new mirror-list tests** (hand-maintained enumerations that duplicate `src/data`). Derive invariants structurally instead ("every drop unique has a collection-log slot"), so content changes don't force test edits.
- **No new source-regex tests** (`readFileSync` + regex over JSX). If that's the only way to reach the logic, the logic is in the wrong place - see the move rule above.
- **Naming**: camelCase test files (`itemValue.test.ts`); test names are full behavioural sentences so `grep` over `tests/` reads as a spec.
- **Server tests**: reuse the shared D1 fake once it exists (`tests/helpers/`), don't hand-roll another regex-on-SQL mock.
