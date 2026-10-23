---
title: Extract thumbnails
description: Extract single video posters or preview strips with correct timing, image sizing, and cleanup.
---

# Extract thumbnails

`thumbnail(source, options)` returns one `ThumbnailImage` or `null`. `thumbnails(source, options)` returns an async iterator of `ThumbnailItem` values. Both take the same Blob, bytes, and HTTP or HTTPS URL inputs as conversion. Conversion settings do not apply.

Option fields are on [thumbnail](/api/thumbnails). A missing frame is `null`. Invalid options, a missing decoder, an unsupported input, a read failure, an oversized image, and an encoder failure reject. They do not come back as `null`.

An embedded cover is a different read. [getEmbeddedPicture](/api/embedded-picture) returns the file's own JPEG, PNG, GIF, WebP, or BMP bytes.

## Request one time

`time` is seconds and may be zero. `width` or `height` is a positive integer up to 4096.

```ts
import { thumbnail } from "fluent-mediabunny";

const poster = await thumbnail(file, { time: 2, width: 640 });
if (poster) {
  const imageUrl = URL.createObjectURL(poster.blob);
}
```

Revoke the object URL when the image is gone. The returned blob keeps its bytes after later requests, cancellation, and disposal.

## Request a batch

Pass `times`, or pass `start`, `end`, and `count`. Do not pass both. Each list holds 1 to 1000 times. `times` is nondecreasing. Duplicates keep separate positions.

```ts
import { thumbnails } from "fluent-mediabunny";

const controller = new AbortController();
for await (const item of thumbnails(file, {
  times: [0, 2, 2, 5],
  width: 160,
  type: "image/png",
  signal: controller.signal,
})) {
  if (item.image) showPreview(item.index, item.image.blob);
  else showPlaceholder(item.index);
  if (previewClosed()) break;
}
```

`showPreview`, `showPlaceholder`, and `previewClosed` belong to the application.

Interval sampling takes the starts of equal bins in `[start, end)`. `start` 2, `end` 10, and `count` 4 request 2, 4, 6, and 8. `end` must be greater than `start`. `count` is an integer from 1 to 1000. There is no duration scan.

## Read the time

Times are relative to `max(0, input.getFirstTimestamp())`, shared across tracks. The primary video track is the default. Set `track` to a video track id from [probe](/api/probe).

No coverage before the video, in a gap, or at or after the last frame returns `null`. The last frame is not extended. Comparisons use rounded microseconds. Returned timing keeps the source sample values. `actualTime` can be negative when a frame overlaps zero.

`break` and `return()` clean up. If you drive the iterator yourself, await `return()` when you stop early. Calls on one iterator are serial. Aborting while the iterator is suspended starts cleanup immediately. The next `next()` rejects `ABORTED`. An explicit `return()` waits for cleanup. In-flight browser encoding may finish before cancellation resolves, and that late output is discarded.

## Choose the image

`type` defaults to `"image/jpeg"`. `"image/png"` is the other value. `quality` is JPEG only, from 0 to 1, and defaults to 0.8. PNG rejects `quality`.

Omit both sizes to use the oriented display size. Set `width` or `height` to keep the display aspect ratio. The other dimension is rounded. Set both only together with `fit`. `"contain"` and `"cover"` are centered. `"fill"` stretches.

Each dimension is at most 4096. The area is at most 16,000,000 pixels. Odd sizes and upscaling are allowed. A requested side above 4096, or a requested area above 16,000,000, throws `INVALID_OPTIONS`. A size that only exceeds the limit after aspect-ratio rounding throws `OUTPUT_TOO_LARGE`.

Source rotation, flip, and pixel aspect ratio are applied. PNG keeps decoded alpha and transparent padding. JPEG composites onto black. A decoder that drops alpha cannot be repaired here. If the sample omits a non-square pixel ratio and the coded size is unchanged, extraction uses the track ratio. A decoder that already baked the ratio into a different raster keeps that raster.

`IMAGE_ENCODING_UNAVAILABLE` means Canvas encoding or 2D drawing is missing, or the encoder substituted the requested MIME type. `CODEC_UNAVAILABLE` means the selected video decoder is missing. `NO_TRACKS` means there is no video track, or the selected video track is empty.
