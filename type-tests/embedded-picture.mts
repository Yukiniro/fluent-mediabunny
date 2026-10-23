import { getEmbeddedPicture, type EmbeddedPictureOptions, type MediaInput } from "fluentbunny";

export async function consumer(source: MediaInput, signal: AbortSignal) {
  const options: EmbeddedPictureOptions = { signal };
  const picture: Uint8Array<ArrayBuffer> | null = await getEmbeddedPicture(source, options);
  // @ts-expect-error The call returns picture bytes. There is no kind filter.
  void getEmbeddedPicture(source, { kind: "front" });
  return picture;
}
