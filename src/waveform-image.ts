import { number, object } from "./config.ts";
import { invalid, MediaError } from "./errors.ts";
import { createCanvas, encodeCanvas, type Raster } from "./image.ts";
import { Scope } from "./scope.ts";
import type { WaveformData, WaveformImage, WaveformRenderOptions } from "./types.ts";

type Rgba = { r: number; g: number; b: number; a: number };

function seconds(value: unknown, name: string) {
  number(value, name, { zero: true });
  if (!Number.isSafeInteger(Math.round(value * 1_000_000)))
    invalid("Time exceeds microsecond precision.");
  return value === 0 ? 0 : value;
}
function hex(value: unknown, name: string): Rgba {
  if (
    typeof value !== "string" ||
    !/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
  )
    invalid(`${name} must be a hexadecimal RGB or RGBA value.`);
  const body = value.slice(1);
  const part = (text: string) => parseInt(text.length === 1 ? text + text : text, 16);
  const channels =
    body.length <= 4
      ? [part(body[0]!), part(body[1]!), part(body[2]!), body.length === 4 ? part(body[3]!) : 255]
      : [
          part(body.slice(0, 2)),
          part(body.slice(2, 4)),
          part(body.slice(4, 6)),
          body.length === 8 ? part(body.slice(6, 8)) : 255,
        ];
  return { r: channels[0]!, g: channels[1]!, b: channels[2]!, a: channels[3]! / 255 };
}
function css(color: Rgba) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
}
function renderOptions(options: WaveformRenderOptions) {
  const opts = object(options, [
    "width",
    "height",
    "start",
    "end",
    "color",
    "background",
    "signal",
  ]);
  if (opts.signal !== undefined && !(opts.signal instanceof AbortSignal))
    invalid("signal must be an AbortSignal.");
  if (opts.width === undefined || opts.height === undefined)
    invalid("width and height are required.");
  number(opts.width, "width", { integer: true });
  number(opts.height, "height", { integer: true });
  if (opts.width > 4096 || opts.height > 4096) invalid("Image dimensions must not exceed 4096.");
  if (opts.width * opts.height > 16_000_000) invalid("Image area exceeds 16000000 pixels.");
  const start = opts.start === undefined ? undefined : seconds(opts.start, "start");
  const end = opts.end === undefined ? undefined : seconds(opts.end, "end");
  if (start !== undefined && end !== undefined && end <= start) invalid("end must exceed start.");
  return {
    width: opts.width as number,
    height: opts.height as number,
    start,
    end,
    color: opts.color === undefined ? hex("#000", "color") : hex(opts.color, "color"),
    background: opts.background === undefined ? undefined : hex(opts.background, "background"),
    signal: opts.signal as AbortSignal | undefined,
  };
}
function waveform(data: WaveformData) {
  if (!data || typeof data !== "object" || Array.isArray(data)) invalid("Expected waveform data.");
  const min = data.min;
  const max = data.max;
  if (!Array.isArray(min) || !Array.isArray(max) || min.length < 1 || min.length !== max.length)
    invalid("Waveform channel arrays must match.");
  const count = min[0]?.length ?? 0;
  if (!count) invalid("Waveform data is empty.");
  for (let channel = 0; channel < min.length; channel++) {
    if (!(min[channel] instanceof Float32Array) || !(max[channel] instanceof Float32Array))
      invalid("Waveform peaks must be Float32Array values.");
    if (min[channel]!.length !== count || max[channel]!.length !== count)
      invalid("Waveform channel arrays must match.");
  }
  if (data.channels !== min.length) invalid("Waveform channel count does not match.");
  number(data.pointsPerSecond, "points per second");
  number(data.startSeconds, "start", { zero: true });
  number(data.endSeconds, "end");
  if (data.endSeconds <= data.startSeconds) invalid("Waveform data is empty.");
  return data;
}
function align(data: WaveformData, start: number | undefined, end: number | undefined) {
  const count = data.min[0]!.length;
  const reqStart = start ?? data.startSeconds;
  const reqEnd = end ?? data.endSeconds;
  if (!(reqEnd > reqStart)) invalid("end must exceed start.");
  let first = -1;
  let last = -1;
  for (let index = 0; index < count; index++) {
    const bucketStart = data.startSeconds + index / data.pointsPerSecond;
    const bucketEnd = data.startSeconds + (index + 1) / data.pointsPerSecond;
    if (bucketEnd > reqStart && bucketStart < reqEnd) {
      if (first < 0) first = index;
      last = index;
    }
  }
  if (first < 0) invalid("Range does not intersect waveform data.");
  return {
    first,
    last,
    startSeconds: data.startSeconds + first / data.pointsPerSecond,
    endSeconds: data.startSeconds + (last + 1) / data.pointsPerSecond,
  };
}
function yOf(value: number, top: number, laneHeight: number) {
  const clipped = Math.min(1, Math.max(-1, value));
  return top + ((1 - clipped) * laneHeight) / 2;
}
export async function renderWaveform(
  data: WaveformData,
  options: WaveformRenderOptions,
): Promise<WaveformImage> {
  const opts = renderOptions(options);
  const source = waveform(data);
  const range = align(source, opts.start, opts.end);
  if (opts.height < source.channels) invalid("Height cannot show every channel.");
  const scope = new Scope(opts.signal);
  let surface: Raster | undefined;
  try {
    scope.check();
    surface = createCanvas(opts.width, opts.height);
    const context = surface.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context)
      throw new MediaError("IMAGE_ENCODING_UNAVAILABLE", "Canvas 2D rendering is unavailable.", {
        phase: "processing",
      });
    if (opts.background) {
      context.fillStyle = css(opts.background);
      context.fillRect(0, 0, opts.width, opts.height);
    }
    context.fillStyle = css(opts.color);
    const selected = range.last - range.first + 1;
    const base = Math.floor(opts.height / source.channels);
    const extra = opts.height % source.channels;
    let top = 0;
    for (let channel = 0; channel < source.channels; channel++) {
      const laneHeight = base + (channel < extra ? 1 : 0);
      const mins = source.min[channel]!;
      const maxes = source.max[channel]!;
      for (let x = 0; x < opts.width; x++) {
        let from: number;
        let to: number;
        if (opts.width <= selected) {
          from = range.first + Math.floor((x * selected) / opts.width);
          to = range.first + Math.floor(((x + 1) * selected) / opts.width);
          if (to <= from) to = from + 1;
        } else {
          from = range.first + Math.min(selected - 1, Math.floor((x * selected) / opts.width));
          to = from + 1;
        }
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (let index = from; index < to; index++) {
          if (mins[index]! < min) min = mins[index]!;
          if (maxes[index]! > max) max = maxes[index]!;
        }
        if (min === 0 && max === 0) continue;
        const y = yOf(max, top, laneHeight);
        const height = yOf(min, top, laneHeight) - y;
        if (height > 0) context.fillRect(x, y, 1, height);
      }
      top += laneHeight;
    }
    scope.phase = "processing";
    const blob = await scope.wait(encodeCanvas(surface, "image/png"));
    if (!blob?.size)
      throw new MediaError("PROCESSING_FAILED", "Image encoder returned no data.", {
        phase: scope.phase,
      });
    if (blob.type !== "image/png")
      throw new MediaError(
        "IMAGE_ENCODING_UNAVAILABLE",
        "Image encoder substituted the requested MIME type.",
        { phase: scope.phase },
      );
    scope.check();
    return {
      blob,
      mimeType: "image/png",
      width: opts.width,
      height: opts.height,
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
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
      scope.cleanupError(error);
    }
    await scope.finish();
  }
}
