import { test, expect } from "@playwright/test";
import type * as API from "../../src/index.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
declare global {
  interface Window {
    mediaAPI: typeof API;
  }
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.mediaAPI);
});
test("real copy, track selection, immutable branches and metadata round trips", async ({
  page,
}, testInfo) => {
  const results = await page.evaluate(async () => {
    const { media, probe } = window.mediaAPI;
    const load = async (name: string) =>
      new Blob([await (await fetch(`/fixtures/${name}`)).arrayBuffer()]);
    const tags = {
      title: "\u6807\u9898🎬",
      artist: "\u827a\u672f\u5bb6",
      album: "\u4e13\u8f91",
      albumArtist: "\u6f14\u594f\u8005",
      genre: "\u6d4b\u8bd5",
      comment: "\u6ce8\u91ca🙂",
      description: "\u63cf\u8ff0",
      date: "2024-02-29",
    };
    const outputs = [];
    for (const [input, format] of [
      ["av.mp4", "mp4"],
      ["av.webm", "webm"],
      ["av.mp4", "m4a"],
      ["audio.wav", "wav"],
    ] as const) {
      let task = media(await load(input))
        .format(format)
        .mode("copy");
      if (format === "m4a") task = task.tracks({ video: false, audio: "primary" });
      const result = await task.metadata(tags, { mode: "replace" }).run();
      const read = await probe(result.blob, { duration: "scan" });
      const deleted = await media(result.blob)
        .format(format)
        .mode("copy")
        .metadata({ title: null })
        .run();
      const reread = await probe(deleted.blob);
      outputs.push({
        format,
        tags: read.metadata,
        deleted: reread.metadata,
        tracks: read.tracks,
        size: result.size,
        bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
      });
    }
    const base = media(await load("audio.wav")).format("wav");
    const branch = base.metadata({ title: "branch" });
    const a = await base.run(),
      b = await branch.run();
    const multi = await load("multi.mp4");
    let multiCode = "";
    try {
      await media(multi).format("wav").tracks({ video: false }).run();
    } catch (e) {
      multiCode = (e as API.MediaError).code;
    }
    const primary = await media(multi)
      .format("m4a")
      .tracks({ video: false, audio: "primary" })
      .run();
    return {
      outputs,
      base: (await probe(a.blob)).metadata,
      branch: (await probe(b.blob)).metadata,
      multiCode,
      primary: (await probe(primary.blob)).tracks,
    };
  });
  for (const output of results.outputs) {
    expect(output.tags).toEqual({
      title: "\u6807\u9898🎬",
      artist: "\u827a\u672f\u5bb6",
      album: "\u4e13\u8f91",
      albumArtist: "\u6f14\u594f\u8005",
      genre: "\u6d4b\u8bd5",
      comment: "\u6ce8\u91ca🙂",
      description: "\u63cf\u8ff0",
      date: "2024-02-29",
    });
    expect(output.deleted.title).toBeUndefined();
    expect(output.size).toBe(output.bytes.length);
    const path = testInfo.outputPath(`output.${output.format}`);
    mkdirSync(testInfo.outputDir, { recursive: true });
    writeFileSync(path, Buffer.from(output.bytes));
    const independent = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        { encoding: "utf8" },
      ),
    );
    expect(independent.streams.length).toBe(output.tracks.length);
    expect(
      independent.format.tags.title ??
        independent.format.tags.TITLE ??
        independent.format.tags["MOVIE/TITLE"],
    ).toBe("\u6807\u9898🎬");
  }
  expect(results.base.title).toBeUndefined();
  expect(results.branch.title).toBe("branch");
  expect(results.multiCode).toBe("TRACK_LOSS");
  expect(results.primary).toHaveLength(1);
});
test("real transcode and transforms, with explicit capability outcomes", async ({
  page,
}, testInfo) => {
  const results = await page.evaluate(async () => {
    const { media, probe } = window.mediaAPI;
    const results = [];
    for (const name of [
      "av.mp4",
      "rotated.mp4",
      "offset.mp4",
      "vfr.mp4",
      "hevc.mp4",
      "odd.webm",
      "audio.mp3",
      "rate.wav",
    ]) {
      const blob = await (await fetch(`/fixtures/${name}`)).blob();
      try {
        let task = media(blob);
        if (name.endsWith(".mp3") || name === "rate.wav")
          task = task.format("wav").mode("transcode");
        else task = task.format("webm").trim({ start: 0.2, end: 0.8 }).resize({ width: 80 });
        const result = await task.run();
        results.push({
          name,
          status: "ok",
          info: await probe(result.blob, { duration: "scan" }),
          report: result.report,
          bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
        });
      } catch (e) {
        results.push({
          name,
          status: "unavailable",
          code: (e as API.MediaError).code,
          message: String(e),
        });
      }
    }
    return results;
  });
  await testInfo.attach("capabilities", {
    body: JSON.stringify(
      results.map((result) => ({ ...result, bytes: undefined })),
      null,
      2,
    ),
    contentType: "application/json",
  });
  for (const r of results) {
    if (r.status === "unavailable") {
      expect(r.code).toBe("CODEC_UNAVAILABLE");
      continue;
    }
    expect(r.info!.tracks.length).toBeGreaterThan(0);
    if (!r.name.endsWith(".mp3") && r.name !== "rate.wav") {
      expect(r.info!.tracks[0]!.width).toBe(80);
      expect(r.info!.durationSeconds).toBeLessThan(0.8);
      expect(r.info!.durationSeconds).toBeGreaterThan(0.45);
      if (r.name === "rotated.mp4") expect(r.info!.tracks[0]!.height).toBe(108);
    }
    const path = testInfo.outputPath(`${r.name}.out`);
    mkdirSync(testInfo.outputDir, { recursive: true });
    writeFileSync(path, Buffer.from(r.bytes!));
    execFileSync("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"]);
    const decoded = JSON.parse(
      execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", path], {
        encoding: "utf8",
      }),
    );
    if (decoded.streams.length === 2) {
      const starts = decoded.streams.map((t: { start_time: string }) => Number(t.start_time));
      expect(Math.abs(starts[0] - starts[1])).toBeLessThan(0.08);
    }
  }
  if (testInfo.project.name === "chrome")
    expect(results.filter((r) => r.status === "ok").length).toBeGreaterThanOrEqual(6);
});
test("strict errors, pre-abort, no codec fallback and observer isolation", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { media, probe } = window.mediaAPI,
      blob = await (await fetch("/fixtures/av.mp4")).blob();
    const codes = [];
    for (const task of [
      media(blob).format("m4a"),
      media(blob).format("webm").video({ codec: "avc" }),
      media(blob).format("mp4").tracks({ video: false, audio: false }),
      media(blob)
        .format("mp4")
        .tracks({ audio: [999] }),
      media(blob).format("mp4").trim({ start: 99 }),
      media(blob).format("mp4").crop({ x: 1000, y: 0, width: 2, height: 2 }),
    ])
      try {
        await task.run();
        codes.push("success");
      } catch (e) {
        codes.push((e as API.MediaError).code);
      }
    const abort = new AbortController();
    abort.abort();
    for (const operation of [
      () => media("http://127.0.0.1:1/private").format("mp4").run({ signal: abort.signal }),
      () => probe("http://127.0.0.1:1/private", { signal: abort.signal }),
    ])
      try {
        await operation();
      } catch (e) {
        codes.push((e as API.MediaError).code);
      }
    const result = await media(blob)
      .format("mp4")
      .mode("copy")
      .run({
        onProgress: () => {
          throw Error("observer");
        },
      });
    return { codes, warnings: result.report.warnings };
  });
  expect(result.codes).toEqual([
    "TRACK_LOSS",
    "UNSUPPORTED_OUTPUT_COMBINATION",
    "NO_TRACKS",
    "INVALID_OPTIONS",
    "INVALID_OPTIONS",
    "INVALID_OPTIONS",
    "ABORTED",
    "ABORTED",
  ]);
  expect(result.warnings.some((w) => w.code === "CALLBACK_FAILED")).toBe(true);
});
test("OPFS transactional write, readback, overwrite and cancellation", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chrome",
    "File permission queries verified on Chromium OPFS; other engines may lack this API.",
  );
  const result = await page.evaluate(async () => {
    const { media, probe } = window.mediaAPI;
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("output.mp4", { create: true });
    const stream = await handle.createWritable();
    await stream.write(new Uint8Array(2000000));
    await stream.close();
    const source = await (await fetch("/fixtures/av.mp4")).blob();
    const output = await media(source)
      .format("mp4")
      .mode("copy")
      .run({ target: { type: "file", handle } });
    const file = await handle.getFile();
    const info = await probe(file);
    const before = Array.from(new Uint8Array(await file.arrayBuffer()));
    const abort = new AbortController();
    let code = "";
    try {
      await media(source)
        .format("mp4")
        .run({
          target: { type: "file", handle },
          signal: abort.signal,
          onProgress: (e) => {
            if (e.phase === "processing") abort.abort();
          },
        });
    } catch (e) {
      code = (e as API.MediaError).code;
    }
    const after = Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
    await root.removeEntry("output.mp4");
    return { output, size: file.size, tracks: info.tracks, before, after, code };
  });
  expect(result.output.commitState).toBe("committed");
  expect(result.size).toBeLessThan(2000000);
  expect(result.output.size).toBe(result.size);
  expect(result.tracks).toHaveLength(2);
  expect(result.code).toBe("ABORTED");
  expect(result.after).toEqual(result.before);
});

test("HEVC defaults resolve AVC while copy preserves HEVC without encoders", async ({
  page,
}, testInfo) => {
  const result = await page.evaluate(async () => {
    const { media, probe } = window.mediaAPI;
    const blob = await (await fetch("/fixtures/hevc.mp4")).blob();
    const copy = await media(blob).format("mp4").mode("copy").run();
    let auto;
    try {
      const r = await media(blob).format("mp4").run();
      auto = {
        code: "ok",
        codec: (await probe(r.blob)).tracks[0]?.codec,
        resolved: r.report.resolved.tracks[0]?.codec,
      };
    } catch (e) {
      auto = { code: (e as API.MediaError).code };
    }
    return { copy: (await probe(copy.blob)).tracks[0]?.codec, auto };
  });
  expect(result.copy).toBe("hevc");
  if (result.auto.code === "ok") {
    expect(result.auto.codec).toBe("avc");
    expect(result.auto.resolved).toBe("avc");
  } else expect(result.auto.code).toBe("CODEC_UNAVAILABLE");
  await testInfo.attach("hevc-default", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
});

test("URL reads are anonymous; broken network has no retry and abort settles", async ({ page }) => {
  let requests = 0;
  await page.route("**/broken.mp4", (route) => {
    requests++;
    return route.abort("failed");
  });
  const broken = await page.evaluate(async () => {
    try {
      await window.mediaAPI.media(new URL("/broken.mp4", location.href)).format("mp4").run();
      return "success";
    } catch (e) {
      return (e as API.MediaError).code;
    }
  });
  expect(broken).toBe("READ_FAILED");
  expect(requests).toBe(1);
  const result = await page.evaluate(async () => {
    const { media } = window.mediaAPI;
    const original = window.fetch;
    const seen: string[] = [];
    window.fetch = async (input, init) => {
      if ((input instanceof Request ? input.url : input.toString()).includes("/fixtures/av.mp4"))
        seen.push(`${init?.credentials}:${init?.mode}`);
      return original(input, init);
    };
    try {
      const r = await media(new URL("/fixtures/av.mp4", location.href))
        .format("mp4")
        .mode("copy")
        .run();
      return { size: r.size, seen };
    } finally {
      window.fetch = original;
    }
  });
  expect(result.size).toBeGreaterThan(0);
  expect(result.seen.length).toBeGreaterThan(0);
  expect(result.seen.every((v) => v === "omit:cors")).toBe(true);
  const unhandled: string[] = [];
  page.on("pageerror", (e) => unhandled.push(String(e)));
  await page.route("**/slow.mp4", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.abort("failed").catch(() => {});
  });
  const canceled = await page.evaluate(async () => {
    const controller = new AbortController();
    const p = window.mediaAPI
      .media(new URL("/slow.mp4", location.href))
      .format("mp4")
      .run({ signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    try {
      await p;
      return "success";
    } catch (e) {
      return (e as API.MediaError).code;
    }
  });
  expect(canceled).toBe("ABORTED");
  expect(unhandled).toEqual([]);
});

test("built package works as a browser consumer", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = "/dist/index.mjs";
    const built: typeof API = await import(/* @vite-ignore */ path);
    const blob = await (await fetch("/fixtures/audio.wav")).blob();
    const result = await built.media(blob).format("wav").run();
    return { size: result.size, mime: result.mimeType };
  });
  expect(result.size).toBeGreaterThan(44);
  expect(result.mime).toBe("audio/wav");
});

test("dynamic dimensions fail before opening a target", async ({ page }, testInfo) => {
  const result = await page.evaluate(async () => {
    const blob = await (await fetch("/fixtures/dynamic.mp4")).blob();
    let opened = false;
    const handle = {
      kind: "file",
      name: "dynamic.webm",
      queryPermission: async () => "granted",
      isSameEntry: async () => false,
      createWritable: async () => {
        opened = true;
        throw Error("must not open");
      },
    } as unknown as FileSystemFileHandle;
    try {
      await window.mediaAPI
        .media(blob)
        .format("webm")
        .mode("transcode")
        .run({ target: { type: "file", handle } });
      return { code: "success", opened };
    } catch (e) {
      return { code: (e as API.MediaError).code, opened };
    }
  });
  expect(result.opened).toBe(false);
  expect([
    "UNSUPPORTED_INPUT",
    "CODEC_UNAVAILABLE",
    ...(testInfo.project.name === "webkit" ? ["PROCESSING_FAILED"] : []),
  ]).toContain(result.code);
  await testInfo.attach("dynamic-input", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
  if (testInfo.project.name === "chrome") expect(result.code).toBe("UNSUPPORTED_INPUT");
});

test("repeated success failure cancel cycles and 30-second file output", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chrome", "Resource trend and file test baseline is Chrome.");
  const result = await page.evaluate(async () => {
    const { media } = window.mediaAPI;
    const source = await (await fetch("/fixtures/long.mp4")).blob();
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("long-output.mp4", { create: true });
    const samples = [];
    const heap = () =>
      (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize ?? null;
    let aborts = 0;
    try {
      for (let i = 0; i < 8; i++) {
        const controller = new AbortController();
        if (i % 2) controller.abort();
        try {
          await media(source)
            .format("mp4")
            .mode("copy")
            .run({ target: { type: "file", handle }, signal: controller.signal });
        } catch (e) {
          if ((e as API.MediaError).code !== "ABORTED") throw e;
          aborts++;
        }
        try {
          await media(source).format("wav").run();
        } catch (e) {
          if ((e as API.MediaError).code !== "TRACK_LOSS") throw e;
        }
        samples.push(heap());
      }
      const file = await handle.getFile();
      return { samples, aborts, size: file.size, userAgent: navigator.userAgent };
    } finally {
      await root.removeEntry("long-output.mp4");
    }
  });
  expect(result.aborts).toBe(4);
  expect(result.size).toBeGreaterThan(1000000);
  await testInfo.attach("resource-trend", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
});
test("explicit rotate crop resize and frame rate compose in order", async ({ page }, testInfo) => {
  const result = await page.evaluate(async () => {
    try {
      const source = await (await fetch("/fixtures/av.mp4")).blob();
      const r = await window.mediaAPI
        .media(source)
        .format("webm")
        .rotate(90)
        .crop({ x: 10, y: 10, width: 80, height: 100 })
        .resize({ width: 40 })
        .video({ frameRate: 12 })
        .trim({ start: 0.2, end: 0.8 })
        .run();
      return { code: "ok", info: await window.mediaAPI.probe(r.blob), resolved: r.report.resolved };
    } catch (e) {
      return { code: (e as API.MediaError).code };
    }
  });
  if (result.code === "ok") {
    expect(result.info!.tracks[0]).toMatchObject({ width: 40, height: 50, codec: "vp9" });
    expect(result.resolved!.tracks[0]?.frameRate).toBe(12);
  } else {
    expect(result.code).toBe("CODEC_UNAVAILABLE");
    expect(testInfo.project.name).not.toBe("chrome");
  }
});
test("keyFrameInterval requests key frames and leaves copyable audio as is", async ({
  page,
}, testInfo) => {
  const results = await page.evaluate(async () => {
    const { media } = window.mediaAPI;
    const source = await (await fetch("/fixtures/av.webm")).blob();
    const results = [];
    for (const keyFrameInterval of [0, 0.5]) {
      try {
        const r = await media(source).format("webm").video({ keyFrameInterval }).run();
        results.push({
          keyFrameInterval,
          code: "ok",
          bytes: Array.from(new Uint8Array(await r.blob.arrayBuffer())),
        });
      } catch (e) {
        results.push({ keyFrameInterval, code: (e as API.MediaError).code });
      }
    }
    return results;
  });
  await testInfo.attach("key-frame-interval", {
    body: JSON.stringify(results.map((r) => ({ ...r, bytes: undefined }))),
    contentType: "application/json",
  });
  const ffprobe = (path: string, ...args: string[]) =>
    JSON.parse(
      execFileSync("ffprobe", ["-v", "error", ...args, "-of", "json", path], { encoding: "utf8" }),
    );
  const audioFacts = (path: string) => {
    const [stream] = ffprobe(path, "-select_streams", "a", "-show_streams").streams;
    const packets = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        path,
        "-map",
        "0:a",
        "-c",
        "copy",
        "-f",
        "streamhash",
        "-hash",
        "md5",
        "-",
      ],
      { encoding: "utf8" },
    );
    return {
      codec: stream.codec_name,
      sampleRate: stream.sample_rate,
      channels: stream.channels,
      packets,
    };
  };
  const source = audioFacts("public/fixtures/av.webm");
  mkdirSync(testInfo.outputDir, { recursive: true });
  for (const r of results) {
    if (r.code !== "ok") {
      expect(r.code).toBe("CODEC_UNAVAILABLE");
      expect(testInfo.project.name).not.toBe("chrome");
      continue;
    }
    const path = testInfo.outputPath(`key-frame-${r.keyFrameInterval}.webm`);
    writeFileSync(path, Buffer.from(r.bytes!));
    const keyFrames: number[] = ffprobe(
      path,
      "-select_streams",
      "v",
      "-show_entries",
      "frame=key_frame",
    ).frames.map((f: { key_frame: number }) => f.key_frame);
    expect(keyFrames.length).toBeGreaterThan(1);
    if (r.keyFrameInterval === 0) expect(keyFrames.every((k) => k === 1)).toBe(true);
    else expect(keyFrames.filter((k) => k === 1).length).toBeGreaterThan(1);
    expect(audioFacts(path)).toEqual(source);
  }
});
test("ogg holds one Opus or Vorbis audio track with Vorbis comments", async ({
  page,
}, testInfo) => {
  const tags = {
    title: "\u6807\u9898🎬",
    artist: "\u827a\u672f\u5bb6",
    album: "\u4e13\u8f91",
    albumArtist: "\u6f14\u594f\u8005",
    genre: "\u6d4b\u8bd5",
    comment: "\u6ce8\u91ca🙂",
    description: "\u63cf\u8ff0",
    date: "2024-02-29",
  };
  const results = await page.evaluate(async (tags) => {
    const { media, probe } = window.mediaAPI;
    const load = async (name: string) => (await fetch(`/fixtures/${name}`)).blob();
    const attempt = async (name: string, task: API.MediaBuilder) => {
      try {
        const r = await task.run();
        return {
          name,
          code: "ok",
          mimeType: r.mimeType,
          suggestedFilename: r.suggestedFilename,
          info: await probe(r.blob),
          bytes: Array.from(new Uint8Array(await r.blob.arrayBuffer())),
        };
      } catch (e) {
        return { name, code: (e as API.MediaError).code };
      }
    };
    const mp4 = await load("av.mp4");
    return [
      await attempt(
        "transcode",
        media(mp4).format("ogg").tracks({ video: false }).metadata(tags, { mode: "replace" }),
      ),
      await attempt(
        "copy-opus",
        media(await load("av.webm"))
          .format("ogg")
          .mode("copy")
          .tracks({ video: false }),
      ),
      await attempt(
        "copy-vorbis",
        media(await load("vorbis.ogg"))
          .format("ogg")
          .mode("copy"),
      ),
      await attempt("selected-video", media(mp4).format("ogg")),
    ];
  }, tags);
  await testInfo.attach("ogg", {
    body: JSON.stringify(results.map((r) => ({ ...r, bytes: undefined }))),
    contentType: "application/json",
  });
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  expect(byName["selected-video"]!.code).toBe("TRACK_LOSS");
  const write = (name: string, bytes: number[]) => {
    const path = testInfo.outputPath(`${name}.ogg`);
    mkdirSync(testInfo.outputDir, { recursive: true });
    writeFileSync(path, Buffer.from(bytes));
    return path;
  };
  const ffprobe = (path: string) =>
    JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        {
          encoding: "utf8",
        },
      ),
    );
  const audioPackets = (path: string) =>
    execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", path, "-map", "0:a", "-c", "copy", "-f", "framemd5", "-"],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(",").map((field) => field.trim()))
      .map(([, , pts, , size, hash]) => ({ pts: Number(pts), packet: `${size}:${hash}` }));

  const transcode = byName.transcode!;
  expect(transcode.code).toBe("ok");
  expect(transcode.mimeType).toBe("audio/ogg");
  expect(transcode.suggestedFilename).toBe("output.ogg");
  expect(transcode.info!.tracks).toHaveLength(1);
  expect(transcode.info!.tracks[0]!.codec).toBe("opus");
  expect(transcode.info!.metadata).toEqual(tags);
  const independent = ffprobe(write("transcode", transcode.bytes!));
  expect(independent.format.format_name).toContain("ogg");
  expect(independent.streams).toHaveLength(1);
  expect(independent.streams[0].codec_name).toBe("opus");
  // ffprobe puts Ogg comments on the stream and renames ALBUMARTIST and DESCRIPTION, so the Vorbis names are checked in the raw bytes.
  expect(independent.streams[0].tags.TITLE).toBe(tags.title);
  const raw = Buffer.from(transcode.bytes!);
  for (const [key, value] of Object.entries({
    TITLE: tags.title,
    ARTIST: tags.artist,
    ALBUM: tags.album,
    ALBUMARTIST: tags.albumArtist,
    GENRE: tags.genre,
    COMMENT: tags.comment,
    DESCRIPTION: tags.description,
    DATE: tags.date,
  }))
    expect(raw.includes(Buffer.from(`${key}=${value}`)), key).toBe(true);

  for (const [name, source, codec] of [
    ["copy-opus", "av.webm", "opus"],
    ["copy-vorbis", "vorbis.ogg", "vorbis"],
  ] as const) {
    const r = byName[name]!;
    expect(r.code, name).toBe("ok");
    expect(r.mimeType).toBe("audio/ogg");
    expect(r.info!.tracks).toHaveLength(1);
    expect(r.info!.tracks[0]!.codec).toBe(codec);
    const path = write(name, r.bytes!);
    expect(ffprobe(path).streams[0].codec_name).toBe(codec);
    const copied = audioPackets(path).map((p) => p.packet);
    // Copy starts at time zero, so the Vorbis priming packet before it is dropped.
    const kept = audioPackets(`public/fixtures/${source}`).filter((p) => p.pts >= 0);
    expect(copied.length).toBeGreaterThan(1);
    expect(copied).toEqual(kept.map((p) => p.packet));
  }
});
test("encoder matrix and explicit audio parameters use the requested configuration", async ({
  page,
}, testInfo) => {
  const results = await page.evaluate(async () => {
    const { media, probe } = window.mediaAPI;
    const source = await (await fetch("/fixtures/av.mp4")).blob();
    const audioOnly = { mp4: false, webm: false, m4a: true, wav: true, ogg: true } satisfies Record<
      API.Format,
      boolean
    >;
    const results = [];
    for (const [format, noVideo] of Object.entries(audioOnly) as [API.Format, boolean][]) {
      try {
        let task = media(source)
          .format(format)
          .mode("transcode")
          .audio({ sampleRate: 48000, channels: 2 });
        if (noVideo) task = task.tracks({ video: false });
        if (format === "webm")
          task = task.video({ codec: "vp8", quality: "low" }).video({ bitrate: 300000 });
        const r = await task.run();
        results.push({
          format,
          code: "ok",
          info: await probe(r.blob),
          resolved: r.report.resolved,
        });
      } catch (e) {
        results.push({ format, code: (e as API.MediaError).code });
      }
    }
    return results;
  });
  await testInfo.attach("encoder-matrix", {
    body: JSON.stringify(results),
    contentType: "application/json",
  });
  for (const r of results) {
    if (r.code === "ok") {
      const audio = r.info!.tracks.find((t) => t.type === "audio");
      expect(audio).toMatchObject({ sampleRate: 48000, channels: 2 });
      if (r.format === "webm") {
        expect(r.info!.tracks[0]?.codec).toBe("vp8");
        expect(r.resolved!.tracks[0]?.bitrate).toBe(300000);
        expect(r.resolved!.tracks[0]?.quality).toBeUndefined();
      }
    } else {
      expect(r.code).toBe("CODEC_UNAVAILABLE");
    }
  }
  // AAC encoding is platform-dependent even with the same Chrome version.
  for (const format of ["webm", "wav", "ogg"]) {
    expect(results.find((r) => r.format === format)?.code).toBe("ok");
  }
  if (testInfo.project.name === "chrome" && process.platform === "darwin")
    expect(results.every((r) => r.code === "ok")).toBe(true);
});
