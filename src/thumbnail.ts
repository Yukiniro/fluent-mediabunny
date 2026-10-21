import { EncodedPacketSink, VideoSampleSink } from "mediabunny";
import type { Input, VideoSample } from "mediabunny";
import { normalizeSource, number, object, oneOf } from "./config.ts";
import { invalid, MediaError } from "./errors.ts";
import { openInput, readable, signalOption } from "./input.ts";
import { Scope } from "./scope.ts";
import type {
  MediaInput,
  ThumbnailImage,
  ThumbnailImageOptions,
  ThumbnailItem,
  ThumbnailOptions,
  ThumbnailsOptions,
} from "./types.ts";

const imageKeys = ["track", "width", "height", "fit", "type", "quality", "signal"];
function micros(value: number, phase: "preparing" | "processing" = "preparing"): number {
  const result = Math.round(value * 1_000_000);
  if (!Number.isSafeInteger(result))
    throw new MediaError("UNSUPPORTED_INPUT", "Unsafe media timestamp.", { phase });
  return result;
}
function time(value: unknown): number {
  number(value, "time", { zero: true });
  if (!Number.isSafeInteger(Math.round(value * 1_000_000)))
    invalid("Time exceeds microsecond precision.");
  return value === 0 ? 0 : value;
}
function options(value: unknown, single: boolean) {
  const opts = object(value, [
    ...imageKeys,
    ...(single ? ["time"] : ["times", "start", "end", "count"]),
  ]);
  signalOption(opts.signal);
  if (opts.track !== undefined && opts.track !== "primary")
    number(opts.track, "track ID", { integer: true, zero: true });
  for (const key of ["width", "height"]) {
    if (opts[key] !== undefined) {
      number(opts[key], key, { integer: true });
      if (opts[key] > 4096) invalid("Image dimensions must not exceed 4096.");
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
  let times: number[];
  if (single) times = [time(opts.time)];
  else if (opts.times !== undefined) {
    if (["start", "end", "count"].some((key) => opts[key] !== undefined))
      invalid("Choose times or interval options.");
    if (!Array.isArray(opts.times) || opts.times.length < 1 || opts.times.length > 1000)
      invalid("Expected 1..1000 times.");
    times = Array.from(opts.times, time);
    if (times.some((t, i) => i > 0 && t < times[i - 1]!)) invalid("Times must be nondecreasing.");
  } else {
    const start = time(opts.start),
      end = time(opts.end);
    number(opts.count, "count", { integer: true });
    if (opts.count > 1000 || end <= start || micros(end) <= micros(start))
      invalid("Invalid sampling interval.");
    times = Array.from({ length: opts.count }, (_, i) =>
      time(start + (i * (end - start)) / (opts.count as number)),
    );
  }
  return { ...opts, type, quality: opts.quality ?? 0.8, times } as ThumbnailImageOptions & {
    type: "image/jpeg" | "image/png";
    quality: number;
    times: number[];
  };
}

type Canvas = OffscreenCanvas | HTMLCanvasElement;
function canvas(width: number, height: number): Canvas {
  if (
    typeof OffscreenCanvas !== "undefined" &&
    typeof OffscreenCanvas.prototype.convertToBlob === "function"
  )
    return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const result = document.createElement("canvas");
    if (typeof result.toBlob === "function") {
      result.width = width;
      result.height = height;
      return result;
    }
  }
  throw new MediaError("IMAGE_ENCODING_UNAVAILABLE", "Canvas image encoding is unavailable.", {
    phase: "processing",
  });
}
function encode(canvas: Canvas, type: string, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function extract(
  source: MediaInput,
  opts: ReturnType<typeof options>,
): AsyncGenerator<ThumbnailItem, void, unknown> {
  return (async function* () {
    const scope = new Scope(opts.signal);
    let input: Input | undefined;
    let samples: AsyncGenerator<VideoSample | null, void, unknown> | undefined;
    let sample: VideoSample | null = null;
    let surface: Canvas | undefined;
    let working = true;
    let cleaning: Promise<void> | undefined;
    const closeSample = () => {
      const owned = sample;
      sample = null;
      owned?.close();
    };
    const cleanup = () =>
      (cleaning ??= Promise.resolve().then(async () => {
        try {
          input?.dispose();
        } catch (e) {
          scope.fail(e);
        }
        try {
          await samples?.return();
        } catch (e) {
          scope.fail(e);
        }
        try {
          closeSample();
        } catch (e) {
          scope.fail(e);
        }
        sample = null;
        try {
          if (surface) {
            surface.width = 1;
            surface.height = 1;
          }
        } catch (e) {
          scope.fail(e);
        }
        surface = undefined;
      }));
    scope.onStop(() => {
      if (!working) return cleanup();
    });
    try {
      scope.check();
      input = openInput(source, scope);
      await readable(input, scope);
      const track =
        opts.track === undefined || opts.track === "primary"
          ? await scope.wait(input.getPrimaryVideoTrack(), "READ_FAILED")
          : (await scope.wait(input.getTracks(), "READ_FAILED")).find((t) => t.id === opts.track);
      if (!track || !track.isVideoTrack()) {
        if (typeof opts.track === "number") invalid("The requested ID is not a video track.");
        throw new MediaError("NO_TRACKS", "Input has no video track.");
      }
      if (
        !(await scope.wait(
          new EncodedPacketSink(track).getFirstPacket({ metadataOnly: true }),
          "READ_FAILED",
        ))
      )
        throw new MediaError("NO_TRACKS", "Selected video track is empty.");
      if (
        !(await scope.wait(track.getCodec(), "CODEC_UNAVAILABLE")) ||
        !(await scope.wait(track.canDecode(), "CODEC_UNAVAILABLE"))
      )
        throw new MediaError("CODEC_UNAVAILABLE", "Selected video decoder is unavailable.");
      const pixelAspect = await scope.wait(track.getPixelAspectRatio(), "READ_FAILED");
      const fallbackAspect = pixelAspect.num / pixelAspect.den;
      const origin = Math.max(0, await scope.wait(input.getFirstTimestamp(), "READ_FAILED"));
      const queries = opts.times.map((t) => micros(origin + t));
      samples = new VideoSampleSink(track).samplesAtTimestamps(queries.map((t) => t / 1_000_000));
      scope.phase = "processing";
      for (let index = 0; index < queries.length; index++) {
        scope.check();
        working = true;
        sample = (await samples.next()).value ?? null;
        scope.check();
        let image: ThumbnailImage | null = null;
        const requestedTime = opts.times[index]!;
        if (sample) {
          const start = micros(sample.timestamp, "processing"),
            duration = micros(sample.duration, "processing");
          if (duration <= 0 || !Number.isSafeInteger(start + duration))
            throw new MediaError("UNSUPPORTED_INPUT", "Invalid frame coverage.", {
              phase: scope.phase,
            });
          if (start <= queries[index]! && queries[index]! < start + duration) {
            // Some decoders omit container pixel aspect ratio from their VideoFrame metadata.
            const aspect =
              sample.pixelAspectRatio.num === sample.pixelAspectRatio.den ? fallbackAspect : 1;
            const sw = sample.displayWidth * (sample.rotation % 180 === 0 ? aspect : 1),
              sh = sample.displayHeight * (sample.rotation % 180 === 0 ? 1 : aspect);
            if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw <= 0 || sh <= 0)
              throw new MediaError("UNSUPPORTED_INPUT", "Invalid frame geometry.", {
                phase: scope.phase,
              });
            const width =
              opts.width ??
              Math.max(1, Math.round(opts.height === undefined ? sw : (opts.height * sw) / sh));
            const height =
              opts.height ??
              Math.max(1, Math.round(opts.width === undefined ? sh : (opts.width * sh) / sw));
            if (width > 4096 || height > 4096 || width * height > 16_000_000)
              throw new MediaError("OUTPUT_TOO_LARGE", "Resolved image exceeds output limits.", {
                phase: scope.phase,
              });
            surface ??= canvas(width, height);
            surface.width = width;
            surface.height = height;
            const context = surface.getContext("2d") as
              | CanvasRenderingContext2D
              | OffscreenCanvasRenderingContext2D
              | null;
            if (!context)
              throw new MediaError(
                "IMAGE_ENCODING_UNAVAILABLE",
                "Canvas 2D rendering is unavailable.",
                { phase: scope.phase },
              );
            if (opts.type === "image/jpeg") {
              context.fillStyle = "black";
              context.fillRect(0, 0, width, height);
            }
            const scale =
              opts.fit === "contain"
                ? Math.min(width / sw, height / sh)
                : Math.max(width / sw, height / sh);
            const dw = !opts.fit || opts.fit === "fill" ? width : sw * scale;
            const dh = !opts.fit || opts.fit === "fill" ? height : sh * scale;
            sample.draw(context, (width - dw) / 2, (height - dh) / 2, dw, dh);
            const timing = {
              sourceTimestamp: sample.timestamp,
              durationSeconds: sample.duration,
              actualTime: sample.timestamp - origin,
            };
            closeSample();
            const blob = await scope.wait(encode(surface, opts.type, opts.quality));
            if (!blob || !blob.size)
              throw new MediaError("PROCESSING_FAILED", "Image encoder returned no data.", {
                phase: scope.phase,
              });
            if (blob.type !== opts.type)
              throw new MediaError(
                "IMAGE_ENCODING_UNAVAILABLE",
                "Image encoder substituted the requested MIME type.",
                { phase: scope.phase },
              );
            image = {
              blob,
              mimeType: opts.type,
              width,
              height,
              trackId: track.id,
              requestedTime,
              timeOriginSeconds: origin,
              ...timing,
            };
          }
          closeSample();
          sample = null;
        }
        scope.check();
        working = false;
        yield { index, requestedTime, image };
        working = true;
      }
      scope.check();
    } catch (e) {
      throw scope.fail(e);
    } finally {
      const failed = scope.failure;
      await cleanup();
      await scope.finish();
      if (!failed) scope.check();
    }
  })();
}

export function thumbnails(
  source: MediaInput,
  value: ThumbnailsOptions,
): AsyncGenerator<ThumbnailItem, void, unknown> {
  const opts = options(value, false);
  return extract(normalizeSource(source), opts);
}
export async function thumbnail(
  source: MediaInput,
  value: ThumbnailOptions,
): Promise<ThumbnailImage | null> {
  const opts = options(value, true);
  const iterator = extract(normalizeSource(source), opts);
  try {
    const image = (await iterator.next()).value?.image ?? null;
    await iterator.next();
    return image;
  } finally {
    await iterator.return();
  }
}
