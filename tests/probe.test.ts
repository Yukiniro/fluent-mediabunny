import { readFileSync } from "node:fs";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import { expect, test } from "vite-plus/test";
import { probe, type ProbeOptions } from "../src/index.ts";
import { frameRateFromTimestamps, trackInfo } from "../src/input.ts";

const file = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../public/fixtures/${name}`, import.meta.url)));

test("frame-rate estimate needs two distinct timestamps", () => {
  expect(frameRateFromTimestamps([])).toBeNull();
  expect(frameRateFromTimestamps([0])).toBeNull();
  expect(frameRateFromTimestamps([1, 1, 1])).toBeNull();
  expect(frameRateFromTimestamps([0, 1 / 15, 2 / 15])).toBeCloseTo(15, 6);
});

test("probe reports source track facts and leaves unknown bitrate unknown", async () => {
  const info = await probe(file("av.mp4"));
  const video = info.tracks.find((track) => track.type === "video");
  const audio = info.tracks.find((track) => track.type === "audio");
  expect(video).toMatchObject({
    id: 1,
    codec: "avc",
    width: 160,
    height: 120,
    codedWidth: 160,
    codedHeight: 120,
    rotation: 0,
    frameRate: { hertz: null, origin: "unknown" },
    averageBitrate: null,
    peakBitrate: 97432,
    startSeconds: 0,
    endSeconds: 2,
    elapsedSeconds: 2,
    default: true,
  });
  expect(video).not.toHaveProperty("language");
  expect(video).not.toHaveProperty("name");
  expect(audio).toMatchObject({
    id: 2,
    codec: "aac",
    sampleRate: 44100,
    channels: 1,
    language: null,
    name: null,
    averageBitrate: 69663,
    peakBitrate: 69663,
    default: true,
  });
  expect(audio?.startSeconds).toBeCloseTo(-0.023219954648526078, 12);
  expect(audio?.endSeconds).toBe(2);
  expect(audio?.elapsedSeconds).toBeCloseTo(2 - audio!.startSeconds!, 12);
  expect(audio).not.toHaveProperty("frameRate");
  expect(audio).not.toHaveProperty("codedWidth");
  expect(info.durationSeconds).toBe(2);
  expect(info.durationOrigin).toBe("metadata");
});

test("rotation and display size stay distinct from coded size", async () => {
  const video = (await probe(file("rotated.mp4"))).tracks.find((track) => track.type === "video");
  expect(video).toMatchObject({
    codedWidth: 160,
    codedHeight: 120,
    width: 120,
    height: 160,
    rotation: 270,
  });
});

test("track selection does not change container duration or file metadata", async () => {
  const all = await probe(file("multi.mp4"));
  const primary = await probe(file("multi.mp4"), { audio: "primary", video: false });
  const third = await probe(file("multi.mp4"), { audio: [3], video: false });
  const none = await probe(file("multi.mp4"), { audio: false, video: false });
  expect(primary.tracks.map((track) => track.id)).toEqual([2]);
  expect(third.tracks.map((track) => track.id)).toEqual([3]);
  expect(third.tracks[0]).toMatchObject({ default: false });
  expect(none.tracks).toEqual([]);
  for (const info of [primary, third, none]) {
    expect(info.container).toBe(all.container);
    expect(info.durationSeconds).toBe(all.durationSeconds);
    expect(info.durationOrigin).toBe(all.durationOrigin);
    expect(info.metadata).toEqual(all.metadata);
    expect(info.omittedSourceFields).toEqual(all.omittedSourceFields);
  }
});

test("explicit frame-rate estimate samples packets and still leaves unknown bitrate unknown", async () => {
  const video = (await probe(file("av.mp4"), { frameRate: "estimate" })).tracks.find(
    (track) => track.type === "video",
  );
  expect(video?.frameRate).toEqual({ hertz: 15, origin: "estimated" });
  expect(video?.averageBitrate).toBeNull();
  expect(video?.peakBitrate).toBe(97432);
});

test("offset tracks report start, end, and elapsed time separately", async () => {
  const tracks = (await probe(file("offset.mp4"))).tracks;
  const video = tracks.find((track) => track.type === "video");
  const audio = tracks.find((track) => track.type === "audio");
  expect(video).toMatchObject({ startSeconds: 5, endSeconds: 7, elapsedSeconds: 2 });
  const start = 4.976009070294785;
  const end = 6.999229024943311;
  expect(audio?.startSeconds).toBeCloseTo(start, 12);
  expect(audio?.endSeconds).toBeCloseTo(end, 12);
  expect(audio?.elapsedSeconds).toBeCloseTo(end - start, 12);
});

test("wav bitrate stays unknown instead of zero", async () => {
  const audio = (await probe(file("audio.wav"))).tracks[0];
  expect(audio).toMatchObject({
    type: "audio",
    averageBitrate: null,
    peakBitrate: null,
    language: null,
    name: null,
    startSeconds: 0,
    endSeconds: 2,
    elapsedSeconds: 2,
  });
});

test("invalid probe selection fails before treating ids as indexes", async () => {
  await expect(probe(file("multi.mp4"), { audio: [2, 2] })).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  await expect(probe(file("multi.mp4"), { audio: [9] })).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  await expect(
    probe(file("audio.wav"), { frameRate: "metadata" } as unknown as ProbeOptions),
  ).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
});

test("conversion track info does not gain probe-only fields", async () => {
  const input = new Input({ source: new BufferSource(file("av.mp4")), formats: ALL_FORMATS });
  const track = (await input.getTracks()).find((item) => item.isVideoTrack());
  const info = await trackInfo(track!);
  input.dispose();
  expect(info).toMatchObject({ id: 1, type: "video", width: 160, height: 120 });
  expect(info).not.toHaveProperty("codedWidth");
  expect(info).not.toHaveProperty("averageBitrate");
  expect(info).not.toHaveProperty("frameRate");
  expect(info).not.toHaveProperty("elapsedSeconds");
});
