# Audio waveforms

```ts
import { getWaveformData, renderWaveform } from "fluent-mediabunny";

const data = await getWaveformData(file, { pointsPerSecond: 50 });
const image = await renderWaveform(data, {
  width: 800,
  height: 160,
  color: "#4477ee",
  backgroundColor: "#00000000",
});
const url = URL.createObjectURL(image.blob);
// Revoke url after the application no longer needs it.
```

## getWaveformData

`getWaveformData(source: MediaInput, options?: WaveformOptions): Promise<WaveformData>` uses the [shared input contract](/api/probe). It processes one audio track independently of conversion settings.

| Option            | Default             | Rule                                                             |
| ----------------- | ------------------- | ---------------------------------------------------------------- |
| `track`           | `"primary"`         | Primary audio or a source audio ID from probe                    |
| `start`           | 0                   | Nonnegative finite seconds, rounded to safe integer microseconds |
| `end`             | Decode to audio end | Optional finite seconds greater than start after rounding        |
| `pointsPerSecond` | 50                  | Positive finite output bins per second                           |
| `signal`          | none                | AbortSignal                                                      |

The time origin matches thumbnails: `max(0, input.getFirstTimestamp())`, across the entire source. Track offsets and gaps remain in place. Ranges are half-open, including PCM cropping within decoded chunks. Explicit uncovered time is padded with zero. Without end there is no preliminary duration scan; start at/after decoded end fails `INVALID_OPTIONS`.

`WaveformData` contains `trackId`, `timeOriginSeconds`, `start`, `end`, `pointsPerSecond`, and `channels: WaveformChannel[]`. Each channel owns independent Float32 arrays `min` and `max`. Bin i covers `[start + i / pointsPerSecond, min(end, start + (i + 1) / pointsPerSecond))`. Length is the ceiling of microsecond-rounded duration times pointsPerSecond. The last bin can be partial. Extrema include zero for uncovered portions, without normalization or clipping; opposite-phase channels remain separate.

Audio is decoded incrementally and each sample is released. Result arrays total at most 64 MiB (`OUTPUT_TOO_LARGE`); this does not bound decoder memory, input retention or temporary growth/copy buffers. Four hours, two channels and 50 points/s yield 11,520,000 result bytes. Actual sample rates determine timing; changing channel count or non-finite PCM fails `UNSUPPORTED_INPUT`. No audio or an empty track fails `NO_TRACKS`; unavailable decoding fails `CODEC_UNAVAILABLE`.

## renderWaveform

`renderWaveform(data: WaveformData, options: WaveformImageOptions): Promise<WaveformImage>` reads only supplied data and returns one PNG, with no repeated media decoding.

| Option            | Default     | Rule                                                                                         |
| ----------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `width`, `height` | required    | Positive integers, at most 4096 each, area at most 16,000,000; height at least channel count |
| `start`, `end`    | Data bounds | Nonempty interval inside the data, using the same time coordinates                           |
| `color`           | `#000000`   | `#RRGGBB` or `#RRGGBBAA`                                                                     |
| `backgroundColor` | `#00000000` | Same hex formats; transparent by default                                                     |
| `signal`          | none        | AbortSignal                                                                                  |

The request expands outward to complete intersecting bins, clipped to the data bounds. `WaveformImage` contains `blob`, `mimeType: "image/png"`, `width`, `height`, and actual coverage `start`/`end`. Channels occupy separate vertical lanes; amplitudes clip to ±1 only when drawing, and silence is a one-pixel center line. Smaller images aggregate extrema; larger images reuse bins without adding detail.

Rendering accepts matching, non-shared Float32 arrays with finite extrema and min <= max, consistent timing and resolution, and total arrays no larger than 64 MiB. Keep data stable until completion. OffscreenCanvas is preferred with DOM canvas fallback. Missing rendering/PNG support or substituted MIME fails `IMAGE_ENCODING_UNAVAILABLE`; empty encoding fails `PROCESSING_FAILED`. There are no axes, labels, gradients or file-export options.

## Cancellation and ownership

Unknown/invalid options or malformed data fail `INVALID_OPTIONS`. Both operations validate static inputs before observing cancellation. Valid pre-aborted calls perform no media I/O or canvas allocation. Cancellation rejects `ABORTED`, waits for in-flight work and cleanup, and discards late results. First failure wins; later errors are diagnostics. Cleanup-only failures reject `PROCESSING_FAILED`. There are no successful partial results or fixed cancellation latency guarantees.

Returned arrays and Blob are owned results. Applications manage Workers, saving, serialization and object URLs. The APIs add no cache, automatic Worker or codec fallback. See [errors](/api/errors).
