import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { ThumbnailsOptions } from "../src/index.ts";
import { thumbnail, thumbnails } from "../src/index.ts";

const fake = vi.hoisted(() => ({
  opened: 0,
  disposed: 0,
  sinks: 0,
  returned: 0,
  closed: 0,
  allocations: 0,
  encodes: 0,
  width: 80,
  height: 40,
  timestamp: 0,
  duration: 1,
  origin: 0,
  primary: true,
  packet: true,
  decodable: true,
  codec: "avc",
  mime: "",
  empty: false,
  failDecode: false,
  failClose: false,
  failDispose: false,
  encodeHook: undefined as (() => Promise<void>) | undefined,
  decodeHook: undefined as (() => Promise<void>) | undefined,
  readHook: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("../src/input.ts", () => ({
  signalOption: (s: unknown) => {
    if (s !== undefined && !(s instanceof AbortSignal)) throw new Error("signal");
  },
  readable: async () => {
    await fake.readHook?.();
  },
  openInput: (_: unknown, scope: { onStop: (fn: () => void) => void }) => {
    fake.opened++;
    let disposed = false;
    const track = {
      id: 7,
      isVideoTrack: () => true,
      getCodec: async () => fake.codec,
      canDecode: async () => fake.decodable,
      getPixelAspectRatio: async () => ({ num: 1, den: 1 }),
    };
    const input = {
      getPrimaryVideoTrack: async () => (fake.primary ? track : null),
      getTracks: async () => [track, { id: 8, isVideoTrack: () => false }],
      getFirstTimestamp: async () => fake.origin,
      dispose: () => {
        if (!disposed) fake.disposed++;
        disposed = true;
        if (fake.failDispose) throw new Error("dispose failure");
      },
    };
    scope.onStop(input.dispose);
    return input;
  },
}));
vi.mock("mediabunny", () => ({
  EncodedPacketSink: class {
    async getFirstPacket() {
      return fake.packet ? {} : null;
    }
  },
  VideoSampleSink: class {
    constructor() {
      fake.sinks++;
    }
    async *samplesAtTimestamps(times: number[]) {
      try {
        for (const t of times) {
          await fake.decodeHook?.();
          if (fake.failDecode) throw new Error("decoder failure");
          yield {
            timestamp: fake.timestamp,
            duration: fake.duration,
            displayWidth: fake.width,
            displayHeight: fake.height,
            draw: () => {},
            rotation: 0,
            pixelAspectRatio: { num: 1, den: 1 },
            close: () => {
              fake.closed++;
              if (fake.failClose) throw new Error("close failure");
            },
            query: t,
          };
        }
      } finally {
        fake.returned++;
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
    return { fillStyle: "", fillRect() {} };
  }
  async convertToBlob({ type }: { type: string }) {
    fake.encodes++;
    await fake.encodeHook?.();
    return new Blob(fake.empty ? [] : [String(fake.encodes)], { type: fake.mime || type });
  }
}
beforeEach(() => {
  Object.assign(fake, {
    opened: 0,
    disposed: 0,
    sinks: 0,
    returned: 0,
    closed: 0,
    allocations: 0,
    encodes: 0,
    width: 80,
    height: 40,
    timestamp: 0,
    duration: 1,
    origin: 0,
    primary: true,
    packet: true,
    decodable: true,
    codec: "avc",
    mime: "",
    empty: false,
    failDecode: false,
    failClose: false,
    failDispose: false,
    encodeHook: undefined,
    decodeHook: undefined,
    readHook: undefined,
  });
  vi.stubGlobal("OffscreenCanvas", Canvas);
});
afterEach(() => vi.unstubAllGlobals());
const source = new Uint8Array([1]);
const collect = async (opts: ThumbnailsOptions) => {
  const result = [];
  for await (const item of thumbnails(source, opts)) result.push(item);
  return result;
};

test("validates the complete snapshot synchronously before opening input", async () => {
  for (const opts of [
    { times: [] },
    { times: [1, 0] },
    { times: [0, NaN] },
    { times: [Infinity] },
    { times: [-1] },
    { times: [1e20] },
    { times: Array(1001).fill(0) },
    { times: [0], start: 0 },
    { start: 2, end: 2, count: 1 },
    { start: 0, end: 1e-9, count: 1 },
    { start: 0, end: 1, count: 0 },
    { start: 0, end: 1, count: 1.5 },
    { times: [0], width: 1, height: 1 },
    { times: [0], width: 1, fit: "fill" },
    { times: [0], width: 4097 },
    { times: [0], width: 4096, height: 4096, fit: "fill" },
    { times: [0], quality: 2 },
    { times: [0], type: "image/png", quality: 0.5 },
    { times: [0], extra: true },
    { times: [0], type: null },
    { times: [0], track: -1 },
  ])
    expect(() => thumbnails(source, opts as ThumbnailsOptions)).toThrow(
      expect.objectContaining({ code: "INVALID_OPTIONS" }),
    );
  expect(fake.opened).toBe(0);
  const opts = { times: [0, 0], width: 20 };
  const batch = thumbnails(source, opts);
  opts.times[1] = 9;
  opts.width = 100;
  expect(fake.opened).toBe(0);
  expect((await batch.next()).value).toMatchObject({ image: { width: 20, height: 10 } });
  expect((await batch.next()).value).toMatchObject({ requestedTime: 0 });
  await batch.return();
  const unstarted = thumbnails(source, { times: [0] });
  await unstarted.return();
  expect(fake.opened).toBe(1);
});
test("interval bins, duplicates and half-open frame coverage", async () => {
  expect((await collect({ start: 2, end: 10, count: 4 })).map((v) => v.requestedTime)).toEqual([
    2, 4, 6, 8,
  ]);
  expect((await collect({ start: 2, end: 10, count: 1 })).map((v) => v.requestedTime)).toEqual([2]);
  const items = await collect({ times: [-0, 0, 0.999999, 1, 5] });
  expect(items.map((v) => v.image !== null)).toEqual([true, true, true, false, false]);
  expect(items.map((v) => v.index)).toEqual([0, 1, 2, 3, 4]);
  expect(Object.is(items[0]!.requestedTime, -0)).toBe(false);
  fake.timestamp = -0.5;
  expect(await thumbnail(source, { time: 0 })).toMatchObject({
    actualTime: -0.5,
    sourceTimestamp: -0.5,
  });
  fake.timestamp = 2;
  fake.origin = 1;
  expect(await thumbnail(source, { time: 0 })).toBeNull();
  expect(await thumbnail(source, { time: 1 })).toMatchObject({
    actualTime: 1,
    timeOriginSeconds: 1,
  });
});
test("selected track, empty track and decoder failure distinctions", async () => {
  await expect(thumbnail(source, { time: 0, track: 8 })).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  await expect(thumbnail(source, { time: 0, track: 7 })).resolves.toMatchObject({ trackId: 7 });
  fake.primary = false;
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({ code: "NO_TRACKS" });
  fake.primary = true;
  fake.packet = false;
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({ code: "NO_TRACKS" });
  fake.packet = true;
  fake.decodable = false;
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({ code: "CODEC_UNAVAILABLE" });
  fake.decodable = true;
  fake.failDecode = true;
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
});
test("geometry and timing guards precede canvas allocation", async () => {
  fake.width = 5000;
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({ code: "OUTPUT_TOO_LARGE" });
  expect(fake.allocations).toBe(0);
  await expect(thumbnail(source, { time: 0, width: 50 })).resolves.toMatchObject({
    width: 50,
    height: 1,
  });
  fake.duration = 0;
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
  fake.duration = 1;
  fake.timestamp = NaN;
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
});
test("image encoder absence, substitution and empty output", async () => {
  vi.stubGlobal("OffscreenCanvas", undefined);
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({
    code: "IMAGE_ENCODING_UNAVAILABLE",
  });
  vi.stubGlobal("OffscreenCanvas", Canvas);
  fake.mime = "image/webp";
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({
    code: "IMAGE_ENCODING_UNAVAILABLE",
  });
  fake.mime = "";
  fake.empty = true;
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
});
test("abort after yield actively cleans up and retains earlier Blob", async () => {
  const controller = new AbortController();
  const batch = thumbnails(source, { times: [0, 0], signal: controller.signal });
  const first = (await batch.next()).value!;
  const bytes = await first.image!.blob.text();
  controller.abort();
  await vi.waitFor(() => expect(fake.returned).toBe(1));
  expect(fake.disposed).toBe(1);
  expect(await first.image!.blob.text()).toBe(bytes);
  await expect(batch.next()).rejects.toMatchObject({ code: "ABORTED" });
});
test("preabort, pending read/decode/encode discard late work; explicit return is normal", async () => {
  const pre = AbortSignal.abort();
  await expect(thumbnail(source, { time: 0, signal: pre })).rejects.toMatchObject({
    code: "ABORTED",
  });
  expect(fake.opened).toBe(0);
  expect(() => thumbnails(source, { times: [], signal: pre })).toThrow(
    expect.objectContaining({ code: "INVALID_OPTIONS" }),
  );
  for (const hook of ["readHook", "decodeHook", "encodeHook"] as const) {
    const controller = new AbortController();
    fake[hook] = async () => {
      controller.abort();
      await Promise.resolve();
    };
    await expect(thumbnail(source, { time: 0, signal: controller.signal })).rejects.toMatchObject({
      code: "ABORTED",
    });
    fake[hook] = undefined;
  }
  const controller = new AbortController();
  const batch = thumbnails(source, { times: [0, 0], signal: controller.signal });
  await batch.next();
  controller.abort();
  await expect(batch.return()).resolves.toMatchObject({ done: true });
});
test("1000 slow requests reuse one input/sink/canvas and release samples before delivery", async () => {
  let count = 0;
  for await (const item of thumbnails(source, { times: Array(1000).fill(0) })) {
    count++;
    expect(fake.closed).toBe(count);
    expect(fake.encodes).toBe(count);
    expect(item.image).not.toBeNull();
    await Promise.resolve();
  }
  expect(count).toBe(1000);
  expect([fake.opened, fake.sinks, fake.allocations, fake.disposed, fake.returned]).toEqual([
    1, 1, 1, 1, 1,
  ]);
});
test("early break and mid-batch failure close resources without replacing first failure", async () => {
  for await (const item of thumbnails(source, { times: [0, 0] })) {
    expect(item.image).not.toBeNull();
    break;
  }
  expect(fake.returned).toBe(1);
  const batch = thumbnails(source, { times: [0, 0] });
  await batch.next();
  fake.failDecode = true;
  await expect(batch.next()).rejects.toMatchObject({
    code: "PROCESSING_FAILED",
    cause: expect.objectContaining({ message: "decoder failure" }),
  });
  expect(fake.disposed).toBe(2);
});

test("cleanup-only failures reject, later cleanup errors preserve the first failure", async () => {
  fake.failDispose = true;
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({
    code: "PROCESSING_FAILED",
    cause: expect.objectContaining({ message: "dispose failure" }),
  });
  fake.failDispose = false;
  const batch = thumbnails(source, { times: [0, 0] });
  await batch.next();
  fake.failDispose = true;
  await expect(batch.return()).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
  fake.failDecode = true;
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({
    cause: expect.objectContaining({ message: "decoder failure" }),
    diagnostics: expect.arrayContaining([expect.anything()]),
  });
});

test("a delayed encode is awaited after abort and its Blob is never delivered", async () => {
  const controller = new AbortController();
  let release!: () => void;
  fake.encodeHook = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const batch = thumbnails(source, { times: [0, 0], signal: controller.signal });
  const next = batch.next();
  const rejection = expect(next).rejects.toMatchObject({ code: "ABORTED" });
  await vi.waitFor(() => expect(fake.encodes).toBe(1));
  controller.abort();
  expect(fake.closed).toBe(1);
  expect(fake.disposed).toBe(1);
  release();
  await rejection;
  expect(fake.returned).toBe(1);
  expect(fake.encodes).toBe(1);
});

test("per-sample geometry can change without preflight or an extra canvas", async () => {
  const batch = thumbnails(source, { times: [0, 0], height: 21 });
  expect((await batch.next()).value!.image).toMatchObject({ width: 42, height: 21 });
  fake.width = 40;
  fake.height = 80;
  expect((await batch.next()).value!.image).toMatchObject({ width: 11, height: 21 });
  await batch.return();
  expect(fake.allocations).toBe(1);
});

test("HTML canvas null encoding and absent rendering context have distinct errors", async () => {
  vi.stubGlobal("OffscreenCanvas", undefined);
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 1,
      height: 1,
      getContext: () => ({ fillRect() {} }),
      toBlob: (callback: (blob: Blob | null) => void) => callback(null),
    }),
  });
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
  vi.stubGlobal("document", {
    createElement: () => ({ width: 1, height: 1, getContext: () => null, toBlob() {} }),
  });
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({
    code: "IMAGE_ENCODING_UNAVAILABLE",
  });
});
