import { MediaError, invalid } from "./errors.ts";
import type { AudioOptions, Config, Format, MediaInput, VideoOptions } from "./types.ts";

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
export function encoding(value: unknown, kind: "video" | "audio"): VideoOptions & AudioOptions {
  const opts = object(
    value,
    kind === "video"
      ? ["codec", "bitrate", "quality", "frameRate"]
      : ["codec", "bitrate", "quality", "sampleRate", "channels"],
  );
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
  return opts as VideoOptions & AudioOptions;
}
export function mergeEncoding<T extends VideoOptions | AudioOptions>(current: T, patch: T): T {
  const result = { ...current, ...patch };
  if (patch.bitrate !== undefined) delete result.quality;
  if (patch.quality !== undefined) delete result.bitrate;
  return result;
}
export const formats = {
  mp4: { video: ["avc"], audio: ["aac"], copyVideo: ["avc", "hevc"], copyAudio: ["aac"] },
  webm: {
    video: ["vp9", "vp8"],
    audio: ["opus"],
    copyVideo: ["vp8", "vp9", "av1"],
    copyAudio: ["opus", "vorbis"],
  },
  m4a: { video: [], audio: ["aac"], copyVideo: [], copyAudio: ["aac"] },
  wav: {
    video: [],
    audio: ["pcm-s16", "pcm-s24", "pcm-f32"],
    copyVideo: [],
    copyAudio: ["pcm-s16", "pcm-s24", "pcm-f32"],
  },
} satisfies Record<
  Format,
  { video: string[]; audio: string[]; copyVideo: string[]; copyAudio: string[] }
>;
export function validateConfig(config: Config): asserts config is Config & { format: Format } {
  if (!config.format) invalid("Output format is required.");
  const matrix = formats[config.format];
  for (const kind of ["video", "audio"] as const) {
    const codec = config[kind].codec;
    if (codec && !(matrix[kind] as string[]).includes(codec))
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
