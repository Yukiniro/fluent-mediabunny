# Convert with copy mode

Convert with copy mode lets an integrating app remux a local media Blob into a chosen container without re-encoding, then receive a committed Blob whose tracks and size can be independently inspected.

## Sub-features

- `convert-open-source` loads fixture bytes into a Blob for `media()`.
- `convert-copy-run` runs `.format("mp4").mode("copy").run()` to a Blob target.
- `convert-probe` rereads the output with `probe`.
- `convert-ffprobe` checks the written file with system ffprobe.

## How to get to it (user POV)

- Call `media(blob).format("mp4").mode("copy").run()` from application code that imported `fluentbunny` (here: `window.mediaAPI` on the validation page).
- There is no GUI button; the validation harness only exposes the API.

## Driving it with verify-fmb

Preconditions:

- Doctor reports `ok: true` for this run's harness.
- `/fixtures/av.mp4` returns 200.
- `ffprobe` is on PATH.

- **Run copy convert.** Execute `node .cursor/skills/verify-fluentbunny/helpers/verify-fmb.mjs drive convert-copy`. The helper evaluates `media(av.mp4 blob).format("mp4").mode("copy").run()`.
- **Observe blob result.** `proof.json` shows `kind: "blob"`, `size > 0`, and at least one track codec.
- **Independent check.** The same drive writes `output.mp4` and runs ffprobe; `proof.json.ffprobe.streams` is present.
- **Proof.** Require `proof.ok === true` and retain `artifacts/verify-fluentbunny/<run>/convert-copy/`.

## Gotchas

- Linux Chrome may lack AAC encoders; this feature uses **copy** mode so encoding availability is not required.
- Do not treat Vitest Node tests as a substitute for this browser drive when validating WebCodecs/container wiring.
- A non-zero size alone is insufficient; require probe/ffprobe track evidence.
