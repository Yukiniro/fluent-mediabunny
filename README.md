# fluent-mediabunny

An immutable, fluent TypeScript API for browser media conversion, powered by the official [Mediabunny](https://mediabunny.dev/) `Conversion` API.

One input, one output, explicit codecs, and predictable cancellation. Built with **Vite+ 1.3.0** and tested against **Mediabunny 1.61.6**. The package has not been published to npm yet.

```ts
import { media, probe } from "fluent-mediabunny";

const info = await probe(file);
const result = await media(file)
  .format("mp4")
  .trim({ start: 0.2, end: 1.2 })
  .resize({ width: 640 })
  .metadata({ title: "Clip", comment: null })
  .run({ signal, onProgress: ({ phase, ratio }) => console.log(phase, ratio) });

// result.kind === 'blob'; use result.blob for playback, download, or further processing.
```

## Getting started

Clone this repository and build the package:

```sh
git clone https://github.com/Yukiniro/fluent-mediabunny.git
cd fluent-mediabunny
pnpm install --frozen-lockfile
pnpm build
pnpm pack
```

Use the resulting tarball or a local directory dependency in your application, together with `mediabunny@1.61.6`. Use a browser bundler to resolve ESM package imports. The output consists of `dist/index.mjs` and `dist/index.d.mts`; Mediabunny remains an external peer dependency.

`format()` is required. Configuration methods return new builders, and every `run()` owns independent resources. `video()`, `audio()`, and `tracks()` merge explicit fields; a later bitrate replaces quality and vice versa. Each `metadata()` call replaces the entire previous metadata instruction. Input bytes are not copied: keep them stable until the operation settles.

## Supported operations

Inputs: File/Blob, ArrayBuffer, Uint8Array backed by ArrayBuffer, or an absolute HTTP(S) URL. Input containers: MP4/M4A/MOV, WebM/MKV, MP3, WAV, Ogg, FLAC, and ADTS.

Outputs: MP4, WebM, M4A, or WAV, as a Blob or a caller-provided file handle. Operations include auto/copy/transcode, trim, resize, crop, quarter-turn rotation, frame-rate changes, audio resampling, channel changes, track selection, metadata, probe, progress, and cancellation.

There are no presets, concatenation, timelines, mixing, overlays, subtitle composition, filter graphs, HLS, live streams, server adapters, automatic Workers, codec plugins, or arbitrary FFmpeg arguments. FFmpeg is used only for test fixtures and independent validation, never at runtime.

| Format | Default encoding in auto/transcode  | Copy allowlist                                        |
| ------ | ----------------------------------- | ----------------------------------------------------- |
| MP4    | AVC + AAC                           | AVC/HEVC + AAC                                        |
| WebM   | VP9 + Opus; explicit VP8 supported  | VP8/VP9/AV1 + Opus/Vorbis                             |
| M4A    | AAC                                 | AAC; exactly one audio track and no video             |
| WAV    | PCM s16; explicit s24/f32 supported | PCM s16/s24/f32; exactly one audio track and no video |

Defaults are deterministic. HEVC input becomes AVC in MP4 auto mode; choose copy mode to preserve HEVC packets. Copy does not require a decoder or encoder. Transcoding checks the exact resolved codec, dimensions, sample rate, and channel count, without silently substituting a codec or falling back to 48 kHz/stereo. Default encoding quality is high. WAV does not accept bitrate or quality settings.

Any explicit trim forces transcoding. Times are relative to the earliest nonnegative timestamp of the selected tracks; precision remains bounded by frame/sample boundaries and the output timescale. Geometry is applied in a fixed order: source orientation, additional rotation, crop, then resize. Explicit resize dimensions must be positive even integers; two dimensions require `fit`, while one dimension forbids it.

All audio/video tracks are selected by default. IDs come from `probe()`, not array positions. Formats never silently discard selected tracks; a track-count mismatch returns `TRACK_LOSS`.

```ts
const audio = await media(file).tracks({ video: false, audio: "primary" }).format("m4a").run();
```

## Metadata

All four output formats support `title`, `artist`, `album`, `albumArtist`, `genre`, `comment`, `description`, and `date`. Dates use valid `YYYY-MM-DD` strings. Set a field to null or an empty string to remove it.

Merge mode starts from supported source fields; replace mode starts empty. Cover art, lyrics, raw tags, and other unsupported source fields are omitted and reported. Raw tags are never forwarded, so deleting a title cannot revive it through a container-specific fallback. Removing descriptive metadata does not remove media content, codec configuration, orientation, technical timestamps, or filesystem information.

MP4/M4A use mdir tags, WebM uses SimpleTags, and WAV uses ID3. Some players do not display WAV tags. See the [complete specification](spec/design-v1.md) for field mappings and validation rules.

## File output and cancellation

The application obtains the handle and read/write permission before calling the library. The library does not open a picker or request permission. Input and output must be different files; a File/Blob cannot reliably reveal its original handle.

```ts
// Obtain the handle in an application-controlled user interaction.
const handle = await window.showSaveFilePicker({ suggestedName: "output.mp4" });
const result = await media(file)
  .format("mp4")
  .mode("copy")
  .run({ target: { type: "file", handle }, signal });
// commitState is 'committed' only after the actual file stream closes successfully.
```

Conversion finalization and cancellation cannot directly commit the real file. Before the commit barrier, cancellation waits for owned operations to settle and aborts the file stream. After entering `committing`, cancellation is ignored; a failed close returns `WRITE_FAILED` with `targetState: 'unknown'`.

Writes use `keepExistingData: false` and positioned writes, so successful replacement does not retain an old file tail. Missing permissions prevent opening a writable. Concurrent runs targeting the same file within one module instance return `TARGET_BUSY`; this lock does not cover other tabs, Workers, package instances, or external programs.

The library does not delete an empty file created by a picker. It does not guarantee power-loss durability or rollback after a failed close. WAV is limited to ordinary RIFF with a logical length no greater than `0xffffffff`; it never silently switches to RF64.

## Resource and network boundaries

Blob output buffers the entire result. File output propagates backpressure, but muxer indexes can still grow. To reject changing video dimensions, transcoding scans decoded frames in the selected range before Conversion executes, adding a decoding pass. Applications can place work in their own Worker and manage input/handle transfer.

URL reads use anonymous GET requests (`credentials: 'omit'`), normal CORS rules, and no automatic retries. Input disposal requests cancellation, but the underlying API does not expose confirmation that all browser-internal asynchronous cleanup has finished. Input URLs must remain stable for an operation; no ETag transaction or content lock is provided.

Progress is observational, not a completion signal. Only successful resolution of `run()` means completion. Throwing observers are disabled and reported without failing the conversion. Subscribing to progress can add scanning work. Sanitize raw error causes before showing them externally: they may contain signed URLs or local paths. The library disables Conversion's automatic warnings and performs no telemetry.

## Development and validation

Use Node 24 and the pinned pnpm 12.14.0. Vite+ supplies the dev server, Vitest, Oxlint, Oxfmt, type checks, and library packaging.

```sh
pnpm install --frozen-lockfile
pnpm exec vp check
pnpm exec vp test run
pnpm exec vp pack
pnpm exec playwright install chrome firefox webkit
pnpm test:browser
pnpm dev
```

FFmpeg and ffprobe must be on PATH for browser tests. `pnpm fixtures` regenerates the synthetic fixtures; tests normally use the checked-in files. Unicode strings in fixtures are deliberate test payloads, not documentation. The native file-picker check is at `/tests/native.html`; select only a dedicated test file. Applications needing extended File System Access TypeScript declarations can install `@types/wicg-file-system-access`.

See the [validation report](docs/validation.md) for actual browser results, acceptance criteria, and unverified areas. Automated WebKit is not Safari/iOS device acceptance, and OPFS tests do not replace native user-directory tests. The development page is a test harness, not a product UI.

## License

This wrapper is [MIT licensed](LICENSE). Mediabunny is separately licensed under MPL-2.0 and remains an external dependency. See [third-party notices](THIRD_PARTY_NOTICES.md) for its license and source links. This project does not relicense its dependencies.
