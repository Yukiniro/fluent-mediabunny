---
title: run / results
description: Execute a media conversion, choose a blob or file target, handle progress and cancellation, and read the result report.
---

# run / results

Execute a configured `MediaBuilder`. The default target returns a blob; a file target resolves after its writable stream closes successfully.

## Example

```ts
import { media } from "fluentbunny";

const controller = new AbortController();
const result = await media(file)
  .format("webm")
  .run({
    signal: controller.signal,
    onProgress({ phase, ratio }) {
      console.log(phase, ratio);
    },
  });

console.log(result.blob, result.report.warnings);
```

`file` is an application-supplied browser `File`. Call `controller.abort()` from your cancellation control.

## Signature

```ts
run(options?: RunOptions & { target?: "blob" }): Promise<BlobResult>;
run(options: RunOptions & { target: FileTarget }): Promise<FileResult>;
run(options: RunOptions): Promise<MediaResult>;

type MediaResult = BlobResult | FileResult;
type FileTarget = { type: "file"; handle: FileSystemFileHandle };
```

## RunOptions

| Field        | Type                             | Default  | Description                                                                                   |
| ------------ | -------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `target`     | `"blob" \| FileTarget`           | `"blob"` | Return bytes in memory or write to a distinct output file.                                    |
| `signal`     | `AbortSignal`                    | Unset    | Cancel before commit starts. A valid pre-aborted run performs no media I/O.                   |
| `onProgress` | `(event: ProgressEvent) => void` | Unset    | Synchronous observer. Throwing or returning a promise disables it and adds `CALLBACK_FAILED`. |

Call `format()` before execution. Each call owns independent resources and awaits cleanup before settlement. Source bytes remain caller-owned and must stay stable.

### File target

```ts
const result = await media(file)
  .format("mp4")
  .run({
    target: { type: "file", handle },
  });

console.log(result.filename, result.commitState);
```

`handle` must already have read/write permission and support `queryPermission`, `createWritable`, and `isSameEntry`. Choose a different file from the input. The library does not open a picker or request permission. Successful output replaces existing file content, including trailing bytes.

Within one module instance, concurrent writes to the same file fail with `TARGET_BUSY`. This lock does not cover other tabs or programs.

## Progress and cancellation

```ts
type Phase = "preparing" | "processing" | "committing";
type ProgressEvent = { phase: Phase; ratio: number | null };
```

| Phase        | Meaning                                                    | Ratio                       |
| ------------ | ---------------------------------------------------------- | --------------------------- |
| `preparing`  | Validate configuration, source, tracks, and codec support. | `null`                      |
| `processing` | Read and process media into the target.                    | 0–1, or `null` when unknown |
| `committing` | Finalize the blob or await the actual file close.          | `null`                      |

:::warning Commit boundary
A ratio of 1 is not proof that a file is saved. Cancellation before commit aborts opened staged writes. Once commit starts, abort is ignored, including abort from the `committing` callback. Await the result to know whether closing succeeded.
:::

Cancellation is cooperative and has no fixed latency. A failed operation returns no successful partial result. The first observed failure wins; later cleanup failures are recorded in `diagnostics`.

## BlobResult

| Field               | Type          | Description                                                  |
| ------------------- | ------------- | ------------------------------------------------------------ |
| `kind`              | `"blob"`      | Result discriminator.                                        |
| `blob`              | `Blob`        | Completed output bytes. The application manages object URLs. |
| `mimeType`          | `string`      | Output media type, as listed below.                          |
| `size`              | `number`      | Final logical length in bytes.                               |
| `suggestedFilename` | `string`      | `output.<format>`, for example `output.webm`.                |
| `report`            | `MediaReport` | Resolved configuration, metadata, tracks, and warnings.      |

## FileResult

| Field         | Type          | Description                                          |
| ------------- | ------------- | ---------------------------------------------------- |
| `kind`        | `"file"`      | Result discriminator.                                |
| `filename`    | `string`      | Actual file handle name; not renamed by the library. |
| `mimeType`    | `string`      | Output media type.                                   |
| `size`        | `number`      | Final logical length in bytes.                       |
| `commitState` | `"committed"` | Writable stream closed successfully.                 |
| `report`      | `MediaReport` | Same report shape as blob output.                    |

Successful close does not guarantee power-loss durability. Failed file runs set `MediaError.targetState` to `"untouched"`, `"aborted"`, or `"unknown"`; see [Inputs and outputs](/guide/inputs-and-outputs#read-targetstate).

### MIME types and size limits

| Format | MIME type                                                |
| ------ | -------------------------------------------------------- |
| MP4    | `video/mp4` with selected video; otherwise `audio/mp4`   |
| WebM   | `video/webm` with selected video; otherwise `audio/webm` |
| M4A    | `audio/mp4`                                              |
| WAV    | `audio/wav`                                              |

Output length must be a nonnegative safe integer. WAV has a 4,294,967,295-byte RIFF limit with no RF64 fallback. Overflow fails with `OUTPUT_TOO_LARGE`.

## MediaReport

| Field            | Type                                                                          | Description                                                               |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `resolved`       | `{ format: Format; mode: Mode; tracks: ResolvedTrack[]; trim?: TrimOptions }` | Resolved configuration; not measured hardware use or per-frame execution. |
| `selected`       | `TrackInfo[]`                                                                 | Selected source audio/video tracks.                                       |
| `excludedByUser` | `TrackInfo[]`                                                                 | Source audio/video tracks excluded by selection.                          |
| `metadata`       | `MetadataReport`                                                              | Written text values and metadata decisions.                               |
| `warnings`       | `Warning[]`                                                                   | Nonfatal issues; see [warnings](/api/errors#warning).                     |

`ResolvedTrack` extends [TrackInfo](/api/probe#trackinfo) with a non-null string `codec` and optional `quality`, `bitrate`, and `frameRate`. Video reports output width/height; audio reports sample rate/channel count.

### MetadataReport

| Field                    | Type              | Description                                                  |
| ------------------------ | ----------------- | ------------------------------------------------------------ |
| `values`                 | `MetadataValues`  | Written supported text metadata.                             |
| `removedByUser`          | `MetadataField[]` | Explicit deletions, including fields absent from the source. |
| `omittedSourceFields`    | `string[]`        | Unsupported or invalid source tags omitted from output.      |
| `replacedSourceMetadata` | `boolean`         | Whether metadata replace mode was requested.                 |

Embedded pictures are not written during conversion. Read them separately with [getEmbeddedPicture](/api/embedded-picture).

## Errors

Execution rejects with [MediaError](/api/errors). Common causes are missing format (`INVALID_OPTIONS`), an unavailable codec (`CODEC_UNAVAILABLE`), track loss (`TRACK_LOSS`), missing file permission (`PERMISSION_REQUIRED`), write/close failure (`WRITE_FAILED`), and accepted cancellation (`ABORTED`).
