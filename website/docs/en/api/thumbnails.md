# thumbnail

`thumbnail` returns one image or `null`. `thumbnails` yields one item per requested time, including times with no frame.

```ts
function thumbnail(source: MediaInput, options: ThumbnailOptions): Promise<ThumbnailImage | null>;

function thumbnails(
  source: MediaInput,
  options: ThumbnailsOptions,
): AsyncGenerator<ThumbnailItem, void, unknown>;
```

`MediaInput` matches [probe](/api/probe). Static validation runs before any read and snapshots the options. The iterator stays lazy until the first `next()`. `thumbnail` rejects when that single request fails. `null` means no frame covers the time.

## ThumbnailOptions

`ThumbnailOptions` is `ThumbnailImageOptions & { time: number }`.

`time` is finite seconds and may be 0. It must fit in a rounded microsecond.

## ThumbnailsOptions

`ThumbnailsOptions` is `ThumbnailImageOptions` plus one of these two objects.

```ts
{ times: readonly number[]; start?: never; end?: never; count?: never }
{ start: number; end: number; count: number; times?: never }
```

`times` has length 1 to 1000. Values are finite, nonnegative, and nondecreasing. `start` and `end` follow the same time rules, and `end` is greater than `start` in microseconds. `count` is an integer from 1 to 1000. Passing `times` together with `start`, `end`, or `count` throws `INVALID_OPTIONS`.

Interval times are `start + i * (end - start) / count` for `i` from 0 to `count - 1`. That is the start of each equal bin in `[start, end)`.

## ThumbnailImageOptions

| Field     | Type                                | Rule                                                            |
| --------- | ----------------------------------- | --------------------------------------------------------------- |
| `track`   | `"primary"` or `number`             | Default `"primary"`. A number is a video track id and may be 0. |
| `width`   | `number`                            | Positive integer, at most 4096.                                 |
| `height`  | `number`                            | Positive integer, at most 4096.                                 |
| `fit`     | `"contain"`, `"cover"`, or `"fill"` | Required when both sizes are set, and forbidden otherwise.      |
| `type`    | `"image/jpeg"` or `"image/png"`     | Default `"image/jpeg"`.                                         |
| `quality` | `number`                            | JPEG only, 0 to 1, default 0.8.                                 |
| `signal`  | `AbortSignal`                       | Cancels the read and the encode.                                |

`width * height` above 16,000,000 throws `INVALID_OPTIONS`. Omitting both sizes uses the oriented display size. One size preserves that aspect ratio and rounds the other side. Both sizes use `fit`. `"contain"` and `"cover"` letterbox or crop from the center. `"fill"` stretches.

Resolved width or height above 4096, or a resolved area above 16,000,000, throws `OUTPUT_TOO_LARGE`.

## ThumbnailImage

| Field               | Type                            |
| ------------------- | ------------------------------- |
| `blob`              | `Blob`                          |
| `mimeType`          | `"image/jpeg"` or `"image/png"` |
| `width`             | `number`                        |
| `height`            | `number`                        |
| `trackId`           | `number`                        |
| `requestedTime`     | `number`                        |
| `actualTime`        | `number`                        |
| `sourceTimestamp`   | `number`                        |
| `durationSeconds`   | `number`                        |
| `timeOriginSeconds` | `number`                        |

`requestedTime` is the caller's time. `timeOriginSeconds` is `max(0, first timestamp)`. `actualTime` is `sourceTimestamp - timeOriginSeconds` and can be negative. `sourceTimestamp` and `durationSeconds` are the sample's own values.

Times are compared as rounded microseconds against the sample interval `[timestamp, timestamp + duration)`. A nonpositive duration, or a timestamp that cannot be rounded, throws `UNSUPPORTED_INPUT`.

## ThumbnailItem

| Field           | Type                       |
| --------------- | -------------------------- |
| `index`         | `number`                   |
| `requestedTime` | `number`                   |
| `image`         | `ThumbnailImage` or `null` |

A batch reuses one input and one decoder, and encodes on demand. Each blob owns its bytes. `break` and `return()` dispose the input. Manual consumers await `return()` when abandoning the iterator. Calls on one iterator are serial. Abort after a yield rejects the next `next()` with `ABORTED`. `return()` waits until cleanup finishes.

A numeric `track` that is not a video track throws `INVALID_OPTIONS`. `NO_TRACKS` means the input has no video track, or the selected video track is empty. `CODEC_UNAVAILABLE` means the decoder is missing. `IMAGE_ENCODING_UNAVAILABLE` means Canvas 2D or `convertToBlob` / `toBlob` is missing, or the encoder changed the MIME type. `PROCESSING_FAILED` means the encoder returned no bytes. `READ_FAILED` means an input read failed.
