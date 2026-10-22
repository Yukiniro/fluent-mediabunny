# fluent-mediabunny

English | [简体中文](README.zh-CN.md)

A simpler, more approachable fluent TypeScript API for [Mediabunny](https://mediabunny.dev/).

Inspired by the chainable style of fluent-ffmpeg, fluent-mediabunny provides a convenient higher-level API over Mediabunny. It organizes configuration and execution into readable calls, reducing the setup needed to express a media task.

Mediabunny provides the underlying media processing capabilities. fluent-mediabunny focuses on making those public capabilities easier to understand and use through API design. The current release covers media conversion with one input and one output, and video image extraction with bounded batches.

## Why use it

**Keep the task readable.** A chain expresses the output you want, from its format to its time range and size. Configuration is immutable, so you can reuse a starting point for different outputs without changing the original builder.

**Reduce integration code.** Input setup, execution, cancellation, and cleanup are coordinated through the task API, reducing the lifecycle wiring you need to write around Mediabunny.

**Keep decisions visible.** Conversion results report resolved settings, selected and excluded tracks, metadata, and warnings. If a selected track cannot be preserved or the requested encoding is unavailable, the operation fails rather than silently dropping that track or substituting encoding parameters.

## Get started

After a maintainer publishes, `pnpm add fluent-mediabunny` installs the package from npm. Use Node 24 (pinned in [.node-version](.node-version)) and pnpm 12.14.0 to build it from source:

```sh
git clone https://github.com/Yukiniro/fluent-mediabunny.git
cd fluent-mediabunny
pnpm install --frozen-lockfile
pnpm build
pnpm pack --out fluent-mediabunny.tgz
```

Then install the generated tarball and the exact Mediabunny peer dependency from your application's directory:

```sh
pnpm add /path/to/fluent-mediabunny/fluent-mediabunny.tgz mediabunny@1.61.6
```

Replace the tarball path with its actual location. Your application needs a browser bundler.

### Prepare a video

```ts
import { media } from "fluent-mediabunny";

const result = await media(file)
  .format("webm")
  .trim({ start: 2, end: 12 })
  .resize({ width: 1280 })
  .run();

const previewUrl = URL.createObjectURL(result.blob);
```

Here, `file` is a browser `File` supplied by your application, long enough to contain the requested 2–12 second range. Revoke `previewUrl` with `URL.revokeObjectURL()` when the preview is no longer needed.

Conversion outputs can be MP4, WebM, M4A, or WAV. All audio/video tracks are selected by default; audio-only M4A and WAV require explicitly selecting one audio track and excluding video. The default mode copies tracks when compatible with the resolved settings and transcodes when needed; an explicit trim transcodes every selected track.

### Create a video preview

```ts
import { thumbnail } from "fluent-mediabunny";

const poster = await thumbnail(file, { time: 2, width: 640 });
if (poster) {
  const imageUrl = URL.createObjectURL(poster.blob);
  // Use imageUrl in your UI, then revoke it when no longer needed.
}
```

A request returns `null` when no frame covers that time. For a strip of previews, `thumbnails()` yields images on demand and preserves each requested position, including positions without a frame. Batches accept 1–1000 requests; output images are JPEG or PNG, with at most 4096 pixels per dimension and 16,000,000 pixels in area.

## Input and output

Inputs can be a `File`/`Blob`, `ArrayBuffer`, `Uint8Array` backed by an `ArrayBuffer`, or an absolute HTTP(S) URL. Remote sources must allow CORS; requests omit credentials. Codec availability depends on the browser, operating system, and device, so recognizing a container does not guarantee decoding or encoding support.

Conversion returns an in-memory Blob result by default. Applications can instead provide a distinct output file handle with read/write permission already granted. The library never opens a picker or requests permission. Cancellation aborts any opened file stream before commit; once commit starts, the run waits for the actual file close result. Processing progress alone does not mean the file has been saved.

## Contributing

Bug reports and focused improvements are welcome through [GitHub issues](https://github.com/Yukiniro/fluent-mediabunny/issues) and pull requests. For browser-specific issues, include your browser, operating system, and a small reproducible example using shareable media.

The project uses [Vite+](https://viteplus.dev/) for development, checks, tests, and packaging. Run `pnpm dev` to open the local validation harness, or use these commands to check a change:

```sh
pnpm check
pnpm test
pnpm build
pnpm test:package
pnpm exec playwright install chrome firefox webkit
pnpm test:browser
```

Browser tests require the built `dist`, the Playwright browsers, and FFmpeg/ffprobe on `PATH`. Synthetic fixtures are committed; `pnpm fixtures` regenerates them using FFmpeg, which is a test-only dependency. Automated WebKit and OPFS tests do not establish native picker or Safari/iOS support.

If your pull request changes `src/`, run `pnpm changeset` and commit the file it adds under `.changeset/`. While the version is below 1.0, choose `minor` for a breaking change and `patch` for anything else. Write the summary in English, because it becomes the changelog entry. If a `src/` change needs no release, run `pnpm changeset --empty` instead. [RELEASING.md](RELEASING.md) describes how maintainers publish.

## License

fluent-mediabunny is [MIT licensed](LICENSE). Mediabunny is a separate MPL-2.0 dependency; see the [third-party notices](THIRD_PARTY_NOTICES.md).
