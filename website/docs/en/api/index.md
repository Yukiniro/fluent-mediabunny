---
title: API reference
description: Public functions, conversion builder methods, result types, and errors exported by fluentbunny.
---

# API reference

Import public functions and types from `fluentbunny`. Every operation reads one source; conversion produces one output.

```ts
import { media, probe, thumbnail, thumbnails, getEmbeddedPicture, MediaError } from "fluentbunny";
```

## Conversion

| Reference                          | Purpose                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| [media / MediaBuilder](/api/media) | Configure output format, tracks, geometry, encoding, and metadata  |
| [run / results](/api/run)          | Execute a builder, receive progress, and inspect the output report |

Builder configuration is synchronous and immutable. `run()` returns a promise. Invalid method arguments throw immediately; source-dependent validation rejects execution.

## Inspection and extraction

| Function                                    | Return type                                | Purpose                                                    |
| ------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| [probe](/api/probe)                         | `Promise<ProbeResult>`                     | Container, duration, audio/video tracks, and text metadata |
| [thumbnail](/api/thumbnails#thumbnail)      | `Promise<ThumbnailImage \| null>`          | One decoded video frame                                    |
| [thumbnails](/api/thumbnails#thumbnails)    | `AsyncGenerator<ThumbnailItem>`            | One item per requested time, including missing frames      |
| [getEmbeddedPicture](/api/embedded-picture) | `Promise<Uint8Array<ArrayBuffer> \| null>` | One original embedded image, copied into owned bytes       |

## Shared contracts

All operations accept [MediaInput](/api/probe#mediainput). Options are plain objects; unknown keys fail validation. Pass an `AbortSignal` to cancel work. Keep input bytes and remote content stable until the task settles.

Failures use [MediaError](/api/errors). A `null` image is a successful read with no matching image, not a decoding or network failure.
