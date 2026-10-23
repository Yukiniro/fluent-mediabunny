import {
  Conversion,
  Output,
  NullTarget,
  Mp4OutputFormat,
  WebMOutputFormat,
  WavOutputFormat,
  Quality,
  canEncodeVideo,
  canEncodeAudio,
  VideoSampleSink,
} from "mediabunny";
import type {
  Input,
  InputTrack,
  ConversionVideoOptions,
  ConversionAudioOptions,
  VideoCodec,
  AudioCodec,
} from "mediabunny";
import { validateAvcConfiguration } from "./avc.ts";
import { formats } from "./config.ts";
import { MediaError, invalid } from "./errors.ts";
import { selectTracks, trackInfo } from "./input.ts";
import { checkSize } from "./target.ts";
import { Scope } from "./scope.ts";
import type { Config, Format, ResolvedTrack } from "./types.ts";
export function outputFormat(format: Format) {
  return format === "webm"
    ? new WebMOutputFormat({ appendOnly: false })
    : format === "wav"
      ? new WavOutputFormat({ metadataFormat: "id3", large: false })
      : new Mp4OutputFormat({ fastStart: false, metadataFormat: "mdir" });
}
export async function prepare(input: Input, config: Config & { format: Format }, scope: Scope) {
  const all = await scope.wait(input.getTracks(), "READ_FAILED");
  const selected = [
    ...(await selectTracks(input, all, "video", config.tracks.video)),
    ...(await selectTracks(input, all, "audio", config.tracks.audio)),
  ];
  if (!selected.length) throw new MediaError("NO_TRACKS", "No tracks selected.");
  const videos = selected.filter((t) => t.isVideoTrack()).length,
    audios = selected.length - videos;
  const limits = outputFormat(config.format).getSupportedTrackCounts();
  if (
    (["m4a", "wav"].includes(config.format) && (videos !== 0 || audios !== 1)) ||
    videos > limits.video.max ||
    audios > limits.audio.max ||
    selected.length > limits.total.max
  )
    throw new MediaError("TRACK_LOSS", "Output format cannot hold every selected track.");
  if (
    !videos &&
    (Object.keys(config.video).length || config.crop || config.resize || config.rotate)
  )
    invalid("No video track to process.");
  if (!audios && Object.keys(config.audio).length) invalid("No audio track to process.");
  const selectedInfo = await Promise.all(selected.map(trackInfo));
  const excluded = await Promise.all(
    all
      .filter((t) => (t.isVideoTrack() || t.isAudioTrack()) && !selected.includes(t))
      .map(trackInfo),
  );
  let trim: { start: number; end?: number } | undefined;
  if (config.trim) {
    const origin = Math.max(
      0,
      Math.min(...(await Promise.all(selected.map((t) => t.getFirstTimestamp())))),
    );
    const end = Math.max(...(await Promise.all(selected.map((t) => t.computeDuration()))));
    trim = {
      start: origin + config.trim.start,
      end: config.trim.end === undefined ? end : origin + config.trim.end,
    };
    if (trim.start >= end || trim.end! > end) invalid("Trim is outside the selected timeline.");
  }
  const video = new Map<number, ConversionVideoOptions>(),
    audio = new Map<number, ConversionAudioOptions>();
  const resolved: ResolvedTrack[] = [];
  for (let i = 0; i < selected.length; i++) {
    const t = selected[i]!,
      info = selectedInfo[i]!,
      kind = info.type,
      opts = config[kind],
      matrix = formats[config.format];
    const codec = config.mode === "copy" ? info.codec : (opts.codec ?? matrix[kind][0]);
    const copyCodecs: readonly string[] = kind === "video" ? matrix.copyVideo : matrix.copyAudio;
    if (!codec || (config.mode === "copy" && !copyCodecs.includes(codec)))
      throw new MediaError("COPY_NOT_POSSIBLE", "Source codec cannot be copied to this format.");
    const r: ResolvedTrack = { ...info, codec, ...(opts.bitrate ? { bitrate: opts.bitrate } : {}) };
    resolved.push(r);
    const quality =
      opts.bitrate !== undefined
        ? new Quality({ bitrate: opts.bitrate })
        : opts.quality
          ? new Quality(opts.quality)
          : undefined;
    const forceTranscode = config.mode === "transcode" || !!trim;
    if (t.isVideoTrack()) {
      let w = info.width!,
        h = info.height!;
      if (config.rotate === 90 || config.rotate === 270) [w, h] = [h, w];
      if (config.crop) {
        const c = config.crop;
        if (c.x + c.width > w || c.y + c.height > h) invalid("Crop exceeds frame bounds.");
        w = c.width;
        h = c.height;
      }
      if (config.resize) {
        const s = config.resize;
        const even = (n: number) => Math.ceil(Math.round(n) / 2) * 2;
        const nw = s.width ?? even((w * s.height!) / h);
        h = s.height ?? even((h * s.width!) / w);
        w = nw;
      }
      r.width = w;
      r.height = h;
      r.frameRate = config.video.frameRate;
      video.set(t.id, {
        codec: codec as VideoCodec,
        quality,
        forceTranscode,
        rotate: config.rotate,
        crop: config.crop
          ? {
              left: config.crop.x,
              top: config.crop.y,
              width: config.crop.width,
              height: config.crop.height,
            }
          : undefined,
        ...(config.resize ? { width: w, height: h, fit: config.resize.fit ?? "fill" } : {}),
        frameRate: config.video.frameRate,
      });
    } else {
      r.sampleRate = config.audio.sampleRate ?? info.sampleRate;
      r.channels = config.audio.channels ?? info.channels;
      audio.set(t.id, {
        codec: codec as AudioCodec,
        quality,
        forceTranscode,
        sampleRate: config.audio.sampleRate,
        numberOfChannels: config.audio.channels,
      });
    }
  }
  const options = {
    video: (t: InputTrack) => video.get(t.id) ?? { discard: true },
    audio: (t: InputTrack) => audio.get(t.id) ?? { discard: true },
  };
  let copyable = new Set<number>();
  if (config.mode !== "transcode" && !trim) {
    const output = new Output({ format: outputFormat(config.format), target: new NullTarget() });
    let trial: Conversion | undefined;
    const off = scope.onStop(() => output.cancel());
    try {
      trial = await Conversion.init({
        showWarnings: false,
        input,
        output,
        ...options,
        copy: { mode: "forced" },
        tags: {},
      });
      scope.check();
      copyable = new Set(trial.utilizedTracks.map((t) => t.id));
    } catch (error) {
      throw scope.fail(error);
    } finally {
      off();
      try {
        await (trial ? trial.cancel() : output.cancel());
      } catch (error) {
        scope.cleanupError(error);
      }
    }
  }
  if (config.mode === "copy" && selected.some((t) => !copyable.has(t.id)))
    throw new MediaError("COPY_NOT_POSSIBLE", "Selected tracks cannot all be copied.");
  for (let i = 0; i < selected.length; i++) {
    const t = selected[i]!,
      r = resolved[i]!;
    if (copyable.has(t.id)) continue;
    if (!(await scope.wait(t.canDecode())))
      throw new MediaError("CODEC_UNAVAILABLE", "Selected track cannot be decoded.");
    const opts = config[r.type],
      quality = new Quality(
        opts.bitrate === undefined ? (opts.quality ?? "high") : { bitrate: opts.bitrate },
      );
    if (opts.bitrate === undefined && config.format !== "wav") r.quality = opts.quality ?? "high";
    if (t.isVideoTrack()) {
      if (
        !(await scope.wait(
          canEncodeVideo(r.codec as VideoCodec, {
            width: r.width,
            height: r.height,
            frameRate: r.frameRate,
            quality,
          }),
        ))
      )
        throw new MediaError("CODEC_UNAVAILABLE", "Resolved video encoding is unavailable.");
      await validateAvcConfiguration(t, scope);
      let dimensions: string | undefined;
      for await (const sample of new VideoSampleSink(t).samples(trim?.start, trim?.end)) {
        try {
          scope.check();
          // Decoders may retain display dimensions when coded frame dimensions change.
          const d = `${sample.codedWidth}x${sample.codedHeight}/${sample.visibleRect.width}x${sample.visibleRect.height}/${sample.displayWidth}x${sample.displayHeight}`;
          if (dimensions && dimensions !== d)
            throw new MediaError("UNSUPPORTED_INPUT", "Variable frame dimensions are unsupported.");
          dimensions = d;
        } finally {
          sample.close();
        }
      }
      video.get(t.id)!.forceTranscode = true;
    } else {
      if (
        !(await scope.wait(
          canEncodeAudio(r.codec as AudioCodec, {
            sampleRate: r.sampleRate,
            numberOfChannels: r.channels,
            quality,
          }),
        ))
      )
        throw new MediaError("CODEC_UNAVAILABLE", "Resolved audio encoding is unavailable.");
      Object.assign(audio.get(t.id)!, {
        forceTranscode: true,
        process: (sample: import("mediabunny").AudioSample) => {
          if (sample.sampleRate !== r.sampleRate || sample.numberOfChannels !== r.channels)
            throw new MediaError(
              "CODEC_UNAVAILABLE",
              "Backend changed the requested audio configuration.",
              { phase: "processing" },
            );
          return sample;
        },
      });
    }
  }
  if (config.format === "wav") {
    const r = resolved[0]!;
    const duration = trim ? trim.end! - trim.start : await selected[0]!.getDurationFromMetadata();
    if (duration !== null) {
      const bytesPerSample = r.codec === "pcm-s16" ? 2 : r.codec === "pcm-s24" ? 3 : 4;
      checkSize(
        "wav",
        Math.ceil(duration * r.sampleRate!) * r.channels! * bytesPerSample + 44,
        "preparing",
      );
    }
  }
  scope.check();
  return {
    selected,
    selectedInfo,
    excluded,
    resolved,
    trim,
    options,
    nonAV: all.length - selectedInfo.length - excluded.length,
  };
}
