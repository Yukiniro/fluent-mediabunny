import type { ErrorCode, Phase, TargetState } from "./types.ts";

export class MediaError extends Error {
  readonly code: ErrorCode;
  readonly phase: Phase;
  readonly details: Readonly<Record<string, unknown>>;
  readonly diagnostics: unknown[] = [];
  targetState?: TargetState;
  constructor(
    code: ErrorCode,
    message: string,
    options: {
      phase?: Phase;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "MediaError";
    this.code = code;
    this.phase = options.phase ?? "preparing";
    this.details = options.details ?? {};
  }
}
export function invalid(message: string): never {
  throw new MediaError("INVALID_OPTIONS", message);
}
export function mediaError(error: unknown, code: ErrorCode, phase: Phase): MediaError {
  return error instanceof MediaError
    ? error
    : new MediaError(code, `Media operation failed (${code}).`, { phase, cause: error });
}
