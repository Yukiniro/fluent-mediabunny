# Keyframes

English | [简体中文](keyframes.zh-CN.md)

`getClosestKeyFrameImage(source, options)` returns `Promise<KeyFrameImage | null>`. `getKeyFrameImages(source, options?)` returns an `AsyncGenerator<KeyFrameImage>`. `getKeyFrameCount(source, options?)` returns `Promise<number>`. Public types are in [types.ts](../src/types.ts).

These reads use the shared [input contract](conversion.md#input-and-probe). Conversion-builder settings do not apply. They do not change [`thumbnail`](thumbnails.md) or [`thumbnails`](thumbnails.md). A thumbnail is the presentation frame that covers a requested time, including a B frame. A keyframe image is the encoded random-access sample Mediabunny accepts as a key packet.

## Names

`getKeyFrameCount` matches the cardinality of LAVFilters `IKeyFrameInfo.GetKeyFrameCount`: one integer. The optional range is additional. No compared library returns encoded-keyframe images under these names:

| Library                          | Operation                                 | What it returns                                                                                          |
| -------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Android `MediaMetadataRetriever` | `getFrameAtTime`                          | One bitmap. `OPTION_CLOSEST_SYNC` is a seek mode, not a list or a count.                                 |
| AndroidX Media3                  | `FrameExtractor.getFrame`                 | One frame. `CLOSEST_SYNC` is a seek parameter.                                                           |
| Apple `AVAssetImageGenerator`    | `image(at:)` / `images(for:)`             | Images at caller-supplied times. Tolerance may land near an I-frame. It does not list encoded keyframes. |
| LAVFilters                       | `GetKeyFrameCount` / `GetKeyFrames`       | One count, or many timestamps. Not images.                                                               |
| Mediabunny                       | `getKeyPacket`                            | One encoded packet at or before a timestamp. Not an image, and not the nearest packet on either side.    |
| FFmpeg                           | `av_index_search_timestamp`               | One index.                                                                                               |
| GStreamer                        | `GST_SEEK_FLAG_KEY_UNIT` + `SNAP_NEAREST` | A seek flag. Equal distance follows the earlier keyframe.                                                |

`getClosestKeyFrameImage` and `getKeyFrameImages` are a deliberate departure from that set. `getClosestKeyFrameImage` uses “closest” so it is not read as Mediabunny’s previous-or-equal `getKeyPacket`.

## Selection

- `track` follows the thumbnail rule. The default is Mediabunny’s primary video track. A numeric value is a nonnegative safe-integer video track ID. A missing or non-video ID is `INVALID_OPTIONS`. No primary video, or a selected video track with no packets, is `NO_TRACKS`.
- Time origin and microsecond rounding are the thumbnail rules. Origin is `max(0, input.getFirstTimestamp())`. Comparisons use `Math.round(seconds * 1_000_000)`. Do not use `VideoSample.microsecondTimestamp`, which truncates.
- Explicit `time`, `start`, and `end` are finite nonnegative seconds. `-0` becomes 0. When both bounds are set, `end` must exceed `start` before and after microsecond rounding.
- A keyframe belongs to a range when its packet start, in absolute microseconds, is inside `[start, end)`. An omitted bound is unbounded. Omitting both includes every confirmed keyframe, including packets with a negative timestamp. `start: 0` excludes those packets because the origin is clamped at 0.
- The metadata walk is decode order. Results are sorted by presentation timestamp. Key packets whose raw timestamps are exactly equal, including `-0` and `0`, collapse to one candidate. This departs from keeping every distinct packet that shares a timestamp: `VideoSampleSink` decodes one sample for one presentation timestamp, so a count of uncollapsed copies would not match the images.
- Container key flags are not enough. Each candidate is confirmed with `getPacket(timestamp, { verifyKeyPackets: true })`. The scan itself is metadata-only. `verifyKeyPackets` and `metadataOnly` cannot be combined. A candidate is kept only when the verified packet is a key packet and its timestamp rounds to the same microsecond. A demoted packet is dropped, not replaced inside that call. The next candidate is considered. Decode and encode failures throw. They do not skip ahead.
- Nearest means the smallest presentation-time distance on either side of `origin + time`, on the shared microsecond grid. An exact match wins. An equal distance keeps the earlier timestamp. A time before the first or after the last confirmed keyframe returns that boundary keyframe. No confirmed keyframe returns `null`, an empty iteration, or `0`. That is distinct from an empty track, which is `NO_TRACKS`.
- Images are decoded at the confirmed packet’s raw timestamp. Rounding that timestamp to microseconds can fall before the packet. For example, `2002 / 30000` rounds to `0.066733`, which is earlier than the raw value, and a rounded query can select the previous packet. If the decoded sample’s start does not match the packet on the microsecond grid, or its rounded duration is not positive, the call throws `UNSUPPORTED_INPUT`. A missing sample is `PROCESSING_FAILED`.
- `getKeyFrameCount` uses the same candidates, range, and confirmation as the image calls. It does not construct a video sample sink or a canvas, and it does not call `canDecode`. The count is the number of confirmed packets, not a duration or GOP estimate. Scanning encoded metadata is still required. A count does not promise that a later image decode will succeed. The metadata walk finishes before the first image is yielded. Early `return()` stops later confirmation and decode. There is no promise of an immediate first image or of counting from an index without reading packets.
- `getKeyFrameImages()` with no options yields every confirmed keyframe. Each call owns its input. There is no public session or cache. Counting and then extracting reads the source again.

## Images

Image options and limits match [thumbnails](thumbnails.md#images): `width`, `height`, `fit`, `type`, and `quality`. `KeyFrameImage` is a `ThumbnailImage` without `requestedTime`. The caller keeps the `Blob`. JPEG flattens alpha onto black. PNG keeps alpha. Samples are closed before the blob is delivered.

## Lifetime

- `getKeyFrameImages` checks options synchronously, then waits until the first `next()` to read. Returning an unstarted iterator performs no I/O. `getClosestKeyFrameImage` and `getKeyFrameCount` are promises, so invalid options reject.
- Static options are checked before a pre-aborted signal. A valid pre-aborted request rejects `ABORTED` without reading the source.
- Each invocation owns its resources. Completion, failure, cancellation, `return()`, and `for await` break release them. Delivered blobs stay usable. First failure wins. Later cleanup errors are diagnostics. A cleanup-only failure rejects `PROCESSING_FAILED`.
- Abort while suspended after a yield starts cleanup. The next `next()` rejects `ABORTED`. Explicit `return()` completes after cleanup and is not `ABORTED`.

## Errors

Errors use `MediaError` with phase `preparing` or `processing`, without a file target state.

| Code                         | Images                                                                                                             | Count                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `INVALID_OPTIONS`            | Invalid options, times, video track ID, or explicit size limits                                                    | Same, except image size, fit, type, and quality are unknown options |
| `NO_TRACKS`                  | No primary video, or the selected video track has no packets                                                       | Same                                                                |
| `CODEC_UNAVAILABLE`          | Unknown codec or the selected track cannot be decoded                                                              | Not produced by the count path                                      |
| `UNSUPPORTED_INPUT`          | Unsupported source or container, unsafe timestamps, or a decoded sample whose timing does not match the key packet | Unsupported source or container, or an unsafe timestamp             |
| `IMAGE_ENCODING_UNAVAILABLE` | Missing rendering or encoding API, or a substituted MIME type                                                      | Not produced by the count path                                      |
| `OUTPUT_TOO_LARGE`           | Resolved dimensions or area exceed image limits                                                                    | Not produced by the count path                                      |
| `READ_FAILED`                | Source read failed                                                                                                 | Same                                                                |
| `PROCESSING_FAILED`          | Decode, render, empty image output, or cleanup failure                                                             | Cleanup-only failure                                                |
| `ABORTED`                    | Cancellation before completion                                                                                     | Same                                                                |
