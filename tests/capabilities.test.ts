import { expect, test, vi } from "vite-plus/test";
import { readFileSync } from "node:fs";
const capability = vi.hoisted(() => vi.fn());
vi.mock("mediabunny", async (importOriginal) => ({
  ...(await importOriginal<typeof import("mediabunny")>()),
  canEncodeAudio: capability,
}));
import { media } from "../src/index.ts";
test("unsupported exact sample rate fails without trying the supported 48 kHz fallback", async () => {
  capability.mockImplementation(
    async (_codec: string, options: { sampleRate: number }) => options.sampleRate === 48000,
  );
  await expect(
    media(new Blob([readFileSync("public/fixtures/rate.wav")]))
      .format("wav")
      .mode("transcode")
      .run(),
  ).rejects.toMatchObject({ code: "CODEC_UNAVAILABLE" });
  expect(capability).toHaveBeenCalledTimes(1);
  expect(capability.mock.calls[0]?.[1]).toMatchObject({ sampleRate: 12345, numberOfChannels: 1 });
});
