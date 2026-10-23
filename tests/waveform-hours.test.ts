import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { getWaveformData } from "../src/index.ts";
import { longStereoWav } from "./long-wav.ts";

test("four hours of real stereo PCM stays bounded in time and memory", async () => {
  const bytes = new Uint8Array(readFileSync(longStereoWav()));
  const before = process.memoryUsage();
  const started = performance.now();
  const result = await getWaveformData(bytes);
  const elapsed = performance.now() - started;
  const after = process.memoryUsage();
  expect(result.end).toBe(14400);
  expect(result.channels).toHaveLength(2);
  expect(result.channels[0]!.min.length).toBe(720000);
  expect(
    result.channels.reduce(
      (total, channel) => total + channel.min.byteLength + channel.max.byteLength,
      0,
    ),
  ).toBe(11_520_000);
  for (const index of [0, 360_000, 719_999]) {
    expect(result.channels[0]!.min[index]).toBeLessThan(-0.12);
    expect(result.channels[0]!.max[index]).toBeGreaterThan(0.12);
    expect(result.channels[1]!.min[index]).toBeLessThan(-0.12);
    expect(result.channels[1]!.max[index]).toBeGreaterThan(0.12);
  }
  expect(result.channels[0]!.min[0]).not.toBe(result.channels[1]!.min[0]);
  expect(elapsed).toBeLessThan(45_000);
  const retained = after.heapUsed + after.external - before.heapUsed - before.external;
  expect(retained).toBeLessThan(14400 * 8000 * 2 * 4 * 0.75);

  const tailStarted = performance.now();
  const tail = await getWaveformData(bytes, { start: 14390, end: 14400 });
  expect(performance.now() - tailStarted).toBeLessThan(5_000);
  expect(tail.channels[0]!.min.length).toBe(500);
  expect(tail.channels[0]!.max.at(-1)).toBeGreaterThan(0.12);
  expect(tail.channels[1]!.min.at(-1)).toBeLessThan(-0.12);
}, 90_000);
