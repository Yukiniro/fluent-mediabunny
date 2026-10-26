import { EncodedPacketSink, VideoSampleSink } from "mediabunny";
import type { Input, VideoSample } from "mediabunny";
import { normalizeSource, number } from "./config.ts";
import { invalid, MediaError } from "./errors.ts";
import type { Raster } from "./image.ts";
import { readImageRequest } from "./image-options.ts";
import { openInput, readable } from "./input.ts";
import { micros } from "./media-time.ts";
import { paintFrame } from "./paint-frame.ts";
import { Scope } from "./scope.ts";
import type {
  MediaInput,
  ThumbnailImage,
  ThumbnailImageOptions,
  ThumbnailItem,
  ThumbnailOptions,
  ThumbnailsOptions,
} from "./types.ts";

function time(value: unknown): number {
  number(value, "time", { zero: true });
  if (!Number.isSafeInteger(Math.round(value * 1_000_000)))
    invalid("Time exceeds microsecond precision.");
  return value === 0 ? 0 : value;
}
function options(value: unknown, single: boolean) {
  const opts = readImageRequest(value, single ? ["time"] : ["times", "start", "end", "count"]);
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
  return { ...opts, times } as ThumbnailImageOptions & {
    type: "image/jpeg" | "image/png";
    quality: number;
    times: number[];
  };
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
    const slot: { canvas?: Raster } = {};
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
          if (slot.canvas) {
            slot.canvas.width = 1;
            slot.canvas.height = 1;
          }
        } catch (e) {
          scope.fail(e);
        }
        slot.canvas = undefined;
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
      const codedWidth = await scope.wait(track.getCodedWidth(), "READ_FAILED");
      const codedHeight = await scope.wait(track.getCodedHeight(), "READ_FAILED");
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
            image = {
              ...(await paintFrame(
                sample,
                {
                  width: opts.width,
                  height: opts.height,
                  fit: opts.fit,
                  type: opts.type,
                  quality: opts.quality,
                  trackId: track.id,
                  origin,
                  codedWidth,
                  codedHeight,
                  fallbackAspect,
                },
                scope,
                slot,
                closeSample,
              )),
              requestedTime,
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
