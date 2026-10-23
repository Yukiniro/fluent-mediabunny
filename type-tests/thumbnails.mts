import {
  thumbnail,
  thumbnails,
  type MediaInput,
  type ThumbnailImage,
  type ThumbnailItem,
  type ThumbnailOptions,
  type ThumbnailsOptions,
  type ThumbnailImageOptions,
} from "fluentbunny";

export async function consumer(source: MediaInput) {
  const imageOptions: ThumbnailImageOptions = { width: 160, type: "image/png" };
  const single: ThumbnailOptions = { ...imageOptions, time: 1 };
  const batch: ThumbnailsOptions = { ...imageOptions, start: 0, end: 10, count: 5 };
  const image: ThumbnailImage | null = await thumbnail(source, single);
  const iterator: AsyncGenerator<ThumbnailItem, void, unknown> = thumbnails(source, batch);
  for await (const item of iterator) {
    const blob: Blob | undefined = item.image?.blob;
    void blob;
  }
  // @ts-expect-error Explicit timestamps and intervals are mutually exclusive.
  thumbnails(source, { times: [0], start: 0, end: 1, count: 1 });
  // @ts-expect-error A single thumbnail requires a time.
  void thumbnail(source, imageOptions);
  return image;
}
