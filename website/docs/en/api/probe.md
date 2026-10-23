---
title: probe
description: Inspect a container, duration, selected tracks, timing, size, bitrate, and text metadata without converting.
---

# probe

Read container information and metadata without converting or decoding media. Codec names describe the source, not the current browser's ability to decode it.

## Example

```ts
import { probe } from "fluentbunny";

const info = await probe(file, { video: "primary", frameRate: "estimate" });
console.log(info.container, info.durationSeconds);

for (const track of info.tracks) {
  console.log(track.id, track.type, track.startSeconds, track.peakBitrate);
}
```

`file` is a browser `File`. The default reads every audio and video track and leaves `frameRate.hertz` null. `duration: "scan"` also scans duration instead of reading only container metadata.

## Signature

```ts
function probe(source: MediaInput, options?: ProbeOptions): Promise<ProbeResult>;
```

| Parameter | Type           | Required | Description                                          |
| --------- | -------------- | -------- | ---------------------------------------------------- |
| `source`  | `MediaInput`   | Yes      | Source media, using the shared input contract below. |
| `options` | `ProbeOptions` | No       | Duration, track selection, frame-rate estimate, and cancellation. |

## MediaInput

```ts
type MediaInput = Blob | ArrayBuffer | Uint8Array<ArrayBuffer> | URL | string;
```

| Input                     | Requirements                                                                 |
| ------------------------- | ---------------------------------------------------------------------------- |
| `File` / `Blob`           | A browser file or blob; `File` extends `Blob`.                               |
| `ArrayBuffer`             | Nonempty. An empty buffer throws `INVALID_OPTIONS`.                          |
| `Uint8Array<ArrayBuffer>` | Nonempty, backed by `ArrayBuffer`. An empty view throws `UNSUPPORTED_INPUT`. |
| `URL` / `string`          | Absolute `http:` or `https:` URL, without username or password.              |

Remote reads use CORS, omit credentials, and do not retry. URL objects are snapshotted as strings. Byte input is neither copied nor modified; keep it and remote content stable until completion. File paths and `SharedArrayBuffer` are not supported.

Accepted containers are MP4, QTFF, WebM, Matroska, MP3, WAVE, OGG, FLAC, and ADTS. An unrecognized container rejects with `UNSUPPORTED_INPUT`.

## ProbeOptions

| Field       | Type                                         | Default      | Description                                                                                                                    |
| ----------- | ------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `duration`  | `"metadata" \| "scan"`                           | `"metadata"` | Read stored duration with `getDurationFromMetadata`, or scan with `computeDuration`. `"scan"` also scans each selected track end. |
| `video`     | [TrackSelection](/api/media#tracks)              | `"all"`      | Which video tracks appear in `tracks`.                                                                                         |
| `audio`     | [TrackSelection](/api/media#tracks)              | `"all"`      | Which audio tracks appear in `tracks`.                                                                                         |
| `frameRate` | `"estimate"`                                     | Unset        | Estimate video frame rate from the first 256 packets. Omit it to leave the rate unknown.                                      |
| `signal`    | `AbortSignal`                                    | Unset        | Cancel the read with `ABORTED`.                                                                                                |

Unknown option keys reject with `INVALID_OPTIONS`. Each invocation disposes its input before settling.

## ProbeResult

| Field                 | Type                                   | Description                                                       |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `container`           | `string`                               | Recognized format name.                                           |
| `durationSeconds`     | `number \| null`                       | Duration in seconds; `null` means unknown, not zero.              |
| `durationOrigin`      | `"metadata" \| "scanned" \| "unknown"` | How duration was obtained; `"unknown"` when duration is `null`.   |
| `tracks`              | `ProbeTrack[]`                         | Selected audio and video tracks, in source order. Other types are omitted. |
| `metadata`            | `MetadataValues`                       | Valid supported text fields. See [metadata](/api/media#metadata). |
| `omittedSourceFields` | `string[]`                             | Names of unsupported or invalid source metadata fields.           |

Source `Date` values use their UTC `YYYY-MM-DD` date. When metadata exposes pictures, `omittedSourceFields` includes `"images"`; read a picture separately with [getEmbeddedPicture](/api/embedded-picture).

Track selection does not change `container`, `durationSeconds`, `durationOrigin`, `metadata`, or `omittedSourceFields`. An empty selection returns `tracks: []`.

## TrackInfo

`TrackInfo` is the track shape used by conversion reports. A probe track includes these fields and the facts below. Probe-only facts are not written back into a conversion report.

| Field             | Type                 | Description                                                      |
| ----------------- | -------------------- | ---------------------------------------------------------------- |
| `id`              | `number`             | Source track ID, not an array index. Use it for track selection. |
| `type`            | `"video" \| "audio"` | Media type.                                                      |
| `codec`           | `string \| null`     | Recognized codec name, or `null` if unknown.                     |
| `width`, `height` | `number`, optional   | Video display size in pixels. Probe video always includes both.  |
| `sampleRate`      | `number`, optional   | Audio sample rate in hertz. Probe audio always includes it.      |
| `channels`        | `number`, optional   | Audio channel count. Probe audio always includes it.             |

## ProbeTrack

`ProbeTrack` is `ProbeVideoTrack` or `ProbeAudioTrack`. Both include this timing.

| Field                            | Type             | Description                                                                                          |
| -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `startSeconds`                   | `number \| null` | First packet timestamp. `null` when the track has no packet. A missing packet is not reported as 0. |
| `endSeconds`                     | `number \| null` | Track end timestamp from metadata, or from a scan when `duration` is `"scan"`.                       |
| `elapsedSeconds`                 | `number \| null` | `endSeconds - startSeconds` when both are known. Otherwise `null`.                                   |
| `default`                        | `boolean`        | Whether the container marks the track as default.                                                    |
| `averageBitrate`, `peakBitrate`  | `number \| null` | Metadata bitrates in bits per second. `null` means unknown.                                          |

### ProbeVideoTrack

| Field                    | Type                         | Description                                                                                          |
| ------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `codedWidth`, `codedHeight` | `number`                  | Coded sample size in pixels.                                                                         |
| `rotation`               | `0 \| 90 \| 180 \| 270`      | Source rotation in degrees.                                                                          |
| `frameRate`              | `ProbeFrameRate`             | `{ hertz: null, origin: "unknown" }` unless `frameRate: "estimate"` finds two distinct timestamps.   |

`ProbeFrameRate` is `{ hertz: number; origin: "estimated" }` or `{ hertz: null; origin: "unknown" }`. The estimate uses at most the first 256 packets. It is not proof that the whole file has a constant frame rate. Insufficient timestamps stay unknown.

### ProbeAudioTrack

| Field              | Type             | Description                                                     |
| ------------------ | ---------------- | --------------------------------------------------------------- |
| `language`         | `string \| null` | Container language code. `null` when omitted or stored as `und`. |
| `name`             | `string \| null` | Container track name. `null` when the container has no name.    |

## Errors

| Code                | Cause                                                    |
| ------------------- | -------------------------------------------------------- |
| `INVALID_OPTIONS`   | Invalid options or empty `ArrayBuffer`.                  |
| `UNSUPPORTED_INPUT` | Unsupported source form, URL, or unrecognized container. |
| `READ_FAILED`       | Fetch, container, track, or metadata read failed.        |
| `ABORTED`           | Cancellation was observed before resolution.             |

Failures reject with [MediaError](/api/errors). An unknown duration is a successful result with `durationSeconds: null`.
