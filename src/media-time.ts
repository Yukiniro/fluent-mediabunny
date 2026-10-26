import { MediaError } from "./errors.ts";
import type { Phase } from "./types.ts";

export function micros(value: number, phase: Phase = "preparing"): number {
  const result = Math.round(value * 1_000_000);
  if (!Number.isSafeInteger(result))
    throw new MediaError("UNSUPPORTED_INPUT", "Unsafe media timestamp.", { phase });
  return result;
}
