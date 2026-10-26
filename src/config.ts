import { Mp4OutputFormat, OggOutputFormat, WavOutputFormat, WebMOutputFormat } from "mediabunny";
import type {
  AudioCodec as EngineAudioCodec,
  OutputFormat,
  VideoCodec as EngineVideoCodec,
} from "mediabunny";
import { MediaError, invalid } from "./errors.ts";
import type {
  AudioOptions,
  Config,
  Format,
  MediaInput,
  TrackSelection,
  VideoOptions,
} from "./types.ts";

export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid("Expected a plain options object.");
  for (const key of Reflect.ownKeys(value))
    if (typeof key !== "string" || !keys.includes(key)) invalid(`Unknown option: ${String(key)}.`);
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
export function oneOf<T>(value: unknown, values: readonly T[], name: string): asserts value is T {
  if (!values.includes(value as T)) invalid(`Invalid ${name}.`);
}
export function number(
  value: unknown,
  name: string,
  { integer = false, zero = false } = {},
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (integer && !Number.isSafeInteger(value)) ||
    (zero ? value < 0 : value <= 0)
  )
    invalid(`Invalid ${name}.`);
}
export function trackSelection(value: unknown): TrackSelection {
  if (Array.isArray(value)) {
    if (!value.length || new Set(value).size !== value.length)
      invalid("Track IDs must be nonempty and unique.");
    for (const id of value) number(id, "track ID", { integer: true, zero: true });
    return [...value];
  }
  oneOf(value, ["all", "primary", false] as const, "track selection");
  return value;
}
export function normalizeSource(source: MediaInput): Exclude<MediaInput, URL> {
  if (source instanceof URL) source = source.href;
  if (typeof source === "string") {
    try {
      const url = new URL(source);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error();
      return url.href;
    } catch {
      throw new MediaError(
        "UNSUPPORTED_INPUT",
        "Expected an absolute HTTP(S) URL without embedded credentials.",
      );
    }
  }
  if (source instanceof Blob) return source;
  if (source instanceof ArrayBuffer) {
    if (!source.byteLength) invalid("Input bytes must not be empty or detached.");
    return source;
  }
  if (source instanceof Uint8Array && source.buffer instanceof ArrayBuffer && source.byteLength)
    return source;
  throw new MediaError(
    "UNSUPPORTED_INPUT",
    "Expected File, Blob, ArrayBuffer, Uint8Array or HTTP(S) URL.",
  );
}
const videoOptionKeys = [
  "codec",
  "bitrate",
  "quality",
  "frameRate",
  "keyFrameInterval",
] as const satisfies readonly (keyof VideoOptions)[];
const audioOptionKeys = [
  "codec",
  "bitrate",
  "quality",
  "sampleRate",
  "channels",
] as const satisfies readonly (keyof AudioOptions)[];
type _AllVideoKeysListed =
  Exclude<keyof VideoOptions, (typeof videoOptionKeys)[number]> extends never ? true : never;
type _AllAudioKeysListed =
  Exclude<keyof AudioOptions, (typeof audioOptionKeys)[number]> extends never ? true : never;
void (true satisfies _AllVideoKeysListed);
void (true satisfies _AllAudioKeysListed);
export function encoding(value: unknown, kind: "video" | "audio"): VideoOptions & AudioOptions {
  const opts = object(value, kind === "video" ? videoOptionKeys : audioOptionKeys);
  if (opts.codec !== undefined)
    oneOf(
      opts.codec,
      kind === "video" ? ["avc", "vp8", "vp9"] : ["aac", "opus", "pcm-s16", "pcm-s24", "pcm-f32"],
      "codec",
    );
  if (opts.bitrate !== undefined) number(opts.bitrate, "bitrate", { integer: true });
  if (opts.quality !== undefined) oneOf(opts.quality, ["low", "medium", "high"], "quality");
  if (opts.bitrate !== undefined && opts.quality !== undefined)
    invalid("bitrate and quality are mutually exclusive.");
  for (const key of ["frameRate", "sampleRate", "channels"])
    if (opts[key] !== undefined) number(opts[key], key, { integer: key !== "frameRate" });
  if (opts.keyFrameInterval !== undefined)
    number(opts.keyFrameInterval, "keyFrameInterval", { zero: true });
  return opts as VideoOptions & AudioOptions;
}
export function mergeEncoding<T extends VideoOptions | AudioOptions>(current: T, patch: T): T {
  const result = { ...current, ...patch };
  if (patch.bitrate !== undefined) delete result.quality;
  if (patch.quality !== undefined) delete result.bitrate;
  return result;
}
type EncodeCodecs<C> = readonly [defaultCodec: C, ...alternatives: C[]];
export type FormatProfile = {
  readonly writer: () => OutputFormat;
  /** Owned here, not read from writer().mimeType, so a Mediabunny upgrade cannot change the public MIME. */
  readonly mimeSubtype: string;
  readonly audio: EncodeCodecs<NonNullable<AudioOptions["codec"]>>;
  readonly copyAudio: readonly EngineAudioCodec[];
} & (
  | {
      readonly trackPolicy: "one-audio";
      readonly video: readonly never[];
      readonly copyVideo: readonly never[];
    }
  | {
      readonly trackPolicy: "engine-limits";
      readonly video: EncodeCodecs<NonNullable<VideoOptions["codec"]>>;
      readonly copyVideo: readonly EngineVideoCodec[];
    }
);
const mp4Writer = () => new Mp4OutputFormat({ fastStart: false, metadataFormat: "mdir" });
export const formats: Readonly<Record<Format, FormatProfile>> = {
  mp4: {
    writer: mp4Writer,
    mimeSubtype: "mp4",
    trackPolicy: "engine-limits",
    video: ["avc"],
    audio: ["aac"],
    copyVideo: ["avc", "hevc"],
    copyAudio: ["aac"],
  },
  webm: {
    writer: () => new WebMOutputFormat({ appendOnly: false }),
    mimeSubtype: "webm",
    trackPolicy: "engine-limits",
    video: ["vp9", "vp8"],
    audio: ["opus"],
    copyVideo: ["vp8", "vp9", "av1"],
    copyAudio: ["opus", "vorbis"],
  },
  m4a: {
    writer: mp4Writer,
    mimeSubtype: "mp4",
    trackPolicy: "one-audio",
    video: [],
    audio: ["aac"],
    copyVideo: [],
    copyAudio: ["aac"],
  },
  wav: {
    writer: () => new WavOutputFormat({ metadataFormat: "id3", large: false }),
    mimeSubtype: "wav",
    trackPolicy: "one-audio",
    video: [],
    audio: ["pcm-s16", "pcm-s24", "pcm-f32"],
    copyVideo: [],
    copyAudio: ["pcm-s16", "pcm-s24", "pcm-f32"],
  },
  ogg: {
    writer: () => new OggOutputFormat(),
    mimeSubtype: "ogg",
    trackPolicy: "one-audio",
    video: [],
    audio: ["opus"],
    copyVideo: [],
    copyAudio: ["opus", "vorbis"],
  },
};
export function validateConfig(config: Config): asserts config is Config & { format: Format } {
  if (!config.format) invalid("Output format is required.");
  for (const kind of ["video", "audio"] as const) {
    const codec = config[kind].codec;
    const allowed: readonly string[] = formats[config.format][kind];
    if (codec && !allowed.includes(codec))
      throw new MediaError(
        "UNSUPPORTED_OUTPUT_COMBINATION",
        `${codec} is not enabled for ${config.format}.`,
      );
    if (config.tracks[kind] === false && Object.keys(config[kind]).length)
      invalid(`Cannot configure excluded ${kind} tracks.`);
  }
  if (
    config.mode === "copy" &&
    (config.trim ||
      config.resize ||
      config.crop ||
      config.rotate ||
      Object.keys(config.video).length ||
      Object.keys(config.audio).length)
  )
    invalid("copy mode does not accept processing options.");
  if (
    config.format === "wav" &&
    (config.audio.quality !== undefined || config.audio.bitrate !== undefined)
  )
    invalid("PCM has no bitrate/quality setting.");
}
