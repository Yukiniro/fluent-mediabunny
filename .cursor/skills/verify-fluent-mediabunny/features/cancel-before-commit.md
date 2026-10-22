# Cancel before commit

Cancel before commit guarantees that aborting a file-target run before the commit barrier never closes the real writable stream; the library aborts the stream instead, matching the public lifecycle contract.

## Sub-features

- `cancel-preaborted` rejects with `ABORTED` when the signal is already aborted before work.
- `cancel-mid-write` aborts during the first write and records `abort` without `close`.
- `cancel-no-close` asserts `close` is absent from the handle event log after cancel.

## How to get to it (user POV)

- Pass `signal: AbortSignal` into `run({ target: { type: "file", handle }, signal })` and abort before commit completes.
- The application supplies the `FileSystemFileHandle`; the library never opens the native picker.

## Driving it with verify-fmb

Preconditions:

- Doctor `ok: true`.
- `/fixtures/audio.wav` available.

- **Run cancel recipes.** `node .cursor/skills/verify-fluent-mediabunny/helpers/verify-fmb.mjs drive cancel-before-commit`.
- **Observe pre-abort.** `result.preAborted.code === "ABORTED"` and events do not include `close`.
- **Observe mid-write.** `result.midWrite.code === "ABORTED"`, events include `abort`, and do not include `close`.
- **Proof.** `proof.ok === true` under `artifacts/verify-fluent-mediabunny/<run>/cancel-before-commit/`.

## Gotchas

- After `scope.phase === "committing"`, abort must not cancel the close; that success path is covered by Vitest lifecycle tests and the formal verification skill, not this drive.
- Fake handles are required here; OPFS/native picker success is not proof of this contract.
- Never wire a `StreamTarget` directly to a user file stream in product code; only `commit()` closes the real file.
