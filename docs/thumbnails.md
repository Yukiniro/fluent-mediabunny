# Video image extraction

`thumbnail(source, options)` returns one `ThumbnailImage` or null. `thumbnails(source, options)` returns an async iterator of `ThumbnailItem` values. Both accept the same Blob, bytes, and HTTP(S) URL inputs as conversion. No conversion builder settings apply to extraction.

```ts
import { thumbnail, thumbnails } from "fluent-mediabunny";

const poster = await thumbnail(file, { time: 2, width: 640 });
const controller = new AbortController();
for await (const item of thumbnails(file, {
  times: [0, 2, 2, 5],
  width: 160,
  type: "image/png",
  signal: controller.signal,
})) {
  if (item.image) showPreview(item.index, item.image.blob);
  else showPlaceholder(item.index);
  if (previewClosed()) break;
}
```

UI helpers belong to the application. Applications also create and revoke any Blob URLs.

## Requests and timing

Choose an ordered `times` list of 1..1000 finite nonnegative seconds, or supply `start`, `end`, and integer `count` (1..1000). Interval sampling uses the starts of equal bins in `[start, end)`: 2..10 with count 4 requests 2, 4, 6, 8. Duplicates retain separate positions. No implicit duration scan is performed.

Times are relative to `max(0, input.getFirstTimestamp())`, shared across tracks. The primary video is selected by default; `track` can instead be a video track ID from `probe()`. Missing coverage before the video, in a gap, or at/after its final end returns null. The last frame is never extended indefinitely. Comparisons use rounded microseconds; returned timing retains the source sample values.

`ThumbnailImage` includes `blob`, `mimeType`, `width`, `height`, `trackId`, `requestedTime`, `actualTime`, `sourceTimestamp`, `durationSeconds`, and `timeOriginSeconds`. `actualTime` can be negative for a frame overlapping zero. A `ThumbnailItem` contains `index`, `requestedTime`, and `image` (which can be null).

## Image options

| Option              | Behavior                                                                                |
| ------------------- | --------------------------------------------------------------------------------------- |
| `type`              | JPEG by default; PNG also supported                                                     |
| `quality`           | JPEG only, 0..1, default 0.8; forbidden with PNG                                        |
| Neither size        | Oriented sample display size                                                            |
| `width` or `height` | Preserve display aspect ratio; round the inferred dimension                             |
| Both sizes          | Require `fit`: centered `contain`, centered `cover`, or stretched `fill`                |
| Limits              | Each dimension 1..4096, area at most 16,000,000 pixels; odd sizes and upscaling allowed |
| `signal`            | AbortSignal for cancellation                                                            |

Source rotation, flip and pixel aspect ratio are applied. PNG preserves available decoded alpha and transparent padding; JPEG composites onto black. Browser codec/color handling still applies. A decoder that drops alpha cannot be repaired by image encoding. Decoder metadata missing a non-square pixel ratio falls back to the track ratio only when coded dimensions are unchanged. A decoder that materializes the ratio into a different raster retains its sample dimensions; unreported dynamic ratio changes cannot be guaranteed.

## Errors and lifetime

Static batch validation is synchronous and snapshots options before any reads. The iterator remains lazy until its first `next()`. Single-call errors reject its Promise. Invalid options, unavailable decoders, unsupported input, read failures, oversized output and execution failures are errors, never null images. `IMAGE_ENCODING_UNAVAILABLE` identifies missing Canvas facilities or MIME substitution.

A batch reuses one input and decoding pipeline and encodes on demand. Each delivered Blob owns its bytes and survives later requests, cancellation and disposal. Retaining all results increases application memory. Native codec/source-cache allocations are separate from the wrapper's bounded output buffering.

`break` and `return()` clean up normally. Manual consumers must await `return()` when abandoning an iterator. Aborting while suspended after a yield starts cleanup immediately; the next `next()` rejects `ABORTED`, while explicit `return()` waits for cleanup. Calls on one iterator must be serial. In-flight browser encoding may need to finish before cancellation resolves; its late output is discarded. No image file writing, downloads, raw frames, spritesheets or public reader sessions are included.

See the [formal specification](../spec/spec-design-v0-2.md) and [validation evidence](thumbnail-validation.md).
