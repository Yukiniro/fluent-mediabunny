# media

`media(source)` 为一个输入和一个输出返回 `MediaBuilder`。`source` 是 `MediaInput`。

```ts
function media(source: MediaInput): MediaBuilder;
```

## MediaBuilder

下面每个方法都返回新的 `MediaBuilder`。接收者不变。

| 方法       | 参数                                                                        | 效果                                       |
| ---------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| `format`   | `"mp4"`、`"webm"`、`"m4a"` 或 `"wav"`                                       | 设置容器。`run` 之前必须调用。             |
| `mode`     | `"auto"`、`"copy"` 或 `"transcode"`                                         | 默认 `"auto"`。                            |
| `trim`     | `{ start: number; end?: number }`                                           | `start` 可以为 0。`end` 必须大于 `start`。 |
| `resize`   | `{ width?: number; height?: number; fit?: "contain" \| "cover" \| "fill" }` | 正偶数。`fit` 需要两个尺寸。               |
| `crop`     | `{ x: number; y: number; width: number; height: number }`                   | 整数。`x` 和 `y` 可以为 0。                |
| `rotate`   | `0`、`90`、`180` 或 `270`                                                   | 在裁剪和缩放之前应用。                     |
| `video`    | `VideoOptions`                                                              | 合并。比特率与质量互斥。                   |
| `audio`    | `AudioOptions`                                                              | 合并。WAV 拒绝比特率和质量。               |
| `tracks`   | `{ video?: TrackSelection; audio?: TrackSelection }`                        | 合并。默认选择是 `"all"`。                 |
| `metadata` | `MetadataPatch`，可选 `{ mode?: "merge" \| "replace" }`                     | 默认模式是 `"merge"`。                     |

`VideoOptions` 是 `{ codec?: "avc" \| "vp8" \| "vp9"; bitrate?: number; quality?: Quality; frameRate?: number }`。

`AudioOptions` 是 `{ codec?: "aac" \| "opus" \| "pcm-s16" \| "pcm-s24" \| "pcm-f32"; bitrate?: number; quality?: Quality; sampleRate?: number; channels?: number }`。

`Quality` 是 `"low"`、`"medium"` 或 `"high"`。`bitrate` 是正整数。`frameRate` 是正的有限数。`sampleRate` 和 `channels` 是正整数。

`TrackSelection` 是 `"all"`、`"primary"`、`readonly number[]` 或 `false`。

`MetadataPatch` 把 `string` 或 `null` 赋给 `title`、`artist`、`album`、`albumArtist`、`genre`、`comment`、`description` 或 `date`。`null` 或 `""` 删除字段。`date` 是 `YYYY-MM-DD`。

按格式列出的编码器。复制编解码器是 `mode("copy")` 还能保留的额外集合。

| 格式   | 编码视频     | 编码音频                        | 复制视频            | 复制音频                        |
| ------ | ------------ | ------------------------------- | ------------------- | ------------------------------- |
| `mp4`  | `avc`        | `aac`                           | `avc`、`hevc`       | `aac`                           |
| `webm` | `vp9`、`vp8` | `opus`                          | `vp8`、`vp9`、`av1` | `opus`、`vorbis`                |
| `m4a`  | 无           | `aac`                           | 无                  | `aac`                           |
| `wav`  | 无           | `pcm-s16`、`pcm-s24`、`pcm-f32` | 无                  | `pcm-s16`、`pcm-s24`、`pcm-f32` |

省略编解码器时，使用该种类的第一个编码编解码器。转码既不设比特率也不设质量时，质量解析为 `"high"`，WAV 除外。

`"copy"` 拒绝 trim、resize、crop、rotate 以及视频或音频选项。显式 trim 强制转码。M4A 和 WAV 需要一条音轨，并且不能有视频。

## run

```ts
run(options?: RunOptions & { target?: "blob" }): Promise<BlobResult>;
run(options: RunOptions & { target: FileTarget }): Promise<FileResult>;
run(options: RunOptions): Promise<MediaResult>;
```

`RunOptions` 是 `{ target?: "blob" | FileTarget; signal?: AbortSignal; onProgress?: (event: ProgressEvent) => void }`。

`FileTarget` 是 `{ type: "file"; handle: FileSystemFileHandle }`。

`ProgressEvent` 是 `{ phase: "preparing" | "processing" | "committing"; ratio: number | null }`。

`MediaResult` 是 `BlobResult | FileResult`。

## BlobResult

| 字段                | 类型                         |
| ------------------- | ---------------------------- |
| `kind`              | `"blob"`                     |
| `blob`              | `Blob`                       |
| `mimeType`          | `string`                     |
| `size`              | `number`                     |
| `suggestedFilename` | `string`，`output.` 加上格式 |
| `report`            | `MediaReport`                |

## FileResult

| 字段          | 类型                     |
| ------------- | ------------------------ |
| `kind`        | `"file"`                 |
| `filename`    | `string`，句柄上的文件名 |
| `mimeType`    | `string`                 |
| `size`        | `number`                 |
| `commitState` | `"committed"`            |
| `report`      | `MediaReport`            |

WAV 的 `mimeType` 是 `audio/wav`。M4A 是 `audio/mp4`。MP4 是 `video/mp4` 或 `audio/mp4`。WebM 是 `video/webm` 或 `audio/webm`。选中轨道里有 `"video"` 类型时使用视频 MIME。

## MediaReport

| 字段             | 类型                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `resolved`       | `{ format: Format; mode: Mode; tracks: ResolvedTrack[]; trim?: TrimOptions }` |
| `selected`       | `TrackInfo[]`                                                                 |
| `excludedByUser` | `TrackInfo[]`                                                                 |
| `metadata`       | `MetadataReport`                                                              |
| `warnings`       | `Warning[]`                                                                   |

`ResolvedTrack` 是 `TrackInfo` 加上字符串 `codec`，以及可选的 `quality`、`bitrate` 和 `frameRate`。缩放后的视频还报告 `width` 和 `height`。音频报告 `sampleRate` 和 `channels`。

`MetadataReport` 是 `{ values: MetadataValues; removedByUser: MetadataField[]; omittedSourceFields: string[]; replacedSourceMetadata: boolean }`。

`Warning` 写在 [错误](/api/errors)。它的 `code` 是字符串。`run` 目前赋的码有 `METADATA_OMITTED`、`NON_AV_CONTENT_NOT_PRESERVED`、`FILENAME_EXTENSION_MISMATCH`、`CALLBACK_FAILED` 和 `CLEANUP_FAILED`。
