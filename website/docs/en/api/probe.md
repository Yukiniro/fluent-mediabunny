# probe

`probe` reads a container without converting it.

```ts
function probe(source: MediaInput, options?: ProbeOptions): Promise<ProbeResult>;
```

`MediaInput` is `Blob | ArrayBuffer | Uint8Array<ArrayBuffer> | URL | string`. A string or `URL` must be an absolute `http` or `https` URL with no username and no password. Fetch uses CORS and omits credentials. There is no retry.

Accepted containers are MP4, QTFF, WebM, Matroska, MP3, WAVE, OGG, FLAC, and ADTS. An unrecognized container throws `UNSUPPORTED_INPUT`.

## ProbeOptions

| Field       | Type                     | Default                         |
| ----------- | ------------------------ | ------------------------------- |
| `signal`    | `AbortSignal`            | none                            |
| `duration`  | `"metadata"` or `"scan"` | metadata, by omitting the field |
| `tracks`    | `TracksOptions`          | all audio/video tracks          |
| `frameRate` | `"estimate"`             | disabled                        |

`"metadata"` reads `getDurationFromMetadata`. `"scan"` reads `computeDuration`. Unknown keys throw `INVALID_OPTIONS`.

## ProbeResult

| Field                 | Type                                      |
| --------------------- | ----------------------------------------- |
| `container`           | `string`, the format name                 |
| `durationSeconds`     | `number` or `null`                        |
| `durationOrigin`      | `"metadata"`, `"scanned"`, or `"unknown"` |
| `tracks`              | `ProbeTrackInfo[]`                        |
| `metadata`            | `MetadataValues`                          |
| `omittedSourceFields` | `string[]`                                |

`durationOrigin` is `"unknown"` when `durationSeconds` is `null`. It is `"scanned"` when `duration` is `"scan"`. Otherwise it is `"metadata"`.

`tracks` contains selected audio/video tracks in source order. Each media type accepts `"all"`, `"primary"`, a nonempty unique list of source track IDs, or `false`, as in conversion. Wrong-type/missing IDs fail `INVALID_OPTIONS`; no selected tracks fails `NO_TRACKS`. Container, top-level duration, and metadata still describe the complete input. Duration preserves the backend's maximum-end-timestamp meaning, rather than elapsed time of the selection. No time-range option is accepted.

`metadata` keeps supported fields that pass validation. `date` from a source `Date` is `YYYY-MM-DD`. Other source fields, and supported fields that fail validation, are names in `omittedSourceFields`. When the source exposes pictures, that list includes `"images"`. Read one picture with [getEmbeddedPicture](/api/embedded-picture).

## TrackInfo

| Field        | Type                   |
| ------------ | ---------------------- |
| `id`         | `number`               |
| `type`       | `"video"` or `"audio"` |
| `codec`      | `string` or `null`     |
| `width`      | `number`, video only   |
| `height`     | `number`, video only   |
| `sampleRate` | `number`, audio only   |
| `channels`   | `number`, audio only   |

Video `width` and `height` are display size. Read failures throw `READ_FAILED`. Aborting the signal throws `ABORTED`.

## ProbeTrackInfo

Probe now returns `ProbeTrackInfo[]`, extending the fields above. Conversion reports still use `TrackInfo`.

| Field                                   | Meaning                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `language`, `name`                      | Source language/name, or null; `und` becomes null                             |
| `isDefault`                             | Source default disposition                                                    |
| `peakBitrate`, `averageBitrate`         | Separate metadata bitrates in bits/s, or null; not measured packet statistics |
| `startTimestamp`, `endTimestamp`        | Source timestamps in seconds, or null; start can be negative                  |
| `durationSeconds`                       | Elapsed track time, `max(0, end - start)`, or null                            |
| `durationOrigin`                        | `"metadata"`, `"scanned"`, or `"unknown"`, following the duration option      |
| `codedWidth`, `codedHeight`, `rotation` | Video coded size and source rotation in degrees                               |
| `frameRate`, `frameRateOrigin`          | Video estimate or null; `"estimated"` or `"unknown"`                          |

`frameRate: "estimate"` samples a prefix targeting 256 packets using distinct presentation timestamps, without decoding. Reordering can require extra packets; this is not a byte/time budget. The estimate is average prefix frame rate, not proof of constant FPS. Without the option, or with insufficient timestamps, it is null. Empty tracks have unknown timing. Scan mode scans selected track ends as well as full input duration.

```ts
const info = await probe(file, {
  tracks: { video: "primary", audio: false },
  frameRate: "estimate",
});
```

To build an editor timeline, read [waveform data](/api/waveforms) separately. Probe reports source facts and never reports decoder availability. Track reads and cleanup finish before settlement, including after a failed concurrent read.
