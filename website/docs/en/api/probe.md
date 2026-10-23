---
title: probe
description: Inspect a media container, duration, audio/video tracks, and supported text metadata without converting it.
---

# probe

Read container information and metadata without converting or decoding media. Codec names describe the source, not the current browser's ability to decode it.

## Example

```ts
import { probe } from "fluentbunny";

const info = await probe(file, { duration: "scan" });
console.log(info.container, info.durationSeconds);

for (const track of info.tracks) {
  console.log(track.id, track.type, track.codec);
}
```

`file` is a browser `File`. Omit `duration: "scan"` to read only the duration available in container metadata.

## Signature

```ts
function probe(source: MediaInput, options?: ProbeOptions): Promise<ProbeResult>;
```

| Parameter | Type           | Required | Description                                          |
| --------- | -------------- | -------- | ---------------------------------------------------- |
| `source`  | `MediaInput`   | Yes      | Source media, using the shared input contract below. |
| `options` | `ProbeOptions` | No       | Duration strategy and cancellation.                  |

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

| Field      | Type                   | Default      | Description                                                                                                                   |
| ---------- | ---------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `duration` | `"metadata" \| "scan"` | `"metadata"` | Read stored duration using `getDurationFromMetadata`, or scan using `computeDuration`. Scanning may require more input reads. |
| `signal`   | `AbortSignal`          | Unset        | Cancel the read with `ABORTED`.                                                                                               |

Unknown option keys reject with `INVALID_OPTIONS`. Each invocation disposes its input before settling.

## ProbeResult

| Field                 | Type                                   | Description                                                       |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `container`           | `string`                               | Recognized format name.                                           |
| `durationSeconds`     | `number \| null`                       | Duration in seconds; `null` means unknown, not zero.              |
| `durationOrigin`      | `"metadata" \| "scanned" \| "unknown"` | How duration was obtained; `"unknown"` when duration is `null`.   |
| `tracks`              | `TrackInfo[]`                          | Audio and video source tracks. Other track types are omitted.     |
| `metadata`            | `MetadataValues`                       | Valid supported text fields. See [metadata](/api/media#metadata). |
| `omittedSourceFields` | `string[]`                             | Names of unsupported or invalid source metadata fields.           |

Source `Date` values use their UTC `YYYY-MM-DD` date. When metadata exposes pictures, `omittedSourceFields` includes `"images"`; read a picture separately with [getEmbeddedPicture](/api/embedded-picture).

## TrackInfo

| Field             | Type                 | Description                                                      |
| ----------------- | -------------------- | ---------------------------------------------------------------- |
| `id`              | `number`             | Source track ID, not an array index. Use it for track selection. |
| `type`            | `"video" \| "audio"` | Media type.                                                      |
| `codec`           | `string \| null`     | Recognized codec name, or `null` if unknown.                     |
| `width`, `height` | `number`, optional   | Video display size in pixels; absent for audio.                  |
| `sampleRate`      | `number`, optional   | Audio sample rate in hertz; absent for video.                    |
| `channels`        | `number`, optional   | Audio channel count; absent for video.                           |

## Errors

| Code                | Cause                                                    |
| ------------------- | -------------------------------------------------------- |
| `INVALID_OPTIONS`   | Invalid options or empty `ArrayBuffer`.                  |
| `UNSUPPORTED_INPUT` | Unsupported source form, URL, or unrecognized container. |
| `READ_FAILED`       | Fetch, container, track, or metadata read failed.        |
| `ABORTED`           | Cancellation was observed before resolution.             |

Failures reject with [MediaError](/api/errors). An unknown duration is a successful result with `durationSeconds: null`.
