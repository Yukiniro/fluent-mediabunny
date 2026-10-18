import { MediaError, mediaError } from "./errors.ts";
import type { ErrorCode, Phase, RunOptions, Warning } from "./types.ts";

export class Scope {
  phase: Phase = "preparing";
  failure?: MediaError;
  readonly warnings: Warning[] = [];
  private ended = false;
  private stopping = false;
  private callback: RunOptions["onProgress"];
  private stopActions = new Set<() => void | Promise<void>>();
  private pending: Promise<void>[] = [];
  constructor(
    private signal?: AbortSignal,
    callback?: RunOptions["onProgress"],
  ) {
    this.callback = callback;
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }
  private abort = () => {
    if (this.ended || this.phase === "committing") return;
    this.fail(
      new MediaError("ABORTED", "Media operation canceled.", {
        phase: this.phase,
        cause: this.signal?.reason,
      }),
    );
  };
  fail(error: unknown, code: ErrorCode = "PROCESSING_FAILED"): MediaError {
    const failure = mediaError(error, code, this.phase);
    if (this.failure) {
      if (failure !== this.failure) this.failure.diagnostics.push(failure);
      return this.failure;
    }
    this.failure = failure;
    this.stopping = true;
    for (const action of this.stopActions) this.performStop(action);
    this.stopActions.clear();
    return failure;
  }
  private performStop(action: () => void | Promise<void>) {
    try {
      this.pending.push(
        Promise.resolve(action()).catch((e) => {
          this.failure?.diagnostics.push(e);
        }),
      );
    } catch (e) {
      this.failure?.diagnostics.push(e);
    }
  }
  onStop(action: () => void | Promise<void>): () => void {
    if (this.stopping) this.performStop(action);
    else this.stopActions.add(action);
    return () => {
      this.stopActions.delete(action);
    };
  }
  check() {
    if (this.failure) throw this.failure;
  }
  async wait<T>(operation: Promise<T>, code: ErrorCode = "PROCESSING_FAILED"): Promise<T> {
    try {
      const value = await operation;
      this.check();
      return value;
    } catch (error) {
      throw this.fail(error, code);
    }
  }
  progress(ratio: number | null = null) {
    if (this.ended || this.failure || !this.callback) return;
    try {
      const returned: unknown = this.callback({ phase: this.phase, ratio });
      if (returned && typeof (returned as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(returned).catch(() => {});
        this.disableCallback();
      }
    } catch {
      this.disableCallback();
    }
  }
  private disableCallback() {
    this.warnings.push({
      code: "CALLBACK_FAILED",
      message: "Progress observer threw or returned a Promise; observer disabled.",
    });
    this.callback = undefined;
  }
  commit() {
    this.check();
    this.phase = "committing";
    this.progress();
  }
  async finish() {
    this.ended = true;
    this.signal?.removeEventListener("abort", this.abort);
    this.stopActions.clear();
    for (let i = 0; i < this.pending.length; i++) await this.pending[i];
  }
  cleanupError(error: unknown) {
    if (this.failure) this.failure.diagnostics.push(error);
    else
      this.warnings.push({
        code: "CLEANUP_FAILED",
        message: "Output completed, but an input cleanup operation failed.",
      });
  }
}
