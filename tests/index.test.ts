import { expect, test } from "vite-plus/test";
import { formats } from "../src/config.ts";
import { media, MediaError } from "../src/index.ts";
import { resolveMetadata, metadataPatch } from "../src/metadata.ts";
import { Scope } from "../src/scope.ts";
import { checkSize, OutputSink } from "../src/target.ts";
const input = new Blob(["media"]);
test("strict immutable options and required format", async () => {
  const base = media(input);
  base.format("wav");
  await expect(base.run()).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  expect(() => base.resize({ width: 3 })).toThrow(MediaError);
  expect(() => base.resize({ width: 320, height: 240 })).toThrow(MediaError);
  expect(() => base.tracks({ audio: [1, 1] })).toThrow(MediaError);
  expect(() => base.video({ quality: "high", bitrate: 10 })).toThrow(MediaError);
  await expect(base.format("wav").mode("copy").trim({ start: 0 }).run()).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
});
test("metadata projects allowlist, deletes and validates dates", () => {
  const result = resolveMetadata(
    { title: "old", artist: "a", raw: { secret: "x" } },
    { mode: "merge", patch: { title: null, date: "2024-02-29" } },
  );
  expect(result.tags).toEqual({ artist: "a", date: new Date("2024-02-29T00:00:00Z") });
  expect(result.report.omittedSourceFields).toEqual(["raw"]);
  expect(() => metadataPatch({ date: "2023-02-29" })).toThrow();
  expect(() => metadataPatch({ title: "\ud800" })).toThrow();
  expect(() => metadataPatch({ unknown: "x" })).toThrowError(
    expect.objectContaining({ code: "UNSUPPORTED_METADATA_FIELD" }),
  );
  expect(
    resolveMetadata({ artist: "a" }, { mode: "replace", patch: { title: "new" } }).tags,
  ).toEqual({ title: "new" });
});
test("first failure wins; observer failures do not fail work", async () => {
  const abort = new AbortController();
  const scope = new Scope(abort.signal, () => {
    throw Error("observer");
  });
  scope.progress();
  expect(scope.warnings).toHaveLength(1);
  expect(scope.failure).toBeUndefined();
  abort.abort();
  scope.fail(Error("late"));
  expect(scope.failure?.code).toBe("ABORTED");
  expect(scope.failure?.diagnostics).toHaveLength(1);
  await scope.finish();
});
test("late cancellation cannot interrupt commit", async () => {
  const abort = new AbortController();
  const scope = new Scope(abort.signal, () => abort.abort());
  scope.commit();
  expect(scope.failure).toBeUndefined();
  await scope.finish();
});
test("WAV logical size guard rejects before allocation", () => {
  expect(() => checkSize("wav", 0x100000000)).toThrowError(
    expect.objectContaining({ code: "OUTPUT_TOO_LARGE" }),
  );
  checkSize("wav", 0xffffffff);
});
function fakeHandle(events: string[], permission: PermissionState = "granted") {
  return {
    kind: "file",
    name: "test.wav",
    isSameEntry: async () => false,
    queryPermission: async () => permission,
    createWritable: async () => ({
      write: async () => {
        events.push("write");
      },
      close: async () => {
        events.push("close");
      },
      abort: async () => {
        events.push("abort");
      },
    }),
  } as unknown as FileSystemFileHandle;
}
test("cancel aborts actual file without committing; lease prevents concurrent writes", async () => {
  const events: string[] = [];
  const handle = fakeHandle(events);
  const a = new Scope(),
    b = new Scope();
  const first = new OutputSink("wav", a, { type: "file", handle }),
    second = new OutputSink("wav", b, { type: "file", handle });
  await first.open();
  await expect(second.open()).rejects.toMatchObject({ code: "TARGET_BUSY" });
  a.fail(new MediaError("ABORTED", "cancel"));
  await a.finish();
  expect(events).toEqual(["abort"]);
  expect(first.targetState).toBe("aborted");
  first.releaseLease();
  await b.finish();
});
test("permission denied does not create a writable", async () => {
  const events: string[] = [];
  const scope = new Scope();
  const sink = new OutputSink("wav", scope, { type: "file", handle: fakeHandle(events, "prompt") });
  await expect(sink.open()).rejects.toMatchObject({ code: "PERMISSION_REQUIRED" });
  expect(events).toEqual([]);
  expect(sink.targetState).toBe("untouched");
  await scope.finish();
});
test("video keyFrameInterval accepts zero and positive seconds and is video-only", () => {
  for (const keyFrameInterval of [0, 0.5, 2])
    expect(() => media(input).video({ keyFrameInterval })).not.toThrow();
  for (const keyFrameInterval of [-1, NaN, Infinity, "2"])
    expect(() => media(input).video({ keyFrameInterval } as never)).toThrowError(
      expect.objectContaining({ code: "INVALID_OPTIONS" }),
    );
  expect(() => media(input).audio({ keyFrameInterval: 2 } as never)).toThrowError(
    expect.objectContaining({ code: "INVALID_OPTIONS" }),
  );
});
test("keyFrameInterval 0 counts as a video option before any input read", async () => {
  const webm = media(input).format("webm");
  await expect(webm.mode("copy").video({ keyFrameInterval: 0 }).run()).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  await expect(
    webm.tracks({ video: false }).video({ keyFrameInterval: 0 }).run(),
  ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  await expect(
    webm.mode("copy").video({ keyFrameInterval: 2 }).video({ keyFrameInterval: undefined }).run(),
  ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  await expect(webm.mode("copy").run()).rejects.not.toMatchObject({ code: "INVALID_OPTIONS" });
});
test("ogg is a format name and rejects codecs it cannot encode before opening a target", async () => {
  expect(() => media(input).format("ogg")).not.toThrow();
  for (const format of ["OGG", "toString"])
    expect(() => media(input).format(format as never)).toThrowError(
      expect.objectContaining({ code: "INVALID_OPTIONS" }),
    );
  const ogg = media(input).format("ogg");
  for (const task of [ogg.audio({ codec: "aac" }), ogg.video({ codec: "vp9" })]) {
    const events: string[] = [];
    const target = { type: "file", handle: fakeHandle(events) } as const;
    await expect(task.run({ target })).rejects.toMatchObject({
      code: "UNSUPPORTED_OUTPUT_COMBINATION",
      targetState: "untouched",
    });
    expect(events).toEqual([]);
  }
});
test("every format row matches the Mediabunny writer it builds", () => {
  for (const [format, profile] of Object.entries(formats)) {
    const writer = profile.writer();
    expect(writer.mimeType.split("/")[1], format).toBe(profile.mimeSubtype);
    expect(writer.fileExtension, format).toBe(format === "m4a" ? ".mp4" : `.${format}`);
    const supported: readonly string[] = writer.getSupportedCodecs();
    for (const codec of [
      ...profile.video,
      ...profile.audio,
      ...profile.copyVideo,
      ...profile.copyAudio,
    ])
      expect(supported, `${format} ${codec}`).toContain(codec);
  }
});
test("input scheme boundary and unknown options reject early", () => {
  expect(() => media("file:///private.mp4")).toThrowError(
    expect.objectContaining({ code: "UNSUPPORTED_INPUT" }),
  );
  expect(() => media("https://user:secret@example.com/a.mp4")).toThrow();
  expect(() => media(input).video({ unknown: 1 } as never)).toThrow();
  expect(() => media(input).metadata({ title: "\0" })).toThrow();
});
