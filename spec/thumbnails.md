# Thumbnails

English | [简体中文](thumbnails.zh-CN.md)

`thumbnail(source, options)` returns `Promise<ThumbnailImage | null>`. `thumbnails(source, options)` returns an `AsyncGenerator<ThumbnailItem>` with one entry per request and a zero-based index. Public types are in [types.ts](../src/types.ts).

Both read the original source using the shared [input contract](conversion.md#input-and-probe). Conversion-builder settings do not apply. Encoded keyframes are a separate contract in [keyframes](keyframes.md).

## Requests and timing

- `track` defaults to Mediabunny's primary video track; a numeric value is a nonnegative safe-integer video track ID from `probe()`.
- Single extraction requires `time`. Batch extraction accepts either `times` or all of `start`, `end`, and `count`.
- Times are finite, nonnegative seconds; `-0` becomes 0. An explicit list contains 1–1000 nondecreasing entries. Duplicates retain their positions; requests are neither sorted nor deduplicated.
- Intervals require `end > start` before and after microsecond rounding, and integer count 1–1000. Request `i` is `start + i * (end - start) / count`, including start and excluding end. Count 1 selects start. End is explicit; extraction does not scan duration automatically.
- Time origin is `max(0, input.getFirstTimestamp())`, shared across all input tracks. Waveform data uses the same origin. Lookups use presentation timestamps, including VFR and B frames.
- Lookup and coverage comparisons use `Math.round(seconds * 1_000_000)`. Request-plus-origin arithmetic, frame starts, durations, and frame ends stay within safe integer microseconds; frame duration rounds to a positive value.
- A frame covers a request only within `[frame start, frame start + duration)`. Gaps and requests outside video coverage return `null`; frames are not clamped or extended. Equal frame starts follow the upstream lookup's selection.
- Results retain requested seconds and source sample timestamps/durations. `actualTime = sourceTimestamp - timeOriginSeconds` can be negative for a frame overlapping zero.

## Images

| Option               | Behavior                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `type`               | JPEG by default; PNG is also supported                                                     |
| `quality`            | JPEG only, finite 0–1, default 0.8; supplying it for PNG fails                             |
| No dimensions        | Oriented sample display dimensions rounded to positive integers                            |
| Width or height only | Preserve display aspect ratio; infer the other as `max(1, round(...))`                     |
| Both dimensions      | Require explicit fit and output exactly that size                                          |
| `fit`                | Centered contain, centered cover/crop, or stretched fill; requires both dimensions         |
| Limits               | Integer dimensions 1–4096; area at most 16,000,000 pixels; odd sizes and upscaling allowed |

Source rotation, flip, and pixel aspect ratio apply before sizing. Use each sample's geometry. Fall back to track pixel ratio only for square-pixel samples whose coded dimensions remain unchanged; do not apply it again to a decoder-normalized raster. Unreported dynamic pixel-ratio changes cannot be resolved from fixed track metadata.

JPEG composites alpha and contain-padding onto black. PNG preserves available decoded alpha and transparent padding. Colors and native dimensions may vary across browser decoders; HDR preservation is not guaranteed. Source metadata is not copied into generated images.

Each result owns a nonempty Blob with matching MIME and dimensions, plus track ID and timing fields. Returned images survive later requests, cancellation, and cleanup. Applications manage saving and object URLs.

## Lifetime

- Single-call errors reject its Promise. The batch factory snapshots and validates options and the entire request list synchronously, then defers media I/O until the first `next()`. Returning an unstarted iterator performs no I/O.
- Static options are checked before a pre-aborted signal. A valid pre-aborted request rejects `ABORTED` without reading the source.
- Each invocation owns its resources. A batch reuses one input and decoding pipeline, encoding only when the consumer requests another entry. Wrapper buffering holds at most one encoded image plus reusable render buffers; consumer retention and native caches are separate.
- Iterator calls are serialized by one consumer. Completion, failure, cancellation, `return()`, and `for await` break release resources. Early break is normal completion, not `ABORTED`. Manual consumers abandoning iteration await `return()`.
- Abort also initiates cleanup while suspended after a yield. The next `next()` rejects `ABORTED`; explicit `return()` ends normally after cleanup. In-flight work is awaited and late encoded results are discarded.
- Samples are released before image delivery. Single-call resolution and final iterator completion await cleanup. First failure wins; later cleanup errors are diagnostics. Cleanup-only failure rejects `PROCESSING_FAILED`.
- A successful batch yields every requested position, including null images. Failure stops iteration without invalidating earlier results. Extraction uses only the selected video decoder and does not run conversion's AVC or whole-file dimension preflight.

Cancellation has no fixed latency; abort after single-call resolution or normal batch completion has no effect.

## Errors

Errors use `MediaError` with phase `preparing` or `processing`, without a file target state.

| Code                         | Meaning                                                                 |
| ---------------------------- | ----------------------------------------------------------------------- |
| `INVALID_OPTIONS`            | Invalid options, request times, video track ID, or explicit size limits |
| `NO_TRACKS`                  | No primary video or selected video track has no packets                 |
| `CODEC_UNAVAILABLE`          | Unknown codec or selected track cannot be decoded                       |
| `UNSUPPORTED_INPUT`          | Unsupported source/container or invalid decoded timing/geometry         |
| `IMAGE_ENCODING_UNAVAILABLE` | Missing rendering/encoding API or substituted output MIME               |
| `OUTPUT_TOO_LARGE`           | Inferred/native size exceeds limits; rejected before canvas allocation  |
| `READ_FAILED`                | Source read failure                                                     |
| `PROCESSING_FAILED`          | Decode, render, empty/null image encoding, or cleanup failure           |
| `ABORTED`                    | Cancellation observed before completion                                 |

Missing frame coverage is a null image, not an error.

Related contracts: [conversion](conversion.md), [waveforms](waveforms.md).
