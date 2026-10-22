import type { AttachedImage, Input } from "mediabunny";
import { normalizeSource, object } from "./config.ts";
import { openInput, readable, signalOption } from "./input.ts";
import { Scope } from "./scope.ts";
import type { EmbeddedPictureOptions, MediaInput } from "./types.ts";

type Pattern = readonly (number | null)[];
type PictureView = { data: Uint8Array; kind: AttachedImage["kind"] };

const ascii = (text: string): Pattern => Array.from(text, (char) => char.charCodeAt(0));

const patterns: readonly Pattern[] = [
  [0xff, 0xd8, 0xff],
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  ascii("GIF87a"),
  ascii("GIF89a"),
  [...ascii("RIFF"), null, null, null, null, ...ascii("WEBPVP")],
  ascii("BM"),
];

const ranks: Record<AttachedImage["kind"], number> = {
  coverFront: 0,
  unknown: 1,
  coverBack: 2,
};

function isPicture(bytes: Uint8Array): boolean {
  return patterns.some(
    (pattern) =>
      pattern.length <= bytes.length &&
      pattern.every((byte, index) => byte === null || bytes[index] === byte),
  );
}

function pick(images: readonly PictureView[]): Uint8Array | null {
  let best: { data: Uint8Array; rank: number } | null = null;
  for (const image of images) {
    if (!isPicture(image.data)) continue;
    const rank = ranks[image.kind];
    if (!best || rank < best.rank) best = { data: image.data, rank };
    if (rank === 0) break;
  }
  return best?.data ?? null;
}

export async function getEmbeddedPicture(
  source: MediaInput,
  options: EmbeddedPictureOptions = {},
): Promise<Uint8Array<ArrayBuffer> | null> {
  const opts = object(options, ["signal"]);
  signalOption(opts.signal);
  const normalized = normalizeSource(source);
  const scope = new Scope(opts.signal);
  let input: Input | undefined;
  try {
    input = openInput(normalized, scope);
    await readable(input, scope);
    const tags = await scope.wait(input.getMetadataTags(), "READ_FAILED");
    const selected = pick(
      (tags.images ?? []).map((image) => ({ data: image.data, kind: image.kind })),
    );
    const picture = selected ? selected.slice() : null;
    scope.check();
    return picture;
  } catch (error) {
    throw scope.fail(error, "READ_FAILED");
  } finally {
    try {
      input?.dispose();
    } catch (error) {
      scope.cleanupError(error);
    }
    await scope.finish();
  }
}
