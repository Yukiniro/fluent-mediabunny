# Errors

`MediaError` is the error class thrown by conversion, probe, thumbnail extraction, `getEmbeddedPicture`, and waveform data/rendering. It extends `Error`. `name` is `"MediaError"`.

```ts
class MediaError extends Error {
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

| Code                             | When it is used                                                                                                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_OPTIONS`                | An option object, number, enum, trim, crop, resize, metadata value, or thumbnail request failed validation.                                                                                                                                                          |
| `UNSUPPORTED_INPUT`              | The source is not a `File`, `Blob`, `ArrayBuffer`, `Uint8Array`, or absolute HTTP or HTTPS URL without credentials. Also an unrecognized container, a non-audio or non-video track passed to track info, an unsafe timestamp, or invalid frame coverage or geometry. |
| `UNSUPPORTED_OUTPUT_COMBINATION` | The codec is not enabled for the chosen format.                                                                                                                                                                                                                      |
| `IMAGE_ENCODING_UNAVAILABLE`     | Canvas image encoding or 2D rendering is missing, or the encoder substituted the requested MIME type.                                                                                                                                                                |
| `CODEC_UNAVAILABLE`              | A selected track cannot be decoded, or the resolved video or audio encoder is unavailable.                                                                                                                                                                           |
| `COPY_NOT_POSSIBLE`              | Copy mode cannot copy a selected track into the format.                                                                                                                                                                                                              |
| `NO_TRACKS`                      | No tracks were selected, the thumbnail input has no video track, or the selected video track is empty.                                                                                                                                                               |
| `TRACK_LOSS`                     | The output cannot hold every selected track, or conversion did not retain every selected track.                                                                                                                                                                      |
| `UNSUPPORTED_METADATA_FIELD`     | A metadata patch names a field outside `title`, `artist`, `album`, `albumArtist`, `genre`, `comment`, `description`, and `date`.                                                                                                                                     |
| `TARGET_UNSUPPORTED`             | The file target is not a file handle with permission queries and writable streams.                                                                                                                                                                                   |
| `TARGET_BUSY`                    | Another task owns this output file.                                                                                                                                                                                                                                  |
| `PERMISSION_REQUIRED`            | The file handle does not already have read and write permission.                                                                                                                                                                                                     |
| `READ_FAILED`                    | Reading the input failed.                                                                                                                                                                                                                                            |
| `WRITE_FAILED`                   | Opening, writing, or closing the output failed.                                                                                                                                                                                                                      |
| `OUTPUT_TOO_LARGE`               | The output length is not a safe nonnegative integer, WAV exceeds 4294967295 bytes, a resolved thumbnail exceeds 4096 pixels on a side or 16000000 pixels in area, or waveform arrays exceed 64 MiB.                                                                  |
| `PROCESSING_FAILED`              | An operation failed without a more specific code, including an image encoder that returned no bytes.                                                                                                                                                                 |
| `ABORTED`                        | The `AbortSignal` fired before commit.                                                                                                                                                                                                                               |

Waveform operations also reject malformed extrema/ranges with `INVALID_OPTIONS`, changing channel counts or non-finite PCM with `UNSUPPORTED_INPUT`, and absent/empty audio with `NO_TRACKS`. Their cleanup-only failures reject `PROCESSING_FAILED`.

## Warning

`Warning` is not a `MediaError`. Its `code` is a `string`, not an `ErrorCode`.

```ts
type Warning = { code: string; message: string; fields?: readonly string[] };
```

`run` currently assigns `METADATA_OMITTED`, `NON_AV_CONTENT_NOT_PRESERVED`, `FILENAME_EXTENSION_MISMATCH`, `CALLBACK_FAILED`, and `CLEANUP_FAILED`. Those strings are not members of `ErrorCode`. A thrown observer or a returned promise disables `onProgress` and adds `CALLBACK_FAILED`. Cleanup that fails after a successful output adds `CLEANUP_FAILED`. Cleanup that fails after an error is pushed onto `diagnostics` instead.
