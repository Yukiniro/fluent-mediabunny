import { AudioSampleSink, EncodedPacketSink } from "mediabunny";
import type { AudioSample, Input } from "mediabunny";
import { normalizeSource, number, object } from "./config.ts";
import { invalid, MediaError } from "./errors.ts";
import { openInput, readable, signalOption } from "./input.ts";
import { Scope } from "./scope.ts";
import { canvas, encode } from "./image.ts";
import type { Canvas } from "./image.ts";
import type {
  MediaInput,
  WaveformChannel,
  WaveformData,
  WaveformOptions,
  WaveformImage,
  WaveformImageOptions,
} from "./types.ts";

const maxBytes = 64 * 1024 * 1024;
function time(value: unknown, name: string): number {
  number(value, name, { zero: true });
  const micros = Math.round(value * 1_000_000);
  if (!Number.isSafeInteger(micros)) invalid("Time exceeds microsecond precision.");
  return micros / 1_000_000;
}

export async function renderWaveform(
  data: WaveformData,
  options: WaveformImageOptions,
): Promise<WaveformImage> {
  const opts = object(options, [
    "width",
    "height",
    "start",
    "end",
    "color",
    "backgroundColor",
    "signal",
  ]);
  signalOption(opts.signal);
  const { width, height } = opts;
  number(width, "width", { integer: true });
  number(height, "height", { integer: true });
  if (width > 4096 || height > 4096 || width * height > 16_000_000)
    invalid("Image exceeds output limits.");
  const color = opts.color === undefined ? "#000000" : opts.color,
    background = opts.backgroundColor === undefined ? "#00000000" : opts.backgroundColor;
  for (const value of [color, background])
    if (typeof value !== "string" || !/^#(?:[\da-f]{6}|[\da-f]{8})$/i.test(value))
      invalid("Colors must be #RRGGBB or #RRGGBBAA.");
  const value = object(data, [
    "trackId",
    "timeOriginSeconds",
    "start",
    "end",
    "pointsPerSecond",
    "channels",
  ]);
  number(value.trackId, "track ID", { integer: true, zero: true });
  time(value.timeOriginSeconds, "time origin");
  const dataStart = time(value.start, "data start"),
    dataEnd = time(value.end, "data end");
  const rate = value.pointsPerSecond;
  number(rate, "pointsPerSecond");
  if (dataEnd <= dataStart) invalid("Waveform data must have positive duration.");
  const start = time(opts.start === undefined ? dataStart : opts.start, "start"),
    end = time(opts.end === undefined ? dataEnd : opts.end, "end");
  if (end <= start || start < dataStart || end > dataEnd)
    invalid("Image range is outside the waveform data.");
  const count = pointCount(dataStart, dataEnd, rate);
  if (!Array.isArray(value.channels) || !value.channels.length || value.channels.length > height)
    invalid("Waveform requires at least one pixel of height per channel.");
  if (!Number.isSafeInteger(count) || count * value.channels.length * 8 > maxBytes)
    throw new MediaError("OUTPUT_TOO_LARGE", "Waveform data exceeds 64 MiB.");
  const channels = value.channels.map((channel) => {
    const entry = object(channel, ["min", "max"]);
    for (const values of [entry.min, entry.max])
      if (
        !(values instanceof Float32Array) ||
        !(values.buffer instanceof ArrayBuffer) ||
        values.length !== count
      )
        invalid("Expected matching, non-shared Float32 min/max arrays.");
    return entry as WaveformChannel;
  });
  const first = Math.floor((Math.round((start - dataStart) * 1_000_000) * rate) / 1_000_000);
  const last = Math.min(count, pointCount(dataStart, end, rate));
  const scope = new Scope(opts.signal);
  let surface: Canvas | undefined;
  try {
    scope.check();
    for (const channel of channels)
      for (let i = 0; i < count; i++) {
        if (
          !Number.isFinite(channel.min[i]) ||
          !Number.isFinite(channel.max[i]) ||
          channel.min[i]! > channel.max[i]!
        )
          invalid("Waveform extrema must be finite with min <= max.");
      }
    scope.phase = "processing";
    surface = canvas(width, height);
    const context = surface.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context)
      throw new MediaError("IMAGE_ENCODING_UNAVAILABLE", "Canvas 2D rendering is unavailable.", {
        phase: scope.phase,
      });
    context.fillStyle = background as string;
    context.fillRect(0, 0, width, height);
    context.fillStyle = color as string;
    for (let c = 0; c < channels.length; c++) {
      const channel = channels[c]!;
      const laneStart = Math.floor((c * height) / channels.length),
        laneEnd = Math.floor(((c + 1) * height) / channels.length);
      const half = (laneEnd - laneStart) / 2,
        center = laneStart + half;
      for (let x = 0; x < width; x++) {
        const from = first + Math.floor((x * (last - first)) / width);
        const to = Math.min(last, first + Math.ceil(((x + 1) * (last - first)) / width));
        let min = Infinity,
          max = -Infinity;
        for (let i = from; i < to; i++) {
          min = Math.min(min, channel.min[i]!);
          max = Math.max(max, channel.max[i]!);
        }
        const top = Math.min(
          laneEnd - 1,
          Math.max(laneStart, Math.floor(center - Math.max(-1, Math.min(1, max)) * half)),
        );
        const bottom = Math.min(laneEnd, Math.ceil(center - Math.max(-1, Math.min(1, min)) * half));
        context.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
    }
    const blob = await scope.wait(encode(surface, "image/png"));
    if (!blob || !blob.size)
      throw new MediaError("PROCESSING_FAILED", "Image encoder returned no data.", {
        phase: scope.phase,
      });
    if (blob.type !== "image/png")
      throw new MediaError(
        "IMAGE_ENCODING_UNAVAILABLE",
        "Image encoder substituted the requested MIME type.",
        { phase: scope.phase },
      );
    return {
      blob,
      mimeType: "image/png",
      width,
      height,
      start: dataStart + first / rate,
      end: Math.min(dataEnd, dataStart + last / rate),
    };
  } catch (error) {
    throw scope.fail(error);
  } finally {
    try {
      if (surface) {
        surface.width = 1;
        surface.height = 1;
      }
    } catch (error) {
      scope.fail(error);
    }
    await scope.finish();
    scope.check();
  }
}
function pointCount(start: number, end: number, rate: number): number {
  return end > start
    ? Math.max(1, Math.ceil((Math.round((end - start) * 1_000_000) * rate) / 1_000_000))
    : 0;
}
export async function getWaveformData(
  source: MediaInput,
  options: WaveformOptions = {},
): Promise<WaveformData> {
  const opts = object(options, ["track", "start", "end", "pointsPerSecond", "signal"]);
  signalOption(opts.signal);
  if (opts.track !== undefined && opts.track !== "primary")
    number(opts.track, "track ID", { integer: true, zero: true });
  const start = time(opts.start === undefined ? 0 : opts.start, "start");
  const requestedEnd = opts.end === undefined ? undefined : time(opts.end, "end");
  if (requestedEnd !== undefined && requestedEnd <= start) invalid("end must exceed start.");
  const pointsPerSecond = opts.pointsPerSecond === undefined ? 50 : opts.pointsPerSecond;
  number(pointsPerSecond, "pointsPerSecond");
  const normalized = normalizeSource(source);
  const scope = new Scope(opts.signal);
  let input: Input | undefined;
  let samples: AsyncGenerator<AudioSample, void, unknown> | undefined;
  try {
    input = openInput(normalized, scope);
    await readable(input, scope);
    const track =
      opts.track === undefined || opts.track === "primary"
        ? await scope.wait(input.getPrimaryAudioTrack(), "READ_FAILED")
        : (await scope.wait(input.getTracks(), "READ_FAILED")).find((t) => t.id === opts.track);
    if (!track || !track.isAudioTrack()) {
      if (typeof opts.track === "number") invalid("The requested ID is not an audio track.");
      throw new MediaError("NO_TRACKS", "Input has no audio track.");
    }
    if (
      !(await scope.wait(
        new EncodedPacketSink(track).getFirstPacket({ metadataOnly: true }),
        "READ_FAILED",
      ))
    )
      throw new MediaError("NO_TRACKS", "Selected audio track is empty.");
    if (!(await scope.wait(track.canDecode(), "CODEC_UNAVAILABLE")))
      throw new MediaError("CODEC_UNAVAILABLE", "Selected audio decoder is unavailable.");
    const timeOriginSeconds = Math.max(
      0,
      await scope.wait(input.getFirstTimestamp(), "READ_FAILED"),
    );
    const channelCount = await scope.wait(track.getNumberOfChannels(), "READ_FAILED");
    if (
      !Number.isSafeInteger(channelCount) ||
      channelCount <= 0 ||
      ![
        timeOriginSeconds,
        timeOriginSeconds + start,
        timeOriginSeconds + (requestedEnd ?? start),
      ].every((value) => Number.isSafeInteger(Math.round(value * 1_000_000)))
    )
      throw new MediaError("UNSUPPORTED_INPUT", "Invalid audio geometry or time origin.");
    const maxPoints = Math.floor(maxBytes / (channelCount * 8));
    let capacity = 0;
    let channels: WaveformChannel[] = [];
    const grow = (count: number) => {
      if (!Number.isSafeInteger(count) || count > maxPoints)
        throw new MediaError("OUTPUT_TOO_LARGE", "Waveform data exceeds 64 MiB.", {
          phase: scope.phase,
        });
      if (count <= capacity) return;
      capacity = Math.min(maxPoints, Math.max(count, capacity * 2, 1024));
      channels = Array.from({ length: channelCount }, (_, c) => {
        const min = new Float32Array(capacity).fill(Infinity);
        const max = new Float32Array(capacity).fill(-Infinity);
        if (channels[c]) {
          min.set(channels[c]!.min);
          max.set(channels[c]!.max);
        }
        return { min, max };
      });
    };
    if (requestedEnd !== undefined) grow(pointCount(start, requestedEnd, pointsPerSecond));
    let end = start;
    let coveredEnd = start;
    const silence = (from: number, to: number) => {
      const a = Math.max(start, from),
        b = Math.min(to, requestedEnd ?? end);
      if (b <= a) return;
      const first = Math.floor((Math.round((a - start) * 1_000_000) * pointsPerSecond) / 1_000_000);
      const last = pointCount(start, b, pointsPerSecond);
      for (const channel of channels)
        for (let i = first; i < last; i++) {
          channel.min[i] = Math.min(channel.min[i]!, 0);
          channel.max[i] = Math.max(channel.max[i]!, 0);
        }
    };
    const pcm = new Float32Array(4096);
    let lastYield = Date.now();
    scope.phase = "processing";
    samples = new AudioSampleSink(track).samples(
      start + timeOriginSeconds,
      requestedEnd === undefined ? undefined : requestedEnd + timeOriginSeconds,
    );
    for (;;) {
      const next = await samples.next();
      if (next.done) break;
      const sample = next.value;
      try {
        scope.check();
        const { timestamp, sampleRate, numberOfFrames, numberOfChannels } = sample;
        if (
          !Number.isFinite(timestamp) ||
          !Number.isFinite(sampleRate) ||
          sampleRate <= 0 ||
          !Number.isSafeInteger(numberOfFrames) ||
          numberOfFrames <= 0 ||
          numberOfChannels !== channelCount
        )
          throw new MediaError(
            "UNSUPPORTED_INPUT",
            "Invalid audio timing or changing channel count.",
            { phase: "processing" },
          );
        const sampleEnd =
          Math.round((timestamp - timeOriginSeconds + numberOfFrames / sampleRate) * 1_000_000) /
          1_000_000;
        if (!Number.isSafeInteger(Math.round(sampleEnd * 1_000_000)))
          throw new MediaError("UNSUPPORTED_INPUT", "Unsafe audio timestamp.", {
            phase: "processing",
          });
        end = Math.max(end, Math.min(requestedEnd ?? Infinity, sampleEnd));
        const bins = pointCount(start, end, pointsPerSecond);
        grow(bins);
        silence(coveredEnd, Math.round((timestamp - timeOriginSeconds) * 1_000_000) / 1_000_000);
        coveredEnd = Math.max(coveredEnd, sampleEnd);
        for (let offset = 0; offset < numberOfFrames; offset += pcm.length) {
          scope.check();
          const count = Math.min(pcm.length, numberOfFrames - offset);
          for (let c = 0; c < channelCount; c++) {
            sample.copyTo(pcm, {
              planeIndex: c,
              format: "f32-planar",
              frameOffset: offset,
              frameCount: count,
            });
            for (let i = 0; i < count; i++) {
              const value = pcm[i]!;
              if (!Number.isFinite(value))
                throw new MediaError("UNSUPPORTED_INPUT", "Non-finite audio sample.", {
                  phase: "processing",
                });
              const position =
                Math.round(
                  (timestamp - timeOriginSeconds + (offset + i) / sampleRate) * 1_000_000,
                ) / 1_000_000;
              if (position < start || (requestedEnd !== undefined && position >= requestedEnd))
                continue;
              const bin = Math.floor(
                (Math.round((position - start) * 1_000_000) * pointsPerSecond) / 1_000_000,
              );
              if (bin >= bins) continue;
              channels[c]!.min[bin] = Math.min(channels[c]!.min[bin]!, value);
              channels[c]!.max[bin] = Math.max(channels[c]!.max[bin]!, value);
            }
          }
        }
      } catch (error) {
        throw scope.fail(error);
      } finally {
        try {
          sample.close();
        } catch (error) {
          scope.fail(error);
        }
        scope.check();
      }
      if (Date.now() - lastYield >= 16) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYield = Date.now();
        scope.check();
      }
    }
    scope.check();
    end = requestedEnd ?? end;
    if (end <= start) invalid("No audio after start; supply an explicit end for zero padding.");
    const count = pointCount(start, end, pointsPerSecond);
    grow(count);
    silence(coveredEnd, end);
    for (const channel of channels) {
      if (capacity !== count) {
        channel.min = channel.min.slice(0, count);
        channel.max = channel.max.slice(0, count);
      }
      for (let i = 0; i < count; i++)
        if (channel.min[i] === Infinity) channel.min[i] = channel.max[i] = 0;
    }
    return { trackId: track.id, timeOriginSeconds, start, end, pointsPerSecond, channels };
  } catch (error) {
    throw scope.fail(error);
  } finally {
    try {
      input?.dispose();
    } catch (error) {
      scope.fail(error);
    }
    try {
      await samples?.return();
    } catch (error) {
      scope.fail(error);
    }
    await scope.finish();
    scope.check();
  }
}
