import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { WaveformData } from "../src/index.ts";
import { renderWaveform } from "../src/index.ts";

const fake = vi.hoisted(() => ({
  allocations: 0,
  encodes: 0,
  empty: false,
  mime: "",
  encodeHook: undefined as (() => void) | undefined,
  canvases: [] as Canvas[],
}));
function contextFor(canvas: Canvas) {
  return {
    set fillStyle(value: string) {
      canvas.style = value;
    },
    get fillStyle() {
      return canvas.style;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      canvas.ops.push({ style: canvas.style, x, y, w, h });
    },
  };
}
class Canvas {
  width: number;
  height: number;
  ops: { style: string; x: number; y: number; w: number; h: number }[] = [];
  style = "";
  constructor(width: number, height: number) {
    fake.allocations++;
    fake.canvases.push(this);
    this.width = width;
    this.height = height;
  }
  getContext() {
    return contextFor(this);
  }
  async convertToBlob({ type }: { type: string }) {
    fake.encodes++;
    fake.encodeHook?.();
    if (fake.empty) return null;
    return new Blob([new Uint8Array([137, 80, 78, 71])], { type: fake.mime || type });
  }
}
beforeEach(() => {
  fake.allocations = 0;
  fake.encodes = 0;
  fake.empty = false;
  fake.mime = "";
  fake.encodeHook = undefined;
  fake.canvases = [];
  vi.stubGlobal("OffscreenCanvas", Canvas);
});
afterEach(() => vi.unstubAllGlobals());

const wave = (
  min: number[][],
  max: number[][],
  extra: Partial<WaveformData> = {},
): WaveformData => ({
  trackId: 1,
  sampleRate: 1000,
  channels: min.length,
  pointsPerSecond: 50,
  startSeconds: 0,
  endSeconds: min[0]!.length / 50,
  timeOriginSeconds: 0,
  min: min.map((row) => Float32Array.from(row)),
  max: max.map((row) => Float32Array.from(row)),
  ...extra,
});

test("rejects invalid image options before allocating a canvas", async () => {
  const data = wave([[0, 1]], [[0, 1]]);
  for (const options of [
    {},
    { width: 0, height: 2 },
    { width: 4097, height: 1 },
    { width: 4096, height: 4096 },
    { width: 2, height: 2, color: "red" },
    { width: 2, height: 2, color: "#ff" },
    { width: 2, height: 2, background: "#12" },
    { width: 2, height: 2, start: 1, end: 1 },
    { width: 2, height: 2, start: 5, end: 6 },
    { width: 2, height: 2, extra: true },
  ])
    await expect(renderWaveform(data, options as never)).rejects.toMatchObject({
      code: "INVALID_OPTIONS",
    });
  expect(fake.allocations).toBe(0);
  await expect(
    renderWaveform(
      wave(
        [
          [0, 0],
          [0, 0],
        ],
        [
          [1, 1],
          [1, 1],
        ],
      ),
      { width: 2, height: 1 },
    ),
  ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  expect(fake.allocations).toBe(0);
});

test("aligns a range outward to whole buckets and stacks channels", async () => {
  const data = wave(
    [
      [-1, -0.25, -1],
      [0, 0, 0],
    ],
    [
      [1, 1, 0],
      [0, 0, 0],
    ],
  );
  const image = await renderWaveform(data, { width: 2, height: 4, start: 0.03, end: 0.05 });
  expect(image).toMatchObject({
    mimeType: "image/png",
    width: 2,
    height: 4,
    startSeconds: 0.02,
    endSeconds: 0.06,
  });
  expect(image.blob.type).toBe("image/png");
  const ops = fake.canvases[0]!.ops;
  expect(ops.map((op) => [op.x, op.y, op.w, op.h])).toEqual([
    [0, 0, 1, 1.25],
    [1, 1, 1, 1],
  ]);
  expect(ops.every((op) => op.style === "rgba(0, 0, 0, 1)")).toBe(true);
});

test("preserves peaks when shrinking and reuses buckets when enlarging", async () => {
  const shrunk = wave([[0, -0.25, 0, -1]], [[0.25, 1, 0, 0.5]]);
  await renderWaveform(shrunk, { width: 2, height: 2 });
  expect(fake.canvases[0]!.ops.map((op) => [op.x, op.y, op.h])).toEqual([
    [0, 0, 1.25],
    [1, 0.5, 1.5],
  ]);
  fake.canvases = [];
  const grown = wave([[-1, 0]], [[1, 0]]);
  await renderWaveform(grown, { width: 4, height: 2 });
  expect(fake.canvases.at(-1)!.ops.map((op) => op.x)).toEqual([0, 1]);
});

test("clips only the drawing and accepts explicit hex colors", async () => {
  const data = wave([[-2]], [[2]]);
  await renderWaveform(data, {
    width: 1,
    height: 2,
    color: "#f00",
    background: "#00ff0080",
  });
  expect(Array.from(data.min[0]!)).toEqual([-2]);
  expect(Array.from(data.max[0]!)).toEqual([2]);
  expect(fake.canvases[0]!.ops.map((op) => [op.style, op.x, op.y, op.w, op.h])).toEqual([
    ["rgba(0, 255, 0, 0.5019607843137255)", 0, 0, 1, 2],
    ["rgba(255, 0, 0, 1)", 0, 0, 1, 2],
  ]);
});

test("a partial final bucket aligns to the full bucket grid", async () => {
  const data = wave([[0, 0]], [[1, 0]], { endSeconds: 0.025 });
  const image = await renderWaveform(data, { width: 2, height: 2 });
  expect(image.startSeconds).toBe(0);
  expect(image.endSeconds).toBe(0.04);
});

test("encoding failure and cancellation clear the canvas", async () => {
  const data = wave([[-1]], [[1]]);
  fake.empty = true;
  await expect(renderWaveform(data, { width: 2, height: 2 })).rejects.toMatchObject({
    code: "PROCESSING_FAILED",
  });
  expect(fake.canvases[0]!.width).toBe(1);
  expect(fake.canvases[0]!.height).toBe(1);
  fake.empty = false;
  fake.mime = "image/jpeg";
  await expect(renderWaveform(data, { width: 2, height: 2 })).rejects.toMatchObject({
    code: "IMAGE_ENCODING_UNAVAILABLE",
  });
  const abort = new AbortController();
  fake.mime = "";
  fake.encodeHook = () => abort.abort();
  await expect(
    renderWaveform(data, { width: 2, height: 2, signal: abort.signal }),
  ).rejects.toMatchObject({ code: "ABORTED" });
  expect(fake.canvases.at(-1)!.width).toBe(1);
});
