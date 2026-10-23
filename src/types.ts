export type MediaInput = Blob | ArrayBuffer | Uint8Array<ArrayBuffer> | URL | string;
export type Format = "mp4" | "webm" | "m4a" | "wav";
export type Mode = "auto" | "copy" | "transcode";
export type Quality = "low" | "medium" | "high";
export type TrackSelection = "all" | "primary" | readonly number[] | false;
export type VideoOptions = {
  codec?: "avc" | "vp8" | "vp9";
  bitrate?: number;
  quality?: Quality;
  frameRate?: number;
};
export type AudioOptions = {
  codec?: "aac" | "opus" | "pcm-s16" | "pcm-s24" | "pcm-f32";
  bitrate?: number;
  quality?: Quality;
  sampleRate?: number;
  channels?: number;
};
export type ResizeOptions = { width?: number; height?: number; fit?: "contain" | "cover" | "fill" };
export type TrimOptions = { start: number; end?: number };
export type CropOptions = { x: number; y: number; width: number; height: number };
export type TracksOptions = { video?: TrackSelection; audio?: TrackSelection };
export const metadataFields = [
  "title",
  "artist",
  "album",
  "albumArtist",
  "genre",
  "comment",
  "description",
  "date",
] as const;
export type MetadataField = (typeof metadataFields)[number];
export type MetadataPatch = Partial<Record<MetadataField, string | null>>;
export type MetadataValues = Partial<Record<MetadataField, string>>;
export type MetadataOptions = { mode?: "merge" | "replace" };
export type FileTarget = { type: "file"; handle: FileSystemFileHandle };
export type Target = "blob" | FileTarget;
export type Phase = "preparing" | "processing" | "committing";
export type ProgressEvent = { phase: Phase; ratio: number | null };
export type RunOptions = {
  target?: Target;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
};
export type ProbeOptions = {
  signal?: AbortSignal;
  duration?: "metadata" | "scan";
  video?: TrackSelection;
  audio?: TrackSelection;
  frameRate?: "estimate";
};
export type Warning = { code: string; message: string; fields?: readonly string[] };
export type TrackInfo = {
  id: number;
  type: "video" | "audio";
  codec: string | null;
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
};
export type ProbeFrameRate =
  | { hertz: number; origin: "estimated" }
  | { hertz: null; origin: "unknown" };
export type ProbeTiming = {
  startSeconds: number | null;
  endSeconds: number | null;
  elapsedSeconds: number | null;
  default: boolean;
  averageBitrate: number | null;
  peakBitrate: number | null;
};
export type ProbeVideoTrack = TrackInfo &
  ProbeTiming & {
    type: "video";
    width: number;
    height: number;
    codedWidth: number;
    codedHeight: number;
    rotation: 0 | 90 | 180 | 270;
    frameRate: ProbeFrameRate;
  };
export type ProbeAudioTrack = TrackInfo &
  ProbeTiming & {
    type: "audio";
    sampleRate: number;
    channels: number;
    language: string | null;
    name: string | null;
  };
export type ProbeTrack = ProbeVideoTrack | ProbeAudioTrack;
export type ResolvedTrack = TrackInfo & {
  codec: string;
  quality?: Quality;
  bitrate?: number;
  frameRate?: number;
};
export type MetadataReport = {
  values: MetadataValues;
  removedByUser: MetadataField[];
  omittedSourceFields: string[];
  replacedSourceMetadata: boolean;
};
export type MediaReport = {
  resolved: { format: Format; mode: Mode; tracks: ResolvedTrack[]; trim?: TrimOptions };
  selected: TrackInfo[];
  excludedByUser: TrackInfo[];
  metadata: MetadataReport;
  warnings: Warning[];
};
export type BlobResult = {
  kind: "blob";
  blob: Blob;
  mimeType: string;
  size: number;
  suggestedFilename: string;
  report: MediaReport;
};
export type FileResult = {
  kind: "file";
  filename: string;
  mimeType: string;
  size: number;
  commitState: "committed";
  report: MediaReport;
};
export type MediaResult = BlobResult | FileResult;
export type ProbeResult = {
  container: string;
  durationSeconds: number | null;
  durationOrigin: "metadata" | "scanned" | "unknown";
  tracks: ProbeTrack[];
  metadata: MetadataValues;
  omittedSourceFields: string[];
};
export type ErrorCode =
  | "INVALID_OPTIONS"
  | "UNSUPPORTED_INPUT"
  | "UNSUPPORTED_OUTPUT_COMBINATION"
  | "IMAGE_ENCODING_UNAVAILABLE"
  | "CODEC_UNAVAILABLE"
  | "COPY_NOT_POSSIBLE"
  | "NO_TRACKS"
  | "TRACK_LOSS"
  | "UNSUPPORTED_METADATA_FIELD"
  | "TARGET_UNSUPPORTED"
  | "TARGET_BUSY"
  | "PERMISSION_REQUIRED"
  | "READ_FAILED"
  | "WRITE_FAILED"
  | "OUTPUT_TOO_LARGE"
  | "PROCESSING_FAILED"
  | "ABORTED";
export type TargetState = "untouched" | "aborted" | "unknown";

/** Internal immutable configuration. Media bytes remain caller-owned. */
export type Config = {
  format?: Format;
  mode: Mode;
  trim?: TrimOptions;
  resize?: ResizeOptions;
  crop?: CropOptions;
  rotate?: 0 | 90 | 180 | 270;
  video: VideoOptions;
  audio: AudioOptions;
  tracks: TracksOptions;
  metadata?: { patch: MetadataPatch; mode: "merge" | "replace" };
};

export type ThumbnailImageOptions = {
  track?: "primary" | number;
  width?: number;
  height?: number;
  fit?: "contain" | "cover" | "fill";
  type?: "image/jpeg" | "image/png";
  quality?: number;
  signal?: AbortSignal;
};
export type ThumbnailOptions = ThumbnailImageOptions & { time: number };
export type ThumbnailsOptions = ThumbnailImageOptions &
  (
    | { times: readonly number[]; start?: never; end?: never; count?: never }
    | { start: number; end: number; count: number; times?: never }
  );
export type ThumbnailImage = {
  blob: Blob;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  trackId: number;
  requestedTime: number;
  actualTime: number;
  sourceTimestamp: number;
  durationSeconds: number;
  timeOriginSeconds: number;
};
export type ThumbnailItem = { index: number; requestedTime: number; image: ThumbnailImage | null };
export type EmbeddedPictureOptions = { signal?: AbortSignal };
export type WaveformOptions = {
  track?: "primary" | number;
  pointsPerSecond?: number;
  start?: number;
  end?: number;
  signal?: AbortSignal;
};
export type WaveformData = {
  trackId: number;
  sampleRate: number;
  channels: number;
  pointsPerSecond: number;
  startSeconds: number;
  endSeconds: number;
  timeOriginSeconds: number;
  min: Float32Array[];
  max: Float32Array[];
};
export type WaveformRenderOptions = {
  width: number;
  height: number;
  start?: number;
  end?: number;
  color?: string;
  background?: string;
  signal?: AbortSignal;
};
export type WaveformImage = {
  blob: Blob;
  mimeType: "image/png";
  width: number;
  height: number;
  startSeconds: number;
  endSeconds: number;
};
