# fluent-mediabunny

A simpler, more approachable fluent TypeScript API for [Mediabunny](https://mediabunny.dev/).

Inspired by the chainable style of fluent-ffmpeg, fluent-mediabunny aims to make Mediabunny easier to understand and use. It brings related media operations into a readable API, reducing the setup needed to turn an idea into a working media workflow.

The project can draw on the full range of Mediabunny APIs, including input and output, tracks, packets, samples, metadata, and conversion. Conversion is one building block, not the limit of the project. The current release covers browser media conversion and video image extraction; it does not yet expose every Mediabunny capability.

```ts
import { media } from "fluent-mediabunny";

const result = await media(file)
  .format("webm")
  .trim({ start: 2, end: 12 })
  .resize({ width: 1280 })
  .run();

const previewUrl = URL.createObjectURL(result.blob);
```

## What you can do today

- Convert media to **MP4, WebM, M4A, or WAV**.
- Trim, resize, crop, rotate, and change video frame rates.
- Extract audio, adjust its sample rate and channels, and select tracks.
- Extract posters, screenshots, and batches of timeline previews as JPEG or PNG.
- Inspect media information and edit descriptive metadata.
- Copy compatible tracks without re-encoding, or transcode when needed.
- Follow conversion progress, cancel work, and save to a Blob or an application-provided file handle.

The API is immutable, so one starting configuration can be reused for different outputs. Processing uses browser media capabilities; available codecs vary by browser, operating system, and device.

```ts
import { thumbnail, thumbnails } from "fluent-mediabunny";

const poster = await thumbnail(file, { time: 2, width: 640 });

for await (const item of thumbnails(file, { start: 0, end: 10, count: 5, width: 160 })) {
  if (item.image) showPreview(item.index, item.image.blob);
}
```

Image batches preserve request positions, support cancellation, and release resources on early loop exit. See the [image extraction guide](docs/thumbnails.md) for time selection and output options.

## Where it fits

The project serves browser applications that need straightforward media conversion and video previews: upload preparation, personal media tools, and audio or video utilities. Local media is processed in the browser without a conversion server or an FFmpeg runtime.

The current release does not include concatenation, mixing, overlays, live streaming, or server-side processing. These are current release boundaries, rather than a restriction to the Conversion API. The project does not aim to reproduce the FFmpeg command-line interface.

## Try it locally

The package is in early development and **has not been published to npm**. Use Node 24 and pnpm 12.14.0 to build it from source:

```sh
git clone https://github.com/Yukiniro/fluent-mediabunny.git
cd fluent-mediabunny
pnpm install --frozen-lockfile
pnpm build
pnpm pack
```

Install the generated tarball in your browser application alongside `mediabunny@1.61.6`. A browser bundler is required.

## Learn more

- [Version 1 specification](spec/design-v1.md): API reference, supported formats, and behavior guarantees.
- [Video image extraction specification](spec/spec-design-v0-2.md) ([中文](spec/spec-design-v0-2.zh-CN.md)).
- [Image extraction validation](docs/thumbnail-validation.md): acceptance criteria and browser limitations.
- [Validation report](docs/validation.md): tested browsers, reproduction commands, and known limits.
- [GitHub Actions](https://github.com/Yukiniro/fluent-mediabunny/actions): current automated checks.

## Contributing

Bug reports and focused improvements are welcome through [GitHub issues](https://github.com/Yukiniro/fluent-mediabunny/issues) and pull requests. For browser-specific issues, include your browser, operating system, and a small reproducible example using shareable media.

The project uses [Vite+](https://viteplus.dev/) for development, checks, tests, and packaging. See the validation report for the local test setup, and keep changes within the approved conversion and video image extraction scopes.

## License

fluent-mediabunny is [MIT licensed](LICENSE). Mediabunny is a separate MPL-2.0 dependency; see the [third-party notices](THIRD_PARTY_NOTICES.md).
