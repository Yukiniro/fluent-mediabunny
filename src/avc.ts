import { EncodedPacketSink, type InputVideoTrack } from "mediabunny";
import { MediaError } from "./errors.ts";
import type { Scope } from "./scope.ts";

// Some decoders normalize changing AVC frames to the initial dimensions.
export async function validateAvcConfiguration(track: InputVideoTrack, scope: Scope) {
  if ((await scope.wait(track.getCodec())) !== "avc") return;
  const config = await scope.wait(track.getDecoderConfig());
  const description = config?.description;
  const fail = () => {
    throw new MediaError(
      "UNSUPPORTED_INPUT",
      "AVC transcoding requires a stable sequence configuration.",
    );
  };
  if (!description) return fail();
  const bytes = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description);
  if (bytes.length < 7 || bytes[0] !== 1) return fail();
  const lengthSize = (bytes[4]! & 3) + 1;
  const count = bytes[5]! & 31;
  if (!count) return fail();
  let offset = 6;
  let sequence: Uint8Array | undefined;
  const check = (nal: Uint8Array) => {
    if (!sequence) sequence = nal.slice();
    else if (nal.length !== sequence.length || nal.some((byte, i) => byte !== sequence![i])) fail();
  };
  for (let i = 0; i < count; i++) {
    if (offset + 2 > bytes.length) return fail();
    const length = bytes[offset]! * 256 + bytes[offset + 1]!;
    offset += 2;
    if (!length || offset + length > bytes.length || (bytes[offset]! & 31) !== 7) return fail();
    check(bytes.subarray(offset, offset + length));
    offset += length;
  }
  for await (const packet of new EncodedPacketSink(track).packets()) {
    scope.check();
    for (let offset = 0; offset < packet.data.length;) {
      if (offset + lengthSize > packet.data.length) return fail();
      let length = 0;
      for (let i = 0; i < lengthSize; i++) length = length * 256 + packet.data[offset++]!;
      if (!length || offset + length > packet.data.length) return fail();
      if ((packet.data[offset]! & 31) === 7) check(packet.data.subarray(offset, offset + length));
      offset += length;
    }
  }
}
