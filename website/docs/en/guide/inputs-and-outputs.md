# Choose inputs and outputs

Pass a `File` or `Blob`, an `ArrayBuffer`, a `Uint8Array` backed by an `ArrayBuffer`, or an absolute HTTP or HTTPS URL. Remote sources must allow CORS. Requests omit credentials and do not retry. A URL with a username or password throws `UNSUPPORTED_INPUT`. An empty `ArrayBuffer` throws `INVALID_OPTIONS`. An empty `Uint8Array` throws `UNSUPPORTED_INPUT`.

Recognizing a container does not mean this browser can decode or encode it. [probe](/api/probe) reads the container, duration, audio and video tracks, and supported metadata without converting.

## Return a blob

`run()` with no target, or with `target: "blob"`, resolves to a `BlobResult`. The bytes live in `result.blob`. Create and revoke object URLs in the application. `suggestedFilename` is `output.` plus the format.

## Write a file

```ts
await media(file)
  .format("mp4")
  .run({
    target: { type: "file", handle },
  });
```

`handle` is a `FileSystemFileHandle` for a file, with `queryPermission`, `createWritable`, and `isSameEntry`. Grant read and write permission before `run`. This library does not open a picker and does not ask for permission. A missing grant throws `PERMISSION_REQUIRED`. A handle that cannot do those operations throws `TARGET_UNSUPPORTED`.

Two tasks cannot own the same file. The second throws `TARGET_BUSY`. The writable stream is created with `keepExistingData: false`, so a successful open replaces the file contents.

## Cancel and read progress

Pass `signal` as an `AbortSignal`. Pass `onProgress` to receive `{ phase, ratio }`.

`phase` moves from `"preparing"` to `"processing"` to `"committing"`. `ratio` is a number from 0 to 1, or `null` when the underlying progress is not finite. A callback that throws or returns a promise is disabled. The report then includes `CALLBACK_FAILED`.

Cancel before commit and any opened file stream is aborted. Once commit starts, abort is ignored and the run waits for the file close. Processing progress alone does not mean the file has been saved.

## Read targetState

`targetState` is set only when `run` was given a file target and then failed. `"untouched"` means the output file was not opened. `"aborted"` means the opened stream aborted. `"unknown"` means the file was opened, and abort or close did not prove the bytes.

A blob run does not set `targetState`. A successful file run has `commitState: "committed"` and no `targetState`.

WAV output longer than 4294967295 bytes throws `OUTPUT_TOO_LARGE`. Any output length that is negative or not a safe integer throws the same code.
