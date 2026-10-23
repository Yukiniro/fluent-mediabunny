import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { EncodedPacket, EncodedPacketSink, InputTrack } from "mediabunny";
import { probe } from "../src/index.ts";

const source = (name: string) => new Blob([readFileSync(`public/fixtures/${name}`)]);
afterEach(() => vi.restoreAllMocks());

test("probe selects source IDs while preserving full input duration and adding source metadata", async () => {
  const all = await probe(source("multi.mp4"));
  const audio = all.tracks.filter((t) => t.type === "audio");
  const selected = await probe(source("multi.mp4"), {
    tracks: { video: false, audio: [audio[1]!.id] },
  });
  expect(selected.tracks).toHaveLength(1);
  expect(selected.durationSeconds).toBe(all.durationSeconds);
  expect(selected.tracks[0]).toMatchObject({
    id: audio[1]!.id,
    language: null,
    name: null,
    isDefault: false,
    sampleRate: 44100,
    channels: 1,
    durationOrigin: "metadata",
  });
  const track = selected.tracks[0]!;
  expect(track.startTimestamp).toBeTypeOf("number");
  expect(track.endTimestamp).toBeGreaterThan(track.startTimestamp!);
  expect(track.durationSeconds).toBeCloseTo(track.endTimestamp! - track.startTimestamp!, 6);
  expect(track.averageBitrate).toBeGreaterThan(0);
  await expect(probe(source("multi.mp4"), { tracks: { audio: [9999] } })).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  await expect(
    probe(source("multi.mp4"), { tracks: { audio: false, video: false } }),
  ).rejects.toMatchObject({ code: "NO_TRACKS" });
});

test("frame-rate estimates require distinct timestamps and metadata probing never iterates packets", async () => {
  const packets = vi
    .spyOn(EncodedPacketSink.prototype, "packets")
    .mockImplementation(async function* () {
      yield new EncodedPacket(new Uint8Array([0]), "key", 0, 1);
      yield new EncodedPacket(new Uint8Array([0]), "delta", 0, 1);
    });
  await probe(source("silent.mp4"));
  expect(packets).not.toHaveBeenCalled();
  const result = await probe(source("silent.mp4"), { frameRate: "estimate" });
  expect(result.tracks[0]).toMatchObject({ frameRate: null, frameRateOrigin: "unknown" });
  packets.mockImplementation(async function* () {
    yield new EncodedPacket(new Uint8Array([0]), "key", 0, 1);
    yield new EncodedPacket(new Uint8Array([0]), "delta", Number.MIN_VALUE, 1);
  });
  expect((await probe(source("silent.mp4"), { frameRate: "estimate" })).tracks[0]).toMatchObject({
    frameRate: null,
    frameRateOrigin: "unknown",
  });
  for (const options of [
    { tracks: null },
    { tracks: { audio: [] } },
    { frameRate: true },
    { start: 0 },
  ])
    await expect(probe(source("silent.mp4"), options as never)).rejects.toMatchObject({
      code: "INVALID_OPTIONS",
    });
});

test("video probe reports coded geometry and estimates frame rate only when requested", async () => {
  const basic = await probe(source("av.mp4"));
  expect(basic.tracks.find((t) => t.type === "video")).toMatchObject({
    codedWidth: 160,
    codedHeight: 120,
    width: 160,
    height: 120,
    rotation: 0,
    frameRate: null,
    frameRateOrigin: "unknown",
  });
  const estimated = await probe(source("av.mp4"), {
    frameRate: "estimate",
    tracks: { audio: false },
  });
  expect(estimated.tracks[0]).toMatchObject({ frameRate: 15, frameRateOrigin: "estimated" });
});

test("probe waits for owned track reads after the first failure", async () => {
  let release!: () => void, entered!: () => void, failed!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const failure = new Promise<void>((r) => {
    failed = r;
  });
  vi.spyOn(InputTrack.prototype, "getName").mockImplementation(async function (this: InputTrack) {
    if (this.isVideoTrack()) {
      entered();
      await pending;
      return null;
    }
    await ready;
    failed();
    throw new Error("tag read failed");
  });
  let settled = false;
  const result = probe(source("av.mp4"));
  const rejection = expect(result).rejects.toMatchObject({ code: "READ_FAILED" });
  void result.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await failure;
  await new Promise((r) => setTimeout(r, 0));
  const premature = settled;
  release();
  await rejection;
  expect(premature).toBe(false);
});
