import { Input, ALL_FORMATS, UrlSource, VideoSampleSink } from "mediabunny";

export async function inspectSample(name: string) {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(new URL(`/fixtures/${name}`, location.href).href),
  });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    const sample = (await new VideoSampleSink(track).getSample(0))!;
    try {
      return {
        name,
        track: {
          coded: [await track.getCodedWidth(), await track.getCodedHeight()],
          display: [await track.getDisplayWidth(), await track.getDisplayHeight()],
          ratio: await track.getPixelAspectRatio(),
        },
        sample: {
          coded: [sample.codedWidth, sample.codedHeight],
          display: [sample.displayWidth, sample.displayHeight],
          visible: sample.visibleRect,
          ratio: sample.pixelAspectRatio,
          rotation: sample.rotation,
          flip: sample.flip,
        },
      };
    } finally {
      sample.close();
    }
  } finally {
    input.dispose();
  }
}
