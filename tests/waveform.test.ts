import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { getWaveformData } from "../src/index.ts";

type Sample = {
  timestamp: number;
  sampleRate: number;
  channels: number[][];
};
const fake = vi.hoisted(() => ({
  opened: 0,
  disposed: 0,
  sinks: 0,
  closed: 0,
  live: 0,
  maxLive: 0,
  returned: 0,
  origin: 0,
  primary: true,
  packet: true,
  decodable: true,
  channels: 1,
  sampleRate: 1000,
  samples: [] as Sample[],
  ranges: [] as (number | undefined)[][],
  scanned: false,
  pulls: 0,
  decodeHook: undefined as (() => void) | undefined,
}));
vi.mock("mediabunny", () => ({
  Input: class {
    constructor() {
      fake.opened++;
      let disposed = false;
      const track = {
        id: 4,
        isVideoTrack: () => false,
        isAudioTrack: () => true,
        getCodec: async () => "pcm-f32",
        canDecode: async () => fake.decodable,
        getSampleRate: async () => fake.sampleRate,
        getNumberOfChannels: async () => fake.channels,
        computeDuration: async () => {
          fake.scanned = true;
          return 99;
        },
        getDurationFromMetadata: async () => {
          fake.scanned = true;
          return 99;
        },
      };
      return {
        getFormat: async () => ({ name: "WAVE" }),
        getPrimaryAudioTrack: async () => (fake.primary ? track : null),
        getTracks: async () => [
          track,
          { id: 9, isVideoTrack: () => true, isAudioTrack: () => false },
        ],
        getFirstTimestamp: async () => fake.origin,
        dispose: () => {
          if (!disposed) fake.disposed++;
          disposed = true;
        },
      };
    }
  },
  BlobSource: class {},
  BufferSource: class {},
  UrlSource: class {},
  MP4: {},
  QTFF: {},
  WEBM: {},
  MATROSKA: {},
  MP3: {},
  WAVE: {},
  OGG: {},
  FLAC: {},
  ADTS: {},
  UnsupportedInputFormatError: class extends Error {},
  EncodedPacketSink: class {
    async getFirstPacket() {
      return fake.packet ? { timestamp: fake.origin } : null;
    }
  },
  AudioSampleSink: class {
    constructor() {
      fake.sinks++;
    }
    async *samples(start?: number, end?: number) {
      fake.ranges.push([start, end]);
      try {
        for (const item of fake.samples) {
          const frames = item.channels[0]?.length ?? 0;
          const duration = frames / item.sampleRate;
          if (end !== undefined && item.timestamp >= end) continue;
          if (start !== undefined && item.timestamp + duration <= start) continue;
          fake.pulls++;
          fake.decodeHook?.();
          fake.live++;
          fake.maxLive = Math.max(fake.maxLive, fake.live);
          const channels = item.channels.map((row) => Float32Array.from(row));
          let released = false;
          const sample = {
            timestamp: item.timestamp,
            duration,
            sampleRate: item.sampleRate,
            numberOfChannels: item.channels.length,
            numberOfFrames: frames,
            copyTo(dest: Float32Array, options: { planeIndex: number }) {
              dest.set(channels[options.planeIndex]!);
            },
            close() {
              if (released) return;
              released = true;
              fake.live--;
              fake.closed++;
            },
          };
          try {
            yield sample;
          } finally {
            sample.close();
          }
        }
      } finally {
        fake.returned++;
      }
    }
  },
}));

const source = new Uint8Array([1, 2, 3, 4]);
const tone = (timestamp: number, channels: number[][], sampleRate = 1000): Sample => ({
  timestamp,
  sampleRate,
  channels,
});
const column = (value: number, count: number) => Array.from({ length: count }, () => value);
beforeEach(() => {
  fake.opened = 0;
  fake.disposed = 0;
  fake.sinks = 0;
  fake.closed = 0;
  fake.live = 0;
  fake.maxLive = 0;
  fake.returned = 0;
  fake.origin = 0;
  fake.primary = true;
  fake.packet = true;
  fake.decodable = true;
  fake.channels = 1;
  fake.sampleRate = 1000;
  fake.samples = [];
  fake.ranges = [];
  fake.scanned = false;
  fake.pulls = 0;
  fake.decodeHook = undefined;
});
afterEach(() => vi.unstubAllGlobals());

test("rejects invalid waveform options before opening input", async () => {
  for (const options of [
    { start: -1 },
    { start: 1, end: 1 },
    { pointsPerSecond: 0 },
    { pointsPerSecond: Number.NaN },
    { track: -1 },
    { track: 1.5 },
    { signal: {} },
    { extra: true },
  ])
    await expect(getWaveformData(source, options as never)).rejects.toMatchObject({
      code: "INVALID_OPTIONS",
    });
  expect(fake.opened).toBe(0);
});

test("builds a raw per-channel envelope with delay, gaps, and a partial bucket", async () => {
  fake.channels = 2;
  fake.samples = [
    tone(0.04, [column(0.5, 20), column(-0.5, 20)]),
    tone(0.1, [column(-0.25, 10), column(0.25, 10)]),
  ];
  const data = await getWaveformData(source, { pointsPerSecond: 50 });
  expect(data).toMatchObject({
    trackId: 4,
    sampleRate: 1000,
    channels: 2,
    pointsPerSecond: 50,
    startSeconds: 0,
    endSeconds: 0.11,
    timeOriginSeconds: 0,
  });
  expect(data.min).toHaveLength(2);
  expect(data.max).toHaveLength(2);
  expect(data.min[0]).toBeInstanceOf(Float32Array);
  expect(Array.from(data.min[0]!)).toEqual([0, 0, 0.5, 0, 0, -0.25]);
  expect(Array.from(data.max[0]!)).toEqual([0, 0, 0.5, 0, 0, -0.25]);
  expect(Array.from(data.min[1]!)).toEqual([0, 0, -0.5, 0, 0, 0.25]);
  expect(Array.from(data.max[1]!)).toEqual([0, 0, -0.5, 0, 0, 0.25]);
  expect(fake.maxLive).toBe(1);
  expect(fake.live).toBe(0);
  expect(fake.closed).toBe(2);
  expect(fake.scanned).toBe(false);
  expect(fake.ranges).toEqual([[0, undefined]]);
});

test("uses the shared input origin and keeps amplitudes outside the drawing scale", async () => {
  fake.origin = 5;
  fake.samples = [tone(5.04, [column(1.5, 20)])];
  const data = await getWaveformData(source);
  expect(data.timeOriginSeconds).toBe(5);
  expect(data.pointsPerSecond).toBe(50);
  expect(data.endSeconds).toBeCloseTo(0.06, 6);
  expect(Array.from(data.min[0]!)).toEqual([0, 0, 1.5]);
  expect(Array.from(data.max[0]!)).toEqual([0, 0, 1.5]);
  expect(fake.ranges[0]?.[0]).toBe(5);
  expect(fake.ranges[0]?.[1]).toBeUndefined();
});

test("clips samples to a half-open range and keeps silence at zero", async () => {
  const frames = Array.from({ length: 41 }, (_, index) => (index === 40 ? 1 : 0.25));
  fake.samples = [tone(0, [frames]), tone(0.04, [[1]])];
  const data = await getWaveformData(source, { start: 0, end: 0.04, pointsPerSecond: 50 });
  expect(data.startSeconds).toBe(0);
  expect(data.endSeconds).toBe(0.04);
  expect(Array.from(data.min[0]!)).toEqual([0.25, 0.25]);
  expect(Array.from(data.max[0]!)).toEqual([0.25, 0.25]);
  fake.samples = [tone(-0.01, [Array.from({ length: 30 }, (_, index) => index)])];
  const clipped = await getWaveformData(source, { start: 0, end: 0.02, pointsPerSecond: 50 });
  expect(clipped.min[0]![0]).toBe(10);
  expect(clipped.max[0]![0]).toBe(29);
  fake.samples = [tone(0, [column(0, 20)])];
  const silent = await getWaveformData(source, { start: 2, end: 2.02, pointsPerSecond: 50 });
  expect(Array.from(silent.min[0]!)).toEqual([0]);
  expect(Array.from(silent.max[0]!)).toEqual([0]);
  expect(silent.endSeconds).toBe(2.02);
});

test("keeps earlier buckets when a later chunk reuses sample memory", async () => {
  fake.samples = [tone(0, [column(0.5, 20)]), tone(0.02, [column(-0.25, 20)])];
  const data = await getWaveformData(source, { end: 0.04, pointsPerSecond: 50 });
  expect(Array.from(data.min[0]!)).toEqual([0.5, -0.25]);
  expect(Array.from(data.max[0]!)).toEqual([0.5, -0.25]);
});

test("rejects a channel-count change and does not resolve a partial envelope", async () => {
  fake.channels = 2;
  fake.samples = [tone(0, [column(0.2, 10), column(0.2, 10)]), tone(0.01, [column(0.2, 10)])];
  await expect(getWaveformData(source, { end: 0.02 })).rejects.toMatchObject({
    code: "UNSUPPORTED_INPUT",
  });
  expect(fake.live).toBe(0);
  expect(fake.disposed).toBe(1);
});

test("cancellation releases the current sample and input", async () => {
  const abort = new AbortController();
  fake.samples = [tone(0, [column(0.2, 20)]), tone(0.02, [column(0.2, 20)])];
  fake.decodeHook = () => {
    if (fake.pulls === 2) abort.abort();
  };
  await expect(getWaveformData(source, { signal: abort.signal, end: 0.04 })).rejects.toMatchObject({
    code: "ABORTED",
  });
  expect(fake.live).toBe(0);
  expect(fake.disposed).toBe(1);
  abort.abort();
  await expect(getWaveformData(source, { signal: abort.signal })).rejects.toMatchObject({
    code: "ABORTED",
  });
});

test("refuses an envelope above 64 MiB before decoding", async () => {
  fake.samples = [tone(0, [column(1, 10)])];
  await expect(
    getWaveformData(source, { end: 10, pointsPerSecond: 1_000_000 }),
  ).rejects.toMatchObject({ code: "OUTPUT_TOO_LARGE" });
  expect(fake.sinks).toBe(0);
});

test("empty, undecodable, and missing tracks fail clearly", async () => {
  fake.packet = false;
  await expect(getWaveformData(source)).rejects.toMatchObject({ code: "NO_TRACKS" });
  fake.packet = true;
  fake.decodable = false;
  await expect(getWaveformData(source)).rejects.toMatchObject({ code: "CODEC_UNAVAILABLE" });
  fake.decodable = true;
  fake.primary = false;
  await expect(getWaveformData(source)).rejects.toMatchObject({ code: "NO_TRACKS" });
  fake.primary = true;
  await expect(getWaveformData(source, { track: 9 })).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  await expect(getWaveformData(source, { track: 4 })).resolves.toMatchObject({ trackId: 4 });
});
