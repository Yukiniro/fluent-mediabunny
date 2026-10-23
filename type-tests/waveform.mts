import {
  getWaveformData,
  renderWaveform,
  probe,
  type MediaInput,
  type ProbeOptions,
  type ProbeTrackInfo,
  type WaveformOptions,
  type WaveformData,
  type WaveformChannel,
  type WaveformImageOptions,
  type WaveformImage,
} from "../dist/index.mjs";

export async function consumer(source: MediaInput) {
  const options: ProbeOptions = { tracks: { video: "primary", audio: [2] }, frameRate: "estimate" };
  const info: ProbeTrackInfo[] = (await probe(source, options)).tracks;
  const request: WaveformOptions = { track: "primary", start: 0, end: 10, pointsPerSecond: 50 };
  const data: WaveformData = await getWaveformData(source, request);
  const channel: WaveformChannel = data.channels[0]!;
  const min: Float32Array<ArrayBuffer> = channel.min;
  const imageOptions: WaveformImageOptions = { width: 800, height: 120, color: "#123456" };
  const image: WaveformImage = await renderWaveform(data, imageOptions);
  const png: Blob = image.blob;
  // @ts-expect-error Image width and height are both required.
  void renderWaveform(data, { width: 100 });
  // @ts-expect-error Only one audio track can be selected.
  void getWaveformData(source, { track: [1, 2] });
  // @ts-expect-error Probe ranges are not supported.
  void probe(source, { start: 0, end: 1 });
  return { info, min, png };
}
