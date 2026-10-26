import {
  getClosestKeyFrameImage,
  getKeyFrameCount,
  getKeyFrameImages,
  type KeyFrameCountOptions,
  type KeyFrameImage,
  type KeyFrameImageOptions,
  type KeyFrameImagesOptions,
  type MediaInput,
} from "fluentbunny";

export async function consumer(source: MediaInput) {
  const closestOptions: KeyFrameImageOptions = { time: 1, width: 160, type: "image/png" };
  const rangeOptions: KeyFrameImagesOptions = { start: 0, end: 10, height: 90 };
  const countOptions: KeyFrameCountOptions = { start: 0, track: "primary" };
  const image: KeyFrameImage | null = await getClosestKeyFrameImage(source, closestOptions);
  const images: AsyncGenerator<KeyFrameImage, void, unknown> = getKeyFrameImages(
    source,
    rangeOptions,
  );
  const all: AsyncGenerator<KeyFrameImage, void, unknown> = getKeyFrameImages(source);
  const total: number = await getKeyFrameCount(source, countOptions);
  if (image) {
    const blob: Blob = image.blob;
    void blob;
    // @ts-expect-error Keyframe images do not repeat the requested time.
    void image.requestedTime;
  }
  for await (const item of images) void item.sourceTimestamp;
  void all;
  void total;
  // @ts-expect-error The closest keyframe requires a time.
  void getClosestKeyFrameImage(source, { width: 16 });
  // @ts-expect-error Counting keyframes does not accept image dimensions.
  void getKeyFrameCount(source, { width: 16 });
  return image;
}
