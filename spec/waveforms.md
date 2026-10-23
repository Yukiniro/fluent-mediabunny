# Waveforms

English | [简体中文](waveforms.zh-CN.md)

`getWaveformData(source, options?)` returns `Promise<WaveformData>` for one audio track. `renderWaveform(data, options)` returns `Promise<WaveformImage>` for one PNG drawn from that data. Public types are in [types.ts](../src/types.ts).

`getWaveformData` reads the original source with the shared [input contract](conversion.md#input-and-probe). `renderWaveform` accepts waveform data only and does not open, decode, or reread the source. The result is not a BBC waveform-data.js file and not a wavesurfer peak list.

## Waveform data

- `track` defaults to Mediabunny's primary audio track. A number is a nonnegative safe-integer source audio track ID from `probe()`.
- `pointsPerSecond` is a positive finite number and defaults to 50. Bucket `i` covers `[start + i / pointsPerSecond, start + (i + 1) / pointsPerSecond)`.
- `start` defaults to 0. `end` is optional. The requested interval is half-open, `[start, end)`. Both bounds are finite, nonnegative, and safe after rounding to microseconds. An explicit end must be greater than start.
- Times are relative to `max(0, input.getFirstTimestamp())`, the same origin [thumbnails](thumbnails.md) use. `timeOriginSeconds` reports that origin. `startSeconds` and `endSeconds` are positions on it.
- The default interval runs from 0 to the end of the selected track. Omitting `end` decodes until the samples end. The function does not call `computeDuration` or `getDurationFromMetadata` to discover that end. `endSeconds` is then the end of the last decoded sample, measured from the origin. If no sample is decoded, `endSeconds` equals `start` and both peak arrays are empty.
- An explicit end keeps that end. Audio that starts late, a gap, and any part of the interval with no samples stay at min 0 and max 0. Those zeros are part of the result.
- Peaks keep the decoded sample amplitude. The function does not normalize, mix channels, or write a file.
- `min[channel]` and `max[channel]` are independent `Float32Array` values of equal length. `channels` is the count from the first decoded layout. A later sample with a different channel count rejects `UNSUPPORTED_INPUT` and returns no result.
- Samples are decoded in chunks and closed before the next pull. The function does not retain the full PCM.
- A known end allocates the exact bucket count before decoding. `count * channels * 8` bytes above 64 MiB rejects `OUTPUT_TOO_LARGE` before creating `AudioSampleSink`. An omitted end grows the arrays and uses the same limit. 64 MiB limits those result arrays. It does not limit process memory, browser caches, or decode time.
- `signal` cancels the read. Failure and cancellation reject. Neither returns a successful partial object.

## PNG

- `width` and `height` are required positive integers. Each side is at most 4096 pixels and the area is at most 16,000,000 pixels. A size outside those limits is `INVALID_OPTIONS`. `height` must be at least `channels`, so each channel has a lane. Extra pixels go to the first lanes.
- `start` and `end` are optional and use the data's time base. The drawn interval expands to every full bucket that intersects the half-open request. The image reports that expanded `startSeconds` and `endSeconds`. A request that misses every bucket is `INVALID_OPTIONS`.
- Channels are stacked from top to bottom, one lane each. A column aggregates min and max when `width` is less than or equal to the selected bucket count. For column `x` and `n` selected buckets, the source range is `[floor(x * n / width), floor((x + 1) * n / width))`, and a zero-width slice still reads one bucket. A wider image repeats existing buckets with `floor(x * n / width)` and does not invent finer peaks.
- Drawing uses ±1 as the lane height. A value outside that range is clipped only while computing the pixel. The input arrays stay unchanged. A column whose aggregated min and max are both 0 draws no pixels. Positive amplitude draws toward the top of its lane.
- `color` is `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`. The default is `#000`. An omitted `background` leaves the canvas unfilled, so the PNG background is transparent. A supplied background is a full-rectangle fill before the waveform. The alpha byte is divided by 255.
- The result is one nonempty `image/png` blob, the requested pixel size, and the aligned time range. A substituted MIME type is `IMAGE_ENCODING_UNAVAILABLE`. An empty encoding is `PROCESSING_FAILED`.
- `signal` cancels before encoding finishes. The canvas is reset to 1×1 during cleanup. Failure and cancellation return no image.

## Errors

Errors use `MediaError` with phase `preparing` or `processing`, without a file target state.

| Code                         | Meaning                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `INVALID_OPTIONS`            | Invalid options, colors, size, range, empty data, or an ID that is not an audio track |
| `NO_TRACKS`                  | No primary audio track, or the selected audio track has no packets                  |
| `CODEC_UNAVAILABLE`          | The selected audio track cannot be decoded                                          |
| `UNSUPPORTED_INPUT`          | Unsupported source, missing sample layout, invalid sample timing, or a channel-count change |
| `OUTPUT_TOO_LARGE`           | The min and max arrays would exceed 64 MiB                                          |
| `IMAGE_ENCODING_UNAVAILABLE` | Missing Canvas 2D or PNG encoding, or a substituted MIME type                       |
| `READ_FAILED`                | Source read failure                                                                  |
| `PROCESSING_FAILED`          | Empty image encoding or cleanup failure                                              |
| `ABORTED`                    | Cancellation observed before completion                                              |
