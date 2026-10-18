import { StreamTarget } from "mediabunny";
import type { StreamTargetChunk } from "mediabunny";
import { MediaError } from "./errors.ts";
import { Scope } from "./scope.ts";
import type { FileTarget, Format, TargetState } from "./types.ts";

const occupied = new Set<FileSystemFileHandle>();
let leaseQueue = Promise.resolve();
async function acquire(handle: FileSystemFileHandle): Promise<() => void> {
  const previous = leaseQueue;
  let releaseQueue!: () => void;
  leaseQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previous;
  try {
    for (const active of occupied)
      if (handle === active || (await handle.isSameEntry(active)))
        throw new MediaError("TARGET_BUSY", "Another task owns this output file.");
    occupied.add(handle);
    return () => {
      occupied.delete(handle);
    };
  } finally {
    releaseQueue();
  }
}
export function checkSize(
  format: Format,
  end: number,
  phase: "preparing" | "processing" = "processing",
) {
  if (!Number.isSafeInteger(end) || end < 0 || (format === "wav" && end > 0xffffffff))
    throw new MediaError("OUTPUT_TOO_LARGE", "Output exceeds the supported length.", { phase });
}

/** This stream's close is NOT the file commit. Only commit() closes the real file. */
export class OutputSink {
  readonly target: StreamTarget;
  size = 0;
  targetState: TargetState = "untouched";
  private stream?: FileSystemWritableFileStream;
  private release?: () => void;
  private abortPromise?: Promise<void>;
  private chunks: StreamTargetChunk[] = [];
  constructor(
    format: Format,
    private scope: Scope,
    readonly file?: FileTarget,
  ) {
    if (file) {
      const handle = file.handle;
      if (
        !handle ||
        handle.kind !== "file" ||
        typeof handle.name !== "string" ||
        ["queryPermission", "createWritable", "isSameEntry"].some(
          (k) => typeof Reflect.get(handle, k) !== "function",
        )
      )
        throw new MediaError(
          "TARGET_UNSUPPORTED",
          "File target requires a file handle with permission queries and writable streams.",
        );
    }
    this.target = new StreamTarget(
      new WritableStream<StreamTargetChunk>({
        write: async (chunk) => {
          try {
            scope.check();
            checkSize(format, chunk.position + chunk.data.byteLength);
            if (file) {
              if (!this.stream)
                throw new MediaError("WRITE_FAILED", "Output file has not been opened.", {
                  phase: scope.phase,
                });
              await this.stream.write({
                type: "write",
                position: chunk.position,
                data: chunk.data as Uint8Array<ArrayBuffer>,
              });
            } else this.chunks.push({ ...chunk, data: chunk.data.slice() });
            this.size = Math.max(this.size, chunk.position + chunk.data.byteLength);
          } catch (e) {
            throw scope.fail(e, "WRITE_FAILED");
          }
        },
        close: () => {},
      }),
      { chunked: true, chunkSize: 1024 * 1024 },
    );
    scope.onStop(() => this.abort());
  }
  async open() {
    if (!this.file) return;
    const handle = this.file.handle;
    if (
      (await this.scope.wait(
        handle.queryPermission({ mode: "readwrite" }),
        "PERMISSION_REQUIRED",
      )) !== "granted"
    )
      throw new MediaError("PERMISSION_REQUIRED", "Grant file read/write permission before run().");
    this.release = await acquire(handle);
    this.scope.check();
    // Capture a late-arriving stream even when cancellation happened during creation.
    this.stream = await handle.createWritable({ keepExistingData: false });
    this.targetState = "unknown";
    if (this.scope.failure) {
      await this.abort();
      this.scope.check();
    }
  }
  async abort() {
    if (this.scope.phase === "committing") return;
    this.chunks = [];
    if (!this.stream) return;
    this.abortPromise ??= this.stream.abort(this.scope.failure).then(
      () => {
        this.targetState = "aborted";
      },
      (e) => {
        this.targetState = "unknown";
        throw e;
      },
    );
    await this.abortPromise;
  }
  async commit(mimeType: string): Promise<Blob | undefined> {
    this.scope.commit();
    if (this.stream) {
      try {
        await this.stream.close();
      } catch (e) {
        this.targetState = "unknown";
        throw this.scope.fail(e, "WRITE_FAILED");
      }
      return undefined;
    }
    const bytes = new Uint8Array(this.size);
    for (const chunk of this.chunks) bytes.set(chunk.data, chunk.position);
    this.chunks = [];
    return new Blob([bytes], { type: mimeType });
  }
  releaseLease() {
    this.release?.();
    this.release = undefined;
  }
}
