---
title: media / MediaBuilder
description: Configure an immutable media conversion with format, encoding, track selection, geometry, and metadata methods.
---

# media / MediaBuilder {#media}

Build a conversion from one input to one output. Configuration is synchronous; media I/O starts when you call `run()`.

## Example

```ts
import { media } from "fluentbunny";

const base = media(file).format("mp4");
const preview = base.resize({ width: 1280 });
const result = await preview.run();
```

`file` is a browser `File`. `base` keeps its original settings, so it can be reused for another output.

## Signature

```ts
function media(source: MediaInput): MediaBuilder;

class MediaBuilder {
  constructor(source: MediaInput);
}
```

| Parameter | Type                                | Description                                                                                     |
| --------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `source`  | [MediaInput](/api/probe#mediainput) | A blob, byte buffer, or absolute HTTP(S) URL. Keep source bytes stable until execution settles. |

**Returns:** a `MediaBuilder`. `new MediaBuilder(source)` is also supported. Invalid source forms throw `MediaError` synchronously.

## MediaBuilder

Every configuration method returns a **new** `MediaBuilder`. Methods validate arguments without opening the input. Options must be plain objects; unknown keys fail.

| Methods                                              | Repeated calls                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `format`, `mode`, `trim`, `resize`, `crop`, `rotate` | Replace the previous setting                                                 |
| `video`, `audio`, `tracks`                           | Merge supplied fields; empty objects and `undefined` fields do not overwrite |
| `metadata`                                           | Replace the entire metadata instruction, including its mode                  |

### format

```ts
format(value: Format): MediaBuilder;
type Format = "mp4" | "webm" | "m4a" | "wav";
```

Required before `run()`. The first encode codec listed for each format is the default. Copy mode can preserve the additional source codecs in the last two columns.

| Format | Encode video | Encode audio                    | Copy video          | Copy audio                      |
| ------ | ------------ | ------------------------------- | ------------------- | ------------------------------- |
| `mp4`  | `avc`        | `aac`                           | `avc`, `hevc`       | `aac`                           |
| `webm` | `vp9`, `vp8` | `opus`                          | `vp8`, `vp9`, `av1` | `opus`, `vorbis`                |
| `m4a`  | None         | `aac`                           | None                | `aac`                           |
| `wav`  | None         | `pcm-s16`, `pcm-s24`, `pcm-f32` | None                | `pcm-s16`, `pcm-s24`, `pcm-f32` |

M4A and WAV need exactly one audio track and no video. Exclude video explicitly with `tracks({ video: false, audio: "primary" })`. An incompatible explicit codec rejects `run()` with `UNSUPPORTED_OUTPUT_COMBINATION`.

### mode

```ts
mode(value: Mode): MediaBuilder;
type Mode = "auto" | "copy" | "transcode";
```

| Value              | Behavior                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `"auto"` (default) | Resolve the explicit or format-default codec; copy compatible tracks when settings allow, otherwise transcode. |
| `"copy"`           | Preserve every selected track's codec. Reject if any selected track cannot be copied.                          |
| `"transcode"`      | Decode and encode every selected track.                                                                        |

Copy mode rejects trim, resize, crop, nonzero rotation, and nonempty video/audio options. `rotate(0)` is allowed. Every explicit trim forces transcoding, including in auto mode. Unavailable decoding or exact encoding configurations fail with `CODEC_UNAVAILABLE`; they are not substituted.

### trim

```ts
trim(options: TrimOptions): MediaBuilder;
type TrimOptions = { start: number; end?: number };
```

| Field   | Required | Description                                                                          |
| ------- | -------- | ------------------------------------------------------------------------------------ |
| `start` | Yes      | Finite seconds, at least 0.                                                          |
| `end`   | No       | Finite seconds greater than `start`. Omit to keep the rest of the selected timeline. |

Times are relative to `max(0, min(selected first timestamps))`. A start at or beyond the selected end, or an end beyond it, rejects execution with `INVALID_OPTIONS`. Trim normalizes output time and preserves inter-track offsets within sample precision.

### resize

```ts
resize(options: ResizeOptions): MediaBuilder;
type ResizeOptions = {
  width?: number;
  height?: number;
  fit?: "contain" | "cover" | "fill";
};
```

| Field             | Description                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `width`, `height` | Positive even integers in pixels. Supply at least one. Upscaling is allowed.                                                                 |
| `fit`             | Required when both dimensions are supplied; forbidden when only one is supplied. `contain` letterboxes, `cover` crops, and `fill` stretches. |

A single dimension preserves aspect ratio and infers the other with `2 * ceil(round(size) / 2)`. Geometry applies in this order, regardless of call order: source orientation and flip, additional rotation, crop, then resize.

### crop

```ts
crop(options: CropOptions): MediaBuilder;
type CropOptions = { x: number; y: number; width: number; height: number };
```

`x` and `y` are nonnegative integers in pixels; `width` and `height` are positive integers. The rectangle must fit inside the frame after rotation. A 90° or 270° rotation swaps its axes.

### rotate

```ts
rotate(degrees: 0 | 90 | 180 | 270): MediaBuilder;
```

Apply an additional rotation before crop and resize. Omit it, or pass `0`, to leave the source orientation unchanged.

### video

```ts
video(options: VideoOptions): MediaBuilder;
type VideoOptions = {
  codec?: "avc" | "vp8" | "vp9";
  bitrate?: number;
  quality?: Quality;
  frameRate?: number;
  keyFrameInterval?: number;
};
type Quality = "low" | "medium" | "high";
```

| Field              | Default                                   | Description                                                                       |
| ------------------ | ----------------------------------------- | --------------------------------------------------------------------------------- |
| `codec`            | First video codec for the format          | Must be compatible with the output format.                                        |
| `bitrate`          | Unset                                     | Positive safe integer, in bits per second. Mutually exclusive with `quality`.     |
| `quality`          | `"high"` when transcoding without bitrate | A quality preset. An explicit preset forces transcoding.                          |
| `frameRate`        | Source behavior                           | Positive finite frames per second.                                                |
| `keyFrameInterval` | Encoder fallback                          | Finite seconds between key frames, at least 0. `0` makes every frame a key frame. |

Setting bitrate in a later call removes a previous quality setting, and the reverse. Setting `keyFrameInterval`, including `0`, forces video transcoding; audio tracks still copy when they can. When it is omitted, the encoder chooses; Mediabunny 1.62.1 currently falls back to 2 seconds. The interval is a request to the encoder, not a promise of exact key-frame timestamps. A later `video()` call keeps the stored interval unless it passes a new number; `undefined` does not clear it. Video options require a selected video track. Video transcoding rejects changing frame dimensions; AVC transcoding also requires a stable avcC configuration across the source, including outside a trim.

### audio

```ts
audio(options: AudioOptions): MediaBuilder;
type AudioOptions = {
  codec?: "aac" | "opus" | "pcm-s16" | "pcm-s24" | "pcm-f32";
  bitrate?: number;
  quality?: Quality;
  sampleRate?: number;
  channels?: number;
};
```

| Field                | Default                          | Description                                                                    |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| `codec`              | First audio codec for the format | Must be compatible with the output format.                                     |
| `bitrate`, `quality` | Same as video, except WAV        | Mutually exclusive; a later call replaces the other setting. WAV rejects both. |
| `sampleRate`         | Source sample rate               | Positive safe integer, in hertz.                                               |
| `channels`           | Source channel count             | Positive safe integer.                                                         |

Audio options require a selected audio track. Requested sample rate and channel count are checked without silent substitution.

### tracks

```ts
tracks(options: TracksOptions): MediaBuilder;
type TracksOptions = { video?: TrackSelection; audio?: TrackSelection };
type TrackSelection = "all" | "primary" | readonly number[] | false;
```

`video` and `audio` both default to `"all"`. Use `"primary"` for Mediabunny's primary track, `false` to exclude a media type, or a nonempty list of unique nonnegative safe-integer track IDs from [probe](/api/probe). IDs are not array indices and must exist for that media type.

An empty final selection rejects with `NO_TRACKS`. A format that cannot retain all selected tracks rejects with `TRACK_LOSS`. Non-audio/video content is outside this preservation guarantee and can produce a warning.

### metadata

```ts
metadata(patch: MetadataPatch, options?: MetadataOptions): MediaBuilder;
type MetadataOptions = { mode?: "merge" | "replace" };
type MetadataPatch = Partial<Record<MetadataField, string | null>>;
type MetadataField =
  | "title" | "artist" | "album" | "albumArtist"
  | "genre" | "comment" | "description" | "date";
```

| Value or option              | Behavior                                           |
| ---------------------------- | -------------------------------------------------- |
| `mode: "merge"` (default)    | Apply the patch over valid, supported source tags. |
| `mode: "replace"`            | Write only nonempty patch values.                  |
| Field set to `null` or `""`  | Remove the field.                                  |
| Omitted or `undefined` field | Supply no override.                                |
| `date`                       | A valid `YYYY-MM-DD` date, years 0001–9999.        |

Text preserves whitespace and Unicode; NUL and unpaired surrogates fail validation. Unknown metadata fields throw `UNSUPPORTED_METADATA_FIELD`. Embedded images are not written into the output; use [getEmbeddedPicture](/api/embedded-picture) to read one separately.

## run

Execute the configured conversion with [`run(options?)`](/api/run). It returns a promise and owns independent resources on each call.

## BlobResult

The default output contains `blob`, `mimeType`, `size`, `suggestedFilename`, and `report`. See [BlobResult](/api/run#blobresult) for fields and units.

## FileResult

A file target resolves only after closing successfully. See [FileResult](/api/run#fileresult) for the committed result.

## MediaReport

Every successful conversion includes resolved settings, selected and excluded tracks, metadata changes, and warnings. See [MediaReport](/api/run#mediareport).
