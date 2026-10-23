import { MediaError } from "./errors.ts";

export type Raster = OffscreenCanvas | HTMLCanvasElement;

export function createCanvas(width: number, height: number): Raster {
  if (
    typeof OffscreenCanvas !== "undefined" &&
    typeof OffscreenCanvas.prototype.convertToBlob === "function"
  )
    return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const result = document.createElement("canvas");
    if (typeof result.toBlob === "function") {
      result.width = width;
      result.height = height;
      return result;
    }
  }
  throw new MediaError("IMAGE_ENCODING_UNAVAILABLE", "Canvas image encoding is unavailable.", {
    phase: "processing",
  });
}

export function encodeCanvas(canvas: Raster, type: string, quality?: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
