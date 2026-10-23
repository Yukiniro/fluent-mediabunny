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

test("compressed audio, source offsets and a secondary track decode in this browser", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const api = window.mediaAPI;
    const load = (name: string) => new URL(`/fixtures/${name}`, location.href);
    const shape = async (name: string, track?: number) => {
      const data = await api.getWaveformData(load(name), track === undefined ? {} : { track });
      const channel = data.channels[0]!;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < channel.min.length; i++) {
        min = Math.min(min, channel.min[i]!);
        max = Math.max(max, channel.max[i]!);
      }
      return {
        trackId: data.trackId,
        origin: data.timeOriginSeconds,
        end: data.end,
        points: channel.min.length,
        channels: data.channels.length,
        min,
        max,
      };
    };
    const probed = await api.probe(load("multi.mp4"));
    const audio = probed.tracks.filter((track) => track.type === "audio");
    return {
      wav: await shape("audio.wav"),
      mp3: await shape("audio.mp3"),
      aac: await shape("av.mp4"),
      opus: await shape("av.webm"),
      offset: await shape("offset.mp4"),
      secondary: await shape("multi.mp4", audio[1]!.id),
      audioIds: audio.map((track) => track.id),
    };
  });
  expect(result.wav).toMatchObject({ end: 2, points: 100, channels: 1 });
  expect(result.wav.min).toBeLessThan(-0.12);
  expect(result.wav.max).toBeGreaterThan(0.12);
  expect(result.mp3.end).toBeCloseTo(2.037551, 3);
  expect(result.mp3.points).toBe(102);
  expect(result.mp3.min).toBeLessThan(-0.1);
  expect(result.aac.end).toBeCloseTo(2.020136, 3);
  expect(result.aac.points).toBe(102);
  expect(result.aac.min).toBeLessThan(-0.12);
  expect(result.opus.points).toBe(101);
  expect(result.opus.end).toBeGreaterThan(2);
  expect(result.opus.end).toBeLessThan(2.05);
  expect(result.opus.min).toBeLessThan(-0.12);
  expect(result.offset.origin).toBeCloseTo(4.976, 2);
  expect(result.offset.end).toBeGreaterThan(2);
  expect(result.offset.points).toBeGreaterThanOrEqual(100);
  expect(result.audioIds).toHaveLength(2);
  expect(result.secondary.trackId).toBe(result.audioIds[1]);
  expect(result.secondary.trackId).not.toBe(result.audioIds[0]);
  expect(result.secondary.end).toBeCloseTo(result.aac.end, 3);
  expect(result.secondary.min).toBeLessThan(-0.12);
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
