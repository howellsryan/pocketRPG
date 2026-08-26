---
name: scope-fence
description: Use on every task where you will modify existing work - code, documents, configs. Fences your changes to exactly what was asked. Adjacent problems get FLAGGED, never silently fixed. Keeps diffs minimal and reviewable. Do not use it to refuse legitimate follow-through the task actually requires.
---

# scope-fence: do what was asked, flag what you found

The most reviewable diff contains exactly the requested change and nothing else. Every unrequested improvement costs double: the reviewer must untangle what was asked from what was volunteered, and every extra line is a new place to introduce a regression nobody asked you to risk. (This operationalises CLAUDE.md §13 "minimal and scoped; no unrelated refactors".)

## The fence

1. **Restate the task as a boundary.** One sentence, before editing: "The task is X. The fence is: files/behavior needed for X."
2. **Inside the fence: full effort.** Do X completely, including its genuine requirements (the import X needs, the test X breaks, the §11 commit gate).
3. **Outside the fence: eyes open, hands off.** You will see broken things — dead code, a bug in a neighboring function, an outdated comment. Do not touch them. Record them.
4. **Flag, do not fix.** If (and only if) you noticed something, end with:

```
Noticed, NOT touched: <issue> - <why it matters> - <suggested follow-up>
```

Do not list what you changed — the diff already shows it (CLAUDE.md §17: never echo what the user can see). No flags → no report.

## Decision rules for the gray zone

- Would the requested change BREAK without this extra edit? In scope.
- Merely "while I am here"? Out. Flag it.
- Formatting churn on untouched lines (auto-format, import reordering)? Revert before presenting — it is diff noise.
- The requested fix reveals the real bug is elsewhere? Stop and say so — do not silently relocate the fence. Re-fence with the user.

## Check the fence held, before committing

Read the diff back against your boundary sentence (`git diff`, `git diff --cached`, or `git diff origin/main...HEAD`). For each signal below, decide **keep** (the task genuinely requires it), **split** (real, but its own change), or **justify** (one line on why it had to ride along):

| Signal | Why it matters here |
|---|---|
| **Unrelated paths** | A file outside the fence sentence. An engine fix touching `screens/` needs a reason. |
| **New dependency** | A decision, not an implementation detail. Almost always split. |
| **A UI import inside `src/engine/`** | Never a keep — the engine is pure logic, and that boundary is what makes it testable (§3). |
| **A new `/api/save` check** | Almost never a keep. §14 allows exactly three guards; tighten integrity by moving the reward server-side instead. |
| **Committed `index.html` or `game-*.js`** | Never a keep — generated and gitignored (§12). |
| **A comment added to `migrations/*.sql`** | Never a keep — §13 forbids them outright; the file gets pasted into the D1 console by hand. |
| **Config, CI, or build edits** | `build_single.cjs`, `wrangler.jsonc`, `worker/router.js`. Not a drive-by — and a new `functions/` file needs `npm run gen:routes`, which IS in scope. |
| **Oversized hunk** | A 400-line diff for a "small fix" means the fence moved while you were not looking. |
| **Formatting-only files** | Whole diff is reflow or import reordering. Revert it. |

Anything landing in **split** that you already wrote: take it back out. A smaller diff you can defend beats a larger one you have to explain.

## Anti-patterns this skill kills

- The 40-file diff for a one-line fix.
- The drive-by refactor that "improved" a function the task never mentioned and broke its one weird caller.
- Style opinions applied to code you were not asked to judge.

## The honest tension

Sometimes the adjacent problem genuinely is worse than the task. The answer is still the fence: finish X, then flag it with your recommendation. "I noticed something worse, want me to switch?" costs one exchange. The uninvited mixed diff costs trust.
