import { expect, test, vi } from "vite-plus/test";
import { readFileSync } from "node:fs";
const frames = vi.hoisted(() => ({ samples: [] as Record<string, unknown>[] }));
vi.mock("mediabunny", async (importOriginal) => ({
  ...(await importOriginal<typeof import("mediabunny")>()),
  canEncodeVideo: async () => true,
  VideoSampleSink: class {
    async *samples() {
      yield* frames.samples;
    }
  },
}));
import { InputVideoTrack } from "mediabunny";
import { media } from "../src/index.ts";

test("coded dimension changes fail before file open even with constant display dimensions", async () => {
  const decode = vi.spyOn(InputVideoTrack.prototype, "canDecode").mockResolvedValue(true);
  const close = vi.fn();
  frames.samples = [160, 96].map((width) => ({
    codedWidth: width,
    codedHeight: 120,
    displayWidth: 160,
    displayHeight: 120,
    visibleRect: { width: 160, height: 120 },
    close,
  }));
  const createWritable = vi.fn();
  const handle = {
    kind: "file",
    name: "output.webm",
    queryPermission: async () => "granted",
    isSameEntry: async () => false,
    createWritable,
  } as unknown as FileSystemFileHandle;
  try {
    await expect(
      media(new Blob([readFileSync("public/fixtures/av.mp4")]))
        .tracks({ audio: false })
        .format("webm")
        .mode("transcode")
        .run({ target: { type: "file", handle } }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
    expect(createWritable).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(2);
  } finally {
    decode.mockRestore();
  }
});
