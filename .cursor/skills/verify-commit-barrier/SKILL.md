---
name: verify-commit-barrier
description: Formally checks the fluentbunny file-target cancel-vs-commit barrier (Scope + OutputSink). Use when changing src/scope.ts or src/target.ts lifecycle, cancellation, or file close/abort ordering — or when a change might close a writable after abort.
---

# Verify commit barrier

## Property (plain language)

**If the user cancels before commit starts, the real file writable must never be closed** — it is aborted instead. Closing is only allowed after the commit barrier.

**Harm if broken:** a canceled export can still finalize a partial file on disk (`close` after `abort`), corrupting or unexpectedly creating user media.

## When to run

Run this skill before finishing any change that touches:

- `src/scope.ts` — especially `abort`, `commit`, `fail`, `finish`
- `src/target.ts` — especially `OutputSink.abort`, `OutputSink.commit`, `open`, lease handling
- Lifecycle tests in `tests/lifecycle.test.ts` that assert abort vs close

If those paths are untouched, you may skip; still re-run when unsure.

## Tool and why

A **finite-state exhaustive checker** in Node (`model/commit_barrier_check.mjs`), not TLC/TLA+.

Why: the barrier is a small discrete protocol already expressed in TypeScript; a same-language model maps 1:1 to `Scope` / `OutputSink` method names, needs no Java toolchain, and finishes in milliseconds so agents will actually re-run it. Event order (cancel vs commit vs close) is exactly what this checks.

## Coverage record

| Model action     | Code                                                          |
| ---------------- | ------------------------------------------------------------- |
| `userAbort`      | `Scope.abort` — no-op when `phase === "committing"`           |
| `beginCommit`    | `Scope.commit` — `check()` then `phase = "committing"`        |
| `runAbort`       | `OutputSink.abort` — returns immediately while committing     |
| `close`          | `OutputSink.commit` → `stream.close()` after `scope.commit()` |
| `open` / `write` | `OutputSink.open` / writable `write`                          |

**Last sync commit:** `5edd606bb2e4ecddaab677aa24ec608f5d4ebff9`

Move this SHA forward only after you confirm the model still describes the code at the new commit (read the two source files; update the table if method names or guards changed).

## Bounds and assumptions

- Explores preparing → processing → committing → finished with a single file stream.
- At most three `write` steps (enough to interleave abort).
- Does not model Mediabunny muxer internals, OPFS, or permission prompts.
- Does not prove browser-native cleanup beyond the library's abort/close calls.
- A pass covers the model, not the whole converter.

## How to run

From the repo root:

```sh
node .cursor/skills/verify-commit-barrier/model/commit_barrier_check.mjs
```

Expect exit `0` and JSON `"ok": true`. Report written to `artifacts/verify-commit-barrier/report.json`.

## Tell a real bug from a modeling error

1. Re-read `Scope.abort` / `OutputSink.abort` / `OutputSink.commit` against the coverage table.
2. Reproduce with Vitest: `pnpm exec vp test run tests/lifecycle.test.ts` (cancel-during-write and commit-barrier cases).
3. If Vitest fails the same way, treat it as a product bug — **do not weaken the model** unless the user asks to change the contract.
4. If Vitest passes and only the model fails, fix the model (stale sync).

## Prove the checker can fail

```sh
node .cursor/skills/verify-commit-barrier/model/commit_barrier_check.mjs --broken
```

Must exit `1` with reason `cancel-before-commit-closed-file` and a counterexample that includes `userAbort` before `beginCommit` then `close`. That broken mode allows `beginCommit` after failure (the bug the real `check()` prevents). Drop `--broken` afterward; do not leave the default run in broken mode.

## Maintenance

After intentional lifecycle changes, update the model and the sync commit, then run `/maintain-formal-verification-skill`.
