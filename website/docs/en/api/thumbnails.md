---
title: thumbnail / thumbnails
description: Decode one video frame or lazily generate a bounded batch of JPEG or PNG images with explicit timing and sizing.
---

# thumbnail / thumbnails

Decode video frames into JPEG or PNG images. Use `thumbnail` for one time and `thumbnails` for a batch. To read original cover art instead, use [getEmbeddedPicture](/api/embedded-picture).

## thumbnail

```ts
import { thumbnail } from "fluent-mediabunny";

const image = await thumbnail(file, { time: 2, width: 640 });
if (image) {
  console.log(image.blob, image.actualTime);
}
```

```ts
function thumbnail(source: MediaInput, options: ThumbnailOptions): Promise<ThumbnailImage | null>;
```

| Parameter | Type                                | Description                                               |
| --------- | ----------------------------------- | --------------------------------------------------------- |
| `source`  | [MediaInput](/api/probe#mediainput) | Original media; conversion builder settings do not apply. |
| `options` | `ThumbnailOptions`                  | Required time, plus shared image options below.           |

**Returns:** a promise for one `ThumbnailImage`, or `null` when no frame covers the requested time. Read, decode, and encode failures reject; they do not return `null`.

## thumbnails

```ts
import { thumbnails } from "fluent-mediabunny";

for await (const item of thumbnails(file, {
  start: 2,
  end: 10,
  count: 4,
  width: 160,
})) {
  console.log(item.index, item.requestedTime, item.image?.blob);
}
```

This requests seconds 2, 4, 6, and 8. The end is excluded.

```ts
function thumbnails(
  source: MediaInput,
  options: ThumbnailsOptions,
): AsyncGenerator<ThumbnailItem, void, unknown>;
```

**Returns:** a lazy async generator yielding one `ThumbnailItem` per requested position, including missing frames. Static options are snapshotted and validated synchronously; media reads start on the first `next()`. Consume calls serially.

## ThumbnailOptions

```ts
type ThumbnailOptions = ThumbnailImageOptions & { time: number };
```

`time` is required, finite, nonnegative seconds. The rounded microsecond value must be a safe integer. Zero is valid.

## ThumbnailsOptions

Choose one request form, together with the shared image options. Mixing the two throws `INVALID_OPTIONS`.

```ts
type ThumbnailsOptions = ThumbnailImageOptions &
  (
    | { times: readonly number[]; start?: never; end?: never; count?: never }
    | { start: number; end: number; count: number; times?: never }
  );
```

| Field          | Description                                                                               |
| -------------- | ----------------------------------------------------------------------------------------- |
| `times`        | 1–1000 finite, nonnegative, nondecreasing times. Duplicate times retain separate indices. |
| `start`, `end` | Finite, nonnegative seconds; `end > start` both before and after microsecond rounding.    |
| `count`        | Integer from 1 to 1000. A count of 1 selects `start`.                                     |

Interval request `i` is `start + i * (end - start) / count`, for `i` from 0 to `count - 1`. There is no automatic duration scan.

## ThumbnailImageOptions

| Field             | Type                             | Default               | Description                                                                                         |
| ----------------- | -------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| `track`           | `"primary" \| number`            | `"primary"`           | Primary video track or a nonnegative safe-integer video track ID from `probe()`.                    |
| `width`, `height` | `number`                         | Oriented display size | Positive integer pixels, at most 4096 per side. Odd sizes and upscaling are allowed.                |
| `fit`             | `"contain" \| "cover" \| "fill"` | Unset                 | Required with both dimensions, forbidden otherwise. Contain and cover are centered; fill stretches. |
| `type`            | `"image/jpeg" \| "image/png"`    | `"image/jpeg"`        | Requested image MIME type. Substitution is an error.                                                |
| `quality`         | `number`                         | `0.8` for JPEG        | Finite 0–1. Supplying quality for PNG is invalid.                                                   |
| `signal`          | `AbortSignal`                    | Unset                 | Cancel reading and encoding.                                                                        |

One dimension preserves display aspect ratio and rounds the other. Source rotation, flip, and pixel aspect ratio apply before sizing. JPEG composites alpha and padding onto black; PNG preserves available decoded alpha and transparent padding. Generated images do not copy source metadata.

The maximum area is 16,000,000 pixels. Explicit limits fail with `INVALID_OPTIONS`; a native or inferred size that exceeds a limit fails with `OUTPUT_TOO_LARGE` before canvas allocation.

## ThumbnailImage

| Field               | Type                          | Description                                                |
| ------------------- | ----------------------------- | ---------------------------------------------------------- |
| `blob`              | `Blob`                        | Nonempty encoded image with independently owned bytes.     |
| `mimeType`          | `"image/jpeg" \| "image/png"` | Actual encoded type, matching the request.                 |
| `width`, `height`   | `number`                      | Output dimensions in pixels.                               |
| `trackId`           | `number`                      | Selected source video track ID.                            |
| `requestedTime`     | `number`                      | Original requested seconds.                                |
| `actualTime`        | `number`                      | `sourceTimestamp - timeOriginSeconds`; may be negative.    |
| `sourceTimestamp`   | `number`                      | Source sample timestamp, in seconds.                       |
| `durationSeconds`   | `number`                      | Source sample duration, in seconds.                        |
| `timeOriginSeconds` | `number`                      | `max(0, input.getFirstTimestamp())`, shared across tracks. |

### Frame coverage

Comparisons use rounded microseconds. A frame covers `[timestamp, timestamp + duration)`. Requests before video, in gaps, or at/after the last frame's end return `null`; no frame is extended. A frame overlapping zero can have negative `actualTime`.

A nonpositive rounded duration or an unsafe timestamp rejects with `UNSUPPORTED_INPUT`. Returned timestamps keep the source sample values, rather than the rounded comparison values.

## ThumbnailItem

| Field           | Type                     | Description                                       |
| --------------- | ------------------------ | ------------------------------------------------- |
| `index`         | `number`                 | Zero-based request position.                      |
| `requestedTime` | `number`                 | Requested seconds, retained even without a frame. |
| `image`         | `ThumbnailImage \| null` | Encoded image or missing frame.                   |

## Cleanup and cancellation

A batch reuses one input and decoding pipeline, encoding on demand. Images already returned survive later requests, cancellation, and disposal. The application manages object URLs and saving.

Completion and `for await` break release resources. Manual consumers must await `return()` when abandoning an iterator. Returning an unstarted iterator performs no media I/O.

Abort after a yield starts cleanup immediately and makes the next `next()` reject with `ABORTED`. Explicit `return()` waits for cleanup and ends normally. In-flight browser encoding may finish before cancellation resolves; late output is discarded. There is no fixed cancellation latency.

## Errors

Errors use [MediaError](/api/errors), with phase `preparing` or `processing` and no file target state.

| Code                         | Cause                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `INVALID_OPTIONS`            | Invalid request options, explicit dimensions, or a numeric ID that is not a video track. |
| `NO_TRACKS`                  | No primary video track, or the selected video track has no packets.                      |
| `CODEC_UNAVAILABLE`          | Unknown codec or unavailable video decoder.                                              |
| `UNSUPPORTED_INPUT`          | Unsupported source/container or invalid sample timing/geometry.                          |
| `IMAGE_ENCODING_UNAVAILABLE` | Missing Canvas encoding/2D drawing API, or substituted MIME type.                        |
| `OUTPUT_TOO_LARGE`           | Resolved dimensions or area exceed image limits.                                         |
| `READ_FAILED`                | Source read failed.                                                                      |
| `PROCESSING_FAILED`          | Decode, render, empty image output, or cleanup failure.                                  |
| `ABORTED`                    | Cancellation before completion.                                                          |
