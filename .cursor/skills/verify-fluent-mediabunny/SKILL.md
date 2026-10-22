---
name: verify-fluent-mediabunny
description: Drive the fluent-mediabunny browser validation harness (window.mediaAPI) to prove conversion, thumbnails, probe, and cancel-before-commit behavior. Use when verifying library changes against real browser media APIs, or when a task needs user-path evidence beyond Vitest.
---

# Verify fluent-mediabunny

Primary surface is the **browser library API** loaded by the local validation page (`index.html` → `window.mediaAPI`). There is no product UI. Agents prove behavior by launching that harness and evaluating the public API the way an integrating app would. Secondary surfaces: Vitest (`pnpm test`), package build (`pnpm build` / `vp pack`). Native save-picker flows are out of automated scope (see `docs/validation.md`).

## Launch

From the repo root:

```sh
export FMB_VERIFY_RUN_ID="${FMB_VERIFY_RUN_ID:-$(date +%s)}"
export FMB_VERIFY_PORT="${FMB_VERIFY_PORT:-4173}"
node .cursor/skills/verify-fluent-mediabunny/helpers/verify-fmb.mjs launch
```

Ready when `GET http://127.0.0.1:$FMB_VERIFY_PORT/` returns 200 and the page title contains `fluent-mediabunny`. The helper starts `vp dev --host 127.0.0.1 --port <port>` as a detached process owned by this run. Fixtures are served from `public/fixtures/` (already in the tree; regenerate with `pnpm fixtures` only if missing).

Two instances need different `FMB_VERIFY_PORT` and `FMB_VERIFY_RUN_ID` values. Do not attach to a harness you did not launch.

Teardown: see Cleanup.

## Doctor

```sh
node .cursor/skills/verify-fluent-mediabunny/helpers/verify-fmb.mjs doctor
```

Requires exit code 0 and JSON with `ok: true`, `harnessProcess.alive: true`, `mediaAPI: true`, `fixtureAvMp4: true`. Run doctor first whenever a drive fails or the page looks wrong.

## Drive

```sh
node .cursor/skills/verify-fluent-mediabunny/helpers/verify-fmb.mjs drive <feature-id>
```

Feature IDs match `features/*.md` (without `.md`): `convert-copy`, `thumbnails-batch`, `probe-media`, `cancel-before-commit`.

Harness recipe: Playwright Chromium (`channel: "chrome"`) opens the validation URL, waits for `window.mediaAPI`, then `page.evaluate`s the public API. Prefer the exact entry points in the feature map. Do not call internal modules under `src/` from a proof drive.

Read `features/README.md` before choosing a feature. A proof that only exercises one entry point is incomplete when the map lists others for that feature.

## Evidence

Proof files land under:

`artifacts/verify-fluent-mediabunny/<FMB_VERIFY_RUN_ID>/<feature-id>/`

Each drive writes `proof.json` plus any binary outputs (e.g. `output.mp4`, JPEG frames). Standards:

- Exercise the real public API path (`media` / `thumbnails` / `probe` / `run` with `signal` / file target), not Vitest-only mocks, unless the feature file says the mock handle is the user-facing file-target contract.
- Capture the action result and a second observer when possible (e.g. `probe` after convert, `ffprobe` on the written file).
- Side effects: written bytes on disk, `commitState`, abort vs close event order for file targets.
- Mocks only at the File System Access boundary (fake `FileSystemFileHandle`) because native pickers are not automatable here.

## Cleanup

```sh
node .cursor/skills/verify-fluent-mediabunny/helpers/verify-fmb.mjs cleanup
```

Sends SIGTERM (then SIGKILL if needed) to the PID recorded at launch. Deletes launch state under `/tmp/fmb-verify-<RUN_ID>/`. **Does not delete** `artifacts/verify-fluent-mediabunny/...` proof files. Never `pkill` by process name.

## Helpers

Executable entry: `.cursor/skills/verify-fluent-mediabunny/helpers/verify-fmb.mjs`

| Command      | Purpose                                       |
| ------------ | --------------------------------------------- |
| `launch`     | Start isolated Vite harness; print JSON state |
| `doctor`     | Read-only health check                        |
| `drive <id>` | Run one mapped feature; write proof           |
| `cleanup`    | Stop the launched PID; keep evidence          |

Optional env: `FMB_VERIFY_RUN_ID`, `FMB_VERIFY_PORT`, `FMB_VERIFY_STATE_DIR`, `FMB_VERIFY_EVIDENCE`.

## Maintenance

When routes, fixtures, or public API entry points change, run `/maintain-verification-skill` so the feature map stays honest.
