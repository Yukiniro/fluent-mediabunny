import { EncodedPacketSink, VideoSampleSink } from "mediabunny";
import type { EncodedPacket, Input, InputVideoTrack, VideoSample } from "mediabunny";
import { normalizeSource, number, object } from "./config.ts";
import { invalid, MediaError } from "./errors.ts";
import type { Raster } from "./image.ts";
import { readImageRequest, type ResolvedImageRequest } from "./image-options.ts";
import { openInput, readable, signalOption } from "./input.ts";
import { micros } from "./media-time.ts";
import { paintFrame } from "./paint-frame.ts";
import { Scope } from "./scope.ts";
import type {
  KeyFrameCountOptions,
  KeyFrameImage,
  KeyFrameImageOptions,
  KeyFrameImagesOptions,
  MediaInput,
} from "./types.ts";

type Candidate = { raw: number; at: number };
type CountOpts = {
  track?: "primary" | number;
  signal?: AbortSignal;
  start?: number;
  end?: number;
};
type ImageOpts = ResolvedImageRequest & { start?: number; end?: number };
type ClosestOpts = ResolvedImageRequest & { time: number };
type Opened = {
  input: Input;
  track: InputVideoTrack;
  packets: EncodedPacketSink;
  origin: number;
  codedWidth: number;
  codedHeight: number;
  fallbackAspect: number;
};

function seconds(value: unknown, name: string): number {
  number(value, name, { zero: true });
  if (!Number.isSafeInteger(Math.round(value * 1_000_000)))
    invalid("Time exceeds microsecond precision.");
  return value === 0 ? 0 : value;
}
function boundsOf(opts: Record<string, unknown>) {
  const start = opts.start === undefined ? undefined : seconds(opts.start, "start");
  const end = opts.end === undefined ? undefined : seconds(opts.end, "end");
  if (start !== undefined && end !== undefined && (end <= start || micros(end) <= micros(start)))
    invalid("Invalid time range.");
  return { start, end };
}
function parseClosest(value: unknown): ClosestOpts {
  const opts = readImageRequest(value, ["time"]);
  return { ...opts, time: seconds(opts.time, "time") };
}
function parseImages(value: unknown): ImageOpts {
  const opts = readImageRequest(value, ["start", "end"]);
  return { ...opts, ...boundsOf({ start: opts.start, end: opts.end }) };
}
function parseCount(value: unknown): CountOpts {
  const opts = object(value, ["track", "start", "end", "signal"]);
  signalOption(opts.signal);
  if (opts.track !== undefined && opts.track !== "primary")
    number(opts.track, "track ID", { integer: true, zero: true });
  return {
    track: opts.track as CountOpts["track"],
    signal: opts.signal as AbortSignal | undefined,
    ...boundsOf(opts),
  };
}
function membership(origin: number, start?: number, end?: number) {
  return {
    from: start === undefined ? Number.NEGATIVE_INFINITY : micros(origin + start),
    to: end === undefined ? Number.POSITIVE_INFINITY : micros(origin + end),
  };
}
function included(at: number, from: number, to: number) {
  return at >= from && at < to;
}
function nearestOrder(candidates: Candidate[], query: number) {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        Math.abs(a.candidate.at - query) - Math.abs(b.candidate.at - query) ||
        a.candidate.raw - b.candidate.raw ||
        a.index - b.index,
    )
    .map((item) => item.candidate);
}

function resources(scope: Scope) {
  let input: Input | undefined;
  let sample: VideoSample | null = null;
  let inner: AsyncGenerator<VideoSample | null, void, unknown> | undefined;
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
        await inner?.return();
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
  return {
    slot,
    closeSample,
    cleanup,
    setInput: (value: Input) => {
      input = value;
    },
    setSample: (value: VideoSample | null) => {
      sample = value;
    },
    setInner: (value: AsyncGenerator<VideoSample | null, void, unknown> | undefined) => {
      inner = value;
    },
    pause: () => {
      working = false;
    },
    resume: () => {
      working = true;
    },
  };
}
type Resources = ReturnType<typeof resources>;

async function finish(scope: Scope, bin: Resources) {
  const failed = scope.failure;
  await bin.cleanup();
  await scope.finish();
  if (!failed) scope.check();
}
async function openVideo(
  scope: Scope,
  source: MediaInput,
  trackId: "primary" | number | undefined,
  decode: boolean,
): Promise<Opened> {
  scope.check();
  const input = openInput(source, scope);
  await readable(input, scope);
  const selected =
    trackId === undefined || trackId === "primary"
      ? await scope.wait(input.getPrimaryVideoTrack(), "READ_FAILED")
      : (await scope.wait(input.getTracks(), "READ_FAILED")).find((item) => item.id === trackId);
  if (!selected || !selected.isVideoTrack()) {
    if (typeof trackId === "number") invalid("The requested ID is not a video track.");
    throw new MediaError("NO_TRACKS", "Input has no video track.");
  }
  const packets = new EncodedPacketSink(selected);
  if (!(await scope.wait(packets.getFirstPacket({ metadataOnly: true }), "READ_FAILED")))
    throw new MediaError("NO_TRACKS", "Selected video track is empty.");
  let codedWidth = 0;
  let codedHeight = 0;
  let fallbackAspect = 1;
  if (decode) {
    if (
      !(await scope.wait(selected.getCodec(), "CODEC_UNAVAILABLE")) ||
      !(await scope.wait(selected.canDecode(), "CODEC_UNAVAILABLE"))
    )
      throw new MediaError("CODEC_UNAVAILABLE", "Selected video decoder is unavailable.");
    const pixelAspect = await scope.wait(selected.getPixelAspectRatio(), "READ_FAILED");
    fallbackAspect = pixelAspect.num / pixelAspect.den;
    codedWidth = await scope.wait(selected.getCodedWidth(), "READ_FAILED");
    codedHeight = await scope.wait(selected.getCodedHeight(), "READ_FAILED");
  }
  const origin = Math.max(0, await scope.wait(input.getFirstTimestamp(), "READ_FAILED"));
  return { input, track: selected, packets, origin, codedWidth, codedHeight, fallbackAspect };
}
async function scan(packets: EncodedPacketSink, scope: Scope): Promise<Candidate[]> {
  const raws: number[] = [];
  let packet = await scope.wait(packets.getFirstKeyPacket({ metadataOnly: true }), "READ_FAILED");
  while (packet) {
    raws.push(packet.timestamp);
    packet = await scope.wait(
      packets.getNextKeyPacket(packet, { metadataOnly: true }),
      "READ_FAILED",
    );
  }
  // Equal raw timestamps collapse. One presentation timestamp decodes as one sample.
  const stamped = raws.map((raw) => ({ raw: raw === 0 ? 0 : raw, at: micros(raw) }));
  stamped.sort((a, b) => a.at - b.at || a.raw - b.raw);
  const unique: Candidate[] = [];
  for (const item of stamped) {
    if (unique.at(-1)?.raw === item.raw) continue;
    unique.push(item);
  }
  return unique;
}
async function confirm(packets: EncodedPacketSink, candidate: Candidate, scope: Scope) {
  const packet = await scope.wait(
    packets.getPacket(candidate.raw, { verifyKeyPackets: true }),
    "READ_FAILED",
  );
  if (!packet || packet.type !== "key") return null;
  if (micros(packet.timestamp, scope.phase) !== candidate.at) return null;
  return packet;
}
async function renderPacket(
  scope: Scope,
  bin: Resources,
  opened: Opened,
  decoder: VideoSampleSink,
  packet: EncodedPacket,
  image: ResolvedImageRequest,
): Promise<KeyFrameImage> {
  // Pass the packet timestamp through. Rounding it to microseconds can fall before the packet.
  const generated = decoder.samplesAtTimestamps([packet.timestamp]);
  bin.setInner(generated);
  let imageResult: KeyFrameImage | undefined;
  try {
    scope.check();
    const sample = (await generated.next()).value ?? null;
    scope.check();
    bin.setSample(sample);
    if (!sample)
      throw new MediaError("PROCESSING_FAILED", "Video decoder returned no frame.", {
        phase: scope.phase,
      });
    const start = micros(sample.timestamp, scope.phase);
    const duration = micros(sample.duration, scope.phase);
    if (duration <= 0 || !Number.isSafeInteger(start + duration))
      throw new MediaError("UNSUPPORTED_INPUT", "Invalid frame coverage.", { phase: scope.phase });
    if (start !== micros(packet.timestamp, scope.phase))
      throw new MediaError(
        "UNSUPPORTED_INPUT",
        "Decoded frame timestamp does not match the key packet.",
        { phase: scope.phase },
      );
    imageResult = await paintFrame(
      sample,
      {
        width: image.width,
        height: image.height,
        fit: image.fit,
        type: image.type,
        quality: image.quality,
        trackId: opened.track.id,
        origin: opened.origin,
        codedWidth: opened.codedWidth,
        codedHeight: opened.codedHeight,
        fallbackAspect: opened.fallbackAspect,
      },
      scope,
      bin.slot,
      bin.closeSample,
    );
  } catch (error) {
    throw scope.fail(error);
  } finally {
    bin.setInner(undefined);
    try {
      await generated.return(undefined);
    } catch (error) {
      if (scope.failure) scope.failure.diagnostics.push(error);
      else scope.fail(error);
    }
  }
  if (scope.failure) throw scope.failure;
  if (!imageResult)
    throw new MediaError("PROCESSING_FAILED", "Video decoder returned no frame.", {
      phase: scope.phase,
    });
  return imageResult;
}

async function readClosest(source: MediaInput, opts: ClosestOpts): Promise<KeyFrameImage | null> {
  const scope = new Scope(opts.signal);
  const bin = resources(scope);
  try {
    const opened = await openVideo(scope, source, opts.track, true);
    bin.setInput(opened.input);
    const candidates = await scan(opened.packets, scope);
    scope.phase = "processing";
    let decoder: VideoSampleSink | undefined;
    for (const candidate of nearestOrder(candidates, micros(opened.origin + opts.time))) {
      scope.check();
      const packet = await confirm(opened.packets, candidate, scope);
      if (!packet) continue;
      decoder ??= new VideoSampleSink(opened.track);
      return await renderPacket(scope, bin, opened, decoder, packet, opts);
    }
    scope.check();
    return null;
  } catch (error) {
    throw scope.fail(error);
  } finally {
    await finish(scope, bin);
  }
}
function readImages(
  source: MediaInput,
  opts: ImageOpts,
): AsyncGenerator<KeyFrameImage, void, unknown> {
  return (async function* () {
    const scope = new Scope(opts.signal);
    const bin = resources(scope);
    try {
      const opened = await openVideo(scope, source, opts.track, true);
      bin.setInput(opened.input);
      const candidates = await scan(opened.packets, scope);
      scope.phase = "processing";
      const window = membership(opened.origin, opts.start, opts.end);
      let decoder: VideoSampleSink | undefined;
      for (const candidate of candidates) {
        if (!included(candidate.at, window.from, window.to)) continue;
        scope.check();
        const packet = await confirm(opened.packets, candidate, scope);
        if (!packet) continue;
        decoder ??= new VideoSampleSink(opened.track);
        const image = await renderPacket(scope, bin, opened, decoder, packet, opts);
        scope.check();
        bin.pause();
        yield image;
        bin.resume();
      }
      scope.check();
    } catch (error) {
      throw scope.fail(error);
    } finally {
      await finish(scope, bin);
    }
  })();
}
async function countKeyFrames(source: MediaInput, opts: CountOpts): Promise<number> {
  const scope = new Scope(opts.signal);
  const bin = resources(scope);
  try {
    const opened = await openVideo(scope, source, opts.track, false);
    bin.setInput(opened.input);
    const candidates = await scan(opened.packets, scope);
    scope.phase = "processing";
    const window = membership(opened.origin, opts.start, opts.end);
    let total = 0;
    for (const candidate of candidates) {
      if (!included(candidate.at, window.from, window.to)) continue;
      scope.check();
      if (await confirm(opened.packets, candidate, scope)) total++;
    }
    scope.check();
    return total;
  } catch (error) {
    throw scope.fail(error);
  } finally {
    await finish(scope, bin);
  }
}

export async function getClosestKeyFrameImage(
  source: MediaInput,
  value: KeyFrameImageOptions,
): Promise<KeyFrameImage | null> {
  const opts = parseClosest(value);
  return readClosest(normalizeSource(source), opts);
}
export function getKeyFrameImages(
  source: MediaInput,
  value: KeyFrameImagesOptions = {},
): AsyncGenerator<KeyFrameImage, void, unknown> {
  const opts = parseImages(value);
  return readImages(normalizeSource(source), opts);
}
export async function getKeyFrameCount(
  source: MediaInput,
  value: KeyFrameCountOptions = {},
): Promise<number> {
  const opts = parseCount(value);
  return countKeyFrames(normalizeSource(source), opts);
}
