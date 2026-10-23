import { existsSync, symlinkSync, unlinkSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { longStereoWav } from "../long-wav.ts";

const served = "public/fixtures/hours-4h.wav";
test.setTimeout(120_000);
test.beforeAll(() => {
  if (existsSync(served)) unlinkSync(served);
  symlinkSync(longStereoWav(), served);
});
test.afterAll(() => {
  if (existsSync(served)) unlinkSync(served);
});
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.mediaAPI);
});

test("four hours of real audio keeps its envelope and renders both lanes", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const started = performance.now();
    const data = await window.mediaAPI.getWaveformData(
      new URL("/fixtures/hours-4h.wav", location.href),
    );
    const decodedMs = performance.now() - started;
    const image = await window.mediaAPI.renderWaveform(data, {
      width: 320,
      height: 40,
      color: "#00ff00",
      backgroundColor: "#00000000",
    });
    const bitmap = await createImageBitmap(image.blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    const tailStarted = performance.now();
    const tail = await window.mediaAPI.getWaveformData(
      new URL("/fixtures/hours-4h.wav", location.href),
      { start: 14390, end: 14400 },
    );
    return {
      ms: decodedMs,
      tailMs: performance.now() - tailStarted,
      end: data.end,
      channels: data.channels.length,
      points: data.channels[0]!.min.length,
      bytes: data.channels.reduce(
        (total, channel) => total + channel.min.byteLength + channel.max.byteLength,
        0,
      ),
      left: [data.channels[0]!.min[0], data.channels[0]!.max[719999]],
      right: [data.channels[1]!.min[0], data.channels[1]!.max[719999]],
      tailPoints: tail.channels[0]!.min.length,
      tailPeak: tail.channels[0]!.max.at(-1),
      mime: image.mimeType,
      top: pixel(10, 0),
      lane: pixel(160, 10),
      other: pixel(160, 30),
    };
  });
  expect(result.end).toBe(14400);
  expect(result.channels).toBe(2);
  expect(result.points).toBe(720000);
  expect(result.bytes).toBe(11_520_000);
  expect(result.left[0]).toBeLessThan(-0.12);
  expect(result.left[1]).toBeGreaterThan(0.12);
  expect(result.right[0]).toBeLessThan(-0.12);
  expect(result.right[1]).toBeGreaterThan(0.12);
  expect(result.left[0]).not.toBe(result.right[0]);
  expect(result.tailPoints).toBe(500);
  expect(result.tailPeak).toBeGreaterThan(0.12);
  expect(result.ms).toBeLessThan(60_000);
  expect(result.tailMs).toBeLessThan(5_000);
  expect(result.mime).toBe("image/png");
  expect(result.top).toEqual([0, 0, 0, 0]);
  expect(result.lane).toEqual([0, 255, 0, 255]);
  expect(result.other).toEqual([0, 255, 0, 255]);
});

test("canceling a real long decode rejects without waiting for the whole file", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const result = await page.evaluate(async () => {
    const controller = new AbortController();
    const started = performance.now();
    const pending = window.mediaAPI.getWaveformData(
      new URL("/fixtures/hours-4h.wav", location.href),
      { signal: controller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort("stop");
    try {
      await pending;
      return { code: "resolved", abortedMs: performance.now() - started };
    } catch (error) {
      return {
        code: (error as { code?: string }).code ?? "throw",
        abortedMs: performance.now() - started,
      };
    }
  });
  expect(result.code).toBe("ABORTED");
  expect(result.abortedMs).toBeLessThan(5_000);
  expect(errors).toEqual([]);
});

test("a pre-aborted waveform reads no audio bytes", async ({ page }) => {
  const hits: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("hours-4h.wav")) hits.push(request.url());
  });
  const code = await page.evaluate(async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await window.mediaAPI.getWaveformData(new URL("/fixtures/hours-4h.wav", location.href), {
        signal: controller.signal,
      });
      return "resolved";
    } catch (error) {
      return (error as { code?: string }).code ?? "throw";
    }
  });
  expect(code).toBe("ABORTED");
  expect(hits).toEqual([]);
});
