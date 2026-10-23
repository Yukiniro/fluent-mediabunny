# media

`media(source)` returns a `MediaBuilder` for one input and one output. `source` is a `MediaInput`.

```ts
function media(source: MediaInput): MediaBuilder;
```

## MediaBuilder

Each method below returns a new `MediaBuilder`. The receiver does not change.

| Method     | Argument                                                                    | Effect                                               |
| ---------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| `format`   | `"mp4"`, `"webm"`, `"m4a"`, or `"wav"`                                      | Sets the container. Required before `run`.           |
| `mode`     | `"auto"`, `"copy"`, or `"transcode"`                                        | Defaults to `"auto"`.                                |
| `trim`     | `{ start: number; end?: number }`                                           | `start` may be 0. `end` must exceed `start`.         |
| `resize`   | `{ width?: number; height?: number; fit?: "contain" \| "cover" \| "fill" }` | Even positive integers. `fit` needs both dimensions. |
| `crop`     | `{ x: number; y: number; width: number; height: number }`                   | Integers. `x` and `y` may be 0.                      |
| `rotate`   | `0`, `90`, `180`, or `270`                                                  | Applied before crop and resize.                      |
| `video`    | `VideoOptions`                                                              | Merges. Bitrate and quality are exclusive.           |
| `audio`    | `AudioOptions`                                                              | Merges. WAV rejects bitrate and quality.             |
| `tracks`   | `{ video?: TrackSelection; audio?: TrackSelection }`                        | Merges. Default selection is `"all"`.                |
| `metadata` | `MetadataPatch`, optional `{ mode?: "merge" \| "replace" }`                 | Default mode is `"merge"`.                           |

`VideoOptions` is `{ codec?: "avc" \| "vp8" \| "vp9"; bitrate?: number; quality?: Quality; frameRate?: number }`.

`AudioOptions` is `{ codec?: "aac" \| "opus" \| "pcm-s16" \| "pcm-s24" \| "pcm-f32"; bitrate?: number; quality?: Quality; sampleRate?: number; channels?: number }`.

`Quality` is `"low"`, `"medium"`, or `"high"`. `bitrate` is a positive integer. `frameRate` is a positive finite number. `sampleRate` and `channels` are positive integers.

`TrackSelection` is `"all"`, `"primary"`, `readonly number[]`, or `false`.

`MetadataPatch` assigns `string` or `null` to `title`, `artist`, `album`, `albumArtist`, `genre`, `comment`, `description`, or `date`. `null` or `""` removes a field. `date` is `YYYY-MM-DD`.

Encoders by format. Copy codecs are the extra set `mode("copy")` can keep.

| Format | Encode video | Encode audio                    | Copy video          | Copy audio                      |
| ------ | ------------ | ------------------------------- | ------------------- | ------------------------------- |
| `mp4`  | `avc`        | `aac`                           | `avc`, `hevc`       | `aac`                           |
| `webm` | `vp9`, `vp8` | `opus`                          | `vp8`, `vp9`, `av1` | `opus`, `vorbis`                |
| `m4a`  | none         | `aac`                           | none                | `aac`                           |
| `wav`  | none         | `pcm-s16`, `pcm-s24`, `pcm-f32` | none                | `pcm-s16`, `pcm-s24`, `pcm-f32` |

An omitted codec uses the first encode codec for that kind. A transcode with neither bitrate nor quality resolves quality to `"high"`, except WAV.

`"copy"` rejects trim, resize, crop, rotate, and video or audio options. An explicit trim forces transcode. M4A and WAV require one audio track and no video.

## run

```ts
run(options?: RunOptions & { target?: "blob" }): Promise<BlobResult>;
run(options: RunOptions & { target: FileTarget }): Promise<FileResult>;
run(options: RunOptions): Promise<MediaResult>;
```

`RunOptions` is `{ target?: "blob" | FileTarget; signal?: AbortSignal; onProgress?: (event: ProgressEvent) => void }`.

`FileTarget` is `{ type: "file"; handle: FileSystemFileHandle }`.

`ProgressEvent` is `{ phase: "preparing" | "processing" | "committing"; ratio: number | null }`.

`MediaResult` is `BlobResult | FileResult`.

## BlobResult

| Field               | Type                                |
| ------------------- | ----------------------------------- |
| `kind`              | `"blob"`                            |
| `blob`              | `Blob`                              |
| `mimeType`          | `string`                            |
| `size`              | `number`                            |
| `suggestedFilename` | `string`, `output.` plus the format |
| `report`            | `MediaReport`                       |

## FileResult

| Field         | Type                      |
| ------------- | ------------------------- |
| `kind`        | `"file"`                  |
| `filename`    | `string`, the handle name |
| `mimeType`    | `string`                  |
| `size`        | `number`                  |
| `commitState` | `"committed"`             |
| `report`      | `MediaReport`             |

`mimeType` is `audio/wav` for WAV, `audio/mp4` for M4A, `video/mp4` or `audio/mp4` for MP4, and `video/webm` or `audio/webm` for WebM. The video MIME is used when a selected track has type `"video"`.

## MediaReport

| Field            | Type                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `resolved`       | `{ format: Format; mode: Mode; tracks: ResolvedTrack[]; trim?: TrimOptions }` |
| `selected`       | `TrackInfo[]`                                                                 |
| `excludedByUser` | `TrackInfo[]`                                                                 |
| `metadata`       | `MetadataReport`                                                              |
| `warnings`       | `Warning[]`                                                                   |

`ResolvedTrack` is `TrackInfo` plus a string `codec`, and optional `quality`, `bitrate`, and `frameRate`. Resized video also reports `width` and `height`. Audio reports `sampleRate` and `channels`.

`MetadataReport` is `{ values: MetadataValues; removedByUser: MetadataField[]; omittedSourceFields: string[]; replacedSourceMetadata: boolean }`. Conversion does not write embedded pictures into the output. Read one from the source with [getEmbeddedPicture](/api/embedded-picture).

`Warning` is documented on [Errors](/api/errors). Its `code` is a string. Codes `run` assigns today are `METADATA_OMITTED`, `NON_AV_CONTENT_NOT_PRESERVED`, `FILENAME_EXTENSION_MISMATCH`, `CALLBACK_FAILED`, and `CLEANUP_FAILED`.
