import { number, object, oneOf } from "./config.ts";
import { invalid } from "./errors.ts";
import { signalOption } from "./input.ts";

const imageOptionKeys = ["track", "width", "height", "fit", "type", "quality", "signal"];

export type ResolvedImageRequest = {
  track?: "primary" | number;
  width?: number;
  height?: number;
  fit?: "contain" | "cover" | "fill";
  type: "image/jpeg" | "image/png";
  quality: number;
  signal?: AbortSignal;
};

export function readImageRequest(
  value: unknown,
  extraKeys: readonly string[],
): ResolvedImageRequest & Record<string, unknown> {
  const opts = object(value, [...imageOptionKeys, ...extraKeys]);
  signalOption(opts.signal);
  if (opts.track !== undefined && opts.track !== "primary")
    number(opts.track, "track ID", { integer: true, zero: true });
  for (const key of ["width", "height"]) {
    if (opts[key] !== undefined) {
      number(opts[key], key, { integer: true });
      if ((opts[key] as number) > 4096) invalid("Image dimensions must not exceed 4096.");
    }
  }
  if ((opts.width !== undefined && opts.height !== undefined) !== (opts.fit !== undefined))
    invalid("fit requires both dimensions and vice versa.");
  if (opts.fit !== undefined) oneOf(opts.fit, ["contain", "cover", "fill"], "fit");
  if (
    typeof opts.width === "number" &&
    typeof opts.height === "number" &&
    opts.width * opts.height > 16_000_000
  )
    invalid("Image area exceeds 16000000 pixels.");
  const type = opts.type === undefined ? "image/jpeg" : opts.type;
  oneOf(type, ["image/jpeg", "image/png"] as const, "image type");
  if (opts.quality !== undefined) {
    number(opts.quality, "quality", { zero: true });
    if (opts.quality > 1 || type === "image/png")
      invalid("quality is a JPEG-only value in [0, 1].");
  }
  return {
    ...opts,
    track: opts.track as ResolvedImageRequest["track"],
    width: opts.width as number | undefined,
    height: opts.height as number | undefined,
    fit: opts.fit as ResolvedImageRequest["fit"],
    type,
    quality: opts.quality === undefined ? 0.8 : opts.quality,
    signal: opts.signal as AbortSignal | undefined,
  };
}
