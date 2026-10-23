import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { getWaveformData } from "../src/index.ts";

const wav = new Uint8Array(readFileSync(new URL("../public/fixtures/audio.wav", import.meta.url)));

test("decodes a real wav into one raw envelope", async () => {
  const data = await getWaveformData(wav, { pointsPerSecond: 50 });
  expect(data).toMatchObject({
    channels: 1,
    sampleRate: 44100,
    pointsPerSecond: 50,
    startSeconds: 0,
    timeOriginSeconds: 0,
  });
  expect(data.endSeconds).toBeCloseTo(2, 2);
  expect(data.min).toHaveLength(1);
  expect(data.min[0]).toHaveLength(100);
  expect(data.max[0]).toHaveLength(100);
  const peak = Math.max(...data.max[0]!);
  const trough = Math.min(...data.min[0]!);
  expect(peak).toBeGreaterThan(0.05);
  expect(peak).toBeLessThan(1);
  expect(trough).toBeLessThan(-0.05);
  expect(trough).toBeGreaterThan(-1);
  const slice = await getWaveformData(wav, { start: 0, end: 0.02, pointsPerSecond: 50 });
  expect(slice.min[0]).toHaveLength(1);
  expect(slice.max[0]![0]).toBeGreaterThan(0);
  expect(slice.min[0]![0]).toBeLessThan(0);
});
