import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { AudioSample, AudioSampleSink, Input } from "mediabunny";
import { getWaveformData } from "../src/index.ts";
import { wav } from "./wav.ts";

const left = [
  ...Array<number>(160).fill(0.5),
  ...Array<number>(160).fill(-0.25),
  ...Array<number>(160).fill(1.5),
];
const source = () => wav([left, left.map((v) => -v)]);
afterEach(() => vi.restoreAllMocks());

test("waveform preserves channel min/max and raw amplitude at 50 points per second", async () => {
  const result = await getWaveformData(source());
  expect(result).toMatchObject({ start: 0, end: 0.06, pointsPerSecond: 50, timeOriginSeconds: 0 });
  expect(result.channels).toHaveLength(2);
  expect(result.channels[0]!.min).toEqual(new Float32Array([0.5, -0.25, 1.5]));
  expect(result.channels[0]!.max).toEqual(new Float32Array([0.5, -0.25, 1.5]));
  expect(result.channels[1]!.min).toEqual(new Float32Array([-0.5, 0.25, -1.5]));
  result.channels[0]!.min.fill(99);
  expect((await getWaveformData(source())).channels[0]!.min[0]).toBe(0.5);
});

test("source offsets and partial-bin gaps remain silent rather than collapsing the timeline", async () => {
  vi.spyOn(Input.prototype, "getFirstTimestamp").mockResolvedValue(5);
  vi.spyOn(AudioSampleSink.prototype, "samples").mockImplementation(async function* () {
    yield new AudioSample({
      data: new Float32Array(160).fill(0.5),
      format: "f32-planar",
      sampleRate: 8000,
      numberOfChannels: 2,
      timestamp: 5.02,
    });
  });
  const result = await getWaveformData(source(), { end: 0.06 });
  expect(result.timeOriginSeconds).toBe(5);
  expect(result.channels[0]!.min).toEqual(new Float32Array([0, 0, 0]));
  expect(result.channels[0]!.max).toEqual(new Float32Array([0, 0.5, 0]));
});

test("half-open ranges crop PCM inside decoded chunks and retain partial final bins", async () => {
  const result = await getWaveformData(source(), { start: 0.01, end: 0.05 });
  expect(result.channels[0]!.min).toEqual(new Float32Array([-0.25, -0.25]));
  expect(result.channels[0]!.max).toEqual(new Float32Array([0.5, 1.5]));
  const fine = await getWaveformData(source(), { end: 0.055, pointsPerSecond: 100 });
  expect(fine.channels[0]!.min).toEqual(new Float32Array([0.5, 0.5, -0.25, -0.25, 1.5, 1.5]));
  const padded = await getWaveformData(source(), { start: 1, end: 1.04 });
  expect(padded.channels[0]!.min).toEqual(new Float32Array(2));
  expect(padded.channels[0]!.max).toEqual(new Float32Array(2));
});

test("waveform validates options and rejects oversized results before decoding", async () => {
  for (const options of [
    { start: -1 },
    { end: 0 },
    { start: 1, end: 1 },
    { pointsPerSecond: 0 },
    { pointsPerSecond: Infinity },
    { track: -1 },
    { start: Number.MAX_VALUE },
    { signal: {} },
    { extra: true },
    { start: null },
    { pointsPerSecond: null },
  ])
    await expect(getWaveformData(source(), options as never)).rejects.toMatchObject({
      code: "INVALID_OPTIONS",
    });
  const decode = vi.spyOn(AudioSampleSink.prototype, "samples");
  await expect(getWaveformData(source(), { end: 100000 })).rejects.toMatchObject({
    code: "OUTPUT_TOO_LARGE",
  });
  expect(decode).not.toHaveBeenCalled();
  await expect(getWaveformData(source(), { track: 999 })).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  await expect(getWaveformData(source(), { start: 1 })).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
});

test("time-origin arithmetic stays within safe microseconds and tiny resolution still has one bin", async () => {
  const tiny = await getWaveformData(source(), { pointsPerSecond: Number.MIN_VALUE });
  expect(tiny.channels[0]!.min).toEqual(new Float32Array([-0.25]));
  expect(tiny.channels[0]!.max).toEqual(new Float32Array([1.5]));
  vi.spyOn(Input.prototype, "getFirstTimestamp").mockResolvedValue(Number.MAX_SAFE_INTEGER);
  await expect(getWaveformData(source())).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
});

test("changing sample rates use actual sample timing while channel changes and NaNs fail", async () => {
  const sample = (rate: number, timestamp: number, value: number, channels = 2) =>
    new AudioSample({
      data: new Float32Array((rate / 50) * channels).fill(value),
      format: "f32-planar",
      sampleRate: rate,
      numberOfChannels: channels,
      timestamp,
    });
  const decoder = vi
    .spyOn(AudioSampleSink.prototype, "samples")
    .mockImplementation(async function* () {
      yield sample(8000, 0, 0.5);
      yield sample(16000, 0.02, -0.25);
    });
  expect((await getWaveformData(source())).channels[0]!.min).toEqual(
    new Float32Array([0.5, -0.25]),
  );
  for (const bad of [sample(8000, 0.02, 0.5, 1), sample(8000, 0.02, NaN)]) {
    decoder.mockImplementation(async function* () {
      yield bad;
    });
    await expect(getWaveformData(source())).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
    expect(() => bad.allocationSize({ planeIndex: 0 })).toThrow("closed");
  }
});

test("cancellation awaits a pending decoder and closes its late sample before rejecting", async () => {
  const controller = new AbortController();
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const pending = new Promise<void>((r) => {
    release = r;
  });
  const late = new AudioSample({
    data: new Float32Array(320),
    format: "f32-planar",
    sampleRate: 8000,
    numberOfChannels: 2,
    timestamp: 0,
  });
  let returned = false;
  const decoder = vi
    .spyOn(AudioSampleSink.prototype, "samples")
    .mockImplementation(async function* () {
      try {
        entered();
        await pending;
        yield late;
      } finally {
        returned = true;
      }
    });
  const result = getWaveformData(source(), { signal: controller.signal });
  const rejection = expect(result).rejects.toMatchObject({ code: "ABORTED", cause: "stop" });
  await ready;
  controller.abort("stop");
  expect(returned).toBe(false);
  release();
  await rejection;
  expect(returned).toBe(true);
  expect(() => late.allocationSize({ planeIndex: 0 })).toThrow("closed");
  decoder.mockClear();
  await expect(getWaveformData(source(), { signal: controller.signal })).rejects.toMatchObject({
    code: "ABORTED",
  });
  expect(decoder).not.toHaveBeenCalled();
});

test("real high-rate stereo PCM keeps constants, mixed bins and sine peaks", async () => {
  const rate = 96_000;
  const frames = rate / 10;
  const constant = await getWaveformData(
    wav([Array<number>(frames).fill(0.5), Array<number>(frames).fill(-0.25)], rate),
  );
  expect(constant.end).toBeCloseTo(0.1, 6);
  expect(constant.channels[0]!.min).toEqual(new Float32Array(5).fill(0.5));
  expect(constant.channels[0]!.max).toEqual(new Float32Array(5).fill(0.5));
  expect(constant.channels[1]!.min).toEqual(new Float32Array(5).fill(-0.25));
  expect(constant.channels[1]!.max).toEqual(new Float32Array(5).fill(-0.25));
  const cropped = await getWaveformData(
    wav([Array<number>(frames).fill(0.5), Array<number>(frames).fill(-0.25)], rate),
    { start: 0.025, end: 0.075 },
  );
  expect(cropped.channels[0]!.min).toEqual(new Float32Array(3).fill(0.5));
  expect(cropped.channels[1]!.max).toEqual(new Float32Array(3).fill(-0.25));

  const stepRate = 48_000;
  const stepFrames = Math.round(stepRate * 0.04);
  const step = Array.from({ length: stepFrames }, (_, i) => (i / stepRate < 0.01 ? 0.25 : 0.75));
  const stepped = await getWaveformData(wav([step], stepRate));
  expect(stepped.channels[0]!.min[0]).toBeCloseTo(0.25, 5);
  expect(stepped.channels[0]!.max[0]).toBeCloseTo(0.75, 5);
  expect(stepped.channels[0]!.min[1]).toBeCloseTo(0.75, 5);
  expect(stepped.channels[0]!.max[1]).toBeCloseTo(0.75, 5);

  const sineFrames = stepRate / 10;
  const sine = Array.from({ length: sineFrames }, (_, i) =>
    Math.sin((2 * Math.PI * 440 * i) / stepRate),
  );
  const tone = await getWaveformData(wav([sine], stepRate));
  for (const value of tone.channels[0]!.min) expect(value).toBeLessThan(-0.99);
  for (const value of tone.channels[0]!.max) expect(value).toBeGreaterThan(0.99);
});

test("ten seconds of real 96 kHz stereo PCM keeps constant extrema", async () => {
  const file = join(tmpdir(), "fmb-wave-10s.wav");
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.5\\|-0.25:s=96000:d=10",
    "-c:a",
    "pcm_f32le",
    file,
  ]);
  const started = performance.now();
  const result = await getWaveformData(new Uint8Array(readFileSync(file)));
  const elapsed = performance.now() - started;
  expect(result.end).toBeCloseTo(10, 4);
  expect(result.channels).toHaveLength(2);
  expect(result.channels[0]!.min[100]).toBeCloseTo(0.5, 5);
  expect(result.channels[1]!.max[100]).toBeCloseTo(-0.25, 5);
  expect(result.channels[0]!.min.length).toBe(500);
  // Catches a quadratic or full-PCM regression. The multi-hour budget is enforced in the browser.
  expect(elapsed).toBeLessThan(1_000);
});

test("four hours of timestamped chunks produce bounded-size envelopes without retaining PCM", async () => {
  vi.spyOn(AudioSampleSink.prototype, "samples").mockImplementation(async function* () {
    for (let minute = 0; minute < 240; minute++)
      yield new AudioSample({
        data: new Float32Array(6000).fill(0.25),
        format: "f32-planar",
        sampleRate: 50,
        numberOfChannels: 2,
        timestamp: minute * 60,
      });
  });
  const result = await getWaveformData(source());
  expect(result.end).toBe(14400);
  expect(result.channels[0]!.min.length).toBe(720000);
  expect(result.channels[0]!.min[0]).toBe(0.25);
  expect(result.channels[1]!.max[719999]).toBe(0.25);
  expect(result.channels.reduce((bytes, c) => bytes + c.min.byteLength + c.max.byteLength, 0)).toBe(
    11520000,
  );
}, 15000);

test("the first decode failure survives later sample and input cleanup failures", async () => {
  const sample = new AudioSample({
    data: new Float32Array(320),
    format: "f32-planar",
    sampleRate: 8000,
    numberOfChannels: 2,
    timestamp: 0,
  });
  const decodeError = new Error("decode first");
  vi.spyOn(sample, "copyTo").mockImplementation(() => {
    throw decodeError;
  });
  const close = sample.close.bind(sample);
  vi.spyOn(sample, "close").mockImplementation(() => {
    close();
    throw new Error("close later");
  });
  vi.spyOn(AudioSampleSink.prototype, "samples").mockImplementation(async function* () {
    yield sample;
  });
  await expect(getWaveformData(source())).rejects.toMatchObject({
    code: "PROCESSING_FAILED",
    cause: decodeError,
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ cause: expect.objectContaining({ message: "close later" }) }),
    ]),
  });
});
