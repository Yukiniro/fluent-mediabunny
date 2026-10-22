# Thumbnail batch

Thumbnail batch lets an integrating app request a bounded set of timeline images from a video, receiving JPEG or PNG Blobs with requested and source timestamps preserved per index.

## Sub-features

- `thumbs-times` requests discrete `times` for extraction.
- `thumbs-jpeg` encodes `image/jpeg` at a capped width.
- `thumbs-order` yields one result per requested index without dropping slots.

## How to get to it (user POV)

- Call `thumbnails(source, { times, type, width })` and iterate the async iterable.
- Or call `thumbnail(source, { time, ... })` for a single frame (covered as a thinner path of the same surface).

## Driving it with verify-fmb

Preconditions:

- Doctor `ok: true`.
- `/fixtures/markers.mp4` available (color-marked synthetic video).

- **Run batch.** `node .cursor/skills/verify-fluent-mediabunny/helpers/verify-fmb.mjs drive thumbnails-batch`.
- **Observe frames.** `proof.json` lists three frames with `width: 80`, non-zero `byteLength`, and JPEG mime.
- **Proof.** JPEG files `frame-0.jpg` … written beside `proof.json`; `proof.ok === true`.

## Gotchas

- Early consumer `break` must release resources; do not hold the iterable open across unrelated drives.
- Automated WebKit/Safari differences are out of scope for this Chrome harness proof.
- Pixel-oracle color checks live in Playwright specs; this map only requires successful bounded extraction.
