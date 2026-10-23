# Audio waveforms

English | [简体中文](waveforms.zh-CN.md)

`getWaveformData(source, options?)` returns `Promise<WaveformData>`. `renderWaveform(data, options)` returns `Promise<WaveformImage>` containing one PNG. Both are independent of conversion-builder settings. Public types are in [types.ts](../src/types.ts).

## Data

- Input follows the shared [MediaInput contract](conversion.md#input-and-probe). `track` defaults to the primary audio track, or accepts a source audio track ID from `probe`. One call processes one audio track; it does not mix tracks or channels.
- `start` defaults to 0. Optional `end` must exceed start; omitting it decodes to the selected audio track's end without a preliminary duration scan. Times are nonnegative finite seconds rounded to safe integer microseconds. A range that collapses after rounding fails. With no end, start at/after decoded audio end fails `INVALID_OPTIONS`.
- The shared source origin is `max(0, input.getFirstTimestamp())`, matching thumbnails. Selected-track offsets and timestamp gaps remain in place. Negative relative audio is excluded. Explicit ranges preserve their full requested duration, with zero padding outside coverage, including wholly uncovered ranges. No audio track or an empty selected track fails `NO_TRACKS`.
- `pointsPerSecond` is a positive finite number, default 50 (20 ms per bin). Bin `i` covers `[start + i / pointsPerSecond, min(end, start + (i + 1) / pointsPerSecond))`. The last bin may be partial. Sample positions and coverage boundaries use microsecond rounding. Decode chunks are cropped inside their PCM frames, not just selected by chunk start.
- The result contains `trackId`, `timeOriginSeconds`, `start`, `end`, `pointsPerSecond`, and `channels`. Each channel owns separate `Float32Array<ArrayBuffer>` arrays `min` and `max`, both of length `ceil((end - start) * pointsPerSecond)` with microsecond-rounded duration. Returned arrays remain valid independently of input disposal or other calls.
- Extrema include zero for missing coverage, including gaps within partially covered bins. Finite raw amplitudes are preserved without normalization or clipping. Opposite-phase channels do not cancel each other. Actual sample rates determine chunk timing; a changing channel count or non-finite PCM fails `UNSUPPORTED_INPUT`.
- Decode and aggregate incrementally, release each sample, and retain no full-source PCM buffer. Total result arrays are capped at 64 MiB; exceeding the cap fails `OUTPUT_TOO_LARGE`. This is not a total process-memory limit: growth/copy buffers, decoding, native caches, input retention, and caller retention are separate. Four hours at 50 points/s and two channels use 11,520,000 result bytes.

## PNG rendering

- Rendering reads only supplied waveform data; it never opens media or decodes audio. Callers keep the data stable until settlement. Data must be a plain object with matching non-shared Float32 arrays, finite extrema and `min <= max`, consistent timing and resolution, and at least one channel. Data is neither modified nor normalized.
- `width` and `height` are required positive integers, each at most 4096, with area at most 16,000,000 pixels. Height must be at least the number of channels, which occupy separate vertical lanes in source order.
- `start`/`end` default to the data bounds and must form a nonempty interval wholly inside them. Rendering includes complete bins intersecting the request. Result `start`/`end` report the outward-aligned coverage, clipped to the data bounds.
- Downsampling combines min/max across every bin contributing to a pixel column. Upscaling reuses existing bins without inventing detail. A finer picture requires higher-resolution source data.
- `color` defaults to `#000000`; `backgroundColor` defaults to `#00000000`. Only `#RRGGBB` and `#RRGGBBAA` are accepted. Each lane maps amplitude +1 to its top and -1 to its bottom; only drawing clips amplitudes outside this range. Silence is a one-pixel line at the lane center.
- Use OffscreenCanvas with DOM canvas fallback, as thumbnails do. Missing canvas/PNG encoding or substituted MIME fails `IMAGE_ENCODING_UNAVAILABLE`; empty/null encoding fails `PROCESSING_FAILED`.
- A successful result contains an owned nonempty `blob`, `mimeType: "image/png"`, `width`, `height`, `start`, and `end`. Applications manage object URLs, saving and serialization. There are no axes, labels, gradients, image lists, or built-in file export.

## Errors and lifetime

Both operations accept `signal: AbortSignal`. Unknown options and invalid values fail `INVALID_OPTIONS`. Static validation precedes cancellation; valid pre-aborted calls perform no media I/O or canvas allocation. Decode/render errors use `MediaError` with phase `preparing` or `processing`, without a file target state. Selected decoder unavailability fails `CODEC_UNAVAILABLE`; source reads fail `READ_FAILED`.

Each call owns its resources and awaits in-flight work and cleanup before settlement. Cancellation discards late results and rejects `ABORTED`. No successful partial result is returned. The first failure wins, later failures become diagnostics, and cleanup-only failures reject `PROCESSING_FAILED`. Cancellation is cooperative without fixed latency. Applications manage Workers and codec installation; no Worker, WASM fallback, cache, progress callback or streaming result is added.

## API survey and scope

The name and one-object result of `getWaveformData` follow [Peaks.js](https://github.com/bbc/peaks.js/blob/master/doc/API.md#instancegetwaveformdata), whose WaveformData exposes per-channel min/max. We also checked [BBC waveform-data.js](https://github.com/bbc/waveform-data.js/blob/master/doc/API.md) and [audiowaveform](https://github.com/bbc/audiowaveform), which can render a single PNG from previously generated waveform data. `renderWaveform` is this library's standalone rendering name, not a claimed shared method name. The adaptation preserves this library's MediaInput, AbortSignal and owned results, with the agreed Float32 representation; it does not claim BBC JSON/binary compatibility. [wavesurfer](https://wavesurfer.xyz/docs/classes/wavesurfer.default) was checked too: its `exportPeaks` has one signed peak per bin, and its `exportImage` returns an image list, so neither operation is copied with a misleading result shape.

This contract adds separate audio analysis and rendering; it does not change conversion settings or thumbnail timing. Probe remains a source-facts operation, not a decoding-capability report. No probe time range or deep packet statistics are added.
