import { afterEach, expect, test, vi } from "vite-plus/test";
import { renderWaveform, type WaveformData } from "../src/index.ts";

const data = (): WaveformData => ({
  trackId: 1,
  timeOriginSeconds: 0,
  start: 0,
  end: 0.04,
  pointsPerSecond: 50,
  channels: [{ min: new Float32Array([-0.5, 0]), max: new Float32Array([0.5, 0]) }],
});
const size = { width: 20, height: 10 };
afterEach(() => vi.unstubAllGlobals());

test("image validation rejects invalid colors, sizes, ranges and malformed envelopes", async () => {
  for (const options of [
    { width: 0 },
    { height: 4097 },
    { width: 4096, height: 4096 },
    { color: "red" },
    { color: null },
    { backgroundColor: "url(https://example.com)" },
    { start: -1 },
    { start: 0.04 },
    { end: 1 },
    { start: null },
    { signal: {} },
    { type: "image/jpeg" },
  ])
    await expect(renderWaveform(data(), { ...size, ...options } as never)).rejects.toMatchObject({
      code: "INVALID_OPTIONS",
    });
  for (const channels of [
    [],
    [{ min: new Float32Array([0]), max: new Float32Array([0]) }],
    [{ min: new Float32Array([NaN, 0]), max: new Float32Array([1, 0]) }],
    [{ min: new Float32Array([1, 0]), max: new Float32Array([0, 0]) }],
    [{ min: new Float32Array(new SharedArrayBuffer(8)), max: new Float32Array(2) }],
  ])
    await expect(
      renderWaveform({ ...data(), channels } as WaveformData, size),
    ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  await expect(renderWaveform(data(), size)).rejects.toMatchObject({
    code: "IMAGE_ENCODING_UNAVAILABLE",
  });
  const controller = new AbortController();
  controller.abort();
  await expect(
    renderWaveform(data(), { ...size, signal: controller.signal }),
  ).rejects.toMatchObject({ code: "ABORTED" });
});

test("image encoding rejects empty or substituted MIME results and awaits cancellation", async () => {
  let encode = async (): Promise<Blob | null> => new Blob(["png"], { type: "image/jpeg" });
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      width = 0;
      height = 0;
      getContext() {
        return { fillRect() {}, fillStyle: "" };
      }
      convertToBlob() {
        return encode();
      }
    },
  );
  await expect(renderWaveform(data(), size)).rejects.toMatchObject({
    code: "IMAGE_ENCODING_UNAVAILABLE",
  });
  encode = async () => new Blob([], { type: "image/png" });
  await expect(renderWaveform(data(), size)).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
  encode = async () => null;
  await expect(renderWaveform(data(), size)).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
  const controller = new AbortController();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  encode = async () => {
    controller.abort("encoding");
    await pending;
    return new Blob(["png"], { type: "image/png" });
  };
  const image = renderWaveform(data(), { ...size, signal: controller.signal });
  const rejection = expect(image).rejects.toMatchObject({ code: "ABORTED", cause: "encoding" });
  release();
  await rejection;
});
