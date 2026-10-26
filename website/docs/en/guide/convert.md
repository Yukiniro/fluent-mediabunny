---
title: Convert a file
description: Convert media with format selection, copy or transcode modes, trimming, geometry, tracks, and metadata.
---

# Convert a file

`media(source)` returns a `MediaBuilder`. Each method returns a new builder and leaves the one you called unchanged. Call `format` before `run`. The default mode is `"auto"`, and both video and audio default to every track.

The field list is on [media](/api/media). Failures reject with [MediaError](/api/errors).

## Set the format

Pass `"mp4"`, `"webm"`, `"m4a"`, `"wav"`, or `"ogg"`.

```ts
media(file).format("webm");
```

MP4 encodes `avc` and `aac`. WebM encodes `vp9` or `vp8`, and `opus`. M4A encodes `aac` and no video. WAV encodes `pcm-s16`, `pcm-s24`, or `pcm-f32`, and no video. Ogg encodes `opus` and no video. A codec outside that set throws `UNSUPPORTED_OUTPUT_COMBINATION`. When you omit the codec, a transcode uses the first of those codecs.

## Set the mode

```ts
media(file).format("mp4").mode("copy");
```

`"auto"` resolves the explicit or format-default codec, then copies compatible tracks when the processing settings allow it and transcodes the rest. `"transcode"` decodes and encodes every selected track. `"copy"` copies every selected track and rejects `trim`, `resize`, `crop`, nonzero `rotate`, a `flip` axis set to `true`, and nonempty video or audio options. `rotate(0)` and `flip` with both axes `false` are allowed.

Copy can keep `avc` and `hevc` in MP4, `aac` in MP4 or M4A, `vp8`, `vp9`, and `av1` in WebM, `opus` and `vorbis` in WebM or Ogg, and `pcm-s16`, `pcm-s24`, and `pcm-f32` in WAV. Anything else in copy mode throws `COPY_NOT_POSSIBLE`.

An explicit `trim` transcodes every selected track, including in `"auto"`.

## Trim the timeline

`start` is seconds and may be zero. `end` must be greater than `start`. Omit `end` to keep the rest of the timeline.

```ts
media(file).format("webm").trim({ start: 2, end: 12 });
```

Both values are added to the earliest selected-track origin, `max(0, min(first timestamps))`. A range outside that timeline throws `INVALID_OPTIONS`.

## Resize the picture

`width` and `height` are positive even integers. Pass at least one. `fit` is `"contain"`, `"cover"`, or `"fill"`, and it is required when both dimensions are set and forbidden otherwise. One dimension keeps the aspect ratio and rounds the other dimension up to an even number.

```ts
media(file).format("mp4").resize({ width: 1280 });
media(file).format("mp4").resize({ width: 1280, height: 720, fit: "contain" });
```

## Crop the picture

`x`, `y`, `width`, and `height` are integers. `x` and `y` may be zero. `width` and `height` are positive. The rectangle is applied after a 90 or 270 degree rotation swaps the frame axes, and it must lie inside that frame.

```ts
media(file).format("mp4").crop({ x: 0, y: 0, width: 640, height: 360 });
```

## Rotate the picture

Pass `0`, `90`, `180`, or `270`. Rotation is applied before crop and resize.

```ts
media(file).format("mp4").rotate(90);
```

## Flip the picture

Pass `horizontal`, `vertical`, or both. A later call changes only the axes you set. The flip runs after rotation and before crop. A vertical flip is a horizontal flip plus 180 degrees.

```ts
media(file).format("mp4").flip({ horizontal: true }).flip({ vertical: true });
```

## Set the video encoding

`codec` is `"avc"`, `"vp8"`, or `"vp9"`. `bitrate` is a positive integer. `quality` is `"low"`, `"medium"`, or `"high"`. Set bitrate or quality, not both. A later `video` call replaces a previous bitrate with quality, and the reverse. `frameRate` is a positive finite number. Calls merge onto the previous video options.

```ts
media(file).format("mp4").video({ codec: "avc", quality: "high", frameRate: 30 });
```

When a transcode sets neither bitrate nor quality, the resolved quality is `"high"`.

`keyFrameInterval` is the number of seconds between key frames. It is a finite number and may be zero. `0` makes every frame a key frame. Setting it re-encodes the video, even in `"auto"` mode, and audio still copies when it can. Omit it to let the encoder choose. Mediabunny 1.62.1 currently falls back to 2 seconds. The value is a request to the encoder, so this library does not promise key frames at exact timestamps.

```ts
media(file).format("webm").video({ keyFrameInterval: 2 });
```

## Set the audio encoding

`codec` is `"aac"`, `"opus"`, `"pcm-s16"`, `"pcm-s24"`, or `"pcm-f32"`. `sampleRate` and `channels` are positive integers. The same bitrate and quality rules as video apply. WAV rejects bitrate and quality. Calls merge onto the previous audio options.

```ts
media(file).format("webm").audio({ codec: "opus", channels: 2 });
```

## Select tracks

`video` and `audio` each take `"all"`, `"primary"`, a nonempty list of unique track ids, or `false`. The default is `"all"`. Ids are integers, may be zero, and must exist for that media type.

```ts
media(file)
  .format("mp4")
  .tracks({ video: "primary", audio: [1] });
```

M4A, WAV, and Ogg need exactly one audio track and no video. Drop video and pick one audio track.

```ts
media(file).format("m4a").tracks({ video: false, audio: "primary" });
```

Do not pass video options, crop, resize, or rotate when no video track is selected. Do not pass audio options when no audio track is selected. An empty selection throws `NO_TRACKS`. A format that cannot hold every selected track throws `TRACK_LOSS`.

## Edit metadata

Fields are `title`, `artist`, `album`, `albumArtist`, `genre`, `comment`, `description`, and `date`. `date` is `YYYY-MM-DD` from year 0001 through 9999. `null` or `""` removes a field. Any other name throws `UNSUPPORTED_METADATA_FIELD`.

```ts
media(file).format("mp4").metadata({ title: "Clip", date: "2026-10-22" });
media(file).format("mp4").metadata({ comment: null }, { mode: "replace" });
```

`mode` defaults to `"merge"`. Merge keeps supported source tags you did not set. `"replace"` writes only the patch. Unsupported source tags are omitted. The report can include a `METADATA_OMITTED` warning.

## Run the task

No target, or `target: "blob"`, returns a blob. `suggestedFilename` is `output.<format>`.

```ts
const result = await media(file)
  .format("webm")
  .trim({ start: 2, end: 12 })
  .resize({ width: 1280 })
  .run();

result.report.resolved;
result.report.selected;
result.report.excludedByUser;
result.report.metadata;
result.report.warnings;
```

To write a file, pass a handle that already has read and write permission. This library does not open a picker and does not request permission.

```ts
await media(file)
  .format("mp4")
  .run({
    target: { type: "file", handle },
    signal,
    onProgress(event) {
      event.phase;
      event.ratio;
    },
  });
```

`phase` is `"preparing"`, `"processing"`, or `"committing"`. `ratio` is a number from 0 to 1, or `null`. Progress during `"processing"` does not mean the file is saved. Cancel before commit and the opened stream is aborted. After commit starts, the run waits for the file to close.

`onProgress` must be a function. If it throws or returns a promise, later progress is skipped and the report gets a `CALLBACK_FAILED` warning.

A failed file run sets `targetState` on the error to `"untouched"`, `"aborted"`, or `"unknown"`. [Choose inputs and outputs](/guide/inputs-and-outputs) covers those states.

Non-audio and non-video tracks are omitted and can add a `NON_AV_CONTENT_NOT_PRESERVED` warning. A file name that does not end with the format can add `FILENAME_EXTENSION_MISMATCH`.
