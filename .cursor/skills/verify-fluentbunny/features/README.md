# fluentbunny verification map

This directory is the maintained source for verifying browser-facing library behavior. Read this index before driving the harness, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `node .cursor/skills/verify-fluentbunny/helpers/verify-fmb.mjs launch` so the Vite validation page serves `window.mediaAPI`.
- Set a unique `FMB_VERIFY_RUN_ID` (and a free `FMB_VERIFY_PORT` if 4173 is taken).
- Require `doctor` JSON `ok: true` before any drive.
- Fixtures under `public/fixtures/` must include at least `av.mp4`, `audio.wav`, and `markers.mp4`.
- System Chrome available to Playwright (`channel: "chrome"`). `ffprobe` on PATH for convert proofs.
- Never drive a harness process that this run did not launch.

## Driving conventions

- Start every recipe from a freshly loaded `/` with `window.mediaAPI` present.
- Drive only through `verify-fmb.mjs drive <feature-id>` or equivalent Playwright `page.evaluate` of the public exports.
- Treat feature IDs and helper commands as literal.
- Restore nothing to disk between features beyond evidence writes; the library is stateless aside from in-module file-handle leases.
- Cleanup stops the harness only; keep proof artifacts.

## Proof and skip reporting

- Capture the API call result and a second observer (`probe`, `ffprobe`, or file-handle event order).
- Browser proof includes `proof.json` under `artifacts/verify-fluentbunny/<run>/<feature>/`.
- Mutation/side-effect proof for file targets includes open/write/abort/close event lists.
- Record the feature ID and entry point in every `proof.json`.
- Report an unreachable path with the unmet precondition; do not claim a different entry point verified it.

## Feature entry contract

Each feature file starts with an H1 and one paragraph, then exactly four H2 sections: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-fmb`, `Gotchas`.

## Features

- [Convert with copy mode](./convert-copy.md) — MP4 remux/copy to a committed Blob, checked with probe and ffprobe.
- [Thumbnail batch](./thumbnails-batch.md) — bounded JPEG timeline frames from `thumbnails()`.
- [Probe media](./probe-media.md) — inspect tracks and duration via `probe()`.
- [Cancel before commit](./cancel-before-commit.md) — abort before file close; never `close` after cancel.
