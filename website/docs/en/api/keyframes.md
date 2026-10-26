---
title: Keyframes
description: Decode the encoded video keyframe nearest a time, list keyframe images in a range, or count them without a video decoder.
---

# Keyframes

`thumbnail()` returns the presentation frame that covers a time, and that frame may be a B frame. These three functions read encoded keyframes instead. They do not change `thumbnail` or `thumbnails`.

`getKeyFrameCount` returns one integer, as LAVFilters' keyframe count does. The image functions are named for this library. Android, Media3, AVFoundation, Mediabunny, FFmpeg, and GStreamer do not return encoded-keyframe images under these names. The [keyframe contract](https://github.com/Yukiniro/fluent-mediabunny/blob/main/spec/keyframes.md) records that departure.

## getClosestKeyFrameImage

```ts
import { getClosestKeyFrameImage } from "fluentbunny";

const image = await getClosestKeyFrameImage(file, { time: 2, width: 640 });
if (image) console.log(image.blob, image.sourceTimestamp);
```

```ts
function getClosestKeyFrameImage(
  source: MediaInput,
  options: KeyFrameImageOptions,
): Promise<KeyFrameImage | null>;
```

Distance is measured on both sides of the requested time. An exact timestamp wins. An equal distance keeps the earlier keyframe. A time outside the first or last keyframe returns that boundary frame. No confirmed keyframe returns `null`.

## getKeyFrameImages

```ts
import { getKeyFrameImages } from "fluentbunny";

for await (const image of getKeyFrameImages(file, { start: 1, end: 4 })) {
  console.log(image.sourceTimestamp);
}
```

```ts
function getKeyFrameImages(
  source: MediaInput,
  options?: KeyFrameImagesOptions,
): AsyncGenerator<KeyFrameImage>;
```

A keyframe is included when its packet start lies in `[start, end)`. Omit either bound to leave that side open. Omit both, or call `getKeyFrameImages(file)`, to include every confirmed keyframe, including packets with a negative timestamp. `start: 0` excludes those packets. Images are yielded in presentation order after the metadata walk finishes. `return()` stops later confirmation and decode.

Packets with the same raw timestamp collapse to one image. A container key flag that does not survive packet verification is dropped.

## getKeyFrameCount

```ts
import { getKeyFrameCount } from "fluentbunny";

const total = await getKeyFrameCount(file, { start: 1, end: 4 });
```

```ts
function getKeyFrameCount(source: MediaInput, options?: KeyFrameCountOptions): Promise<number>;
```

The count uses the same candidates and range as `getKeyFrameImages`. It does not construct a video decoder or a canvas. It can still read encoded packets. A count does not promise that decoding those images later will succeed. Counting and then extracting reads the source again.

## Options

`time`, `start`, and `end` are finite nonnegative seconds. `-0` becomes `0`. When both bounds are present, `end` must be greater than `start`. `track` defaults to the primary video track.

Image calls accept the same `width`, `height`, `fit`, `type`, `quality`, and `signal` options as [`thumbnail()`](/api/thumbnails). `KeyFrameImage` has the thumbnail fields except `requestedTime`. `getKeyFrameCount` accepts only `track`, `start`, `end`, and `signal`.

## Errors

| Code                         | When                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `INVALID_OPTIONS`            | Invalid options, times, or a numeric id that is not a video track. Image limits apply only to the image calls. |
| `NO_TRACKS`                  | No primary video track, or the selected video track has no packets.                                            |
| `CODEC_UNAVAILABLE`          | The image call cannot decode the selected track. Counting does not check the decoder.                          |
| `UNSUPPORTED_INPUT`          | Unsupported source, an unsafe timestamp, or a decoded frame whose time does not match the key packet.          |
| `IMAGE_ENCODING_UNAVAILABLE` | Canvas encoding is unavailable, or the encoder changes the MIME type. Image calls only.                        |
| `OUTPUT_TOO_LARGE`           | The resolved image exceeds 4096 pixels on a side or 16,000,000 pixels in area. Image calls only.               |
| `READ_FAILED`                | Reading the source failed.                                                                                     |
| `PROCESSING_FAILED`          | Decode, rendering, or cleanup failed. A count fails this way only when cleanup fails.                          |
| `ABORTED`                    | The signal aborted before the call finished.                                                                   |

An empty track is `NO_TRACKS`. A track that has packets but no confirmed keyframe returns `null`, an empty iteration, or `0`.
