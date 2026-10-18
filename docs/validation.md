# v1 implementation validation

Baseline date: 2026-10-18. These are local execution results, not a claim of universal device support or a published release. The English documentation update does not change the recorded media payloads.

## Results

- Vite+ 1.3.0 `vp check`: formatting, Oxlint, and type checks passed.
- Vitest: 17 tests in three files passed, including real Mediabunny PCM conversion and injected failures.
- Vite+ `vp pack`: ESM and TypeScript declarations built successfully; approximately 32.23 kB ESM (9.62 kB gzip), excluding external Mediabunny.
- Playwright: 33 cases, 29 passed, four skipped, zero failed. The skipped cases are WebKit/Firefox OPFS and resource-trend checks, which use Chrome as their baseline.
- The built package was imported and used for WAV conversion in all three browsers, independently of source-module checks.
- FFprobe independently checked containers, track counts, and Unicode titles in all four output formats. FFmpeg decoded converted outputs without errors. FFprobe exposes the WebM title as `MOVIE/TITLE`.

TypeScript 7.0.2 declaration generation emits an upstream experimental-API warning. Build/type checks passed, but toolchain upgrades need regression testing.

## Observed browser capabilities

Versions: [browser-versions.json](browser-versions.json). Test names and capability details: [browser-results.json](browser-results.json).

| Tested combination                             | Chrome 155.0.8059.80             | Playwright WebKit 26.0                           | Firefox 146.0.1                  |
| ---------------------------------------------- | -------------------------------- | ------------------------------------------------ | -------------------------------- |
| MP4/WebM/M4A/WAV copy and all eight tag fields | Passed                           | Passed                                           | Passed                           |
| AVC/AAC MP4 and AAC M4A transcoding            | Passed                           | Passed                                           | CODEC_UNAVAILABLE                |
| VP8/Opus, VP9/Opus, and WAV transcoding        | Passed                           | Passed                                           | Passed                           |
| HEVC to MP4 auto resolves and writes AVC       | Passed                           | Passed                                           | CODEC_UNAVAILABLE                |
| HEVC copy                                      | Passed                           | Passed                                           | Passed                           |
| Odd-dimension VP9 yuv444p input resize         | Passed                           | CODEC_UNAVAILABLE                                | Passed                           |
| Dynamic video dimensions                       | UNSUPPORTED_INPUT; file unopened | PROCESSING_FAILED during decoding; file unopened | UNSUPPORTED_INPUT; file unopened |
| OPFS overwrite, readback, and cancellation     | Passed                           | Not validated                                    | Not validated                    |

A passing result applies only to the tested machine, fixtures, and parameters. Automated WebKit is not Safari/iOS device validation. Passing a capability-refusal test does not mean encoding succeeded. Static capability queries cannot prevent runtime decoding/encoding errors.

## Acceptance-criterion evidence

| AC  | Evidence                                                                                                                                  | Boundary                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 001 | Derived metadata leaves the base unchanged; concurrent runs create independent Blobs                                                      | Caller keeps source bytes stable                           |
| 002 | Metadata instruction replacement and real WebM quality-to-bitrate override; no presets                                                    | No additional configuration subsystem                      |
| 003 | HEVC auto to AVC, HEVC copy, copy in Node without WebCodecs, explicit Firefox refusal                                                     | No HEVC encoding claim                                     |
| 004 | Invalid AVC/WebM, WAV parameters, and copy+trim rejected early                                                                            | No real writable opened                                    |
| 005 | Controlled 12345 Hz refusal performs one exact capability query despite available 48000 Hz fallback; real 48000 Hz/stereo output checked  | Mock refusal and actual encoding are separate evidence     |
| 006 | M4A with selected video returns TRACK_LOSS; explicit video exclusion succeeds                                                             | Track-count errors follow specification section 4.6        |
| 007 | Multi-audio WAV rejected; primary M4A succeeds; silent HEVC MP4 copy/auto exercised                                                       | Invalid, duplicate, and empty ID selections validated      |
| 008 | Merge/null/replace and repeated metadata instructions; deleted title stays absent after same-container round-trip                         | No raw passthrough                                         |
| 009 | Eight fields across four formats and three browsers; CJK, emoji, leap date, and invalid values                                            | Independent title check; all fields reread with Mediabunny |
| 010 | Raw omissions reported; replace avoids per-field warnings                                                                                 | No discovery claim for unexposed source data               |
| 011 | Pre-aborted run/probe makes no URL request; late-created writable is aborted                                                              | No proof of complete browser-internal cleanup              |
| 012 | Cancellation during final buffered write invokes abort with zero real closes; OPFS retains committed bytes                                | Native user directories remain unverified                  |
| 013 | Delayed close blocks success; post-commit abort does not cancel; close failure is WRITE_FAILED+unknown                                    | No power-loss guarantee                                    |
| 014 | One request on network failure; slow-read abort; no captured unhandled page errors; omit/cors verified                                    | No Internet-service load test                              |
| 015 | Concurrent same-handle lease refusal; a 2 MB old OPFS file is replaced by shorter output                                                  | Lock is module-instance local                              |
| 016 | MP4 positioned header rewrites; reported size equals actual file size; both tracks reread                                                 | Size is not cumulative write traffic                       |
| 017 | Processing ratio=1 still waits for close; observer throws become warnings                                                                 | Progress is not commit status                              |
| 018 | Nonzero timestamps, display-matrix rotation, VFR, crop/rotate/resize/frame rate; independent decode and start-time difference below 80 ms | No subjective lip-sync or pixel-perfect fidelity claim     |
| 019 | Write failure survives abort-cleanup failure; cancellation first remains ABORTED                                                          | Secondary errors stay in diagnostics                       |
| 020 | Estimated PCM bounds, pre-write positioned size guard, and boundary arithmetic injection                                                  | No physical file above 4 GB generated                      |

## Resource observations

Chrome ran eight success/pre-cancel cycles on a 30-second 640×360, 24 fps synthetic file, with an additional track-constraint failure in each cycle. Four cancellations returned as expected; final output was 6,778,236 bytes. Reusing the same handle after each operation demonstrated lease release.

Sampled JavaScript heap was approximately 32.5–86.0 MB. Values in the JSON are influenced by garbage collection, sampling precision, and the test itself; they do not include all native codec memory. They do not prove leak freedom or constant memory. Hour-long inputs and high-concurrency stress were not tested.

## Native save panel and outstanding checks

A native Chrome click opened the macOS save panel. After directory navigation, desktop automation could not reliably target the system panel, so native user-directory save/overwrite/cancel acceptance was not completed. No user media was changed; the dedicated placeholder and temporary validation tabs were removed.

Run `pnpm dev`, visit `/tests/native.html`, and select a dedicated `native-output.mp4` file to complete this check manually. The application page requests the picker; the library does not request permissions. OPFS and controlled streams cannot substitute for this evidence.

At this baseline, the GitHub workflow had not run. Consult the repository's Actions page for subsequent hosted results rather than treating this snapshot as a live CI badge. Real Safari/iOS/Android/Windows acceptance, npm publication, adversarial-media fuzzing, and native file acceptance remain outside the completed evidence. The wrapper is now MIT licensed; dependency licenses remain separate.

## Reproduction

Versions are pinned in package.json and pnpm-lock.yaml. Fixture origins/expectations are in public/fixtures/manifest.json; scripts/fixtures.mjs generates them from synthetic patterns, without third-party recordings. Use Node 24, pnpm 12.14.0, and FFmpeg/ffprobe on PATH. Run:

```sh
pnpm install --frozen-lockfile
pnpm exec vp check
pnpm exec vp test run
pnpm exec vp pack
pnpm exec playwright install chrome firefox webkit
pnpm test:browser
```

`pnpm fixtures` regenerates the synthetic media. `pnpm dev` starts the browser test harness. Live Playwright results are written to test-results; the JSON files here are the recorded local baseline snapshot.
