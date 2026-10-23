import {
  encoding,
  mergeEncoding,
  normalizeSource,
  object,
  oneOf,
  number,
  tracksOptions,
} from "./config.ts";
import { invalid } from "./errors.ts";
import { metadataPatch } from "./metadata.ts";
import { run } from "./run.ts";
import type {
  MediaInput,
  Config,
  Format,
  Mode,
  TrimOptions,
  ResizeOptions,
  CropOptions,
  VideoOptions,
  AudioOptions,
  TracksOptions,
  MetadataPatch,
  MetadataOptions,
  RunOptions,
  BlobResult,
  FileResult,
  MediaResult,
  FileTarget,
} from "./types.ts";
export { probe } from "./input.ts";
export { MediaError } from "./errors.ts";
export type {
  MediaInput,
  Format,
  Mode,
  Quality,
  TrackSelection,
  VideoOptions,
  AudioOptions,
  ResizeOptions,
  TrimOptions,
  CropOptions,
  TracksOptions,
  MetadataField,
  MetadataPatch,
  MetadataValues,
  MetadataOptions,
  FileTarget,
  Target,
  Phase,
  ProgressEvent,
  RunOptions,
  ProbeOptions,
  Warning,
  TrackInfo,
  ProbeTrackInfo,
  ResolvedTrack,
  MetadataReport,
  MediaReport,
  BlobResult,
  FileResult,
  MediaResult,
  ProbeResult,
  ErrorCode,
  TargetState,
} from "./types.ts";
export class MediaBuilder {
  #source: MediaInput;
  #config: Config = { mode: "auto", video: {}, audio: {}, tracks: {} };
  constructor(source: MediaInput) {
    this.#source = normalizeSource(source);
  }
  private with(patch: Partial<Config>) {
    const next = new MediaBuilder(this.#source);
    next.#config = { ...this.#config, ...patch };
    return next;
  }
  format(value: Format) {
    oneOf(value, ["mp4", "webm", "m4a", "wav"], "format");
    return this.with({ format: value });
  }
  mode(value: Mode) {
    oneOf(value, ["auto", "copy", "transcode"], "mode");
    return this.with({ mode: value });
  }
  trim(value: TrimOptions) {
    const p = object(value, ["start", "end"]);
    number(p.start, "start", { zero: true });
    if (p.end !== undefined) {
      number(p.end, "end");
      if (p.end <= p.start) invalid("end must exceed start.");
    }
    return this.with({ trim: p as TrimOptions });
  }
  resize(value: ResizeOptions) {
    const p = object(value, ["width", "height", "fit"]);
    for (const k of ["width", "height"])
      if (p[k] !== undefined) {
        number(p[k], k, { integer: true });
        if ((p[k] as number) % 2) invalid("Dimensions must be even.");
      }
    if (p.width === undefined && p.height === undefined) invalid("A dimension is required.");
    if (p.width !== undefined && p.height !== undefined)
      oneOf(p.fit, ["contain", "cover", "fill"], "fit");
    else if (p.fit !== undefined) invalid("fit requires both dimensions.");
    return this.with({ resize: p as ResizeOptions });
  }
  crop(value: CropOptions) {
    const p = object(value, ["x", "y", "width", "height"]);
    for (const k of ["x", "y", "width", "height"])
      number(p[k], k, { integer: true, zero: k === "x" || k === "y" });
    return this.with({ crop: p as CropOptions });
  }
  rotate(value: 0 | 90 | 180 | 270) {
    oneOf(value, [0, 90, 180, 270], "rotation");
    return this.with({ rotate: value });
  }
  video(value: VideoOptions) {
    return this.with({ video: mergeEncoding(this.#config.video, encoding(value, "video")) });
  }
  audio(value: AudioOptions) {
    return this.with({ audio: mergeEncoding(this.#config.audio, encoding(value, "audio")) });
  }
  tracks(value: TracksOptions) {
    return this.with({ tracks: { ...this.#config.tracks, ...tracksOptions(value) } });
  }
  metadata(value: MetadataPatch, options: MetadataOptions = {}) {
    const p = object(options, ["mode"]);
    const mode = p.mode ?? "merge";
    oneOf(mode, ["merge", "replace"] as const, "metadata mode");
    return this.with({ metadata: { patch: metadataPatch(value), mode } });
  }
  run(options?: RunOptions & { target?: "blob" }): Promise<BlobResult>;
  run(options: RunOptions & { target: FileTarget }): Promise<FileResult>;
  run(options: RunOptions): Promise<MediaResult>;
  run(options: RunOptions = {}): Promise<MediaResult> {
    return run(this.#source, this.#config, options);
  }
}
export function media(source: MediaInput) {
  return new MediaBuilder(source);
}

export { thumbnail, thumbnails } from "./thumbnail.ts";
export { getEmbeddedPicture } from "./embedded-picture.ts";
export { getWaveformData, renderWaveform } from "./waveform.ts";
export type {
  ThumbnailImageOptions,
  ThumbnailOptions,
  ThumbnailsOptions,
  ThumbnailImage,
  ThumbnailItem,
  EmbeddedPictureOptions,
  WaveformOptions,
  WaveformData,
  WaveformChannel,
  WaveformImage,
  WaveformImageOptions,
} from "./types.ts";
