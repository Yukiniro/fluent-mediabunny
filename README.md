# fluent-mediabunny

A fluent TypeScript library for converting audio and video in the browser, powered by [Mediabunny](https://mediabunny.dev/).

Inspired by the approachable, chainable style of fluent-ffmpeg, fluent-mediabunny makes common media tasks easy to express. Prepare a video for upload, extract an audio track, or make a shorter clip — without running FFmpeg or sending local media to a conversion server.

```ts
import { media } from "fluent-mediabunny";

const result = await media(file)
  .format("webm")
  .trim({ start: 2, end: 12 })
  .resize({ width: 1280 })
  .run();

const previewUrl = URL.createObjectURL(result.blob);
```

## What you can do

- Convert media to **MP4, WebM, M4A, or WAV**.
- Trim, resize, crop, rotate, and change video frame rates.
- Extract audio, adjust its sample rate and channels, and select tracks.
- Inspect media information and edit descriptive metadata.
- Copy compatible tracks without re-encoding, or transcode when needed.
- Follow conversion progress, cancel work, and save to a Blob or an application-provided file handle.

The API is immutable, so one starting configuration can be reused for different outputs. Processing uses browser media capabilities; available codecs vary by browser, operating system, and device.

## Where it fits

fluent-mediabunny is for browser applications that need straightforward, **one-input, one-output conversion**: upload preparation, personal media tools, and audio or video utilities.

It is not a full FFmpeg replacement or a timeline editor. Version 1 does not include concatenation, mixing, overlays, live streaming, or server-side processing. It builds on Mediabunny's official Conversion API and leaves more advanced media workflows to the underlying library.

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
- [Validation report](docs/validation.md): tested browsers, reproduction commands, and known limits.
- [GitHub Actions](https://github.com/Yukiniro/fluent-mediabunny/actions): current automated checks.

## Contributing

Bug reports and focused improvements are welcome through [GitHub issues](https://github.com/Yukiniro/fluent-mediabunny/issues) and pull requests. For browser-specific issues, include your browser, operating system, and a small reproducible example using shareable media.

The project uses [Vite+](https://viteplus.dev/) for development, checks, tests, and packaging. See the validation report for the local test setup, and keep changes within the version 1 scope.

## License

fluent-mediabunny is [MIT licensed](LICENSE). Mediabunny is a separate MPL-2.0 dependency; see the [third-party notices](THIRD_PARTY_NOTICES.md).
