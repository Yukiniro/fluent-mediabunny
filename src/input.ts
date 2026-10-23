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
  EncodedPacketSink,
  UnsupportedInputFormatError,
} from "mediabunny";
import type { InputTrack, InputVideoTrack } from "mediabunny";
import { normalizeSource, object, oneOf, trackSelection } from "./config.ts";
import { MediaError, invalid } from "./errors.ts";
import { Scope } from "./scope.ts";
import { resolveMetadata } from "./metadata.ts";
import type {
  MediaInput,
  ProbeFrameRate,
  ProbeOptions,
  ProbeResult,
  ProbeTrack,
  TrackInfo,
  TrackSelection,
} from "./types.ts";

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
export function frameRateFromTimestamps(stamps: readonly number[]): number | null {
  if (stamps.length < 2) return null;
  const sorted = Float64Array.from(stamps).sort();
  let count = 1;
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index] !== sorted[count - 1]) sorted[count++] = sorted[index]!;
  }
  if (count < 2) return null;
  const span = sorted[count - 1]! - sorted[0]!;
  if (!(span > 0)) return null;
  return (count - 1) / span;
}
export async function selectTracks(
  input: Input,
  tracks: InputTrack[],
  kind: "video" | "audio",
  selection: TrackSelection = "all",
) {
  const matching = tracks.filter((track) =>
    kind === "video" ? track.isVideoTrack() : track.isAudioTrack(),
  );
  if (selection === false) return [];
  if (selection === "all") return matching;
  if (selection === "primary") {
    const track = await (kind === "video"
      ? input.getPrimaryVideoTrack()
      : input.getPrimaryAudioTrack());
    return track ? [track] : [];
  }
  if (selection.some((id) => !matching.some((track) => track.id === id)))
    invalid("Selected track ID does not exist for its media type.");
  return matching.filter((track) => selection.includes(track.id));
}
async function packetRate(track: InputVideoTrack, scope: Scope): Promise<ProbeFrameRate> {
  const sink = new EncodedPacketSink(track);
  const stamps: number[] = [];
  // 256 packets is the sample target. It is not a byte or time budget.
  for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
    scope.check();
    stamps.push(packet.timestamp);
    if (stamps.length >= 256) break;
  }
  const hertz = frameRateFromTimestamps(stamps);
  // Mediabunny substitutes its timebase when fewer than two timestamps exist. That number is not a frame rate.
  return hertz === null ? { hertz: null, origin: "unknown" } : { hertz, origin: "estimated" };
}
async function probeTrack(
  track: InputTrack,
  scope: Scope,
  scan: boolean,
  estimate: boolean,
): Promise<ProbeTrack> {
  const info = await trackInfo(track);
  const packet = await scope.wait(
    new EncodedPacketSink(track).getFirstPacket({ metadataOnly: true }),
    "READ_FAILED",
  );
  const startSeconds = packet ? packet.timestamp : null;
  const endSeconds =
    startSeconds === null
      ? null
      : await scope.wait(
          scan ? track.computeDuration() : track.getDurationFromMetadata(),
          "READ_FAILED",
        );
  const disposition = await scope.wait(track.getDisposition(), "READ_FAILED");
  const timing = {
    startSeconds,
    endSeconds,
    elapsedSeconds: startSeconds !== null && endSeconds !== null ? endSeconds - startSeconds : null,
    default: disposition.default,
    averageBitrate: await scope.wait(track.getAverageBitrate(), "READ_FAILED"),
    peakBitrate: await scope.wait(track.getBitrate(), "READ_FAILED"),
  };
  if (track.isVideoTrack())
    return {
      ...info,
      ...timing,
      type: "video",
      width: info.width ?? (await scope.wait(track.getDisplayWidth(), "READ_FAILED")),
      height: info.height ?? (await scope.wait(track.getDisplayHeight(), "READ_FAILED")),
      codedWidth: await scope.wait(track.getCodedWidth(), "READ_FAILED"),
      codedHeight: await scope.wait(track.getCodedHeight(), "READ_FAILED"),
      rotation: await scope.wait(track.getRotation(), "READ_FAILED"),
      frameRate: estimate ? await packetRate(track, scope) : { hertz: null, origin: "unknown" },
    };
  if (!track.isAudioTrack())
    throw new MediaError("UNSUPPORTED_INPUT", "Only audio/video track information is exposed.");
  const code = await scope.wait(track.getLanguageCode(), "READ_FAILED");
  return {
    ...info,
    ...timing,
    type: "audio",
    sampleRate: info.sampleRate ?? (await scope.wait(track.getSampleRate(), "READ_FAILED")),
    channels: info.channels ?? (await scope.wait(track.getNumberOfChannels(), "READ_FAILED")),
    // ISO 639-2 "und" means the container did not state a language.
    language: code && code !== "und" ? code : null,
    name: await scope.wait(track.getName(), "READ_FAILED"),
  };
}
export async function probe(source: MediaInput, options: ProbeOptions = {}): Promise<ProbeResult> {
  const opts = object(options, ["signal", "duration", "video", "audio", "frameRate"]);
  signalOption(opts.signal);
  if (opts.duration !== undefined) oneOf(opts.duration, ["metadata", "scan"], "duration mode");
  if (opts.frameRate !== undefined) oneOf(opts.frameRate, ["estimate"], "frame rate mode");
  const video = opts.video === undefined ? "all" : trackSelection(opts.video);
  const audio = opts.audio === undefined ? "all" : trackSelection(opts.audio);
  const scope = new Scope(opts.signal);
  let input: Input | undefined;
  try {
    input = openInput(source, scope);
    await readable(input, scope);
    const all = await scope.wait(input.getTracks(), "READ_FAILED");
    const picked = new Set(
      [
        ...(await selectTracks(input, all, "video", video)),
        ...(await selectTracks(input, all, "audio", audio)),
      ].map((track) => track.id),
    );
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
        Promise.all(
          all
            .filter(
              (track) => (track.isAudioTrack() || track.isVideoTrack()) && picked.has(track.id),
            )
            .map((track) =>
              probeTrack(track, scope, opts.duration === "scan", opts.frameRate === "estimate"),
            ),
        ),
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
