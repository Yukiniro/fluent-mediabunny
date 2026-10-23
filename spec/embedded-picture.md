# Embedded pictures

English | [简体中文](embedded-picture.zh-CN.md)

`getEmbeddedPicture(source, options?)` returns `Promise<Uint8Array<ArrayBuffer> | null>`. Options accept only `signal`. It uses the shared [input contract](conversion.md#input-and-probe); public types are in [types.ts](../src/types.ts).

## Selection and result

- Read pictures exposed by Mediabunny metadata: ID3 APIC, MP4 covr, FLAC/Ogg pictures, and Matroska image attachments.
- Eligible bytes match WHATWG MIME Sniffing signatures for JPEG, PNG, GIF, WebP, or BMP. Declared MIME does not determine eligibility; other signatures and picture URLs are ignored.
- Choose the first eligible front cover, otherwise the first unlabeled picture, otherwise the first back cover. Ties use file order. Roles follow Mediabunny's file labels: ID3/FLAC types 3/4, MP4 covr as front, and Matroska attachments named `cover.*`/`back.*`; other labels are unlabeled.
- Return an independent copy of exactly the selected picture's bytes, preserving embedded metadata such as EXIF. No decoding, transformation, MIME field, or role is returned. Repeated calls on an unchanged source return equal bytes in distinct arrays.
- `null` means no eligible picture was exposed. WAV exposes none; Matroska tags may be unavailable when source size is unknown.
- Conversion still omits pictures. `probe().omittedSourceFields` still lists exposed images; `metadata({ images })` rejects `UNSUPPORTED_METADATA_FIELD`.

The name and one-picture result follow Android [MediaMetadataRetriever.getEmbeddedPicture](<https://developer.android.com/reference/android/media/MediaMetadataRetriever#getEmbeddedPicture()>). The API survey also checked music-metadata's `selectCover`, jsmediatags, Mediabunny, FFmpeg/fluent-ffmpeg, and AndroidTagLib. This API preserves `MediaInput`, cancellation, and owned bytes, with deterministic selection.

## Errors and lifetime

Each call owns and disposes its input before settling. Options and source type are checked before observing cancellation or reading. Abort before resolution rejects `ABORTED`, including reads that would otherwise return null; no late result is delivered.

| Code                | Meaning                                                   |
| ------------------- | --------------------------------------------------------- |
| `INVALID_OPTIONS`   | Malformed/unknown options, invalid signal, or empty bytes |
| `UNSUPPORTED_INPUT` | Unsupported source, URL, or container                     |
| `READ_FAILED`       | Source or metadata read failure                           |
| `ABORTED`           | Cancellation observed before completion                   |

All errors use phase `preparing`. As with `probe`, cleanup failure alone does not reject a successful read; after a failure, it is attached as a diagnostic. Cleanup cannot affect returned bytes.
