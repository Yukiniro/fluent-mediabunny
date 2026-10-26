import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
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

type ProbeFrame = { key_frame?: number; best_effort_timestamp_time: string; pict_type?: string };

function probe(name: string, keyOnly: boolean): ProbeFrame[] {
  const report = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        ...(keyOnly ? ["-skip_frame", "nokey"] : []),
        "-show_frames",
        "-show_entries",
        "frame=key_frame,best_effort_timestamp_time,pict_type",
        "-of",
        "json",
        `public/fixtures/${name}`,
      ],
      { encoding: "utf8" },
    ),
  ) as { frames: ProbeFrame[] };
  return report.frames;
}

const micros = (time: number) => Math.round(time * 1_000_000);
const channel = (time: number) => Math.min(2, Math.floor(time + 0.00001));

function nearest(time: number, keys: number[]) {
  return keys.reduce((best, raw) => {
    const distance = Math.abs(micros(raw) - micros(time));
    const bestDistance = Math.abs(micros(best) - micros(time));
    if (distance < bestDistance || (distance === bestDistance && raw < best)) return raw;
    return best;
  });
}

test("encoded keyframes agree with ffprobe and with thumbnail at the key time", async ({
  page,
}) => {
  for (const name of ["markers.mp4", "markers-vfr.mp4"]) {
    const keys = probe(name, true)
      .filter((frame) => frame.key_frame === 1)
      .map((frame) => Number(frame.best_effort_timestamp_time));
    const frames = probe(name, false).map((frame) => Number(frame.best_effort_timestamp_time));
    expect(keys.length).toBeGreaterThan(0);
    const differing = frames.find((time) => {
      const keyTime = nearest(time, keys);
      return micros(time) !== micros(keyTime) && channel(time) !== channel(keyTime);
    });
    expect(differing, `${name} needs a non-key frame in a different color second`).toBeDefined();
    const output = await page.evaluate(
      async ({ name, differing }) => {
        const source = new URL(`/fixtures/${name}`, location.href);
        const pixelOf = async (blob: Blob) => {
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("missing 2d context");
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          return Array.from(context.getImageData(15, 7, 1, 1).data);
        };
        const count = await window.mediaAPI.getKeyFrameCount(source);
        const images = [];
        for await (const image of window.mediaAPI.getKeyFrameImages(source, {
          width: 31,
          type: "image/png",
        })) {
          images.push({
            timestamp: image.sourceTimestamp,
            actual: image.actualTime,
            origin: image.timeOriginSeconds,
            mime: image.blob.type,
            size: [image.width, image.height],
            pixel: await pixelOf(image.blob),
          });
        }
        const thumbnails = [];
        for (const image of images) {
          const thumb = await window.mediaAPI.thumbnail(source, {
            time: image.actual,
            width: 31,
            type: "image/png",
          });
          if (!thumb) throw new Error(`thumbnail missing at ${image.actual}`);
          thumbnails.push(await pixelOf(thumb.blob));
        }
        const query = differing!;
        const closest = await window.mediaAPI.getClosestKeyFrameImage(source, {
          time: query,
          width: 31,
          type: "image/png",
        });
        if (!closest) throw new Error("missing closest keyframe");
        const atQuery = await window.mediaAPI.thumbnail(source, {
          time: query,
          width: 31,
          type: "image/png",
        });
        const atKey = await window.mediaAPI.thumbnail(source, {
          time: closest.actualTime,
          width: 31,
          type: "image/png",
        });
        if (!atQuery || !atKey) throw new Error("missing comparison thumbnail");
        return {
          count,
          images,
          thumbnails,
          closest: {
            timestamp: closest.sourceTimestamp,
            pixel: await pixelOf(closest.blob),
          },
          queryPixel: await pixelOf(atQuery.blob),
          keyPixel: await pixelOf(atKey.blob),
        };
      },
      { name, differing },
    );
    expect(output.count).toBe(keys.length);
    expect(output.images).toHaveLength(keys.length);
    output.images.forEach((image, index) => {
      expect(image.timestamp).toBeCloseTo(keys[index]!, 5);
      expect(image.size).toEqual([31, 16]);
      expect(image.mime).toBe("image/png");
      expect(image.pixel).toEqual(output.thumbnails[index]);
    });
    const keyTime = nearest(differing!, keys);
    expect(output.closest.timestamp).toBeCloseTo(keyTime, 5);
    expect(output.closest.pixel).toEqual(output.keyPixel);
    expect(output.closest.pixel).not.toEqual(output.queryPixel);
  }
});
