# tests/spec — executable invariant specs

Each file here pins a CLAUDE.md §4–§7 gameplay invariant as behavioural tests
against its source-of-truth engine module. The goal is a curated, greppable,
documentation-grade index: `grep -r "combo" tests/spec/` should read like a spec.

Conventions:
- File header states the invariant, its CLAUDE.md section, and the source module.
- Test names are full behavioural sentences.
- Prefer exercising the real engine function over asserting a bare constant.

This is a growing index, not a second suite. Existing domain tests
(`tests/prayerDrain.test.ts`, `tests/journeys.test.ts`, `tests/consumables.test.ts`, …)
are the spec for their areas today; move/rename them in here incrementally rather
than duplicating. New invariants land here from the start.
