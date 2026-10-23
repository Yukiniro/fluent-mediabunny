export function wav(
  channels: readonly (readonly number[])[],
  sampleRate = 8000,
): Uint8Array<ArrayBuffer> {
  const frames = channels[0]!.length;
  const bytes = new Uint8Array(44 + frames * channels.length * 4);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * 4, true);
  view.setUint16(32, channels.length * 4, true);
  view.setUint16(34, 32, true);
  text(36, "data");
  view.setUint32(40, bytes.length - 44, true);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels.length; c++)
      view.setFloat32(44 + (i * channels.length + c) * 4, channels[c]![i]!, true);
  return bytes;
}
