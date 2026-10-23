import { MediaError } from "./errors.ts";

export type Canvas = OffscreenCanvas | HTMLCanvasElement;
export function canvas(width: number, height: number): Canvas {
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
export function encode(canvas: Canvas, type: string, quality?: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
