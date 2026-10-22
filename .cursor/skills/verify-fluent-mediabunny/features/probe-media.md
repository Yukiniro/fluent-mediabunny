# Probe media

Probe media lets an integrating app inspect track types, codecs, and duration of a source without converting it.

## Sub-features

- `probe-tracks` returns video and audio `TrackInfo` entries.
- `probe-duration-scan` uses `{ duration: "scan" }` when metadata duration is insufficient.

## How to get to it (user POV)

- Call `probe(source)` or `probe(source, { duration: "scan" })` from application code / `window.mediaAPI`.

## Driving it with verify-fmb

Preconditions:

- Doctor `ok: true`.
- `/fixtures/av.mp4` available.

- **Run probe.** `node .cursor/skills/verify-fluent-mediabunny/helpers/verify-fmb.mjs drive probe-media`.
- **Observe tracks.** `proof.json.result` has `hasVideo` and `hasAudio` true and `trackCount >= 2`.
- **Proof.** `proof.ok === true` under `artifacts/verify-fluent-mediabunny/<run>/probe-media/`.

## Gotchas

- Duration may be null without `duration: "scan"` on some containers; this recipe always scans.
- Probe does not open a user file writable; do not require file-handle events here.
