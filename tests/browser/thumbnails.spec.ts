import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.mediaAPI);
});

test("JPEG/PNG, VFR and B-frame timestamps agree with independent ffprobe oracle", async ({
  page,
}) => {
  for (const name of ["markers.mp4", "markers-vfr.mp4"]) {
    const oracle = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_frames",
          "-show_entries",
          "frame=best_effort_timestamp_time,duration_time,pkt_duration_time,pict_type",
          "-of",
          "json",
          `public/fixtures/${name}`,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(oracle.frames.some((f: { pict_type: string }) => f.pict_type === "B")).toBe(true);
    const times = oracle.frames.map((f: { best_effort_timestamp_time: string }) =>
      Number(f.best_effort_timestamp_time),
    );
    const output = await page.evaluate(
      async ({ name, times }) => {
        const results = [];
        for (const type of ["image/jpeg", "image/png"] as const) {
          const batch = window.mediaAPI.thumbnails(new URL(`/fixtures/${name}`, location.href), {
            times,
            type,
            width: 31,
          });
          for await (const { image, index } of batch) {
            if (!image) throw new Error(`Missing frame ${index}`);
            const bitmap = await createImageBitmap(image.blob);
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            results.push({
              index,
              type,
              timestamp: image.sourceTimestamp,
              requested: image.requestedTime,
              size: [image.width, image.height],
              mime: image.blob.type,
              pixel: Array.from(ctx.getImageData(15, 7, 1, 1).data),
            });
          }
        }
        return results;
      },
      { name, times },
    );
    for (const result of output) {
      expect(result.timestamp).toBeCloseTo(times[result.index], 5);
      expect(result.size).toEqual([31, 16]);
      expect(result.mime).toBe(result.type);
      const channel = Math.min(2, Math.floor(result.requested + 0.00001));
      expect(result.pixel[channel], JSON.stringify(result)).toBeGreaterThan(200);
      expect(
        result.pixel.filter((_, i) => i < 3 && i !== channel).every((v) => v < 60),
        JSON.stringify(result),
      ).toBe(true);
    }
  }
});

test("batch slots, primary/explicit tracks, intervals, lazy snapshots and retained Blobs", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { thumbnail, thumbnails, probe } = window.mediaAPI;
    const source = new URL("/fixtures/markers.mp4", location.href);
    const opts = { times: [0, 0, 1, 3, 9], width: 21 };
    const iterator = thumbnails(source, opts);
    opts.times[1] = 99;
    opts.width = 200;
    const slots = [];
    const blobs = [];
    for await (const item of iterator) {
      slots.push([item.index, item.requestedTime, item.image?.width ?? null]);
      if (item.image) blobs.push(item.image.blob);
    }
    const first = Array.from(new Uint8Array(await blobs[0]!.arrayBuffer()));
    const single = await thumbnail(source, { time: 0, width: 21 });
    const interval = [];
    for await (const item of thumbnails(source, { start: 2, end: 10, count: 4 }))
      interval.push(item.requestedTime);
    const one = [];
    for await (const item of thumbnails(source, { start: 2, end: 10, count: 1 }))
      one.push(item.requestedTime);
    const multi = new URL("/fixtures/two-video.mp4", location.href);
    const tracks = (await probe(multi)).tracks;
    const primary = await thumbnail(multi, { time: 0 });
    const selected = [];
    for (const track of tracks.filter((t) => t.type === "video"))
      selected.push(await thumbnail(multi, { time: 0, track: track.id }));
    const errors = [];
    for (const [input, options] of [
      [multi, { time: 0, track: tracks.find((t) => t.type === "audio")!.id }],
      [new URL("/fixtures/audio.wav", location.href), { time: 0 }],
    ] as const) {
      try {
        await thumbnail(input, options);
      } catch (e) {
        errors.push((e as { code: string }).code);
      }
    }
    return {
      slots,
      stable:
        JSON.stringify(first) ===
        JSON.stringify(Array.from(new Uint8Array(await single!.blob.arrayBuffer()))),
      interval,
      one,
      primaryId: primary!.trackId,
      selected: selected.map((v) => [v!.trackId, v!.width, v!.height]),
      errors,
    };
  });
  expect(result.slots).toEqual([
    [0, 0, 21],
    [1, 0, 21],
    [2, 1, 21],
    [3, 3, null],
    [4, 9, null],
  ]);
  expect(result.stable).toBe(true);
  expect(result.interval).toEqual([2, 4, 6, 8]);
  expect(result.one).toEqual([2]);
  expect(result.selected.map((v) => v.slice(1))).toEqual([
    [80, 40],
    [40, 80],
  ]);
  expect(result.selected.map((v) => v[0])).toContain(result.primaryId);
  expect(result.errors).toEqual(["INVALID_OPTIONS", "NO_TRACKS"]);
});

test("sample geometry, rotation/flip/SAR, fit modes and alpha padding", async ({ page }, info) => {
  const result = await page.evaluate(async () => {
    const { thumbnail } = window.mediaAPI;
    const outputs = [];
    for (const name of ["geometry.mp4", "geometry-oriented.mp4"]) {
      for (const fit of [undefined, "contain", "cover", "fill"] as const) {
        for (const type of ["image/png", "image/jpeg"] as const) {
          const image = await thumbnail(new URL(`/fixtures/${name}`, location.href), {
            time: 0,
            type,
            ...(fit ? { width: 41, height: 41, fit } : {}),
          });
          const bitmap = await createImageBitmap(image!.blob);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
          outputs.push({
            name,
            fit,
            type,
            size: [image!.width, image!.height],
            corner: pixel(0, 0),
            left: pixel(Math.floor(canvas.width / 4), Math.floor(canvas.height / 4)),
            bottomLeft: pixel(Math.floor(canvas.width / 4), Math.floor((canvas.height * 3) / 4)),
            top: pixel(Math.floor(canvas.width / 2), Math.floor(canvas.height / 4)),
          });
        }
      }
    }
    return outputs;
  });
  for (const item of result) {
    expect(item.size).toEqual(
      item.fit ? [41, 41] : item.name === "geometry.mp4" ? [160, 40] : [40, 160],
    );
    if (item.fit === "contain") {
      if (item.type === "image/png") expect(item.corner[3]).toBe(0);
      else {
        expect(item.corner[3]).toBe(255);
        expect(Math.max(...item.corner.slice(0, 3))).toBeLessThan(20);
      }
    }
    if (!item.fit && item.name === "geometry.mp4") expect(item.left[0]).toBeGreaterThan(230);
    if (!item.fit && item.name === "geometry-oriented.mp4") {
      expect(item.top[2], JSON.stringify(item)).toBeGreaterThan(230);
      expect(item.bottomLeft[1], JSON.stringify(item)).toBeGreaterThan(200);
    }
  }
  await info.attach("geometry", { body: JSON.stringify(result), contentType: "application/json" });
});

test("real cancellation, early exit, URL failure, repeated extraction and built package", async ({
  page,
}, info) => {
  const result = await page.evaluate(async () => {
    const path = "/dist/index.mjs";
    const { thumbnail, thumbnails } = (await import(
      /* @vite-ignore */ path
    )) as typeof window.mediaAPI;
    const source = new URL("/fixtures/av.mp4", location.href);
    const controller = new AbortController();
    const batch = thumbnails(source, { times: [0, 1], signal: controller.signal });
    const first = (await batch.next()).value!;
    const before = await first.image!.blob.arrayBuffer();
    controller.abort();
    let aborted = "";
    try {
      await batch.next();
    } catch (e) {
      aborted = (e as { code: string }).code;
    }
    const after = await first.image!.blob.arrayBuffer();
    const widths = [];
    const started = performance.now();
    for (let i = 0; i < 20; i++) {
      for await (const item of thumbnails(source, { times: [0, 1], width: 33 })) {
        widths.push(item.image!.width);
        break;
      }
    }
    const errors = [];
    for (const url of ["/missing.mp4", "/fixtures/corrupt.mp4"]) {
      try {
        await thumbnail(new URL(url, location.href), { time: 0 });
      } catch (e) {
        errors.push((e as { code: string }).code);
      }
    }
    return {
      aborted,
      stable: new Uint8Array(before).every((v, i) => v === new Uint8Array(after)[i]),
      widths,
      elapsedMs: performance.now() - started,
      errors,
    };
  });
  expect(result.aborted).toBe("ABORTED");
  expect(result.stable).toBe(true);
  expect(result.widths).toEqual(Array(20).fill(33));
  expect(result.errors.every((e) => ["READ_FAILED", "UNSUPPORTED_INPUT"].includes(e))).toBe(true);
  await info.attach("repeated-extraction", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
});

test("decoded VP9 transparency is preserved when supported", async ({ page }, info) => {
  const result = await page.evaluate(async () => {
    try {
      const pixels = [];
      for (const type of ["image/png", "image/jpeg"] as const) {
        const image = await window.mediaAPI.thumbnail(
          new URL("/fixtures/alpha.webm", location.href),
          { time: 0, type },
        );
        const bitmap = await createImageBitmap(image!.blob);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        pixels.push(Array.from(ctx.getImageData(10, 10, 1, 1).data));
      }
      return { pixels };
    } catch (e) {
      return { code: (e as { code: string }).code, cause: String((e as Error).cause) };
    }
  });
  await info.attach("decoded-alpha-support", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
  if (result.code) {
    expect(["CODEC_UNAVAILABLE", "PROCESSING_FAILED"]).toContain(result.code);
    if (result.code === "PROCESSING_FAILED") expect(result.cause).toContain("EncodingError");
    test.skip(true, `VP9 alpha decoder unavailable: ${result.cause}`);
  }
  const [png, jpeg] = result.pixels!;
  test.skip(png![3] === 255, "Browser decoder discards VP9 alpha");
  expect(png![3]).toBeGreaterThan(120);
  expect(png![3]).toBeLessThan(135);
  expect(jpeg![3]).toBe(255);
  expect(jpeg![0]).toBeGreaterThan(110);
  expect(jpeg![0]).toBeLessThan(150);
});

test("delayed video and video ending before audio retain missing positions", async ({ page }) => {
  const entries = await page.evaluate(async () => {
    const result = [];
    for await (const item of window.mediaAPI.thumbnails(
      new URL("/fixtures/delayed-video.mp4", location.href),
      { times: [0, 0.999, 1, 2, 3.999, 4, 4.5] },
    )) {
      result.push({
        time: item.requestedTime,
        actual: item.image?.actualTime ?? null,
        origin: item.image?.timeOriginSeconds ?? null,
      });
    }
    return result;
  });
  expect(entries.map((v) => v.actual !== null)).toEqual([
    false,
    false,
    true,
    true,
    true,
    false,
    false,
  ]);
  expect(entries[2]).toEqual({ time: 1, actual: 1, origin: 0 });
});

test("URL reads can be canceled without late delivery or unhandled rejection", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let requested!: () => void;
  const requestSeen = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let release!: () => void;
  const responseReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/slow-video.mp4", async (route) => {
    requested();
    await responseReady;
    await route.fulfill({
      status: 200,
      path: "public/fixtures/markers.mp4",
      contentType: "video/mp4",
    });
  });
  const result = page.evaluate(async () => {
    const controller = new AbortController();
    Object.assign(window, { cancelThumbnailRead: () => controller.abort() });
    try {
      await window.mediaAPI.thumbnail(new URL("/slow-video.mp4", location.href), {
        time: 0,
        signal: controller.signal,
      });
      return "delivered";
    } catch (error) {
      return (error as { code: string }).code;
    }
  });
  await requestSeen;
  await page.evaluate(() =>
    (window as unknown as { cancelThumbnailRead: () => void }).cancelThumbnailRead(),
  );
  release();
  expect(await result).toBe("ABORTED");
  expect(errors).toEqual([]);
});
