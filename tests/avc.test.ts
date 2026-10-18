import { expect, test, vi } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import { validateAvcConfiguration } from "../src/avc.ts";
import { Scope } from "../src/scope.ts";

for (const name of ["av.mp4", "dynamic.mp4"]) {
  test(`AVC sequence preflight: ${name}`, async () => {
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BufferSource(readFileSync(`public/fixtures/${name}`)),
    });
    try {
      const track = (await input.getPrimaryVideoTrack())!;
      const scope = new Scope();
      const check = vi.spyOn(scope, "check");
      const result = validateAvcConfiguration(track, scope);
      if (name === "dynamic.mp4")
        await expect(result).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
      else await expect(result).resolves.toBeUndefined();
      expect(check).toHaveBeenCalled();
    } finally {
      input.dispose();
    }
  });
}

test("truncated AVC sequence descriptions fail closed", async () => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(readFileSync("public/fixtures/av.mp4")),
  });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    const config = (await track.getDecoderConfig())!;
    vi.spyOn(track, "getDecoderConfig").mockResolvedValue({
      ...config,
      description: new Uint8Array([1, 100, 0, 10, 255, 225, 0, 25, 103]),
    });
    await expect(validateAvcConfiguration(track, new Scope())).rejects.toMatchObject({
      code: "UNSUPPORTED_INPUT",
    });
  } finally {
    input.dispose();
  }
});
