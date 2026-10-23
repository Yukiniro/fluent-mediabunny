---
title: Waveforms
description: Read one audio track into per-channel min and max arrays, then draw those arrays as one PNG.
---

# Waveforms

`getWaveformData` reads one audio track into peak arrays. `renderWaveform` draws one PNG from those arrays and does not open the media again.

## Example

```ts
import { getWaveformData, probe, renderWaveform } from "fluentbunny";

const info = await probe(file);
const audio = info.tracks.find((track) => track.type === "audio");
const data = await getWaveformData(file, audio ? { track: audio.id } : {});
const image = await renderWaveform(data, { width: 800, height: 160 });
```

`file` is a browser `File`. The second call reads one audio track. When `probe` found none, it uses the primary audio track and rejects `NO_TRACKS` if the file has no audio. `image.blob` is one PNG. `image.startSeconds` and `image.endSeconds` are the buckets actually drawn.

## getWaveformData

```ts
function getWaveformData(source: MediaInput, options?: WaveformOptions): Promise<WaveformData>;
```

| Parameter | Type                                | Description                                            |
| --------- | ----------------------------------- | ------------------------------------------------------ |
| `source`  | [MediaInput](/api/probe#mediainput) | Original media. Conversion settings do not apply.      |
| `options` | `WaveformOptions`                   | Track, bucket rate, half-open range, and cancellation. |

**Returns:** one `WaveformData` object. Failure and cancellation reject. They do not return a partial object.

## WaveformOptions

| Field             | Type                  | Default     | Description                                                                      |
| ----------------- | --------------------- | ----------- | -------------------------------------------------------------------------------- |
| `track`           | `"primary" \| number` | `"primary"` | Primary audio track, or a nonnegative safe-integer audio track ID.               |
| `pointsPerSecond` | `number`              | `50`        | Positive finite bucket rate. The default bucket is 20 ms.                        |
| `start`           | `number`              | `0`         | Inclusive start, in seconds, on the shared time origin.                          |
| `end`             | `number`              | Track end   | Exclusive end. Omit it to decode until the samples end, without a duration scan. |
| `signal`          | `AbortSignal`         | Unset       | Cancel decoding.                                                                 |

Times use `max(0, input.getFirstTimestamp())`, the same origin as [thumbnails](/api/thumbnails). The interval is half-open. A late start, a gap, and any requested time with no samples stay at min 0 and max 0.

Peaks keep decoded amplitude. Channels stay separate. The function does not normalize peaks, mix channels, or write a file. Samples are aggregated in chunks and released. The full PCM is not retained.

`min` and `max` together must stay within 64 MiB, measured as `bucketCount * channels * 8` bytes. A known end is checked before decoding. This cap applies to those arrays. It is not a process-memory or decode-time limit.

A change in channel count rejects `UNSUPPORTED_INPUT`.

## WaveformData

| Field               | Type             | Description                                                     |
| ------------------- | ---------------- | --------------------------------------------------------------- |
| `trackId`           | `number`         | Selected source audio track ID.                                 |
| `sampleRate`        | `number`         | Track sample rate in hertz.                                     |
| `channels`          | `number`         | Channel count. `min` and `max` each have this many arrays.      |
| `pointsPerSecond`   | `number`         | Bucket rate used to build the arrays.                           |
| `startSeconds`      | `number`         | Requested inclusive start, relative to `timeOriginSeconds`.     |
| `endSeconds`        | `number`         | Exclusive end. An omitted `end` is the last decoded sample end. |
| `timeOriginSeconds` | `number`         | Shared input origin, `max(0, input.getFirstTimestamp())`.       |
| `min`, `max`        | `Float32Array[]` | Per-channel peaks. Untouched buckets are 0.                     |

Bucket `i` covers `[startSeconds + i / pointsPerSecond, startSeconds + (i + 1) / pointsPerSecond)`.

## renderWaveform

```ts
function renderWaveform(data: WaveformData, options: WaveformRenderOptions): Promise<WaveformImage>;
```

| Parameter | Type                    | Description                                                    |
| --------- | ----------------------- | -------------------------------------------------------------- |
| `data`    | `WaveformData`          | Peak arrays from `getWaveformData` or the same shape.          |
| `options` | `WaveformRenderOptions` | Required pixel size, optional range, colors, and cancellation. |

**Returns:** one `WaveformImage`. The input arrays are not modified.

## WaveformRenderOptions

| Field        | Type          | Default     | Description                                                                |
| ------------ | ------------- | ----------- | -------------------------------------------------------------------------- |
| `width`      | `number`      | Required    | Positive integer pixels, at most 4096.                                     |
| `height`     | `number`      | Required    | Positive integer pixels, at most 4096, and at least one pixel per channel. |
| `start`      | `number`      | Data start  | Inclusive start on the data time base.                                     |
| `end`        | `number`      | Data end    | Exclusive end on the data time base.                                       |
| `color`      | `string`      | `"#000"`    | Hex RGB or RGBA. `#RGB`, `#RGBA`, `#RRGGBB`, and `#RRGGBBAA` are accepted. |
| `background` | `string`      | Transparent | Hex fill for the whole image. Omit it to leave the background unpainted.   |
| `signal`     | `AbortSignal` | Unset       | Cancel before encoding finishes.                                           |

The area limit is 16,000,000 pixels. A size outside a limit rejects `INVALID_OPTIONS`.

The drawn range expands to every full bucket that intersects `[start, end)`. The image returns that expanded range. A request that misses every bucket rejects `INVALID_OPTIONS`.

Channels are stacked from the top. When the width is less than or equal to the selected bucket count, each column aggregates min and max. A wider image repeats existing buckets and does not create finer peaks.

Drawing treats ±1 as the full lane. Values outside that range are clipped only for the pixel. A column whose min and max are both 0 draws nothing. Positive amplitude draws toward the top of the lane.

## WaveformImage

| Field                        | Type          | Description                                 |
| ---------------------------- | ------------- | ------------------------------------------- |
| `blob`                       | `Blob`        | Nonempty `image/png` bytes.                 |
| `mimeType`                   | `"image/png"` | Always PNG. A substituted type is an error. |
| `width`, `height`            | `number`      | Requested pixel size.                       |
| `startSeconds`, `endSeconds` | `number`      | Full buckets covered by the image.          |

The canvas is reset to 1×1 after encoding, including when encoding fails or the caller cancels.

## Errors

Errors use [MediaError](/api/errors), with phase `preparing` or `processing` and no file target state.

| Code                         | Cause                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `INVALID_OPTIONS`            | Invalid options, colors, size, range, empty data, or an ID that is not an audio track. |
| `NO_TRACKS`                  | No primary audio track, or the selected audio track has no packets.                    |
| `CODEC_UNAVAILABLE`          | The selected audio decoder is unavailable.                                             |
| `UNSUPPORTED_INPUT`          | Unsupported source, missing layout, invalid sample timing, or a channel-count change.  |
| `OUTPUT_TOO_LARGE`           | The min and max arrays would exceed 64 MiB.                                            |
| `IMAGE_ENCODING_UNAVAILABLE` | Missing Canvas 2D or PNG encoding, or a substituted MIME type.                         |
| `READ_FAILED`                | The source read failed.                                                                |
| `PROCESSING_FAILED`          | The encoder returned no bytes, or cleanup failed.                                      |
| `ABORTED`                    | Cancellation before completion.                                                        |
