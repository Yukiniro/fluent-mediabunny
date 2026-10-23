import { AudioSampleSink, EncodedPacketSink } from "mediabunny";
import type { AudioSample, Input, InputAudioTrack } from "mediabunny";
import { number, object } from "./config.ts";
import { invalid, MediaError } from "./errors.ts";
import { openInput, readable, signalOption } from "./input.ts";
import { Scope } from "./scope.ts";
import type { MediaInput, WaveformData, WaveformOptions } from "./types.ts";

const maxBytes = 64 * 1024 * 1024;

function seconds(value: unknown, name: string) {
  number(value, name, { zero: true });
  if (!Number.isSafeInteger(Math.round(value * 1_000_000)))
    invalid("Time exceeds microsecond precision.");
  return value === 0 ? 0 : value;
}
function waveformOptions(options: WaveformOptions) {
  const opts = object(options, ["track", "pointsPerSecond", "start", "end", "signal"]);
  signalOption(opts.signal);
  if (opts.track !== undefined && opts.track !== "primary")
    number(opts.track, "track ID", { integer: true, zero: true });
  if (opts.pointsPerSecond !== undefined) number(opts.pointsPerSecond, "points per second");
  const start = opts.start === undefined ? 0 : seconds(opts.start, "start");
  const end = opts.end === undefined ? undefined : seconds(opts.end, "end");
  if (end !== undefined && end <= start) invalid("end must exceed start.");
  return {
    track: opts.track as "primary" | number | undefined,
    pointsPerSecond: (opts.pointsPerSecond as number | undefined) ?? 50,
    start,
    end,
    signal: opts.signal as AbortSignal | undefined,
  };
}
function bucketCount(start: number, end: number, pointsPerSecond: number) {
  const span = end - start;
  if (!(span > 0)) return 0;
  return Math.ceil(span * pointsPerSecond - 1e-12);
}
function bytes(channels: number, count: number) {
  return count * channels * 8;
}
function blank(count: number) {
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  min.fill(Number.POSITIVE_INFINITY);
  max.fill(Number.NEGATIVE_INFINITY);
  return { min, max };
}
type Envelope = {
  channels: number;
  count: number;
  capacity: number;
  min: Float32Array[];
  max: Float32Array[];
};
function allocate(channels: number, count: number, phase: "preparing" | "processing"): Envelope {
  if (bytes(channels, count) > maxBytes)
    throw new MediaError("OUTPUT_TOO_LARGE", "Waveform data exceeds 64 MiB.", { phase });
  const rows = Array.from({ length: channels }, () => blank(count));
  return {
    channels,
    count,
    capacity: count,
    min: rows.map((row) => row.min),
    max: rows.map((row) => row.max),
  };
}
function grow(envelope: Envelope, count: number) {
  if (count <= envelope.count) return;
  if (bytes(envelope.channels, count) > maxBytes)
    throw new MediaError("OUTPUT_TOO_LARGE", "Waveform data exceeds 64 MiB.", {
      phase: "processing",
    });
  if (count > envelope.capacity) {
    let capacity = Math.max(envelope.capacity, 64);
    while (capacity < count) capacity *= 2;
    if (bytes(envelope.channels, capacity) > maxBytes) capacity = count;
    envelope.min = envelope.min.map((row) => {
      const next = blank(capacity).min;
      next.set(row);
      return next;
    });
    envelope.max = envelope.max.map((row) => {
      const next = blank(capacity).max;
      next.set(row);
      return next;
    });
    envelope.capacity = capacity;
  }
  envelope.count = count;
}
function materialize(rows: Float32Array[], count: number) {
  return rows.map((row) => {
    const out = row.slice(0, count);
    for (let index = 0; index < out.length; index++)
      if (!Number.isFinite(out[index]!)) out[index] = 0;
    return out;
  });
}
function frameAt(time: number, timestamp: number, sampleRate: number) {
  return Math.ceil((time - timestamp) * sampleRate - 1e-9);
}
function absorb(
  envelope: Envelope,
  sample: AudioSample,
  origin: number,
  start: number,
  end: number | undefined,
  pointsPerSecond: number,
) {
  if (sample.numberOfChannels !== envelope.channels)
    throw new MediaError("UNSUPPORTED_INPUT", "Channel count changed while reading audio.", {
      phase: "processing",
    });
  if (!(sample.sampleRate > 0) || sample.numberOfFrames < 0)
    throw new MediaError("UNSUPPORTED_INPUT", "Audio sample timing is invalid.", {
      phase: "processing",
    });
  const planes = Array.from({ length: sample.numberOfChannels }, (_, channel) => {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
    return plane;
  });
  const timestamp = sample.timestamp - origin;
  const first = timestamp >= start ? 0 : Math.max(0, frameAt(start, timestamp, sample.sampleRate));
  const last =
    end === undefined
      ? sample.numberOfFrames
      : Math.min(sample.numberOfFrames, Math.max(0, frameAt(end, timestamp, sample.sampleRate)));
  for (let frame = first; frame < last;) {
    const rel = timestamp + frame / sample.sampleRate;
    const index = Math.floor((rel - start) * pointsPerSecond + 1e-9);
    const bucketEnd = start + (index + 1) / pointsPerSecond;
    const boundary = Math.min(
      last,
      Math.max(frame + 1, frameAt(bucketEnd, timestamp, sample.sampleRate)),
    );
    if (index < 0) {
      frame = boundary;
      continue;
    }
    if (end === undefined) grow(envelope, index + 1);
    else if (index >= envelope.count) break;
    for (let channel = 0; channel < planes.length; channel++) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      const plane = planes[channel]!;
      for (let cursor = frame; cursor < boundary; cursor++) {
        const value = plane[cursor]!;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      if (min < envelope.min[channel]![index]!) envelope.min[channel]![index] = min;
      if (max > envelope.max[channel]![index]!) envelope.max[channel]![index] = max;
    }
    frame = boundary;
  }
  return timestamp + sample.duration;
}
async function audioTrack(input: Input, track: "primary" | number | undefined, scope: Scope) {
  const selected =
    track === undefined || track === "primary"
      ? await scope.wait(input.getPrimaryAudioTrack(), "READ_FAILED")
      : (await scope.wait(input.getTracks(), "READ_FAILED")).find((item) => item.id === track);
  if (!selected?.isAudioTrack()) {
    if (typeof track === "number") invalid("The requested ID is not an audio track.");
    throw new MediaError("NO_TRACKS", "Input has no audio track.");
  }
  return selected as InputAudioTrack;
}
export async function getWaveformData(
  source: MediaInput,
  options: WaveformOptions = {},
): Promise<WaveformData> {
  const opts = waveformOptions(options);
  const scope = new Scope(opts.signal);
  let input: Input | undefined;
  let samples: AsyncGenerator<AudioSample, void, unknown> | undefined;
  let sample: AudioSample | null = null;
  let stopped = false;
  const closeSample = () => {
    const owned = sample;
    sample = null;
    owned?.close();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    closeSample();
    void samples?.return().catch((error) => scope.fail(error));
  };
  scope.onStop(stop);
  try {
    input = openInput(source, scope);
    await readable(input, scope);
    const track = await audioTrack(input, opts.track, scope);
    if (
      !(await scope.wait(
        new EncodedPacketSink(track).getFirstPacket({ metadataOnly: true }),
        "READ_FAILED",
      ))
    )
      throw new MediaError("NO_TRACKS", "Selected audio track is empty.");
    if (!(await scope.wait(track.canDecode(), "CODEC_UNAVAILABLE")))
      throw new MediaError("CODEC_UNAVAILABLE", "Selected audio decoder is unavailable.");
    const channels = await scope.wait(track.getNumberOfChannels(), "READ_FAILED");
    const sampleRate = await scope.wait(track.getSampleRate(), "READ_FAILED");
    if (channels < 1 || !(sampleRate > 0))
      throw new MediaError("UNSUPPORTED_INPUT", "Selected audio track has no sample layout.");
    const origin = Math.max(0, await scope.wait(input.getFirstTimestamp(), "READ_FAILED"));
    const known =
      opts.end === undefined ? undefined : bucketCount(opts.start, opts.end, opts.pointsPerSecond);
    const envelope =
      known === undefined
        ? allocate(channels, 0, "preparing")
        : allocate(channels, known, "preparing");
    scope.phase = "processing";
    samples = new AudioSampleSink(track).samples(
      origin + opts.start,
      opts.end === undefined ? undefined : origin + opts.end,
    );
    let discovered = opts.start;
    while (true) {
      scope.check();
      const next = await samples.next();
      if (next.done || !next.value) break;
      sample = next.value;
      scope.check();
      const sampleEnd = absorb(
        envelope,
        sample,
        origin,
        opts.start,
        opts.end,
        opts.pointsPerSecond,
      );
      closeSample();
      if (sampleEnd > discovered) discovered = sampleEnd;
    }
    const endSeconds = opts.end ?? discovered;
    const count =
      opts.end === undefined
        ? bucketCount(opts.start, endSeconds, opts.pointsPerSecond)
        : envelope.count;
    if (opts.end === undefined) grow(envelope, count);
    scope.check();
    return {
      trackId: track.id,
      sampleRate,
      channels,
      pointsPerSecond: opts.pointsPerSecond,
      startSeconds: opts.start,
      endSeconds,
      timeOriginSeconds: origin,
      min: materialize(envelope.min, count),
      max: materialize(envelope.max, count),
    };
  } catch (error) {
    throw scope.fail(error);
  } finally {
    stop();
    try {
      input?.dispose();
    } catch (error) {
      scope.cleanupError(error);
    }
    await scope.finish();
  }
}
