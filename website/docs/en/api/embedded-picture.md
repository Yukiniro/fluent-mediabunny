---
title: getEmbeddedPicture
description: Read one original embedded picture as an owned byte copy, with deterministic selection and null semantics.
---

# getEmbeddedPicture

`getEmbeddedPicture` returns the bytes of one embedded picture, or `null`. The bytes are the file's own image, including metadata inside the image such as EXIF. They are not a frame decoded from the video. [thumbnail](/api/thumbnails) decodes a frame.

## Example

```ts
import { getEmbeddedPicture } from "fluentbunny";

const picture = await getEmbeddedPicture(file);
if (picture) {
  const imageUrl = URL.createObjectURL(new Blob([picture]));
  // Display the image, then revoke imageUrl when it is no longer needed.
}
```

`file` is a browser `File`. No decoder or image encoder is needed for this byte read.

## Signature

```ts
function getEmbeddedPicture(
  source: MediaInput,
  options?: EmbeddedPictureOptions,
): Promise<Uint8Array<ArrayBuffer> | null>;
```

`MediaInput` matches [probe](/api/probe). There is no builder method.

## Parameters

| Parameter | Type                                | Required | Description                                          |
| --------- | ----------------------------------- | -------- | ---------------------------------------------------- |
| `source`  | [MediaInput](/api/probe#mediainput) | Yes      | Original media file, bytes, or absolute HTTP(S) URL. |
| `options` | `EmbeddedPictureOptions`            | No       | Optional cancellation signal.                        |

## Return value

**Returns:** `Promise<Uint8Array<ArrayBuffer> | null>`. The array owns a copy of the selected picture bytes. There is no MIME field, decoding, or resizing.

`null` means no eligible picture. It is not an error. It is also not proof that the file stores no picture tags: WAV has none, and Mediabunny skips Matroska tags when the source size is unknown. Aborting a read that would have returned `null` throws `ABORTED`.

## EmbeddedPictureOptions

| Field    | Type          | Default |
| -------- | ------------- | ------- |
| `signal` | `AbortSignal` | none    |

Pass `signal` to cancel reading. The options object accepts only `signal`. Unknown keys throw `INVALID_OPTIONS` before the input opens, including when the signal is already aborted.

## Selection

The function reads pictures Mediabunny exposes as metadata images: ID3v2 APIC, MP4 `covr`, FLAC PICTURE, Ogg METADATA_BLOCK_PICTURE, and Matroska image attachments. A picture stored as a video track is not one of these.

Eligibility uses the leading bytes. The declared MIME type, name, and description are ignored.

| Leading bytes                          | Format |
| -------------------------------------- | ------ |
| `FF D8 FF`                             | JPEG   |
| `89 50 4E 47 0D 0A 1A 0A`              | PNG    |
| `GIF87a` or `GIF89a`                   | GIF    |
| `RIFF`, four size bytes, then `WEBPVP` | WebP   |
| `BM`                                   | BMP    |

SVG, an ID3 URL link (`-->`), an empty payload, a payload shorter than its signature, HEIC, TIFF, AVIF, and a WebP whose bytes do not continue with `VP` are ineligible. If every picture is ineligible, or there are no pictures, the result is `null`. These are signature checks, not full image validation; matching bytes do not guarantee that the image will decode.

### Selection priority

Use the first eligible picture in each category, in this order:

1. Front cover.
2. Picture without a front or back label.
3. Back cover.

If none is eligible, resolve `null`. Ties keep file order.

### File labels and ownership

A picture is a front or back cover only when the file labels it that way. Picture type 3 is front and type 4 is back, on an ID3 APIC, a FLAC PICTURE block, or an Ogg `METADATA_BLOCK_PICTURE`. An MP4 `covr` and QuickTime artwork (`com.apple.quicktime.artwork`) are front. A Matroska attachment is front when its name starts with `cover.`, and back when its name starts with `back.`. Mediabunny includes that attachment only when the declared type starts with `image/`. Every other label is unlabeled. The result does not include the label, a MIME type, or a cover role.

The returned `Uint8Array<ArrayBuffer>` is a copy from `data.slice()`. Its length is the picture length. Later edits to the source view do not change it. Each call opens and disposes its own input. Two calls on an unchanged source return equal bytes in distinct arrays.

## Probe and conversion

When the source exposes pictures, [probe](/api/probe) still lists `"images"` in `omittedSourceFields`. That name means the pictures sit outside the text metadata. Conversion does not write them into the output. `metadata({ images })` throws `UNSUPPORTED_METADATA_FIELD`.

## Errors

| Condition                                                                           | Outcome             |
| ----------------------------------------------------------------------------------- | ------------------- |
| Options are not a plain object, an unknown key, or `signal` is not an `AbortSignal` | `INVALID_OPTIONS`   |
| Unsupported source or URL, or an unrecognized container                             | `UNSUPPORTED_INPUT` |
| Fetch, read, or tag parsing failed                                                  | `READ_FAILED`       |
| Cancellation before resolution, including a signal that is already aborted          | `ABORTED`           |
| No eligible picture                                                                 | `null`              |

These errors use phase `"preparing"`. Empty input bytes follow the rules in [Choose inputs and outputs](/guide/inputs-and-outputs).
