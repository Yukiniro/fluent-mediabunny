import { expect, test } from "@playwright/test";
import type * as API from "../../src/index.ts";

declare global {
  interface Window {
    mediaAPI: typeof API;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.mediaAPI);
});

test("browser probe, decoded peaks, and one PNG stay on the public contract", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const load = async (name: string) => (await fetch(`/fixtures/${name}`)).blob();
    const av = await window.mediaAPI.probe(await load("av.mp4"));
    const estimated = await window.mediaAPI.probe(await load("av.mp4"), { frameRate: "estimate" });
    const offset = await window.mediaAPI.probe(await load("offset.mp4"));
    const video = av.tracks.find((track) => track.type === "video");
    const audio = av.tracks.find((track) => track.type === "audio");
    const estimatedVideo = estimated.tracks.find((track) => track.type === "video");
    const offsetVideo = offset.tracks.find((track) => track.type === "video");
    const data = await window.mediaAPI.getWaveformData(await load("audio.wav"));
    const before = data.max[0]![0];
    const image = await window.mediaAPI.renderWaveform(data, {
      width: 320,
      height: 80,
      color: "#000",
    });
    const bytes = new Uint8Array(await image.blob.arrayBuffer());
    const bitmap = await createImageBitmap(image.blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let opaque = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 0) opaque += 1;
    let peak = 0;
    let trough = 0;
    for (const value of data.max[0]!) peak = Math.max(peak, value);
    for (const value of data.min[0]!) trough = Math.min(trough, value);
    return {
      durationSeconds: av.durationSeconds,
      video,
      audioStart: audio && audio.type === "audio" ? audio.startSeconds : null,
      audioBitrate: audio && audio.type === "audio" ? audio.averageBitrate : null,
      audioLanguage: audio && audio.type === "audio" ? audio.language : "missing",
      estimated:
        estimatedVideo && estimatedVideo.type === "video" ? estimatedVideo.frameRate : null,
      offsetStart: offsetVideo && offsetVideo.type === "video" ? offsetVideo.startSeconds : null,
      buckets: data.min[0]!.length,
      channels: data.channels,
      origin: data.timeOriginSeconds,
      end: data.endSeconds,
      peak,
      trough,
      unchanged: data.max[0]![0] === before,
      png: Array.from(bytes.slice(0, 8)),
      width: image.width,
      height: image.height,
      covered: image.endSeconds - image.startSeconds,
      opaque,
    };
  });

  expect(result.durationSeconds).toBe(2);
  expect(result.video).toMatchObject({
    codedWidth: 160,
    codedHeight: 120,
    rotation: 0,
    frameRate: { hertz: null, origin: "unknown" },
    averageBitrate: null,
    peakBitrate: 97432,
    elapsedSeconds: 2,
  });
  expect(result.audioLanguage).toBeNull();
  expect(result.audioBitrate).toBe(69663);
  expect(result.audioStart).toBeLessThan(0);
  expect(result.estimated).toEqual({ hertz: 15, origin: "estimated" });
  expect(result.offsetStart).toBe(5);
  expect(result.buckets).toBe(100);
  expect(result.channels).toBe(1);
  expect(result.origin).toBe(0);
  expect(result.end).toBeCloseTo(2, 5);
  expect(result.peak).toBeGreaterThan(0.05);
  expect(result.peak).toBeLessThan(1);
  expect(result.trough).toBeLessThan(-0.05);
  expect(result.trough).toBeGreaterThan(-1);
  expect(result.unchanged).toBe(true);
  expect(result.png).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(result.width).toBe(320);
  expect(result.height).toBe(80);
  expect(result.covered).toBeCloseTo(2, 5);
  expect(result.opaque).toBeGreaterThan(0);
});
