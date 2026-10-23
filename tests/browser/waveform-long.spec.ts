import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const hours = 4;
const duration = hours * 3600;
const flac = join(tmpdir(), "fmb-wave-4h.flac");
const aac = join(tmpdir(), "fmb-wave-4h.m4a");
const source = `aevalsrc=0.5\\|-0.25:s=96000:d=${duration}`;

function complete(path: string) {
  if (!existsSync(path) || statSync(path).size < 4096) return false;
  try {
    const probe = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
      { encoding: "utf8" },
    );
    return Number(probe.trim()) >= duration - 1;
  } catch {
    return false;
  }
}
function ensure(path: string, args: string[]) {
  if (complete(path)) return;
  execFileSync(
    "ffmpeg",
    ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", source, ...args, path],
    { timeout: 900_000 },
  );
}

test.beforeAll(() => {
  test.setTimeout(900_000);
  // WebKit's FLAC decoder fails with EncodingError after canDecode() succeeds. AAC at 96 kHz
  // decodes in all three browsers; FLAC is the lossless oracle for Chrome and Firefox.
  ensure(flac, ["-sample_fmt", "s16", "-c:a", "flac", "-compression_level", "5"]);
  ensure(aac, ["-c:a", "aac", "-b:a", "48k"]);
});

test.beforeEach(async ({ page }) => {
  await page.route("**/fixtures/long.flac", (route) => route.fulfill({ path: flac }));
  await page.route("**/fixtures/long.m4a", (route) => route.fulfill({ path: aac }));
  await page.goto("/");
  await page.waitForFunction(() => !!window.mediaAPI);
});

test("four hours of real 96 kHz stereo audio stays aligned and bounded", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const lossless = testInfo.project.name !== "webkit";
  const result = await page.evaluate(async (lossless) => {
    const name = lossless ? "long.flac" : "long.m4a";
    const blob = await (await fetch(`/fixtures/${name}`)).blob();
    const memory = performance as Performance & { memory?: { usedJSHeapSize: number } };
    const before = memory.memory?.usedJSHeapSize ?? null;
    const started = performance.now();
    const data = await window.mediaAPI.getWaveformData(blob);
    const elapsed = performance.now() - started;
    const after = memory.memory?.usedJSHeapSize ?? null;
    const from = Math.floor(data.channels[0]!.min.length * 0.1);
    const to = Math.ceil(data.channels[0]!.min.length * 0.9);
    const bounds = (channel: { min: Float32Array; max: Float32Array }) => {
      let min = Infinity;
      let max = -Infinity;
      for (let i = from; i < to; i++) {
        min = Math.min(min, channel.min[i]!);
        max = Math.max(max, channel.max[i]!);
      }
      return { min, max };
    };
    return {
      elapsed,
      heap: before === null || after === null ? null : after - before,
      end: data.end,
      channels: data.channels.length,
      length: data.channels[0]!.min.length,
      bytes: data.channels.reduce(
        (total, channel) => total + channel.min.byteLength + channel.max.byteLength,
        0,
      ),
      left: bounds(data.channels[0]!),
      right: bounds(data.channels[1]!),
    };
  }, lossless);
  expect(result.channels).toBe(2);
  expect(Math.abs(result.end - duration)).toBeLessThan(0.05);
  expect(result.length).toBeGreaterThanOrEqual(duration * 50 - 1);
  expect(result.length).toBeLessThanOrEqual(duration * 50 + 3);
  expect(result.bytes).toBe(result.channels * 2 * result.length * 4);
  if (lossless) {
    expect(result.left).toEqual({ min: 0.5, max: 0.5 });
    expect(result.right).toEqual({ min: -0.25, max: -0.25 });
  } else {
    expect(result.left.min).toBeGreaterThan(0.2);
    expect(result.left.max).toBeLessThan(0.8);
    expect(result.right.min).toBeGreaterThan(-0.45);
    expect(result.right.max).toBeLessThan(-0.05);
  }
  if (result.heap !== null) expect(result.heap).toBeLessThan(512 * 1024 * 1024);
  console.log(
    `${testInfo.project.name} ${Math.round(result.elapsed)}ms end=${result.end} bins=${result.length} heap=${result.heap}`,
  );
  // Linux validation host, bin-run aggregation: Chrome FLAC 23s, Firefox FLAC 132s, WebKit AAC 55s.
  expect(result.elapsed, `${testInfo.project.name} ${Math.round(result.elapsed)}ms`).toBeLessThan(
    lossless ? 240_000 : 300_000,
  );
});
