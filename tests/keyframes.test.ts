import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { KeyFrameCountOptions, KeyFrameImagesOptions } from "../src/index.ts";
import { getClosestKeyFrameImage, getKeyFrameCount, getKeyFrameImages } from "../src/index.ts";

type KeyPacket = { timestamp: number; type: "key" | "delta"; cursor: number };
const fake = vi.hoisted(() => ({
  opened: 0,
  disposed: 0,
  sinks: 0,
  closed: 0,
  allocations: 0,
  encodes: 0,
  walked: 0,
  confirms: 0,
  codecChecks: 0,
  width: 80,
  height: 40,
  duration: 0.5,
  origin: 0,
  primary: true,
  packet: true,
  decodable: true,
  sampleNull: false,
  failDecode: false,
  sampleTimestamp: undefined as number | undefined,
  demote: [] as number[],
  keys: [] as { timestamp: number; type: "key" | "delta" }[],
}));
const key = (timestamp: number): { timestamp: number; type: "key" } => ({
  timestamp,
  type: "key",
});
vi.mock("../src/input.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/input.ts")>();
  return {
    signalOption: actual.signalOption,
    readable: async () => {},
    openInput: (_: unknown, scope: { onStop: (fn: () => void) => void }) => {
      fake.opened++;
      let disposed = false;
      const track = {
        id: 7,
        isVideoTrack: () => true,
        getCodec: async () => {
          fake.codecChecks++;
          return "avc";
        },
        canDecode: async () => {
          fake.codecChecks++;
          return fake.decodable;
        },
        getPixelAspectRatio: async () => ({ num: 1, den: 1 }),
        getCodedWidth: async () => 80,
        getCodedHeight: async () => 40,
      };
      const input = {
        getPrimaryVideoTrack: async () => (fake.primary ? track : null),
        getTracks: async () => [track, { id: 8, isVideoTrack: () => false }],
        getFirstTimestamp: async () => fake.origin,
        dispose: () => {
          if (!disposed) fake.disposed++;
          disposed = true;
        },
      };
      scope.onStop(input.dispose);
      return input;
    },
  };
});
vi.mock("mediabunny", () => ({
  EncodedPacketSink: class {
    async getFirstPacket() {
      return fake.packet ? { timestamp: 0, type: "delta" } : null;
    }
    async getFirstKeyPacket() {
      const packet = fake.keys[0];
      if (!packet) return null;
      fake.walked++;
      return { ...packet, cursor: 0 };
    }
    async getNextKeyPacket(packet: KeyPacket) {
      const next = packet.cursor + 1;
      const found = fake.keys[next];
      if (!found) return null;
      fake.walked++;
      return { ...found, cursor: next };
    }
    async getPacket(timestamp: number) {
      fake.confirms++;
      const found = fake.keys.find((item) => item.timestamp === timestamp);
      if (!found) return null;
      return {
        ...found,
        type: fake.demote.includes(found.timestamp) ? "delta" : found.type,
      };
    }
  },
  VideoSampleSink: class {
    constructor() {
      fake.sinks++;
    }
    async *samplesAtTimestamps(times: number[]) {
      for (const time of times) {
        if (fake.failDecode) throw new Error("decoder failure");
        if (fake.sampleNull) {
          yield null;
          continue;
        }
        yield {
          timestamp: fake.sampleTimestamp ?? time,
          duration: fake.duration,
          codedWidth: 80,
          codedHeight: 40,
          hasAlpha: false,
          displayWidth: fake.width,
          displayHeight: fake.height,
          draw: () => {},
          rotation: 0,
          pixelAspectRatio: { num: 1, den: 1 },
          close: () => {
            fake.closed++;
          },
        };
      }
    }
  },
}));
class Canvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    fake.allocations++;
    this.width = w;
    this.height = h;
  }
  getContext() {
    return {
      fillStyle: "",
      globalCompositeOperation: "source-over",
      fillRect() {},
      getImageData: () => ({ data: new Uint8ClampedArray([200, 100, 50, 128]) }),
      putImageData() {},
    };
  }
  async convertToBlob({ type }: { type: string }) {
    fake.encodes++;
    return new Blob([String(fake.encodes)], { type });
  }
}
beforeEach(() => {
  Object.assign(fake, {
    opened: 0,
    disposed: 0,
    sinks: 0,
    closed: 0,
    allocations: 0,
    encodes: 0,
    walked: 0,
    confirms: 0,
    codecChecks: 0,
    width: 80,
    height: 40,
    duration: 0.5,
    origin: 0,
    primary: true,
    packet: true,
    decodable: true,
    sampleNull: false,
    failDecode: false,
    sampleTimestamp: undefined,
    demote: [],
    keys: [key(0), key(1), key(2)],
  });
  vi.stubGlobal("OffscreenCanvas", Canvas);
});
afterEach(() => vi.unstubAllGlobals());
const source = new Uint8Array([1]);
const closest = (time: number, extra: Record<string, unknown> = {}) =>
  getClosestKeyFrameImage(source, { time, ...extra });
const timestamps = async (options: KeyFrameImagesOptions = {}) => {
  const result = [];
  for await (const image of getKeyFrameImages(source, options)) result.push(image.sourceTimestamp);
  return result;
};

test("rejects invalid keyframe options before opening the input", async () => {
  for (const opts of [
    { start: 1, end: 1 },
    { start: 0, end: 1e-9 },
    { start: -1 },
    { end: Number.POSITIVE_INFINITY },
    { width: 1, height: 1 },
    { width: 1, fit: "fill" },
    { width: 4097 },
    { width: 4096, height: 4096, fit: "fill" },
    { type: "image/png", quality: 0.5 },
    { extra: true },
    { track: -1 },
    { signal: {} },
  ])
    expect(() => getKeyFrameImages(source, opts as KeyFrameImagesOptions)).toThrow(
      expect.objectContaining({ code: "INVALID_OPTIONS" }),
    );
  await expect(getClosestKeyFrameImage(source, { time: -1 })).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  await expect(getClosestKeyFrameImage(source, { time: Number.NaN })).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  await expect(getClosestKeyFrameImage(source, { time: 1e20 })).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  await expect(
    getKeyFrameCount(source, { width: 10 } as KeyFrameCountOptions),
  ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  await expect(getKeyFrameCount(source, { start: 2, end: 2 })).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  expect(fake.opened).toBe(0);
  const opts = { start: 0, end: 2 };
  const batch = getKeyFrameImages(source, opts);
  opts.end = 1;
  expect(fake.opened).toBe(0);
  expect(await timestampsFrom(batch)).toEqual([0, 1]);
});
async function timestampsFrom(batch: ReturnType<typeof getKeyFrameImages>) {
  const result = [];
  for await (const image of batch) result.push(image.sourceTimestamp);
  return result;
}

test("selects the nearest keyframe on either side", async () => {
  fake.keys = [key(0), key(2)];
  await expect(closest(1)).resolves.toMatchObject({ sourceTimestamp: 0, actualTime: 0 });
  await expect(closest(1.6)).resolves.toMatchObject({ sourceTimestamp: 2 });
  await expect(closest(0.4)).resolves.toMatchObject({ sourceTimestamp: 0 });
  await expect(closest(2)).resolves.toMatchObject({ sourceTimestamp: 2 });
  fake.keys = [key(1), key(2)];
  await expect(closest(0)).resolves.toMatchObject({ sourceTimestamp: 1 });
  await expect(closest(10)).resolves.toMatchObject({ sourceTimestamp: 2 });
  fake.keys = [];
  await expect(closest(0)).resolves.toBeNull();
  fake.keys = [key(0), key(1)];
  fake.demote = [0];
  await expect(closest(0)).resolves.toMatchObject({ sourceTimestamp: 1 });
  fake.demote = [];
  fake.origin = 1;
  fake.keys = [key(1)];
  await expect(closest(0)).resolves.toMatchObject({
    sourceTimestamp: 1,
    actualTime: 0,
    timeOriginSeconds: 1,
    trackId: 7,
    durationSeconds: 0.5,
    mimeType: "image/jpeg",
  });
  expect(await closest(0)).not.toHaveProperty("requestedTime");
});

test("range is half-open and omitted bounds keep negative timestamps", async () => {
  fake.keys = [key(-0.5), key(0), key(1), key(2)];
  expect(await timestamps()).toEqual([-0.5, 0, 1, 2]);
  expect(await getKeyFrameCount(source)).toBe(4);
  expect(await timestamps({ start: 0 })).toEqual([0, 1, 2]);
  expect(await timestamps({ start: -0 })).toEqual([0, 1, 2]);
  expect(await timestamps({ end: 1 })).toEqual([-0.5, 0]);
  expect(await timestamps({ start: 0, end: 2 })).toEqual([0, 1]);
  expect(await getKeyFrameCount(source, { start: 0, end: 2 })).toBe(2);
  fake.origin = 1;
  fake.keys = [key(0.5), key(1), key(2)];
  expect(await timestamps()).toEqual([0.5, 1, 2]);
  expect(await timestamps({ start: 0 })).toEqual([1, 2]);
});

test("sorts presentation time, collapses equal timestamps, and drops unverified keys", async () => {
  fake.keys = [key(2), key(0), key(0), key(1)];
  expect(await timestamps()).toEqual([0, 1, 2]);
  expect(fake.walked).toBe(4);
  expect(await getKeyFrameCount(source)).toBe(3);
  fake.demote = [1];
  expect(await timestamps()).toEqual([0, 2]);
  expect(await getKeyFrameCount(source)).toBe(2);
});

test("count confirms packets without a decoder, canvas, or codec check", async () => {
  expect(await getKeyFrameCount(source, { track: "primary" })).toBe(3);
  expect(fake.sinks).toBe(0);
  expect(fake.allocations).toBe(0);
  expect(fake.encodes).toBe(0);
  expect(fake.codecChecks).toBe(0);
  expect(fake.confirms).toBe(3);
  expect(fake.disposed).toBe(fake.opened);
});

test("images share one canvas and stop confirming after return", async () => {
  const batch = getKeyFrameImages(source, { width: 20 });
  expect(fake.opened).toBe(0);
  const first = (await batch.next()).value!;
  expect(first).toMatchObject({ sourceTimestamp: 0, width: 20, height: 10 });
  expect(fake.walked).toBe(3);
  expect(fake.confirms).toBe(1);
  expect(fake.sinks).toBe(1);
  expect(fake.codecChecks).toBeGreaterThan(0);
  const text = await first.blob.text();
  await batch.return();
  expect(fake.confirms).toBe(1);
  expect(await first.blob.text()).toBe(text);
  expect(fake.disposed).toBe(fake.opened);
  fake.allocations = 0;
  fake.closed = 0;
  expect(await timestamps()).toEqual([0, 1, 2]);
  expect(fake.allocations).toBe(1);
  expect(fake.closed).toBe(3);
});

test("track, codec, and empty-track failures stay distinct from no keyframes", async () => {
  await expect(closest(0, { track: 8 })).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  await expect(closest(0, { track: 99 })).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  await expect(getKeyFrameCount(source, { track: 8 })).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  const missing = getKeyFrameImages(source, { track: 8 });
  await expect(missing.next()).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  fake.primary = false;
  await expect(closest(0)).rejects.toMatchObject({ code: "NO_TRACKS" });
  await expect(getKeyFrameCount(source)).rejects.toMatchObject({ code: "NO_TRACKS" });
  fake.primary = true;
  fake.packet = false;
  await expect(closest(0)).rejects.toMatchObject({ code: "NO_TRACKS" });
  await expect(getKeyFrameCount(source)).rejects.toMatchObject({ code: "NO_TRACKS" });
  const empty = getKeyFrameImages(source);
  await expect(empty.next()).rejects.toMatchObject({ code: "NO_TRACKS" });
  fake.packet = true;
  fake.decodable = false;
  await expect(closest(0)).rejects.toMatchObject({ code: "CODEC_UNAVAILABLE" });
  expect(await getKeyFrameCount(source)).toBe(3);
  fake.decodable = true;
  fake.keys = [key(1e20)];
  await expect(getKeyFrameCount(source)).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
});

test("decode mismatches and empty frames fail instead of skipping", async () => {
  fake.sampleTimestamp = 9;
  await expect(closest(0)).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
  expect(fake.allocations).toBe(0);
  fake.sampleTimestamp = undefined;
  fake.duration = 0;
  await expect(closest(0)).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
  fake.duration = 0.5;
  fake.sampleNull = true;
  await expect(closest(0)).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
  fake.sampleNull = false;
  fake.failDecode = true;
  await expect(closest(0)).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
  fake.failDecode = false;
  fake.width = 5000;
  await expect(closest(0)).rejects.toMatchObject({ code: "OUTPUT_TOO_LARGE" });
  expect(fake.allocations).toBe(0);
});

test("a pre-aborted request does not open the input", async () => {
  const signal = AbortSignal.abort();
  await expect(closest(0, { signal })).rejects.toMatchObject({ code: "ABORTED" });
  await expect(getKeyFrameCount(source, { signal })).rejects.toMatchObject({ code: "ABORTED" });
  const batch = getKeyFrameImages(source, { signal });
  expect(fake.opened).toBe(0);
  await expect(batch.next()).rejects.toMatchObject({ code: "ABORTED" });
  expect(fake.opened).toBe(0);
  const unstarted = getKeyFrameImages(source);
  await unstarted.return();
  expect(fake.opened).toBe(0);
});
