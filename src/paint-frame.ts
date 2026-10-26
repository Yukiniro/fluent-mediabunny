import type { VideoSample } from "mediabunny";
import { MediaError } from "./errors.ts";
import { createCanvas, encodeCanvas, type Raster } from "./image.ts";
import type { Scope } from "./scope.ts";
import type { KeyFrameImage } from "./types.ts";

export async function paintFrame(
  sample: VideoSample,
  options: {
    width?: number;
    height?: number;
    fit?: "contain" | "cover" | "fill";
    type: "image/jpeg" | "image/png";
    quality: number;
    trackId: number;
    origin: number;
    codedWidth: number;
    codedHeight: number;
    fallbackAspect: number;
  },
  scope: Scope,
  slot: { canvas?: Raster },
  closeSample: () => void,
): Promise<KeyFrameImage> {
  // Some decoders omit container pixel aspect ratio from their VideoFrame metadata.
  const aspect =
    sample.pixelAspectRatio.num === sample.pixelAspectRatio.den &&
    sample.codedWidth === options.codedWidth &&
    sample.codedHeight === options.codedHeight
      ? options.fallbackAspect
      : 1;
  const sw = sample.displayWidth * (sample.rotation % 180 === 0 ? aspect : 1),
    sh = sample.displayHeight * (sample.rotation % 180 === 0 ? 1 : aspect);
  if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw <= 0 || sh <= 0)
    throw new MediaError("UNSUPPORTED_INPUT", "Invalid frame geometry.", { phase: scope.phase });
  const width =
    options.width ??
    Math.max(1, Math.round(options.height === undefined ? sw : (options.height * sw) / sh));
  const height =
    options.height ??
    Math.max(1, Math.round(options.width === undefined ? sh : (options.width * sh) / sw));
  if (width > 4096 || height > 4096 || width * height > 16_000_000)
    throw new MediaError("OUTPUT_TOO_LARGE", "Resolved image exceeds output limits.", {
      phase: scope.phase,
    });
  slot.canvas ??= createCanvas(width, height);
  const surface = slot.canvas;
  surface.width = width;
  surface.height = height;
  const context = surface.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!context)
    throw new MediaError("IMAGE_ENCODING_UNAVAILABLE", "Canvas 2D rendering is unavailable.", {
      phase: scope.phase,
    });
  const scale =
    options.fit === "contain"
      ? Math.min(width / sw, height / sh)
      : Math.max(width / sw, height / sh);
  const dw = !options.fit || options.fit === "fill" ? width : sw * scale;
  const dh = !options.fit || options.fit === "fill" ? height : sh * scale;
  sample.draw(context, (width - dw) / 2, (height - dh) / 2, dw, dh);
  if (options.type === "image/jpeg") {
    if (sample.hasAlpha !== false) {
      // CPU composition avoids accelerated VideoFrame alpha blending differences.
      const pixels = context.getImageData(0, 0, width, height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const alpha = pixels.data[i + 3]! / 255;
        for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.round(pixels.data[i + c]! * alpha);
        pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
    } else {
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "black";
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = "source-over";
    }
  }
  const timing = {
    sourceTimestamp: sample.timestamp,
    durationSeconds: sample.duration,
    actualTime: sample.timestamp - options.origin,
  };
  closeSample();
  const blob = await scope.wait(encodeCanvas(surface, options.type, options.quality));
  if (!blob || !blob.size)
    throw new MediaError("PROCESSING_FAILED", "Image encoder returned no data.", {
      phase: scope.phase,
    });
  if (blob.type !== options.type)
    throw new MediaError(
      "IMAGE_ENCODING_UNAVAILABLE",
      "Image encoder substituted the requested MIME type.",
      { phase: scope.phase },
    );
  return {
    blob,
    mimeType: options.type,
    width,
    height,
    trackId: options.trackId,
    timeOriginSeconds: options.origin,
    ...timing,
  };
}
