# Video image extraction validation

Validated locally on 2026-10-21 against Mediabunny 1.61.6, Vite+ 1.3.0, TypeScript 7.0.2, Playwright 1.58.2 and Node 24.11.1 on macOS. This is implementation/test evidence, not an npm release or universal device-support claim.

## Results

- Formatting, lint and source type checks passed.
- 37 unit tests passed, including 16 extraction/capability tests and all 21 existing tests.
- ESM and declarations built; a separate TypeScript consumer checks the built functions, exported types and invalid option combinations.
- Full browser suite: 48 passed, 6 skipped, 0 failed across Chrome 155.0.8059.85, Firefox 146.0.1 and Playwright WebKit 26.0.
- Extraction contributes 19 passes and 2 capability skips. Every browser successfully decodes AVC and returns both JPEG and PNG. Existing conversion/file-safety tests contribute 29 passes and 4 pre-existing Chrome-only OPFS/resource-check skips.
- Chrome decodes the VP9 alpha fixture and preserves PNG transparency; JPEG composites it onto black. WebKit and Firefox pass capability checks but reject this fixture during decoding with native EncodingError, surfaced as PROCESSING_FAILED. Their alpha cases are skipped explicitly, never counted as successful extraction.

GitHub Actions runs source checks, unit tests, packaging, package-consumer type checks and all three browser projects on Ubuntu. See the [workflow](../.github/workflows/ci.yml) and [current runs](https://github.com/Yukiniro/fluent-mediabunny/actions/workflows/ci.yml) for revision-specific results; local macOS capability outcomes do not predict Linux codec availability.

Detailed local outcomes and repeated-run observations: [thumbnail-results.json](thumbnail-results.json).

## Acceptance evidence

| Criteria   | Evidence                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-001     | Real JPEG/PNG decode, MIME/dimensions, track/timing fields and image-color assertions in all three browsers                                                                      |
| AC-002–003 | Duplicate positions, missing slots and interval 2,4,6,8/count=1 in unit and browser tests                                                                                        |
| AC-004     | Synchronous full-list/option validation, precision, incompatible fields, dimensions and quality before mocked input opening                                                      |
| AC-005     | Two real video tracks with different dimensions, primary selection and audio-ID refusal                                                                                          |
| AC-006     | Real audio-only source and deterministic empty-video packet fixture                                                                                                              |
| AC-007     | Real delayed video [1,4) with audio to 5; mock negative-overlap timing and half-open missing coverage; exact boundaries                                                          |
| AC-008     | FFprobe independently provides presentation timestamps and verifies B frames in synthetic red/green/blue CFR and VFR files; each decoded image must match its known time segment |
| AC-009     | Asymmetric colored fixture, rotation plus flip, SAR 2:1, all three fits, odd dimensions; mocked changing sample sizes                                                            |
| AC-010     | Real transparent PNG padding and black JPEG padding in every browser; decoded VP9 alpha success in Chrome, explicit unsupported cases elsewhere                                  |
| AC-011     | Inferred/native size refusal before canvas allocation, with bounded downscale allowed                                                                                            |
| AC-012     | PNG quality refusal, absent API/context, substituted MIME, empty Blob and HTMLCanvas null encoding                                                                               |
| AC-013     | Earlier Blob byte/content stability across later yields, disposal and cancellation                                                                                               |
| AC-014     | Pre-abort, controlled read/decode/encode cancellation, suspended-yield abort, held encoder late-result discard, real delayed URL cancellation without page errors                |
| AC-015     | Completion, break, explicit return, decoder failure and cleanup-only failure; first failure and diagnostics preserved                                                            |
| AC-016     | 1000 paced mock requests use exactly one input, sink and output canvas; each sample closes before delivery and no next encode starts before consumption                          |
| AC-017     | Unstarted return performs no I/O; original times/options mutations do not alter the validated snapshot                                                                           |
| AC-018     | Real Node input can be probed and packet-copied with no decoder while extraction rejects CODEC_UNAVAILABLE                                                                       |
| AC-019     | Browser dynamic import from dist; separate built-declaration consumer in type-tests/thumbnails.mts                                                                               |
| AC-020     | Full unchanged conversion, metadata and file-safety regression suites                                                                                                            |

Resource counters cover wrapper ownership, not browser decoder or source-cache memory. Each browser additionally performs 20 real extraction/early-return cycles; elapsed observations are attached to Playwright results. These tests do not establish native leak freedom or constant total memory. Tests use loss-tolerant color identity assertions rather than cross-browser JPEG byte equality.

## Compatibility clarification discovered during implementation

The tested WebKit decoder returns square-pixel samples for a file declaring a 2:1 pixel ratio. Extraction uses the public track ratio when a sample exposes square pixels and unchanged coded dimensions; a non-square sample ratio takes precedence. Linux WebKit instead materializes the same ratio as an 80x20 raster, which must retain its sample geometry rather than receive the ratio twice. Native dimensions can therefore differ while preserving the 4:1 display aspect ratio. Geometry remains sample-specific, and conversion preflight is not invoked. Both language specifications record this fallback and its limitation for unreported dynamic ratio changes. JPEG alpha composition uses explicit pixel multiplication for samples that can contain alpha, avoiding accelerated Canvas blending differences; this needs one temporary bounded ImageData buffer. Rotation and flip content assertions pass in all three browsers.

No dependency or existing conversion/file-write contract changed. Automated WebKit is not Safari/iOS device acceptance. Additional codecs, HDR/color matching and arbitrary dynamic-resolution streams are not certified by this suite.

## Reproduction

```sh
pnpm install --frozen-lockfile
pnpm exec vp check
pnpm exec vp test run
pnpm exec vp pack
pnpm test:package
pnpm exec playwright install chrome firefox webkit
pnpm test:browser
```

Fixtures are committed and generated only from FFmpeg lavfi sources. `node scripts/thumbnail-fixtures.mjs` regenerates the new extraction fixtures; `pnpm fixtures` regenerates the full collection. FFmpeg must support the display rotation/flip input flags when regenerating. CI consumes the committed fixtures and uses ffprobe as an independent timing oracle.
