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

test("an impulse at 10000.05s stays in its own 20ms bin", async () => {
  const frames = 4800;
  const plane = new Float32Array(frames);
  plane[2400] = 0.8;
  const data = new Float32Array(frames * 2);
  data.set(plane, 0);
  data.set(
    plane.map((value) => -value),
    frames,
  );
  vi.spyOn(AudioSampleSink.prototype, "samples").mockImplementation(async function* () {
    yield new AudioSample({
      data,
      format: "f32-planar",
      sampleRate: 48000,
      numberOfChannels: 2,
      timestamp: 10000,
    });
  });
  const result = await getWaveformData(source(), { start: 10000, end: 10000.1 });
  const index = result.channels[0]!.max.findIndex((value) => value > 0.5);
  expect(index).toBe(2);
  expect(result.channels[0]!.max[index]).toBeCloseTo(0.8, 6);
  expect(result.channels[1]!.min[index]).toBeCloseTo(-0.8, 6);
  expect(result.channels[0]!.max.filter((value) => value > 0.5)).toHaveLength(1);
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
