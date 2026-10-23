import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.mediaAPI);
});

test("waveform PNG preserves transparent padding, colors and outward-aligned coverage", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const data = {
      trackId: 1,
      timeOriginSeconds: 0,
      start: 0,
      end: 0.06,
      pointsPerSecond: 50,
      channels: [{ min: new Float32Array([-0.5, -1, 0]), max: new Float32Array([0.5, 1, 0]) }],
    };
    const image = await window.mediaAPI.renderWaveform(data, {
      width: 3,
      height: 20,
      color: "#ff0000",
    });
    const bitmap = await createImageBitmap(image.blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    const cropped = await window.mediaAPI.renderWaveform(data, {
      start: 0.011,
      end: 0.039,
      width: 10,
      height: 8,
      backgroundColor: "#ffffff",
    });
    return {
      mime: image.blob.type,
      size: [image.width, image.height],
      top: pixel(0, 0),
      middle: pixel(0, 10),
      full: pixel(1, 0),
      silence: pixel(2, 10),
      coverage: [cropped.start, cropped.end],
    };
  });
  expect(result).toEqual({
    mime: "image/png",
    size: [3, 20],
    top: [0, 0, 0, 0],
    middle: [255, 0, 0, 255],
    full: [255, 0, 0, 255],
    silence: [255, 0, 0, 255],
    coverage: [0, 0.04],
  });
});

test("packaged waveform decodes real PCM and renders through the DOM canvas fallback", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const path = "/dist/index.mjs";
    const api = (await import(/* @vite-ignore */ path)) as typeof window.mediaAPI;
    const data = await api.getWaveformData(new URL("/fixtures/audio.wav", location.href));
    const offscreen = globalThis.OffscreenCanvas;
    Object.defineProperty(globalThis, "OffscreenCanvas", { value: undefined, configurable: true });
    try {
      const image = await api.renderWaveform(data, {
        width: 100,
        height: 40,
        backgroundColor: "#ffffff",
      });
      const bitmap = await createImageBitmap(image.blob);
      const canvas = document.createElement("canvas");
      canvas.width = 100;
      canvas.height = 40;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        end: data.end,
        channels: data.channels.length,
        length: data.channels[0]!.min.length,
        min: Math.max(...data.channels[0]!.min),
        max: Math.min(...data.channels[0]!.max),
        background: Array.from(ctx.getImageData(0, 0, 1, 1).data),
        center: Array.from(ctx.getImageData(50, 20, 1, 1).data),
        mime: image.blob.type,
      };
    } finally {
      Object.defineProperty(globalThis, "OffscreenCanvas", {
        value: offscreen,
        configurable: true,
      });
    }
  });
  expect(result.end).toBeCloseTo(2, 5);
  expect(result.channels).toBe(1);
  expect(result.length).toBe(100);
  expect(result.min).toBeLessThan(-0.12);
  expect(result.max).toBeGreaterThan(0.12);
  expect(result.background).toEqual([255, 255, 255, 255]);
  expect(result.center).toEqual([0, 0, 0, 255]);
  expect(result.mime).toBe("image/png");
});

test("rendering keeps channel lanes, clips only pixels and retains peaks when downsampling", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const data = {
      trackId: 1,
      timeOriginSeconds: 0,
      start: 0,
      end: 0.04,
      pointsPerSecond: 50,
      channels: [
        { min: new Float32Array([2, -2]), max: new Float32Array([2, -2]) },
        { min: new Float32Array([-0.5, -0.5]), max: new Float32Array([0.5, 0.5]) },
      ],
    };
    const pixel = async (width: number, x: number, y: number) => {
      const image = await window.mediaAPI.renderWaveform(data, {
        width,
        height: 20,
        color: "#00ff00",
      });
      const bitmap = await createImageBitmap(image.blob);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = 20;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(x, y, 1, 1).data);
    };
    return {
      top: await pixel(2, 0, 0),
      bottom: await pixel(2, 1, 9),
      gap: await pixel(2, 0, 5),
      second: await pixel(2, 0, 15),
      aggregated: await pixel(1, 0, 5),
      raw: data.channels[0]!.min[0],
    };
  });
  expect(result).toEqual({
    top: [0, 255, 0, 255],
    bottom: [0, 255, 0, 255],
    gap: [0, 0, 0, 0],
    second: [0, 255, 0, 255],
    aggregated: [0, 255, 0, 255],
    raw: 2,
  });
});
