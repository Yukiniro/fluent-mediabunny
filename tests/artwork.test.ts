import { readFileSync } from "node:fs";
import { BufferSource, Input, MP3 } from "mediabunny";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import type { MetadataPatch, MediaInput } from "../src/index.ts";
import { artwork, media, probe } from "../src/index.ts";
import type { Scope } from "../src/scope.ts";

type Picture = {
  data: Uint8Array;
  mimeType: string;
  kind: "coverFront" | "coverBack" | "unknown";
  name?: string;
  description?: string;
};
const fake = vi.hoisted(() => ({
  useFake: true,
  opened: 0,
  disposed: 0,
  failDispose: false,
  images: undefined as Picture[] | undefined,
  tagsHook: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("../src/input.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/input.ts")>();
  return {
    ...actual,
    openInput: (source: MediaInput, scope: Scope) => {
      if (!fake.useFake) return actual.openInput(source, scope);
      scope.check();
      fake.opened++;
      let disposed = false;
      const input = {
        getFormat: async () => ({ name: "MP3" }),
        getMetadataTags: async () => {
          await fake.tagsHook?.();
          return { images: fake.images };
        },
        dispose: () => {
          if (!disposed) fake.disposed++;
          disposed = true;
          if (fake.failDispose) throw new Error("dispose failure");
        },
      };
      scope.onStop(input.dispose);
      return input as Input;
    },
  };
});
const source = new Uint8Array([1]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x10, 0x20]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x33]);
const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x18, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
]);
const picture = (
  data: Uint8Array,
  kind: Picture["kind"],
  mimeType: string,
  extra: Pick<Picture, "name" | "description"> = {},
): Picture => ({ data, kind, mimeType, ...extra });
const imageBytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
beforeEach(() => {
  fake.useFake = true;
  fake.opened = 0;
  fake.disposed = 0;
  fake.failDispose = false;
  fake.images = undefined;
  fake.tagsHook = undefined;
});

test("front JPEG wins over an earlier back PNG and ignores the declared type", async () => {
  fake.images = [
    picture(png, "coverBack", "image/png", { name: "cover.jpg", description: "front" }),
    picture(jpeg, "coverFront", "image/jpg", { name: "cover.png", description: "back" }),
  ];
  const cover = await artwork(source);
  expect(cover).toMatchObject({ mimeType: "image/jpeg", kind: "front" });
  expect(cover?.blob.type).toBe("image/jpeg");
  expect(await imageBytes(cover!.blob)).toEqual(jpeg);
});

test("unlabeled pictures outrank back covers and ties keep file order", async () => {
  fake.images = [picture(png, "coverBack", "image/png"), picture(jpeg, "unknown", "image/jpeg")];
  const unlabeled = await artwork(source);
  expect(unlabeled).toMatchObject({ mimeType: "image/jpeg", kind: "unspecified" });
  expect(await imageBytes(unlabeled!.blob)).toEqual(jpeg);
  fake.images = [picture(png, "coverBack", "image/png")];
  const back = await artwork(source);
  expect(back).toMatchObject({ mimeType: "image/png", kind: "back" });
  expect(await imageBytes(back!.blob)).toEqual(png);
  fake.images = [picture(png, "unknown", "image/png"), picture(jpeg, "unknown", "image/jpeg")];
  const first = await artwork(source);
  expect(first).toMatchObject({ mimeType: "image/png", kind: "unspecified" });
  expect(await imageBytes(first!.blob)).toEqual(png);
  fake.images = [
    picture(jpeg, "coverFront", "image/jpeg"),
    picture(png, "coverFront", "image/png"),
  ];
  const earlierFront = await artwork(source);
  expect(await imageBytes(earlierFront!.blob)).toEqual(jpeg);
  fake.images = [
    picture(new TextEncoder().encode("<svg/>"), "coverFront", "image/svg+xml"),
    picture(jpeg, "coverBack", "image/jpeg"),
  ];
  const skipped = await artwork(source);
  expect(skipped).toMatchObject({ mimeType: "image/jpeg", kind: "back" });
  expect(await imageBytes(skipped!.blob)).toEqual(jpeg);
});

test("content bytes choose among the five image types", async () => {
  const cases = [
    [new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01]), "image/gif"],
    [new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x02]), "image/gif"],
    [webp, "image/webp"],
    [new Uint8Array([0x42, 0x4d, 0x01]), "image/bmp"],
    [png, "image/png"],
  ] as const;
  for (const [data, mimeType] of cases) {
    fake.images = [picture(data, "unknown", "image/jpeg")];
    const cover = await artwork(source);
    expect(cover).toMatchObject({ mimeType, kind: "unspecified" });
    expect(cover?.blob.type).toBe(mimeType);
    expect(await imageBytes(cover!.blob)).toEqual(data);
  }
});

test("an ineligible picture or no pictures resolves null", async () => {
  const link = new TextEncoder().encode("https://example.test/cover.jpg");
  const samples = [
    picture(link, "coverFront", "-->"),
    picture(
      new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      "coverFront",
      "image/svg+xml",
    ),
    picture(new Uint8Array(), "coverFront", "image/jpeg"),
    picture(new Uint8Array([0xff, 0xd8]), "coverFront", "image/jpeg"),
    picture(
      new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
      "coverFront",
      "image/heic",
    ),
    picture(new Uint8Array([0x49, 0x49, 0x2a, 0x00]), "coverFront", "image/tiff"),
    picture(
      new Uint8Array([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]),
      "unknown",
      "image/avif",
    ),
    picture(
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00, 0x00,
      ]),
      "coverFront",
      "image/webp",
    ),
  ];
  for (const image of samples) {
    fake.images = [image];
    await expect(artwork(source)).resolves.toBeNull();
  }
  fake.images = undefined;
  await expect(artwork(source)).resolves.toBeNull();
  fake.images = [];
  await expect(artwork(source)).resolves.toBeNull();
});

test("a settled blob keeps the picture view and ignores later source edits", async () => {
  const payload = new Uint8Array([0xff, 0xd8, 0xff, 0x10, 0x20, 0x30]);
  const carrier = new Uint8Array(payload.length + 4);
  carrier.set([0xaa, 0xbb], 0);
  carrier.set(payload, 2);
  carrier.set([0xcc, 0xdd], 2 + payload.length);
  const view = carrier.subarray(2, 2 + payload.length);
  fake.images = [
    picture(view, "coverFront", "image/jpg", { name: "wide.bin", description: "offset" }),
  ];
  const cover = await artwork(source);
  view[0] = 0;
  carrier[0] = 1;
  carrier[2] = 2;
  carrier[carrier.length - 1] = 3;
  const copied = await imageBytes(cover!.blob);
  expect(copied).toEqual(payload);
  expect(cover?.blob.size).toBe(payload.length);
});

test("unknown options reject before an aborted signal opens an input", async () => {
  await expect(
    artwork(source, { kind: "front", signal: AbortSignal.abort() } as never),
  ).rejects.toMatchObject({ code: "INVALID_OPTIONS", phase: "preparing" });
  expect(fake.opened).toBe(0);
});

test("an aborted signal rejects before opening an input", async () => {
  await expect(artwork(source, { signal: AbortSignal.abort() })).rejects.toMatchObject({
    code: "ABORTED",
    phase: "preparing",
  });
  expect(fake.opened).toBe(0);
});

test("abort during a tag read with no pictures rejects aborted", async () => {
  const controller = new AbortController();
  fake.images = [];
  fake.tagsHook = async () => {
    controller.abort();
  };
  await expect(artwork(source, { signal: controller.signal })).rejects.toMatchObject({
    code: "ABORTED",
    phase: "preparing",
  });
});

test("a dispose failure after the copy still resolves the image", async () => {
  fake.failDispose = true;
  fake.images = [picture(jpeg, "coverFront", "image/jpeg")];
  const cover = await artwork(source);
  expect(cover).toMatchObject({ mimeType: "image/jpeg", kind: "front" });
  expect(await imageBytes(cover!.blob)).toEqual(jpeg);
  expect(fake.disposed).toBe(1);
});

test("metadata still rejects an images field", () => {
  expect(() => media(source).metadata({ images: "x" } as MetadataPatch)).toThrow(
    expect.objectContaining({ code: "UNSUPPORTED_METADATA_FIELD" }),
  );
  expect(fake.opened).toBe(0);
});

test("a generated file yields its front cover and probe still lists images", async () => {
  fake.useFake = false;
  const file = readFileSync("public/fixtures/artwork.mp3");
  const input = new Input({ formats: [MP3], source: new BufferSource(file) });
  try {
    const tags = await input.getMetadataTags();
    expect(tags.images?.map((image) => image.kind)).toEqual(["coverBack", "coverFront"]);
    const front = tags.images?.find((image) => image.kind === "coverFront");
    expect(front?.mimeType).toBe("image/jpeg");
    const mediaFile = new Blob([file]);
    const before = await probe(mediaFile);
    const cover = await artwork(mediaFile);
    expect(cover).toMatchObject({ mimeType: "image/jpeg", kind: "front" });
    expect(cover?.blob.type).toBe("image/jpeg");
    expect(await imageBytes(cover!.blob)).toEqual(front!.data);
    const again = await artwork(mediaFile);
    expect(again?.blob).not.toBe(cover?.blob);
    expect(await imageBytes(again!.blob)).toEqual(front!.data);
    const after = await probe(mediaFile);
    expect(after).toEqual(before);
    expect(before.omittedSourceFields).toContain("images");
    const wav = new Blob([readFileSync("public/fixtures/audio.wav")]);
    await expect(artwork(wav)).resolves.toBeNull();
  } finally {
    input.dispose();
  }
});
