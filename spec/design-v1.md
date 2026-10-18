---
title: fluent-mediabunny v1 API and execution contract
version: 1.0.0-spec
date_created: 2026-10-18
last_updated: 2026-10-18
status: design-baseline
language: en
tags: [design, typescript, media, mediabunny, browser]
---

# Introduction

This specification defines a browser TypeScript wrapper around the official Mediabunny Conversion API. An immutable fluent builder describes one input and one output; `run()` executes the operation. The wrapper owns input/output adaptation, deterministic defaults, validation, track integrity, metadata projection, cancellation, and resource lifetimes.

The v1 design excludes presets and uses an object-based metadata interface with merge, replace, and field deletion. This is the design baseline, not evidence that every acceptance criterion has passed. See [implementation validation](../docs/validation.md) for actual results and remaining gaps. Upstream behavior was reviewed against Mediabunny **1.61.6**; wrapper policies are not necessarily upstream defaults.

## 1. Purpose and scope

Hide the `Source → Input → Conversion → Output → Target` wiring while keeping encoding choices, omitted tracks/fields, and errors explainable.

| Area     | v1 scope                                                                           |
| -------- | ---------------------------------------------------------------------------------- |
| Platform | Capable browsers; no DOM access in the core; application-managed Dedicated Workers |
| Input    | One File/Blob, ArrayBuffer, Uint8Array, or absolute HTTP(S) URL                    |
| Output   | One MP4/WebM/M4A/WAV, as a Blob or caller-provided FileSystemFileHandle            |
| Video    | Remux, transcode, trim, resize, crop, rotation, frame-rate adjustment              |
| Audio    | Extract, exclude, transcode, resample, change channels                             |
| Control  | Probe, progress, AbortSignal, structured errors, result reports, cleanup           |
| Metadata | Copy, override, delete, or replace eight descriptive fields                        |

Excluded: presets, concatenation, multi-input composition, overlays, subtitles, mixing, transitions, speed changes, filter collections, thumbnails, live/HLS streams, protocol conversion, Node adapters, automatic Workers, custom process callbacks, raw Input/Output injection, arbitrary FFmpeg arguments, and automatic WASM or server fallbacks. This is an ergonomic Conversion wrapper, not an FFmpeg compatibility layer.

## 2. Definitions

| Term            | Meaning                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------- |
| Builder         | Immutable configuration with no open media resources                                      |
| Run             | Independent execution owning its Input, Output, Conversion, and resource scope            |
| copy            | Copy encoded packets and remux; not byte-for-byte file or metadata copying                |
| transcode       | Decode and re-encode                                                                      |
| auto            | Copy or transcode according to explicit target codecs and requested operations            |
| Selected tracks | Audio/video tracks exposed by the backend and selected by tracks()                        |
| Metadata        | Managed descriptive tags, not all container/track/filesystem information                  |
| Commit          | Start closing the real file stream to publish the result; cancellation is then locked out |
| MUST / MUST NOT | Required / prohibited acceptance behavior                                                 |
| SHOULD          | Recommended; deviations need an implementation explanation                                |

## 3. Requirements and constraints

| ID      | Requirement                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------ |
| REQ-001 | Provide the explicit API below; no presets or copy/strip metadata string overloads               |
| REQ-002 | Immutable builders perform no media I/O; probe and run are independent async terminal operations |
| REQ-003 | Follow the fixed format/codec matrix; no silent codec, rate, or channel substitutions            |
| REQ-004 | Validate every selected audio/video track; unexpected track loss fails the operation             |
| REQ-005 | Follow metadata projection, merge, deletion, replacement, and omission rules                     |
| REQ-006 | Use one cancellation/commit arbiter; pre-commit cancellation cannot close a partial file         |
| REQ-007 | Success requires both media finalization and target commit to succeed                            |
| REQ-008 | Respect network, permission, ownership, and target-concurrency boundaries                        |
| REQ-009 | Report only observed facts; planned configuration is labeled resolved/planned                    |
| REQ-010 | Clean up on success, failure, and cancellation without replacing the primary error               |
| CON-001 | Use only official public APIs; no private methods or underscore-prefixed state                   |
| CON-002 | Track preservation covers exposed audio/video tracks, not undiscovered attachments/subtitles     |
| CON-003 | Do not load custom WASM encoders or server backends automatically                                |
| SEC-001 | No automatic uploads, save/download UI, permission requests, or signed-URL logging               |
| SEC-002 | Do not describe descriptive-tag removal as privacy erasure                                       |
| GUD-001 | Reuse configuration with ordinary TypeScript functions, not a template subsystem                 |

## 4. Interfaces and data contracts

### 4.1 Public API

The following signatures describe the interface. Published types and runtime validation must reject unknown options.

```ts
type MediaInput = Blob | ArrayBuffer | Uint8Array | URL | string;
type Format = "mp4" | "webm" | "m4a" | "wav";
type Mode = "auto" | "copy" | "transcode";
type Quality = "low" | "medium" | "high";
type TrackSelection = "all" | "primary" | readonly number[] | false;
type VideoOptions = {
  codec?: "avc" | "vp8" | "vp9";
  bitrate?: number;
  quality?: Quality;
  frameRate?: number;
};
type AudioOptions = {
  codec?: "aac" | "opus" | "pcm-s16" | "pcm-s24" | "pcm-f32";
  bitrate?: number;
  quality?: Quality;
  sampleRate?: number;
  channels?: number;
};
type ResizeOptions = {
  width?: number;
  height?: number;
  fit?: "contain" | "cover" | "fill";
};
type MetadataPatch = {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  genre?: string | null;
  comment?: string | null;
  description?: string | null;
  date?: string | null; // Strict YYYY-MM-DD
};
type Target = "blob" | { type: "file"; handle: FileSystemFileHandle };
type RunOptions = {
  target?: Target;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
};
interface MediaBuilder {
  format(value: Format): MediaBuilder;
  mode(value: Mode): MediaBuilder;
  trim(value: { start: number; end?: number }): MediaBuilder;
  resize(value: ResizeOptions): MediaBuilder;
  crop(value: { x: number; y: number; width: number; height: number }): MediaBuilder;
  rotate(value: 0 | 90 | 180 | 270): MediaBuilder;
  video(value: VideoOptions): MediaBuilder;
  audio(value: AudioOptions): MediaBuilder;
  tracks(value: { video?: TrackSelection; audio?: TrackSelection }): MediaBuilder;
  metadata(value: MetadataPatch, options?: { mode?: "merge" | "replace" }): MediaBuilder;
  run(options?: RunOptions): Promise<MediaResult>;
}
declare function media(source: MediaInput): MediaBuilder;
declare function probe(
  source: MediaInput,
  options?: {
    signal?: AbortSignal;
    duration?: "metadata" | "scan";
  },
): Promise<ProbeResult>;
```

File is a Blob. Strings mean absolute HTTP(S) URLs, never paths, relative URLs, data URLs, or blob URLs. Pass local files directly as File/Blob. Codec names follow Mediabunny; there are no aliases such as h264.

`run()` must narrow its return type by target: omitted/blob targets return BlobResult, file targets return FileResult. Missing format returns INVALID_OPTIONS; never infer it from a name, MIME type, or input container.

### 4.2 Configuration and overrides

- Every method returns a new builder. Object/array options are copied; URL objects are snapshotted as strings. Media bytes are not copied. Callers must not mutate or detach buffers before probe/run settles; SharedArrayBuffer-backed inputs are unsupported.
- format/mode/trim/resize/crop/rotate replace their previous values.
- video/audio/tracks merge only explicitly supplied fields; undefined does not overwrite, and empty objects do nothing.
- bitrate and quality are mutually exclusive. Supplying both together fails; setting one later removes the other.
- Each metadata call replaces the whole instruction and mode. Merge is with source fields, not the previous call.
- No generic reset, clone, or build method. Reuse immutable builders; each run creates fresh resources.
- Locally invalid method arguments throw MediaError synchronously. Validation requiring the final configuration or source rejects run during preparation. probe/run always return Promises.

### 4.3 Parameters, time, and geometry

| Parameter           | Contract                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------ |
| bitrate             | Positive finite integer in bits/s; no unit strings or promised final file size             |
| frameRate           | Positive finite frames/s; omission preserves source frame-rate behavior, including VFR     |
| sampleRate/channels | Positive finite integers; omission preserves source values, without 48 kHz/stereo fallback |
| trim                | Finite start ≥ 0; optional end > start; relative to the selected common playback origin    |
| crop                | Nonnegative integer x/y, positive integer width/height; must fit the rotated frame         |
| resize              | At least one dimension; explicitly supplied dimensions must be positive even integers      |
| fit                 | Required with both dimensions; prohibited with only one dimension                          |

Trim origin is `max(0, min(selected firstTimestamp))`. Convert the requested range to absolute backend time, normalize output time, and retain inter-track offsets. Negative trimming is unsupported. Preparation determines the selected end timestamp: start at/after it or end beyond it fails instead of silently clamping. Omitted end uses that timestamp. Sparse tracks, encoder delay, and frame boundaries may prevent a sample from landing exactly at zero.

Every explicit trim forces all selected tracks to transcode and conflicts with copy. Precision is limited by frames, samples, and the output timescale.

Geometry order is source orientation/flip → additional rotation → crop → resize, regardless of chaining order. Infer a missing resize dimension with `even(round(known dimension / corresponding aspect ratio))`, where `even(n) = 2 * ceil(n / 2)`. Report resolved dimensions. Upscaling is allowed. Apply and validate processing options for every selected track. Changing frame dimensions during transcoding must fail rather than silently choosing another size policy.

Explicit video/geometry options without selected video, or audio options without selected audio, fail with INVALID_OPTIONS. Format defaults alone do not require audio in a silent source. An explicitly excluded media type cannot also have nonempty processing options.

### 4.4 Container and codec matrices

Input allowlist: MP4/M4A/MOV, WebM/MKV, MP3, WAV, Ogg, FLAC, and ADTS. Container recognition is distinct from packet-copy support and runtime decode/encode support. HLS, MPEG-TS, live streams, arbitrary formats, and network protocols outside HTTP(S) are out of scope.

| Output | Encode video       | Encode audio                        | Copy video    | Copy audio                |
| ------ | ------------------ | ----------------------------------- | ------------- | ------------------------- |
| mp4    | avc                | aac                                 | avc, hevc     | aac                       |
| webm   | vp9 (default), vp8 | opus                                | vp8, vp9, av1 | opus, vorbis              |
| m4a    | None               | aac                                 | None          | aac                       |
| wav    | None               | pcm-s16 (default), pcm-s24, pcm-f32 | None          | pcm-s16, pcm-s24, pcm-f32 |

M4A is an audio-only Mp4OutputFormat policy, not a presumed M4aOutputFormat class. M4A/WAV require exactly one audio track and no video; callers must select tracks explicitly. MP4/WebM retain selected tracks up to backend limits; exceeding a track limit fails rather than truncating the selection.

| Format | Extension | MIME                                        | Fixed output settings                       |
| ------ | --------- | ------------------------------------------- | ------------------------------------------- |
| mp4    | .mp4      | video/mp4 with video; otherwise audio/mp4   | metadataFormat: mdir; fastStart: false      |
| webm   | .webm     | video/webm with video; otherwise audio/webm | appendOnly: false                           |
| m4a    | .m4a      | audio/mp4                                   | MP4 settings with the audio-only constraint |
| wav    | .wav      | audio/wav                                   | metadataFormat: id3; large: false           |

Both Blob and file MP4 targets use fastStart=false. Progressive-download fast start is not promised. WAV must not switch to RF64: estimated or actual logical size above `0xffffffff` fails with OUTPUT_TOO_LARGE before commit. Check positioned-write bounds before writing, not after an overflowing header is emitted. File output reduces whole-file buffering but muxer indexes may still grow.

### 4.5 Defaults and mode resolution

1. Resolve track selection and format constraints before codecs. Explicit codec options win; otherwise use the format's default encoding codec.
2. Auto may copy only when source and resolved codecs match and geometry, timing, quality, and timestamp constraints allow it.
3. Transcode re-encodes every selected track.
4. Copy preserves source codecs within the copy allowlist. Nonempty video/audio options, trim, resize, crop, and nonzero rotation are prohibited. Format, tracks, metadata, and rotate(0) are allowed. Failure to copy any selected track fails the entire run.
5. An explicit codec incompatible with the format returns UNSUPPORTED_OUTPUT_COMBINATION regardless of chaining order.
6. Encoding without explicit quality/bitrate uses Quality('high'). Do not inject quality solely to express that default on a potentially copyable track. Explicit quality/bitrate forces transcoding.
7. PCM bitrate follows sample rate, channels, and bit depth; WAV bitrate/quality options return INVALID_OPTIONS.
8. Preserve source rates/channels unless requested otherwise. Check exact encoding parameters and prohibit backend fallback to 48 kHz/stereo.
9. Copy must not require decoder/encoder availability. Transcoding checks decoding and encoding at resolved parameters. A static capability check is not a guarantee that execution will succeed.

### 4.6 Track integrity

Default selection is `{ video: 'all', audio: 'all' }`. Primary uses the backend primary-track choice. All/primary may find no source tracks of one type. Nonempty ID arrays use probe IDs, not ordinals; duplicates, cross-type IDs, unknown IDs, and empty arrays fail. Use false to exclude a type. Omitted types retain earlier settings.

No selected tracks returns NO_TRACKS. Track-count incompatibility returns TRACK_LOSS. After initialization, inspect isValid, utilizedTracks, and discardedTracks; every omission must be explained by the requested selection. Unexpected loss fails. Reports contain selected/excludedByUser. Detected non-audio/video content may produce NON_AV_CONTENT_NOT_PRESERVED, without claiming exhaustive detection.

### 4.7 Metadata

| Field       | Input           | MP4/M4A mdir | WebM SimpleTags | WAV ID3v2.4 |
| ----------- | --------------- | ------------ | --------------- | ----------- |
| title       | string/null     | ©nam         | TITLE           | TIT2        |
| artist      | string/null     | ©ART         | ARTIST          | TPE1        |
| album       | string/null     | ©alb         | ALBUM           | TALB        |
| albumArtist | string/null     | aART         | ALBUM_ARTIST    | TPE2        |
| genre       | string/null     | ©gen         | GENRE           | TCON        |
| comment     | string/null     | ©cmt         | COMMENT         | COMM        |
| description | string/null     | ©des         | DESCRIPTION     | TIT3        |
| date        | YYYY-MM-DD/null | ©day         | DATE            | TDRC        |

Strings must support Unicode, tested with CJK text and emoji. Player display of tags is outside this guarantee. WAV explicitly uses ID3v2.4 rather than RIFF INFO; its nondefault tag-display compatibility must be documented.

Dates accept valid Gregorian dates in years 0001–9999. Reject Date objects in user patches, timestamps/time zones, invalid leap days, and year-only strings. Construct UTC dates without JavaScript's 0–99 constructor offset. Preserve a calendar date, not a time or zone. Reject NUL and unpaired UTF-16 surrogates. Empty strings equal deletion; do not trim nonempty text.

Native source date tags are Date objects: validate the value and UTC year, project to UTC YYYY-MM-DD, then reconstruct a UTC Date for native output tags. Do not discard a valid native date merely because it is not a string.

| Operation                                             | Meaning                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| No metadata call                                      | Copy readable, valid source fields from the eight-field allowlist       |
| metadata({ title: 'New title' })                      | Merge over projected source fields                                      |
| metadata({ comment: null })                           | Delete comment from the projection                                      |
| metadata({ title: 'New title' }, { mode: 'replace' }) | Write only this instruction's nonempty, non-null fields                 |
| metadata({}, { mode: 'replace' })                     | Write none of the managed descriptive tags                              |
| Another metadata call                                 | Replace the entire previous instruction; omitted mode means merge again |

Missing/undefined means no supplied value. Null/empty strings become deletion, not native MetadataTags values. Never forward inputTags wholesale: strip raw, images, attachments, and every non-allowlisted key, even without a metadata call. Otherwise raw fallback can resurrect deleted fields in same-container output.

Unknown user fields return UNSUPPORTED_METADATA_FIELD; invalid user values return INVALID_OPTIONS. Under default/merge, unsupported exposed source fields are omitted and listed in omittedSourceFields with an omission warning (the design names this METADATA_SOURCE_FIELDS_OMITTED; v1 implementation uses METADATA_OMITTED). Do not invent hidden raw subkeys. Invalid source values are omitted and reported rather than blocking conversion; explicit overrides/deletions take precedence. Replace is intentional removal: report replacedSourceMetadata=true without per-field warnings. Explicit deletions are listed in removedByUser even if absent in the source.

Creation time, copyright, lyrics, images, track/disc numbers, BPM, and arbitrary keys are excluded. The reviewed ID3 lyrics path also had a Unicode length concern, so lyrics are not in the public or copied set. Descriptive-tag replacement does not erase technical MP4 timestamps, WebM writing/muxing application tags, orientation, codec settings, media content, or filesystem metadata. Do not call it “remove all metadata.”

### 4.8 URL inputs, ownership, and probe

- URLs represent finite static HTTP(S) resources read through GET/CORS with credentials=omit. No custom headers, Request objects, auth configuration, or fetch injection.
- Respect same-origin, CORS, mixed-content, and browser security policies. No proxy or access-control bypass. Signed query strings may be transmitted as supplied but must be sanitized in external logs/errors.
- Range support is not required; backend sequential reads are allowed. Do not claim random access without response evidence. The design's rangeSupport value is unknown absent such evidence; the v1 public report does not expose a range-support field.
- Disable UrlSource's default indefinite retries. First network/HTTP failure maps to READ_FAILED; cancellation maps to ABORTED.
- Callers must keep remote resource content stable during a run. No ETag snapshot or content-hash locking; not every remote mutation can be detected.
- File/Blob use browser snapshot semantics; arrays remain caller-owned. Never modify or detach them.
- Probe defaults to duration:'metadata'; unknown duration is null. Only scan mode explicitly requests duration scanning.
- ProbeResult describes the source: container, durationSeconds, durationOrigin (metadata/scanned/unknown), track ID/type/codec, available video dimensions or audio rate/channels, projected tags, and known omissions. Unknown values must not be disguised as zero. Fields inapplicable to a track type may be absent.
- Probe follows the same signal/cleanup rules, writes no output, and does not test every encoder or decode solely to display container facts.

### 4.9 State, cancellation, and races

State progression is preparing → processing → committing → completed. Before committing, cancellation or failure can terminate the operation. Committing accepts only success or failure, not cancellation. Blob result publication also has a short commit barrier.

| Cancellation point                | Required behavior                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Signal already aborted            | Reject ABORTED without reads, fetch, Conversion initialization, or writable creation               |
| Preparing, including init         | Latch cancellation, dispose existing Input, and clean up late-created resources; never execute     |
| Processing/finalizing             | Block subsequent writes, request conversion cancellation, dispose Input, and abort the real stream |
| Execution complete, before commit | Cancellation wins; discard Blob data or abort staged file writes                                   |
| Committing                        | Ignore later abort; await close/publication and report its actual outcome                          |
| Promise settled                   | No action                                                                                          |

Register the listener and check the signal before asynchronous work. Check latched state at async boundaries. Enter commit with synchronous “check failure/cancel, then lock committing,” with no await between them. Notify committing after locking; canceling from that notification is too late.

The first observed terminal event wins. Cancellation first yields ABORTED; processing failure first retains that error. Later errors become diagnostics. Repeated abort must not repeatedly close resources. Cancellation is cooperative, with no fixed latency guarantee for native codecs/filesystems.

Do not use Promise.race to reject while owned work keeps writing. Await owned execution/write/cancel operations that expose completion, dispose Input, and remove listeners. Input.dispose is synchronous but some internal cleanup is asynchronous; do not claim physical destruction of all browser resources at Promise settlement.

### 4.10 File commit boundary

File targets require caller-granted handles with queryPermission, createWritable, and isSameEntry. Query readwrite permission; anything other than granted returns PERMISSION_REQUIRED. Missing APIs return TARGET_UNSUPPORTED. Never call a picker/requestPermission or attempt a write to trigger authorization. Later permission revocation can still fail create/write/close.

1. Complete configuration, format, track, codec, and metadata checks before opening the real writable. Conversion initialization uses an output adapter that does not open it.
2. Call createWritable({keepExistingData:false}). Use positioned writes and track logical size as max(position + byteLength), not cumulative writes.
3. Connect StreamTarget to an intermediate owned WritableStream. Its write forwards positioned writes with backpressure; its close MUST NOT close the real file.
4. This separation is necessary because upstream Output.cancel closes its target, and StreamTarget closes its stream.
5. After execute/finalize and pending writes finish without prior failure/cancel, atomically enter committing, then close the real file. Only successful close means committed.
6. Before commit, failure/cancel prohibits real close and invokes real abort, queue handling, and output cleanup.
7. Failed close returns WRITE_FAILED and targetState=unknown; do not assume the old file is intact. Abort/cleanup failure preserves the primary error and marks unknown.
8. No opened stream means untouched; successful abort means aborted for this task, not a global guarantee against outside changes. Failures return no successful partial Blob/file result.
9. Do not delete picker-created empty files, retry overwrites automatically, or equate close with power-loss durability.
10. Serialize isSameEntry checks within a module instance before opening streams. Concurrent runs on the same file return TARGET_BUSY. Release leases on every exit. Other tabs, package instances, and programs are outside the lock.
11. Intentional in-place input overwrite is unsupported. File does not reliably identify its original handle; callers must choose a distinct target. Names cannot prove identity.

### 4.11 Progress, results, and errors

ProgressEvent is `{phase:'preparing'|'processing'|'committing', ratio:number|null}`. Only processing has a measurable ratio; preparing/committing use null, and unknown processing duration may also use null. Subscribing can add scanning cost. Only run's successful resolution means completion.

onProgress is a synchronous observer, not a control callback. Catch throws, record CALLBACK_FAILED, disable that observer, and continue. Async observers are unsupported; defensively handle an accidental returned Promise's rejection without awaiting it or changing the settled result. No notifications or report mutation after settlement.

| Result     | Fields                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| BlobResult | kind:'blob', blob, mimeType, size, suggestedFilename, report                                                         |
| FileResult | kind:'file', actual filename, mimeType, size, report, commitState:'committed'                                        |
| Report     | Resolved format/mode/per-track parameters; selected/excludedByUser; metadata projection/removals/omissions; warnings |

Warn FILENAME_EXTENSION_MISMATCH without renaming the actual file. Blob suggestions are output.<extension>, never derived from a signed URL. Size is final logical length, not network traffic or accumulated writes. Resolved configuration is not measured per-frame behavior; do not fabricate actual hardware use, copy/transcode execution claims, or exact final duration.

MediaError exposes code, phase, message, details, cause, diagnostics, and file targetState when applicable. Raw cause is for local diagnosis; sanitize credentials, query strings, and paths before external display. No automatic telemetry.

| Code                                                   | Meaning                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| INVALID_OPTIONS                                        | Invalid values, conflicts, track IDs, time/geometry bounds                    |
| UNSUPPORTED_INPUT                                      | Unsupported input type/container                                              |
| UNSUPPORTED_OUTPUT_COMBINATION                         | Explicit codec incompatible with format                                       |
| CODEC_UNAVAILABLE                                      | Required decode/encode capability or exact encoding configuration unavailable |
| COPY_NOT_POSSIBLE                                      | Copy allowlist mismatch or required transcoding                               |
| NO_TRACKS / TRACK_LOSS                                 | Empty selection / selected tracks cannot all be retained                      |
| UNSUPPORTED_METADATA_FIELD                             | Explicit unsupported user metadata field                                      |
| TARGET_UNSUPPORTED / TARGET_BUSY / PERMISSION_REQUIRED | Missing file API / concurrent owner / permission missing                      |
| READ_FAILED / WRITE_FAILED / OUTPUT_TOO_LARGE          | Input / write or commit / length-limit failure                                |
| PROCESSING_FAILED                                      | Other execution failure, retaining its cause                                  |
| ABORTED                                                | Cancellation accepted before commit; signal.reason retained as cause          |

Cleanup errors never replace the primary error. After successful media/file completion, noncritical input cleanup failures become CLEANUP_FAILED warnings; on failure, attach them to diagnostics.

## 5. Acceptance criteria

These define required paths; see the separate validation report for evidence and outstanding platform work.

| ID     | Expected behavior                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------- |
| AC-001 | Derived builders leave the base unchanged; repeated runs own independent resources                            |
| AC-002 | Replacement/merge rules and metadata instruction replacement follow 4.2; no preset                            |
| AC-003 | HEVC→MP4 auto resolves AVC; copy preserves HEVC without requiring an encoder; unsupported auto fails          |
| AC-004 | AVC/WebM, WAV bitrate, and copy+trim fail before writable creation                                            |
| AC-005 | Unsupported exact sample rate fails even when 48 kHz is available; no fallback                                |
| AC-006 | M4A from video input requires explicit video exclusion and retains selected audio                             |
| AC-007 | Multi-audio WAV fails without selection; primary/ID selection works; silent MP4 is valid                      |
| AC-008 | Merge, deletion, and replace work; raw tags cannot resurrect a removed title                                  |
| AC-009 | Eight fields round-trip in four formats with CJK/emoji/leap-day data; unsupported explicit fields fail early  |
| AC-010 | Omitted source images/lyrics/raw are reported when exposed; replace does not issue per-field warnings         |
| AC-011 | Pre-aborted run/probe performs no I/O; late initialization resources are reclaimed                            |
| AC-012 | Abort during writes/finalize invokes real abort, never real close, and returns no success                     |
| AC-013 | Abort after commit does not turn success into ABORTED; close failure means WRITE_FAILED+unknown               |
| AC-014 | Network failure does not retry indefinitely; abort stops URL reads without unhandled rejections               |
| AC-015 | Only one concurrent same-target run opens a stream; replacement removes old trailing bytes                    |
| AC-016 | Repeated positioned writes produce correct logical size; output reopens with all selected tracks              |
| AC-017 | Progress=1 does not resolve before commit; observer failures do not break commit semantics                    |
| AC-018 | Nonzero timestamps, rotation, VFR, trim, and resize preserve defined timing/geometry within sample tolerances |
| AC-019 | Primary read/encode/write/cancel errors survive cleanup failure; first observed event wins                    |
| AC-020 | WAV exceeding ordinary RIFF bounds fails before commit, without RF64 fallback                                 |

## 6. Test strategy

Use Vitest for parameter boundaries, merge rules, dates/Unicode, matrices, projection, arbitration, and error mapping. Integration tests use actual Mediabunny; controlled capability substitutes exercise refusal paths but do not count as real codec success.

Use Playwright Chrome/Chromium as the first baseline and record actual WebKit/Firefox capabilities. Automated WebKit is not Safari/iOS acceptance. OPFS supports real browser write tests; native user-directory permissions, overwrite, and cancellation require a separate manual check.

Use synthetic, redistributable fixtures: AVC/AAC, HEVC, VP8/VP9/Opus, MP3, WAV, silent/multi-audio, nonzero timestamps, rotation, VFR, odd dimensions, unusual rates, corrupt inputs, and Unicode/raw tags. Record source and timing expectations. Re-demux output and cross-check key fields with an independent parser/player. Inject delayed/rejected write/close/abort operations. Use bounded size-fault injection rather than multi-gigabyte CI fixtures.

CI runs unit/build/browser checks and labels missing codec capability explicitly. Core successful combinations need a real capable environment before release. Record long-file/repeated-operation resource trends without inventing throughput or constant-memory guarantees. Acceptance is based on AC-001–020 paths, not line coverage alone.

## 7. Rationale and implementation structure

Removing presets avoids hidden size/quality policy. Fixed defaults keep file types deterministic. The eight-field projection covers common descriptive metadata while preventing raw-tag resurrection. WAV uses ID3 for Unicode at the cost of some player tag-display compatibility. Trim always transcodes to avoid promising both arbitrary precision and keyframe-copy speed. Separating stream finalization from file commit protects cancellation semantics.

| Module                | Responsibility                                                          |
| --------------------- | ----------------------------------------------------------------------- |
| Builder/config        | Immutable snapshots, field merging, option conflicts                    |
| Validation/resolution | Formats, tracks, codec defaults, timeline/geometry, metadata projection |
| Input                 | Allowlisted sources, URL policy, probe, Input ownership                 |
| Conversion            | Public API adaptation and strict utilized/discarded track checks        |
| Target/runner         | Positioned writes, backpressure, arbitration, commit barrier, cleanup   |

Execution order: static validation → source/track facts → resolved codec/metadata parameters → copy/encode feasibility → final Conversion initialization and track verification → real stream creation → execute/finalize → commit → cleanup/result.

Copy feasibility must not be approximated by decoder availability. A temporary Output/NullTarget with Conversion.init({copy:{mode:'forced'}}) may inspect cannot_copy results. Never execute it or open the real file; cancel it without disposing the shared Input. Revalidate the final conversion.

Map quality to Quality(level) or Quality({bitrate}), channels to numberOfChannels, and crop x/y to left/top. Capability queries must use resolved quality (high when omitted), dimensions/rate/channels, not example defaults. Keep default quality out of potentially copyable track options. Exact audio preflight and execution guards must prevent silent backend fallback using public APIs; otherwise fail the combination rather than read private state or patch upstream.

## 8. Dependencies and integration boundaries

Official Mediabunny Conversion/Input/Output/Source/Target/Quality/capability APIs are the sole media backend. WebCodecs or existing built-in paths are probed as needed. Blob, Fetch, AbortSignal, and WHATWG Streams are required; file output additionally requires the granted handle APIs. No account, cloud storage, telemetry, or runtime service is introduced.

Mediabunny is an exact 1.61.6 peer dependency. Do not broaden the peer range without testing metadata and cancellation/close behavior. Dependency notices must be preserved; the wrapper's MIT license does not relicense Mediabunny's MPL-2.0 code.

## 9. Examples and edge cases

```ts
const clip = await media(file)
  .format("mp4")
  .trim({ start: 10, end: 30 })
  .resize({ width: 1280 })
  .video({ bitrate: 2_000_000 })
  .audio({ bitrate: 128_000 })
  .metadata({ title: "Clip", comment: null })
  .run({ signal });

const configureVideo = (task: MediaBuilder) => task.format("mp4").resize({ width: 1280 });

const audio = await media(file)
  .tracks({ video: false, audio: "primary" })
  .format("m4a")
  .metadata({ title: "Audio" }, { mode: "replace" })
  .run();

await media(file)
  .format("mp4")
  .mode("copy")
  .metadata({}, { mode: "replace" })
  .run({ target: { type: "file", handle }, signal });
```

The first example requires selected audio because it explicitly configures audio. Omit those settings for silent input. Applications obtain handles/permissions themselves. Repeated metadata calls do not accumulate. Missing tag display in a player does not prove absence from the file.

## 10. Release validation

The specification defines fixed defaults and one cancellation/commit decision point. Release acceptance additionally requires AC evidence, recorded browser/codec/config versions, intelligible capability failures, no partial-file commit after cancellation, metadata deletion without raw resurrection, and a tested peer range. Source review or this document alone is not build, transcode, performance, or device evidence.

## 11. References

Fixed-version source is the primary upstream baseline; live guides may change.

- [Conversion source](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/conversion.ts) and [conversion guide](https://mediabunny.dev/guide/converting-media-files).
- [Output formats](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/output-format.ts).
- [Targets](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/target.ts) and [Output lifecycle](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/output.ts).
- [Metadata types](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/metadata.ts), [MP4 tags](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/isobmff/isobmff-boxes.ts), [WebM tags](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/matroska/matroska-muxer.ts), [WAV muxer](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/wave/wave-muxer.ts), and [ID3](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/id3.ts).
- [Sources and URL retry policy](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/source.ts) and [Input disposal](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/input.ts).
- [File System createWritable](https://fs.spec.whatwg.org/#api-filesystemfilehandle-createwritable) and [File System Access permissions](https://wicg.github.io/file-system-access/#api-filesystemhandle-querypermission).
