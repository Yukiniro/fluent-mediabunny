import { readFileSync } from "node:fs";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import { expect, test } from "vite-plus/test";
import { media, MediaError } from "../src/index.ts";

const av = () => new Blob([readFileSync("public/fixtures/av.mp4")]);

async function orientation(bytes: Uint8Array) {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("no video track");
    return { rotation: await track.getRotation(), flip: await track.getFlip() };
  } finally {
    input.dispose();
  }
}

async function convert(build: (builder: ReturnType<typeof media>) => ReturnType<typeof media>) {
  const result = await build(media(av()).format("mp4").tracks({ audio: false })).run();
  const video = result.report.resolved.tracks.find((track) => track.type === "video");
  return {
    width: video?.width,
    height: video?.height,
    ...(await orientation(new Uint8Array(await result.blob.arrayBuffer()))),
  };
}

test("flip rejects unknown keys and non-booleans before a run", () => {
  const builder = media(av());
  expect(() => builder.flip({ mirror: true } as never)).toThrow(MediaError);
  expect(() => builder.flip({ horizontal: 1 as never })).toThrow(MediaError);
  expect(() => builder.flip({})).not.toThrow();
});

test("copy mode rejects a true flip axis and allows a false one", async () => {
  await expect(
    media(av()).format("mp4").mode("copy").flip({ horizontal: true }).run(),
  ).rejects.toMatchObject({
    code: "INVALID_OPTIONS",
  });
  const copied = await media(av())
    .format("mp4")
    .mode("copy")
    .tracks({ audio: false })
    .flip({ horizontal: false })
    .run();
  expect(copied.report.resolved.tracks[0]).toMatchObject({ width: 160, height: 120 });
});

test("repeated flip calls merge axes and a vertical flip is a horizontal flip plus 180 degrees", async () => {
  await expect(convert((builder) => builder.flip({ horizontal: true }))).resolves.toEqual({
    width: 160,
    height: 120,
    rotation: 0,
    flip: true,
  });
  await expect(convert((builder) => builder.flip({ vertical: true }))).resolves.toEqual({
    width: 160,
    height: 120,
    rotation: 180,
    flip: true,
  });
  await expect(
    convert((builder) => builder.flip({ horizontal: true }).flip({ vertical: true })),
  ).resolves.toEqual({
    width: 160,
    height: 120,
    rotation: 180,
    flip: false,
  });
  await expect(
    convert((builder) =>
      builder.flip({ horizontal: true, vertical: true }).flip({ horizontal: false }),
    ),
  ).resolves.toEqual({
    width: 160,
    height: 120,
    rotation: 180,
    flip: true,
  });
  await expect(convert((builder) => builder.rotate(90).flip({ vertical: true }))).resolves.toEqual({
    width: 120,
    height: 160,
    rotation: 270,
    flip: true,
  });
});
