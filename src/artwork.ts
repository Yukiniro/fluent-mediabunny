import type { AttachedImage, Input } from "mediabunny";
import { normalizeSource, object } from "./config.ts";
import { openInput, readable, signalOption } from "./input.ts";
import { Scope } from "./scope.ts";
import type { ArtworkImage, ArtworkOptions, MediaInput } from "./types.ts";

type Pattern = readonly (number | null)[];
type PictureView = { data: Uint8Array; kind: AttachedImage["kind"] };
type Selected = {
  data: Uint8Array;
  mimeType: ArtworkImage["mimeType"];
  kind: ArtworkImage["kind"];
};

const ascii = (text: string): Pattern => Array.from(text, (char) => char.charCodeAt(0));

const signatures: Record<ArtworkImage["mimeType"], readonly Pattern[]> = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/gif": [ascii("GIF87a"), ascii("GIF89a")],
  "image/webp": [[...ascii("RIFF"), null, null, null, null, ...ascii("WEBPVP")]],
  "image/bmp": [ascii("BM")],
};

const roles: Record<AttachedImage["kind"], { kind: ArtworkImage["kind"]; rank: number }> = {
  coverFront: { kind: "front", rank: 0 },
  unknown: { kind: "unspecified", rank: 1 },
  coverBack: { kind: "back", rank: 2 },
};

function sniffMime(bytes: Uint8Array): ArtworkImage["mimeType"] | null {
  for (const mimeType of Object.keys(signatures) as ArtworkImage["mimeType"][]) {
    const matched = signatures[mimeType].some(
      (pattern) =>
        pattern.length <= bytes.length &&
        pattern.every((byte, index) => byte === null || bytes[index] === byte),
    );
    if (matched) return mimeType;
  }
  return null;
}

function pick(images: readonly PictureView[]): Selected | null {
  let best: (Selected & { rank: number }) | null = null;
  for (const image of images) {
    const mimeType = sniffMime(image.data);
    if (!mimeType) continue;
    const role = roles[image.kind];
    if (!best || role.rank < best.rank)
      best = { data: image.data, mimeType, kind: role.kind, rank: role.rank };
    if (role.rank === 0) break;
  }
  if (!best) return null;
  return { data: best.data, mimeType: best.mimeType, kind: best.kind };
}

export async function artwork(
  source: MediaInput,
  options: ArtworkOptions = {},
): Promise<ArtworkImage | null> {
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
    const cover: ArtworkImage | null = selected
      ? {
          blob: new Blob([selected.data.slice()], { type: selected.mimeType }),
          mimeType: selected.mimeType,
          kind: selected.kind,
        }
      : null;
    scope.check();
    return cover;
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
