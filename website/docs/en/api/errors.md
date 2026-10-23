---
title: Errors
description: Handle MediaError codes, processing phases, file target states, diagnostics, and nonfatal conversion warnings.
---

# Errors

`MediaError` is the error class thrown by conversion, probe, thumbnails, waveforms, and `getEmbeddedPicture`. It extends `Error`. `name` is `"MediaError"`.

## Handle an error

```ts
import { media, MediaError } from "fluentbunny";

try {
  const result = await media(file).format("webm").run();
  console.log(result.report.warnings);
} catch (error) {
  if (!(error instanceof MediaError)) throw error;
  if (error.code === "ABORTED") return;
  console.error(error.code, error.phase, error.message);
}
```

This snippet runs inside an application function with an input `File` named `file`. Put builder configuration inside `try` as well: invalid method arguments throw synchronously. Async operations reject promises, while batch request validation can throw before iteration starts.

## MediaError

```ts
class MediaError extends Error {
  constructor(
    code: ErrorCode,
    message: string,
    options?: { phase?: Phase; details?: Record<string, unknown>; cause?: unknown },
  );
  readonly code: ErrorCode;
  readonly phase: Phase;
  readonly details: Readonly<Record<string, unknown>>;
  readonly diagnostics: unknown[];
  targetState?: TargetState;
}
```

| Field         | Type                                             | Rule                                                           |
| ------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `message`     | `string`                                         | The `Error` message.                                           |
| `code`        | `ErrorCode`                                      | One of the 17 codes below.                                     |
| `phase`       | `"preparing"`, `"processing"`, or `"committing"` | Defaults to `"preparing"`.                                     |
| `details`     | `Readonly<Record<string, unknown>>`              | Defaults to `{}`.                                              |
| `diagnostics` | `unknown[]`                                      | Later failures and cleanup errors pushed onto the first error. |
| `cause`       | `unknown`                                        | Passed through to `Error`.                                     |
| `targetState` | `"untouched"`, `"aborted"`, or `"unknown"`       | Set only when `run` was given a file target and failed.        |

`targetState` `"untouched"` means the file was not opened. `"aborted"` means the opened stream aborted. `"unknown"` means the file was opened and the byte state was not proved.

## ErrorCode

| Code                             | When it is used                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_OPTIONS`                | An option object, number, enum, trim, crop, resize, metadata value, or thumbnail request failed validation.                                                                                                                                                                                                                        |
| `UNSUPPORTED_INPUT`              | The source is not a `File`, `Blob`, `ArrayBuffer`, `Uint8Array`, or absolute HTTP or HTTPS URL without credentials. Also an unrecognized container, a non-audio or non-video track passed to track info, an unsafe timestamp, invalid frame coverage or geometry, a waveform channel-count change, or invalid audio sample timing. |
| `UNSUPPORTED_OUTPUT_COMBINATION` | The codec is not enabled for the chosen format.                                                                                                                                                                                                                                                                                    |
| `IMAGE_ENCODING_UNAVAILABLE`     | Canvas image encoding or 2D rendering is missing, or the encoder substituted the requested MIME type.                                                                                                                                                                                                                              |
| `CODEC_UNAVAILABLE`              | A selected track cannot be decoded, or the resolved video or audio encoder is unavailable.                                                                                                                                                                                                                                         |
| `COPY_NOT_POSSIBLE`              | Copy mode cannot copy a selected track into the format.                                                                                                                                                                                                                                                                            |
| `NO_TRACKS`                      | No tracks were selected, thumbnail input has no video track, waveform input has no audio track, or the selected video or audio track is empty.                                                                                                                                                                                     |
| `TRACK_LOSS`                     | The output cannot hold every selected track, or conversion did not retain every selected track.                                                                                                                                                                                                                                    |
| `UNSUPPORTED_METADATA_FIELD`     | A metadata patch names a field outside `title`, `artist`, `album`, `albumArtist`, `genre`, `comment`, `description`, and `date`.                                                                                                                                                                                                   |
| `TARGET_UNSUPPORTED`             | The file target is not a file handle with permission queries and writable streams.                                                                                                                                                                                                                                                 |
| `TARGET_BUSY`                    | Another task owns this output file.                                                                                                                                                                                                                                                                                                |
| `PERMISSION_REQUIRED`            | The file handle does not already have read and write permission.                                                                                                                                                                                                                                                                   |
| `READ_FAILED`                    | Reading the input failed.                                                                                                                                                                                                                                                                                                          |
| `WRITE_FAILED`                   | Opening, writing, or closing the output failed.                                                                                                                                                                                                                                                                                    |
| `OUTPUT_TOO_LARGE`               | The output length is not a safe nonnegative integer, WAV exceeds 4294967295 bytes, a resolved thumbnail exceeds 4096 pixels on a side or 16000000 pixels in area, or waveform min and max arrays would exceed 64 MiB.                                                                                                              |
| `PROCESSING_FAILED`              | An operation failed without a more specific code, including an image encoder that returned no bytes.                                                                                                                                                                                                                               |
| `ABORTED`                        | The `AbortSignal` fired before commit.                                                                                                                                                                                                                                                                                             |

## Warning

`Warning` is not a `MediaError`. Its `code` is a `string`, not an `ErrorCode`.

```ts
type Warning = { code: string; message: string; fields?: readonly string[] };
```

`run` currently assigns `METADATA_OMITTED`, `NON_AV_CONTENT_NOT_PRESERVED`, `FILENAME_EXTENSION_MISMATCH`, `CALLBACK_FAILED`, and `CLEANUP_FAILED`. Those strings are not members of `ErrorCode`. A thrown observer or a returned promise disables `onProgress` and adds `CALLBACK_FAILED`. Cleanup that fails after a successful output adds `CLEANUP_FAILED`. Cleanup that fails after an error is pushed onto `diagnostics` instead.

| Warning code                   | Meaning                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `METADATA_OMITTED`             | Source tags were unsupported or invalid and were not preserved. |
| `NON_AV_CONTENT_NOT_PRESERVED` | Source content outside audio/video tracks was omitted.          |
| `FILENAME_EXTENSION_MISMATCH`  | Actual output file name does not match the selected format.     |
| `CALLBACK_FAILED`              | Progress observer threw or returned a promise and was disabled. |
| `CLEANUP_FAILED`               | Output succeeded, but later cleanup failed.                     |

Use `code` for branching and retain `diagnostics` for debugging. Sanitize raw causes and diagnostics before displaying or sending them outside the application. A failed file run with `targetState: "unknown"` does not prove either committed or rolled-back bytes.
