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
  EncodedPacketSink,
} from "mediabunny";
import type { InputTrack } from "mediabunny";
import { normalizeSource, object, oneOf, tracksOptions } from "./config.ts";
import { MediaError, invalid } from "./errors.ts";
import { Scope } from "./scope.ts";
import { resolveMetadata } from "./metadata.ts";
import type {
  MediaInput,
  ProbeOptions,
  ProbeResult,
  TrackInfo,
  TrackSelection,
  ProbeTrackInfo,
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
export async function selectTracks(
  input: Input,
  tracks: InputTrack[],
  kind: "video" | "audio",
  selection: TrackSelection = "all",
) {
  const matching = tracks.filter((t) => (kind === "video" ? t.isVideoTrack() : t.isAudioTrack()));
  if (selection === false) return [];
  if (selection === "all") return matching;
  if (selection === "primary") {
    const track = await (kind === "video"
      ? input.getPrimaryVideoTrack()
      : input.getPrimaryAudioTrack());
    return track ? [track] : [];
  }
  if (selection.some((id) => !matching.some((t) => t.id === id)))
    invalid("Selected track ID does not exist for its media type.");
  return matching.filter((t) => selection.includes(t.id));
}
async function probeTrack(track: InputTrack, options: ProbeOptions): Promise<ProbeTrackInfo> {
  const first = await new EncodedPacketSink(track).getFirstPacket({ metadataOnly: true });
  const startTimestamp = first?.timestamp ?? null;
  const endTimestamp = first
    ? await (options.duration === "scan"
        ? track.computeDuration()
        : track.getDurationFromMetadata())
    : null;
  const language = await track.getLanguageCode();
  const info: ProbeTrackInfo = {
    ...(await trackInfo(track)),
    language: language === "und" ? null : language,
    name: await track.getName(),
    isDefault: !!(await track.getDisposition()).default,
    peakBitrate: await track.getBitrate(),
    averageBitrate: await track.getAverageBitrate(),
    startTimestamp,
    endTimestamp,
    durationSeconds:
      startTimestamp === null || endTimestamp === null
        ? null
        : Math.max(0, endTimestamp - startTimestamp),
    durationOrigin:
      endTimestamp === null ? "unknown" : options.duration === "scan" ? "scanned" : "metadata",
  };
  if (track.isVideoTrack()) {
    info.codedWidth = await track.getCodedWidth();
    info.codedHeight = await track.getCodedHeight();
    info.rotation = await track.getRotation();
    info.frameRate = null;
    if (options.frameRate === "estimate") {
      // Require distinct timestamps instead of the backend's time-resolution fallback.
      const timestamps = new Set<number>();
      let count = 0,
        max = -Infinity,
        min = Infinity;
      for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, {
        metadataOnly: true,
      })) {
        if (count >= 256 && packet.timestamp >= max) break;
        count++;
        timestamps.add(packet.timestamp);
        min = Math.min(min, packet.timestamp);
        max = Math.max(max, packet.timestamp);
      }
      const estimate = (timestamps.size - 1) / (max - min);
      if (timestamps.size >= 2 && Number.isFinite(estimate) && estimate > 0)
        info.frameRate = estimate;
    }
    info.frameRateOrigin = info.frameRate === null ? "unknown" : "estimated";
  }
  return info;
}
export async function probe(source: MediaInput, options: ProbeOptions = {}): Promise<ProbeResult> {
  const opts = object(options, ["signal", "duration", "tracks", "frameRate"]);
  signalOption(opts.signal);
  if (opts.duration !== undefined) oneOf(opts.duration, ["metadata", "scan"], "duration mode");
  if (opts.frameRate !== undefined) oneOf(opts.frameRate, ["estimate"], "frame rate mode");
  const selection = tracksOptions(opts.tracks === undefined ? {} : opts.tracks);
  const scope = new Scope(opts.signal);
  let input: Input | undefined;
  try {
    input = openInput(source, scope);
    await readable(input, scope);
    const tracks = await scope.wait(input.getTracks(), "READ_FAILED");
    const selected = [
      ...(await scope.wait(selectTracks(input, tracks, "video", selection.video), "READ_FAILED")),
      ...(await scope.wait(selectTracks(input, tracks, "audio", selection.audio), "READ_FAILED")),
    ];
    if (!selected.length) throw new MediaError("NO_TRACKS", "No tracks selected.");
    const duration = await scope.wait(
      opts.duration === "scan" ? input.computeDuration() : input.getDurationFromMetadata(),
      "READ_FAILED",
    );
    const metadata = resolveMetadata(await scope.wait(input.getMetadataTags(), "READ_FAILED"));
    const info = await Promise.allSettled(
      tracks
        .filter((t) => selected.includes(t))
        .map(async (t) => {
          try {
            return await probeTrack(t, opts as ProbeOptions);
          } catch (error) {
            throw scope.fail(error, "READ_FAILED");
          }
        }),
    );
    scope.check();
    const result: ProbeResult = {
      container: (await input.getFormat()).name,
      durationSeconds: duration,
      durationOrigin:
        duration === null ? "unknown" : opts.duration === "scan" ? "scanned" : "metadata",
      tracks: info.map((item) => {
        if (item.status === "rejected") throw item.reason;
        return item.value;
      }),
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
