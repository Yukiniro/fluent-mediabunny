# Media conversion

English | [简体中文](conversion.zh-CN.md)

`media(source)` builds one browser media conversion; `run(options?)` executes it. Public methods and types are defined in [index.ts](../src/index.ts) and [types.ts](../src/types.ts).

Processing uses public Mediabunny APIs. Applications manage Workers and codec installation; the library provides no automatic WASM/server fallback, uploads, or telemetry.

## Input and probe

- `MediaInput` accepts File/Blob, nonempty byte buffers (ArrayBuffer or Uint8Array backed by ArrayBuffer), or an absolute HTTP(S) URL. SharedArrayBuffer, paths, embedded URL credentials, and other URL schemes are unsupported.
- Supported input containers are MP4/M4A/MOV, WebM/MKV, MP3, WAV, Ogg, FLAC, and ADTS. Codec availability depends on the runtime.
- URL objects are snapshotted as strings. Finite static URL resources are read using anonymous CORS GET without retries; range support is optional. Callers keep source bytes and remote content stable until completion; media bytes are neither copied nor modified.
- Options are plain objects; unknown keys fail. `signal`, when supplied, is an AbortSignal.
- `probe(source, options?)` returns the source container, top-level duration, selected audio and video tracks, projected metadata, and omitted fields. Track IDs are source IDs, not indices. Unknown values stay `null`. They are not stored as zero and they are not filled with an estimate.
- Probe defaults to every audio track and every video track. `video` and `audio` use the same selection as conversion: `all`, `primary`, a nonempty unique list of source IDs, or `false`. Selection changes `tracks` only. The container, top-level duration, and file metadata keep their meaning. An empty selection returns `tracks: []` and does not throw `NO_TRACKS`. A missing or duplicate ID is `INVALID_OPTIONS`.
- Each selected track reports `startSeconds`, `endSeconds`, `elapsedSeconds`, `default`, `averageBitrate`, and `peakBitrate`. Start is the first packet timestamp, or `null` when the track has no packet. End is the track's metadata or scanned end timestamp. Elapsed is `endSeconds - startSeconds` when both are known, otherwise `null`. Top-level duration keeps the metadata or scan behavior below.
- Video tracks also report coded size, display size, rotation `0 | 90 | 180 | 270`, and `frameRate`. Audio tracks also report sample rate, channel count, `language`, and `name`. `language` is `null` when the container omits it or stores ISO 639-2 `und`.
- `frameRate` defaults to `{ hertz: null, origin: "unknown" }`. `frameRate: "estimate"` reads at most the first 256 packets and, when at least two distinct timestamps span a positive interval, returns `{ hertz, origin: "estimated" }`. Otherwise the result stays unknown. The estimate is not proof of a constant frame rate, and 256 packets is not a byte or time budget. A Mediabunny timebase substitute is not reported as a frame rate.
- Average bitrate and peak bitrate are metadata values. A missing value stays `null`.
- Probe defaults to `duration: "metadata"`. `"scan"` scans the top-level duration and each selected track's end. Unknown top-level duration is `null`, with `durationOrigin: "unknown"`. Probe reports source facts, not codec availability, and disposes its input before settling.
- Probe facts stay on `ProbeTrack`. They are not copied into conversion `TrackInfo` or conversion reports.

## Configuration

Builder methods perform no media I/O and return a new builder with copied options. Each `run()` owns independent resources.

| Calls                                                | Repeated-call behavior                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `format`, `mode`, `trim`, `resize`, `crop`, `rotate` | Replace the previous value                                                          |
| `video`, `audio`, `tracks`                           | Merge supplied fields; `undefined` and empty objects do not overwrite               |
| `metadata`                                           | Replace the entire instruction and mode; default `merge` applies to source metadata |

`bitrate` and `quality` are mutually exclusive: supplying both fails, and setting one later removes the other. Invalid method arguments throw `MediaError` synchronously; final-configuration and source-dependent errors reject `run()` during preparation.

## Formats and tracks

`format()` is required. Codec names use Mediabunny names without aliases. The first encode codec in each cell is the default.

| Output | Encode video | Encode audio              | Copy video    | Copy audio                |
| ------ | ------------ | ------------------------- | ------------- | ------------------------- |
| MP4    | avc          | aac                       | avc, hevc     | aac                       |
| WebM   | vp9, vp8     | opus                      | vp8, vp9, av1 | opus, vorbis              |
| M4A    | None         | aac                       | None          | aac                       |
| WAV    | None         | pcm-s16, pcm-s24, pcm-f32 | None          | pcm-s16, pcm-s24, pcm-f32 |

- Default selection is all audio/video tracks. `primary` uses Mediabunny's primary track; `false` excludes a media type. ID lists are nonempty, unique nonnegative safe integers identifying tracks of that type.
- M4A/WAV require exactly one audio track and no video. Callers exclude video explicitly. MP4/WebM retain selected tracks within backend limits; silent video is valid.
- No selected tracks yields `NO_TRACKS`; incompatible track counts or unexpected selected-track loss yields `TRACK_LOSS`.
- Processing options for an absent or excluded media type fail. Source non-audio/video content is outside track preservation and may produce `NON_AV_CONTENT_NOT_PRESERVED`.

## Encoding and geometry

- `auto` is the default: resolve the explicit or format-default codec, then copy compatible tracks when processing settings allow it. `transcode` re-encodes every selected track.
- `copy` preserves source codecs within the copy allowlist and requires no decoder or encoder. It rejects trim, resize, crop, nonzero rotation, and nonempty audio/video settings. Failure to copy any selected track fails the run.
- Encoding defaults to `quality: "high"`; explicit quality or bitrate forces transcoding. Bitrate is a positive finite integer in bits/s. PCM rejects quality and bitrate options.
- Frame rate is positive finite frames/s; sample rate and channel count are positive integers. Omitted values preserve source behavior. Unavailable requested configurations fail without codec, rate, or channel substitution.
- `keyFrameInterval` is finite seconds `>= 0` between video key frames; `0` makes every frame a key frame. Setting it, including `0`, forces video transcoding and leaves audio copy decisions unchanged. Omitted, the property is not passed to Mediabunny, whose 1.62.1 encoder falls back to 2 seconds. The value is a request to the encoder, not a guarantee of exact key-frame timestamps. It is not reported in `ResolvedTrack`.
- Trim uses finite `start >= 0` and optional `end > start`, relative to `max(0, min(selected firstTimestamp))`. Omitted end uses the selected tracks' end. Start at/after that end or an end beyond it fails. Every explicit trim transcodes all selected tracks, normalizes output time, and preserves inter-track offsets within frame/sample precision.
- Geometry order is source orientation/flip → additional rotation → crop → resize, regardless of call order. Rotation is 0, 90, 180, or 270 degrees. Crop uses nonnegative integer x/y and positive integer dimensions within the rotated frame.
- Resize requires at least one positive even dimension. Both dimensions require `fit: "contain" | "cover" | "fill"`; a single dimension prohibits fit and infers the other as `2 * ceil(round(aspect-preserving dimension) / 2)`. Upscaling is allowed.
- Transcoding rejects changing frame dimensions. AVC transcoding requires an avcC description and unchanged sequence parameter sets throughout the source, including outside a trim. Copy is unaffected.

## Metadata

Supported fields are `title`, `artist`, `album`, `albumArtist`, `genre`, `comment`, `description`, and `date`.

| Instruction                            | Effect                                   |
| -------------------------------------- | ---------------------------------------- |
| No call                                | Copy valid supported source fields       |
| `metadata(patch)`                      | Merge patch over supported source fields |
| `metadata(patch, { mode: "replace" })` | Write only the patch's nonempty values   |
| Field set to `null` or `""`            | Delete that field                        |
| Field omitted or `undefined`           | Supply no override                       |

Text preserves whitespace and Unicode; NUL and unpaired surrogates fail. Dates are valid `YYYY-MM-DD` calendar dates in years 0001–9999; source Date values use their UTC date.

Raw tags, images, attachments, and unsupported fields are omitted, including when no metadata call is made. Default/merge reports omitted or invalid source fields with `METADATA_OMITTED`; explicit overrides take precedence. Replace reports `replacedSourceMetadata` without per-field omission warnings. Explicit deletions appear in `removedByUser` even if absent in the source.

MP4/M4A use mdir tags, WebM uses SimpleTags, and WAV uses ID3v2.4. Removing descriptive tags leaves technical container metadata and media content intact.

| Field       | MP4/M4A | WebM         | WAV  |
| ----------- | ------- | ------------ | ---- |
| title       | ©nam    | TITLE        | TIT2 |
| artist      | ©ART    | ARTIST       | TPE1 |
| album       | ©alb    | ALBUM        | TALB |
| albumArtist | aART    | ALBUM_ARTIST | TPE2 |
| genre       | ©gen    | GENRE        | TCON |
| comment     | ©cmt    | COMMENT      | COMM |
| description | ©des    | DESCRIPTION  | TIT3 |
| date        | ©day    | DATE         | TDRC |

## Output and cancellation

- The default target returns `BlobResult`; a file target returns `FileResult` only after successful close. Reports contain resolved settings, selected/excluded tracks, metadata changes, and warnings. Resolved settings do not describe measured per-frame execution or actual hardware use.
- MIME is `video/mp4` or `video/webm` when video is present, otherwise `audio/mp4` or `audio/webm`; M4A uses `audio/mp4` and WAV uses `audio/wav`.
- Blob filenames are `output.<format>`. File output keeps the actual name and warns `FILENAME_EXTENSION_MISMATCH` when needed. Size is final logical length. MP4/M4A disable fast start; WebM is not append-only; WAV stays within ordinary RIFF's `0xffffffff` byte limit without RF64 fallback. Estimated or actual overflow fails before an oversized write or commit.
- File handles need granted read/write permission and `queryPermission`, `createWritable`, and `isSameEntry`. Applications choose a target distinct from the input; the library neither opens pickers nor requests permission, deletes picker-created files, or retries overwrites automatically.
- Configuration, source, codec, track, and metadata preparation finishes before opening the real writable. Successful output replaces existing content, including old trailing bytes. Concurrent writes to the same file within one module instance fail with `TARGET_BUSY`.
- A pre-aborted signal performs no media I/O. Before commit, cancellation stops new work, aborts staged file writes, and rejects `ABORTED` with the signal reason as cause. Failure returns no successful partial result.
- Commit begins after media finalization and pending writes complete. Cancellation is locked out before notifying `committing`, so aborting from that callback is already too late. The operation awaits actual file close or Blob publication. Only successful close means committed; it does not guarantee power-loss durability.
- The first observed failure/cancellation wins. Owned in-flight work and cleanup are awaited; later failures become diagnostics. Cleanup failure after successful conversion becomes `CLEANUP_FAILED`. No progress or result mutation occurs after settlement.
- File errors report `targetState`: `untouched` before opening, `aborted` after successful abort, or `unknown` when close/abort fails. Locks cover one module instance, not other tabs or programs.

Cancellation is cooperative with no fixed latency. Input disposal and owned cleanup finish before settlement, without guaranteeing physical release of all browser-internal resources. Repeated or post-settlement aborts do not repeat cleanup.

`onProgress` is a synchronous observer receiving phase `preparing`, `processing`, or `committing`. Only processing may have a numeric ratio; other or unknown progress is `null`. A ratio of 1 does not mean committed. Throwing or returning a Promise disables the observer with `CALLBACK_FAILED` without failing the run.

## Errors

`MediaError` carries code, phase, cause, details, diagnostics, and file target state where applicable. Applications sanitize raw causes before external display.

| Code                                                       | Meaning                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `INVALID_OPTIONS`                                          | Invalid values, conflicting settings, track IDs, or geometry/time bounds |
| `UNSUPPORTED_INPUT`                                        | Unsupported source/container or changing video configuration             |
| `UNSUPPORTED_OUTPUT_COMBINATION`                           | Explicit codec incompatible with output format                           |
| `CODEC_UNAVAILABLE`                                        | Required decoding or exact encoding configuration unavailable            |
| `COPY_NOT_POSSIBLE`                                        | Source codecs or processing cannot be copied                             |
| `NO_TRACKS`, `TRACK_LOSS`                                  | Empty selection or selected tracks cannot all be retained                |
| `UNSUPPORTED_METADATA_FIELD`                               | Unsupported explicit metadata key                                        |
| `TARGET_UNSUPPORTED`, `PERMISSION_REQUIRED`, `TARGET_BUSY` | Missing file APIs, permission, or concurrent target owner                |
| `READ_FAILED`, `WRITE_FAILED`, `OUTPUT_TOO_LARGE`          | Read, write/close, or logical size failure                               |
| `PROCESSING_FAILED`, `ABORTED`                             | Execution failure or accepted cancellation                               |

Related contracts: [thumbnails](thumbnails.md), [waveforms](waveforms.md), [embedded pictures](embedded-picture.md).
