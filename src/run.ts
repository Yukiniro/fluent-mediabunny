import { Conversion, Output } from "mediabunny";
import type { Input } from "mediabunny";
import { formats, object, validateConfig } from "./config.ts";
import { invalid, MediaError } from "./errors.ts";
import { openInput, readable, signalOption } from "./input.ts";
import { resolveMetadata } from "./metadata.ts";
import { prepare } from "./plan.ts";
import { Scope } from "./scope.ts";
import { OutputSink } from "./target.ts";
import type {
  Config,
  MediaInput,
  RunOptions,
  MediaResult,
  MediaReport,
  FileTarget,
} from "./types.ts";
export async function run(
  source: MediaInput,
  config: Config,
  options: RunOptions,
): Promise<MediaResult> {
  const opts = object(options, ["target", "signal", "onProgress"]);
  signalOption(opts.signal);
  if (opts.onProgress !== undefined && typeof opts.onProgress !== "function")
    invalid("onProgress must be a function.");
  const observer = opts.onProgress as RunOptions["onProgress"];
  const fileRequested = opts.target !== undefined && opts.target !== "blob";
  const scope = new Scope(opts.signal, observer);
  let input: Input | undefined,
    output: Output | undefined,
    conversion: Conversion | undefined,
    sink: OutputSink | undefined,
    report: MediaReport | undefined;
  const canceled = new Map<Conversion | Output, Promise<void>>();
  const cancel = (resource?: Conversion | Output) => {
    if (!resource) return Promise.resolve();
    let pending = canceled.get(resource);
    if (!pending) {
      pending = resource.cancel();
      canceled.set(resource, pending);
    }
    return pending;
  };
  try {
    scope.check();
    validateConfig(config);
    let file: FileTarget | undefined;
    if (opts.target !== undefined && opts.target !== "blob") {
      const target = object(opts.target, ["type", "handle"]);
      if (target.type !== "file") invalid("Invalid target.");
      file = target as FileTarget;
    }
    sink = new OutputSink(config.format, scope, file);
    scope.progress();
    scope.check();
    input = openInput(source, scope);
    await readable(input, scope);
    const plan = await prepare(input, config, scope),
      metadata = resolveMetadata(
        await scope.wait(input.getMetadataTags(), "READ_FAILED"),
        config.metadata,
      );
    if (metadata.report.omittedSourceFields.length)
      scope.warnings.push({
        code: "METADATA_OMITTED",
        message: "Unsupported source metadata was omitted.",
        fields: metadata.report.omittedSourceFields,
      });
    if (plan.nonAV)
      scope.warnings.push({
        code: "NON_AV_CONTENT_NOT_PRESERVED",
        message: "Non audio/video tracks were omitted.",
      });
    output = new Output({ format: formats[config.format].writer(), target: sink.target });
    scope.onStop(async () => {
      await cancel(conversion ?? output);
    });
    conversion = await Conversion.init({
      showWarnings: false,
      input,
      output,
      ...plan.options,
      trim: plan.trim,
      tags: metadata.tags,
      copy:
        config.mode === "copy"
          ? { mode: "forced" }
          : config.mode === "transcode" || config.trim
            ? false
            : { mode: "preferred" },
    });
    scope.check();
    if (
      !conversion.isValid ||
      conversion.utilizedTracks.length !== plan.selected.length ||
      plan.selected.some((t) => !conversion!.utilizedTracks.includes(t)) ||
      conversion.discardedTracks.some(
        ({ track, reason }) =>
          plan.selected.includes(track) ||
          ((track.isVideoTrack() || track.isAudioTrack()) && reason !== "discarded_by_user"),
      )
    )
      throw new MediaError("TRACK_LOSS", "Conversion did not retain every selected track.");
    report = {
      resolved: {
        format: config.format,
        mode: config.mode,
        tracks: plan.resolved,
        ...(plan.trim ? { trim: plan.trim } : {}),
      },
      selected: plan.selectedInfo,
      excludedByUser: plan.excluded,
      metadata: metadata.report,
      warnings: scope.warnings,
    };
    await scope.wait(sink.open(), "WRITE_FAILED");
    scope.phase = "processing";
    scope.progress();
    scope.check();
    if (observer)
      conversion.onProgress = (ratio) =>
        scope.progress(Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : null);
    await scope.wait(conversion.execute());
    scope.check();
    const hasVideo = plan.selectedInfo.some((t) => t.type === "video");
    const mimeType = `${hasVideo ? "video" : "audio"}/${formats[config.format].mimeSubtype}`;
    if (file && !file.handle.name.toLowerCase().endsWith(`.${config.format}`))
      scope.warnings.push({
        code: "FILENAME_EXTENSION_MISMATCH",
        message: "File extension differs from the chosen container.",
      });
    const blob = await sink.commit(mimeType);
    return file
      ? {
          kind: "file",
          filename: file.handle.name,
          mimeType,
          size: sink.size,
          commitState: "committed",
          report,
        }
      : {
          kind: "blob",
          blob: blob!,
          mimeType,
          size: sink.size,
          suggestedFilename: `output.${config.format}`,
          report,
        };
  } catch (e) {
    const error = scope.fail(e);
    if (fileRequested) error.targetState = sink?.targetState ?? "untouched";
    throw error;
  } finally {
    if (scope.failure) {
      for (const cleanup of [() => cancel(conversion ?? output), () => sink?.abort()])
        try {
          await cleanup();
        } catch (e) {
          scope.cleanupError(e);
        }
    }
    try {
      input?.dispose();
    } catch (e) {
      scope.cleanupError(e);
    }
    await scope.finish();
    sink?.releaseLease();
    if (scope.failure && fileRequested)
      scope.failure.targetState = sink?.targetState ?? "untouched";
    if (report) report.warnings = [...scope.warnings];
  }
}
