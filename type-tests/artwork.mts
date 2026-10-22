import {
  artwork,
  thumbnail,
  type ArtworkImage,
  type ArtworkOptions,
  type MediaInput,
} from "../dist/index.mjs";

export async function consumer(source: MediaInput, signal: AbortSignal) {
  const options: ArtworkOptions = { signal };
  const cover: ArtworkImage | null = await artwork(source, options);
  const shown: Blob | undefined = (cover ?? (await thumbnail(source, { time: 2 })))?.blob;
  // @ts-expect-error Cover selection is fixed; there is no kind filter.
  void artwork(source, { kind: "front" });
  if (cover) {
    const exhaustive = (
      {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/bmp": ".bmp",
      } satisfies Record<ArtworkImage["mimeType"], string>
    )[cover.mimeType];
    void exhaustive;
  }
  return shown;
}
