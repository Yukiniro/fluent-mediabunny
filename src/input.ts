import {
  Input,
  BlobSource,
  BufferSource,
  UrlSource,
  MP4,
  QTFF,
  WEBM,
  MATROSKA,
  MP3,
  WAVE,
  OGG,
  FLAC,
  ADTS,
  UnsupportedInputFormatError,
} from "mediabunny";
import type { InputTrack } from "mediabunny";
import { normalizeSource, object, oneOf } from "./config.ts";
import { MediaError, invalid } from "./errors.ts";
import { Scope } from "./scope.ts";
import { resolveMetadata } from "./metadata.ts";
import type { MediaInput, ProbeOptions, ProbeResult, TrackInfo } from "./types.ts";

export function signalOption(signal: unknown): asserts signal is AbortSignal | undefined {
  if (signal !== undefined && !(signal instanceof AbortSignal))
    invalid("signal must be an AbortSignal.");
}
export function openInput(source: MediaInput, scope: Scope): Input {
  scope.check();
  const normalized = normalizeSource(source);
  const input = new Input({
    formats: [MP4, QTFF, WEBM, MATROSKA, MP3, WAVE, OGG, FLAC, ADTS],
    source:
      typeof normalized === "string"
        ? new UrlSource(normalized, {
            requestInit: { credentials: "omit", mode: "cors" },
            getRetryDelay: () => null,
            fetchFn: async (...args) => {
              try {
                return await fetch(...args);
              } catch (e) {
                throw scope.fail(e, "READ_FAILED");
              }
            },
            handleUnhandledError: (e) => {
              scope.fail(e, "READ_FAILED");
            },
          })
        : normalized instanceof Blob
          ? new BlobSource(normalized)
          : new BufferSource(normalized),
  });
  scope.onStop(() => input.dispose());
  return input;
}
export async function readable(input: Input, scope: Scope) {
  try {
    await input.getFormat();
  } catch (e) {
    if (e instanceof UnsupportedInputFormatError)
      throw new MediaError("UNSUPPORTED_INPUT", "Input container is unsupported or unrecognized.", {
        cause: e,
      });
    throw scope.fail(e, "READ_FAILED");
  }
  scope.check();
}
export async function trackInfo(track: InputTrack): Promise<TrackInfo> {
  if (track.isVideoTrack())
    return {
      id: track.id,
      type: "video",
      codec: await track.getCodec(),
      width: await track.getDisplayWidth(),
      height: await track.getDisplayHeight(),
    };
  if (track.isAudioTrack())
    return {
      id: track.id,
      type: "audio",
      codec: await track.getCodec(),
      sampleRate: await track.getSampleRate(),
      channels: await track.getNumberOfChannels(),
    };
  throw new MediaError("UNSUPPORTED_INPUT", "Only audio/video track information is exposed.");
}
export async function probe(source: MediaInput, options: ProbeOptions = {}): Promise<ProbeResult> {
  const opts = object(options, ["signal", "duration"]);
  signalOption(opts.signal);
  if (opts.duration !== undefined) oneOf(opts.duration, ["metadata", "scan"], "duration mode");
  const scope = new Scope(opts.signal);
  let input: Input | undefined;
  try {
    input = openInput(source, scope);
    await readable(input, scope);
    const tracks = await scope.wait(input.getTracks(), "READ_FAILED");
    const duration = await scope.wait(
      opts.duration === "scan" ? input.computeDuration() : input.getDurationFromMetadata(),
      "READ_FAILED",
    );
    const metadata = resolveMetadata(await scope.wait(input.getMetadataTags(), "READ_FAILED"));
    const result: ProbeResult = {
      container: (await input.getFormat()).name,
      durationSeconds: duration,
      durationOrigin:
        duration === null ? "unknown" : opts.duration === "scan" ? "scanned" : "metadata",
      tracks: await scope.wait(
        Promise.all(tracks.filter((t) => t.isAudioTrack() || t.isVideoTrack()).map(trackInfo)),
        "READ_FAILED",
      ),
      metadata: metadata.report.values,
      omittedSourceFields: metadata.report.omittedSourceFields,
    };
    scope.check();
    return result;
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
