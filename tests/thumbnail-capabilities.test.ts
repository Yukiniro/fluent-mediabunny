import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { media, probe, thumbnail } from "../src/index.ts";

test("inspection and packet copy need no decoder when extraction is unavailable", async () => {
  const source = new Blob([readFileSync("public/fixtures/silent.mp4")]);
  expect((await probe(source)).tracks[0]!.codec).toBe("avc");
  await expect(thumbnail(source, { time: 0 })).rejects.toMatchObject({ code: "CODEC_UNAVAILABLE" });
  const result = await media(source).format("mp4").mode("copy").run();
  expect(result.size).toBeGreaterThan(0);
});
