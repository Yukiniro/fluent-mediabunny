---
title: Introduction
description: Convert media, inspect tracks, draw audio waveforms, extract video frames, and read embedded pictures in a browser with fluentbunny.
---

# fluentbunny

A fluent TypeScript API for converting media, inspecting tracks, drawing audio waveforms, extracting video frames, and reading embedded pictures in the browser. Powered by [Mediabunny](https://mediabunny.dev/).

## Start with a media task

```ts title="Convert a video"
import { media } from "fluentbunny";

const result = await media(file)
  .format("webm")
  .trim({ start: 2, end: 12 })
  .resize({ width: 1280 })
  .run();

const previewUrl = URL.createObjectURL(result.blob);
```

Here, `file` is a browser `File` containing the requested 2–12 second range. Release the preview with `URL.revokeObjectURL(previewUrl)` when it is no longer needed.

New to the package? Follow [Get started](/guide/getting-started) to build and install it, then run your first task.

## Find the right operation

| Task                                    | API                                           | Result                                           |
| --------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| Convert, trim, resize, or extract audio | [media()](/api/media)                         | A builder; `run()` returns a blob or file result |
| Inspect duration, tracks, and metadata  | [probe()](/api/probe)                         | `Promise<ProbeResult>`                           |
| Read one audio waveform                 | [getWaveformData()](/api/waveforms)           | `Promise<WaveformData>`                          |
| Draw that waveform as one PNG           | [renderWaveform()](/api/waveforms)            | `Promise<WaveformImage>`                         |
| Decode one video frame                  | [thumbnail()](/api/thumbnails#thumbnail)      | `Promise<ThumbnailImage \| null>`                |
| Build a strip of video previews         | [thumbnails()](/api/thumbnails#thumbnails)    | `AsyncGenerator<ThumbnailItem>`                  |
| Decode the nearest encoded keyframe     | [getClosestKeyFrameImage()](/api/keyframes)   | `Promise<KeyFrameImage \| null>`                 |
| List encoded keyframes in a time range  | [getKeyFrameImages()](/api/keyframes)         | `AsyncGenerator<KeyFrameImage>`                  |
| Count encoded keyframes                 | [getKeyFrameCount()](/api/keyframes)          | `Promise<number>`                                |
| Read a file's embedded cover image      | [getEmbeddedPicture()](/api/embedded-picture) | `Promise<Uint8Array<ArrayBuffer> \| null>`       |

## How the API works

**Configure, then execute.** Conversion methods return new immutable builders. They do not read media until `run()`. Each execution owns and cleans up its resources.

**Share the input contract.** Every operation accepts a `File` / `Blob`, byte buffer, or absolute HTTP(S) URL. Remote sources need CORS. See [Inputs and outputs](/guide/inputs-and-outputs).

**Read the outcome.** Conversion returns resolved settings, track selection, metadata changes, and warnings. A requested track that cannot be preserved fails the task. See [Execution and results](/api/run).

## Browser requirements

Container support and codec support are separate. Recognizing an MP4 does not prove that a device can decode or encode its tracks. Transcoding uses the browser's media capabilities; there is no automatic server or WASM fallback.

Conversion writes MP4, WebM, M4A, WAV, or Ogg. Waveform images are PNG. Thumbnails use JPEG or PNG. Embedded pictures return the original image bytes without decoding.

Continue with the [task guides](/guide/) or browse the [API reference](/api/).
