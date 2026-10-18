import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { media, MediaError } from "../src/index.ts";
const source = () => new Blob([readFileSync("public/fixtures/audio.wav")]);
function target(
  hooks: {
    write?: () => Promise<void> | void;
    close?: () => Promise<void> | void;
    abort?: () => Promise<void> | void;
    open?: () => Promise<void> | void;
  } = {},
) {
  const events: string[] = [];
  const handle = {
    kind: "file",
    name: "test.wav",
    isSameEntry: async () => false,
    queryPermission: async () => "granted",
    createWritable: async () => {
      events.push("open");
      await hooks.open?.();
      return {
        write: async () => {
          events.push("write");
          await hooks.write?.();
        },
        close: async () => {
          events.push("close");
          await hooks.close?.();
        },
        abort: async () => {
          events.push("abort");
          await hooks.abort?.();
        },
      };
    },
  } as unknown as FileSystemFileHandle;
  return { events, handle };
}
test("cancel during final buffered write never closes file", async () => {
  const controller = new AbortController();
  const t = target({ write: () => controller.abort() });
  await expect(
    media(source())
      .format("wav")
      .run({ target: { type: "file", handle: t.handle }, signal: controller.signal }),
  ).rejects.toMatchObject({ code: "ABORTED", targetState: "aborted" });
  expect(t.events).toContain("write");
  expect(t.events).toContain("abort");
  expect(t.events).not.toContain("close");
});
test("late-created stream is aborted and returned error waits for cleanup", async () => {
  const controller = new AbortController();
  const t = target({ open: () => controller.abort() });
  await expect(
    media(source())
      .format("wav")
      .run({ target: { type: "file", handle: t.handle }, signal: controller.signal }),
  ).rejects.toMatchObject({ code: "ABORTED", targetState: "aborted" });
  expect(t.events).toEqual(["open", "abort"]);
});
test("close is a commit barrier and promise settles only after close", async () => {
  const controller = new AbortController();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let closing!: () => void;
  const started = new Promise<void>((resolve) => {
    closing = resolve;
  });
  const t = target({
    close: async () => {
      closing();
      controller.abort();
      await barrier;
    },
  });
  let settled = false;
  let progressComplete = false;
  const pending = media(source())
    .format("wav")
    .run({
      target: { type: "file", handle: t.handle },
      signal: controller.signal,
      onProgress: (event) => {
        if (event.phase === "processing" && event.ratio === 1) progressComplete = true;
      },
    })
    .then((r) => {
      settled = true;
      return r;
    });
  await started;
  expect(settled).toBe(false);
  expect(progressComplete).toBe(true);
  release();
  expect((await pending).commitState).toBe("committed");
  expect(t.events.filter((e) => e === "close")).toHaveLength(1);
  expect(t.events).not.toContain("abort");
});
test("close rejection is WRITE_FAILED with unknown file state", async () => {
  const t = target({
    close: () => {
      throw Error("close");
    },
  });
  await expect(
    media(source())
      .format("wav")
      .run({ target: { type: "file", handle: t.handle } }),
  ).rejects.toMatchObject({ code: "WRITE_FAILED", phase: "committing", targetState: "unknown" });
  expect(t.events).not.toContain("abort");
});
test("write failure survives abort cleanup failure", async () => {
  const t = target({
    write: () => {
      throw Error("write");
    },
    abort: () => {
      throw Error("cleanup");
    },
  });
  try {
    await media(source())
      .format("wav")
      .run({ target: { type: "file", handle: t.handle } });
    expect.fail("must reject");
  } catch (error) {
    expect(error).toBeInstanceOf(MediaError);
    const e = error as MediaError;
    expect(e.code).toBe("WRITE_FAILED");
    expect(e.cause).toMatchObject({ message: "write" });
    expect(e.diagnostics.length).toBeGreaterThan(0);
    expect(e.targetState).toBe("unknown");
  }
  expect(t.events).not.toContain("close");
});
test("metadata instruction replacement and encoding option override are observable", async () => {
  const base = media(source()).format("wav").metadata({ title: "first" }, { mode: "replace" });
  const result = await base.metadata({ artist: "last" }).run();
  expect(result.report.metadata.values.title).toBeUndefined();
  expect(result.report.metadata.values.artist).toBe("last");
});
test("concurrent runs from a builder use independent outputs and audio MIME", async () => {
  const builder = media(source()).format("wav");
  const [a, b] = await Promise.all([builder.run(), builder.run()]);
  expect(a.blob).not.toBe(b.blob);
  expect(a.size).toBe(b.size);
  const audio = await media(new Blob([readFileSync("public/fixtures/av.mp4")]))
    .format("mp4")
    .mode("copy")
    .tracks({ video: false })
    .run();
  expect(audio.mimeType).toBe("audio/mp4");
});
test("HEVC copy succeeds without a native video decoder or encoder", async () => {
  const blob = new Blob([readFileSync("public/fixtures/hevc.mp4")]);
  const copied = await media(blob).format("mp4").mode("copy").run();
  expect(copied.report.resolved.tracks[0]?.codec).toBe("hevc");
  await expect(media(blob).format("mp4").run()).rejects.toMatchObject({
    code: "CODEC_UNAVAILABLE",
  });
});
