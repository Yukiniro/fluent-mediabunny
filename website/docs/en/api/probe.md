# probe

`probe` reads a container without converting it.

```ts
function probe(source: MediaInput, options?: ProbeOptions): Promise<ProbeResult>;
```

`MediaInput` is `Blob | ArrayBuffer | Uint8Array<ArrayBuffer> | URL | string`. A string or `URL` must be an absolute `http` or `https` URL with no username and no password. Fetch uses CORS and omits credentials. There is no retry.

Accepted containers are MP4, QTFF, WebM, Matroska, MP3, WAVE, OGG, FLAC, and ADTS. An unrecognized container throws `UNSUPPORTED_INPUT`.

## ProbeOptions

| Field      | Type                     | Default                         |
| ---------- | ------------------------ | ------------------------------- |
| `signal`   | `AbortSignal`            | none                            |
| `duration` | `"metadata"` or `"scan"` | metadata, by omitting the field |

`"metadata"` reads `getDurationFromMetadata`. `"scan"` reads `computeDuration`. Unknown keys throw `INVALID_OPTIONS`.

## ProbeResult

| Field                 | Type                                      |
| --------------------- | ----------------------------------------- |
| `container`           | `string`, the format name                 |
| `durationSeconds`     | `number` or `null`                        |
| `durationOrigin`      | `"metadata"`, `"scanned"`, or `"unknown"` |
| `tracks`              | `TrackInfo[]`                             |
| `metadata`            | `MetadataValues`                          |
| `omittedSourceFields` | `string[]`                                |

`durationOrigin` is `"unknown"` when `durationSeconds` is `null`. It is `"scanned"` when `duration` is `"scan"`. Otherwise it is `"metadata"`.

`tracks` contains audio and video tracks only. Other tracks are omitted.

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
