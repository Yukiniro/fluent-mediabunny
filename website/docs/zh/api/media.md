---
title: media / MediaBuilder
description: 通过不可变构建器配置媒体转换的格式、编码、轨道、画面与元数据。
---

# media / MediaBuilder {#media}

为一个输入配置一个输出。配置过程是同步的，调用 `run()` 时才开始媒体 I/O。

## 示例

```ts
import { media } from "fluent-mediabunny";

const base = media(file).format("mp4");
const preview = base.resize({ width: 1280 });
const result = await preview.run();
```

`file` 是浏览器 `File`。`base` 保留原有配置，可以复用于其他输出。

## 签名

```ts
function media(source: MediaInput): MediaBuilder;

class MediaBuilder {
  constructor(source: MediaInput);
}
```

| 参数     | 类型                                   | 说明                                                             |
| -------- | -------------------------------------- | ---------------------------------------------------------------- |
| `source` | [MediaInput](/zh/api/probe#mediainput) | Blob、字节缓冲区或绝对 HTTP(S) URL。在执行结束前保持源字节稳定。 |

**返回：** `MediaBuilder`。也支持 `new MediaBuilder(source)`。输入形式无效时，同步抛出 `MediaError`。

## MediaBuilder

所有配置方法都返回**新的** `MediaBuilder`。参数校验不会打开输入。选项必须是普通对象，未知字段会导致失败。

| 方法                                                 | 重复调用                                            |
| ---------------------------------------------------- | --------------------------------------------------- |
| `format`、`mode`、`trim`、`resize`、`crop`、`rotate` | 替换之前的设置                                      |
| `video`、`audio`、`tracks`                           | 合并提供的字段；空对象和 `undefined` 字段不覆盖旧值 |
| `metadata`                                           | 替换整条元数据指令及其模式                          |

### format

```ts
format(value: Format): MediaBuilder;
type Format = "mp4" | "webm" | "m4a" | "wav";
```

必须在 `run()` 之前设置。每种格式列出的第一个编码器是默认值。复制模式可保留后两列中的源编解码器。

| 格式   | 编码视频     | 编码音频                        | 复制视频            | 复制音频                        |
| ------ | ------------ | ------------------------------- | ------------------- | ------------------------------- |
| `mp4`  | `avc`        | `aac`                           | `avc`、`hevc`       | `aac`                           |
| `webm` | `vp9`、`vp8` | `opus`                          | `vp8`、`vp9`、`av1` | `opus`、`vorbis`                |
| `m4a`  | 无           | `aac`                           | 无                  | `aac`                           |
| `wav`  | 无           | `pcm-s16`、`pcm-s24`、`pcm-f32` | 无                  | `pcm-s16`、`pcm-s24`、`pcm-f32` |

M4A 和 WAV 要求恰好一条音轨且没有视频，需显式设置 `tracks({ video: false, audio: "primary" })`。显式编解码器与格式不兼容时，`run()` 以 `UNSUPPORTED_OUTPUT_COMBINATION` 拒绝。

### mode

```ts
mode(value: Mode): MediaBuilder;
type Mode = "auto" | "copy" | "transcode";
```

| 值               | 行为                                                           |
| ---------------- | -------------------------------------------------------------- |
| `"auto"`（默认） | 解析显式或格式默认编解码器；配置允许时复制兼容轨道，否则转码。 |
| `"copy"`         | 保留所有选中轨道的源编解码器；任何选中轨道无法复制时失败。     |
| `"transcode"`    | 解码并重新编码所有选中轨道。                                   |

复制模式拒绝时间裁剪、缩放、画面裁剪、非零旋转和非空音视频选项，允许 `rotate(0)`。任何显式时间裁剪都会强制转码，包括自动模式。无法满足精确编解码配置时，报 `CODEC_UNAVAILABLE`，不会替换为其他配置。

### trim

```ts
trim(options: TrimOptions): MediaBuilder;
type TrimOptions = { start: number; end?: number };
```

| 字段    | 必填 | 说明                                                      |
| ------- | ---- | --------------------------------------------------------- |
| `start` | 是   | 有限秒数，至少为 0。                                      |
| `end`   | 否   | 大于 `start` 的有限秒数。省略则保留选中时间线的剩余部分。 |

时间相对 `max(0, min(选中轨道的首个时间戳))`。起点达到或超过选中时间线末尾，或终点超出末尾时，执行以 `INVALID_OPTIONS` 拒绝。输出时间归一化，并在采样精度内保留轨道间偏移。

### resize

```ts
resize(options: ResizeOptions): MediaBuilder;
type ResizeOptions = {
  width?: number;
  height?: number;
  fit?: "contain" | "cover" | "fill";
};
```

| 字段              | 说明                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------- |
| `width`、`height` | 像素单位的正偶数，至少提供一个，允许放大。                                            |
| `fit`             | 同时指定宽高时必填，只指定一个尺寸时禁止。`contain` 留边，`cover` 裁剪，`fill` 拉伸。 |

单尺寸保持宽高比，另一边按 `2 * ceil(round(size) / 2)` 推导。无论方法调用顺序如何，画面处理顺序始终是：源方向与翻转、额外旋转、裁剪、缩放。

### crop

```ts
crop(options: CropOptions): MediaBuilder;
type CropOptions = { x: number; y: number; width: number; height: number };
```

`x`、`y` 是非负整数，`width`、`height` 是正整数，单位为像素。矩形必须位于旋转后的画面内；90° 和 270° 旋转会交换画面轴。

### rotate

```ts
rotate(degrees: 0 | 90 | 180 | 270): MediaBuilder;
```

在裁剪和缩放前应用额外旋转。省略或传入 `0` 时保留源方向。

### video

```ts
video(options: VideoOptions): MediaBuilder;
type VideoOptions = {
  codec?: "avc" | "vp8" | "vp9";
  bitrate?: number;
  quality?: Quality;
  frameRate?: number;
};
type Quality = "low" | "medium" | "high";
```

| 字段        | 默认值                      | 说明                                          |
| ----------- | --------------------------- | --------------------------------------------- |
| `codec`     | 格式的首个视频编码器        | 必须与输出格式兼容。                          |
| `bitrate`   | 未设置                      | 正安全整数，单位为 bit/s，与 `quality` 互斥。 |
| `quality`   | 无比特率的转码使用 `"high"` | 质量预设；显式设置会强制转码。                |
| `frameRate` | 源行为                      | 正的有限数，单位为帧/秒。                     |

后续调用设置比特率时会移除之前的质量设置，反之亦然。视频选项要求存在选中视频轨道。视频转码拒绝帧尺寸变化；AVC 转码还要求整个源中的 avcC 配置稳定，包括裁剪范围之外。

### audio

```ts
audio(options: AudioOptions): MediaBuilder;
type AudioOptions = {
  codec?: "aac" | "opus" | "pcm-s16" | "pcm-s24" | "pcm-f32";
  bitrate?: number;
  quality?: Quality;
  sampleRate?: number;
  channels?: number;
};
```

| 字段                 | 默认值               | 说明                                                 |
| -------------------- | -------------------- | ---------------------------------------------------- |
| `codec`              | 格式的首个音频编码器 | 必须与输出格式兼容。                                 |
| `bitrate`、`quality` | 与视频相同，WAV 除外 | 两者互斥，后续调用会替换另一项。WAV 拒绝这两个字段。 |
| `sampleRate`         | 源采样率             | 正安全整数，单位为 Hz。                              |
| `channels`           | 源声道数             | 正安全整数。                                         |

音频选项要求存在选中音轨。请求的采样率和声道数会进行校验，不会静默替换。

### tracks

```ts
tracks(options: TracksOptions): MediaBuilder;
type TracksOptions = { video?: TrackSelection; audio?: TrackSelection };
type TrackSelection = "all" | "primary" | readonly number[] | false;
```

`video` 和 `audio` 都默认为 `"all"`。`"primary"` 选择 Mediabunny 主轨，`false` 排除该媒体类型，也可传入 [probe](/zh/api/probe) 返回的非空、唯一、非负安全整数轨道 ID 列表。ID 不是数组下标，必须属于对应媒体类型。

最终没有选中轨道时报 `NO_TRACKS`；格式不能保留全部选中轨道时报 `TRACK_LOSS`。非音视频内容不在该保留保证内，可能产生警告。

### metadata

```ts
metadata(patch: MetadataPatch, options?: MetadataOptions): MediaBuilder;
type MetadataOptions = { mode?: "merge" | "replace" };
type MetadataPatch = Partial<Record<MetadataField, string | null>>;
type MetadataField =
  | "title" | "artist" | "album" | "albumArtist"
  | "genre" | "comment" | "description" | "date";
```

| 值或选项                 | 行为                                         |
| ------------------------ | -------------------------------------------- |
| `mode: "merge"`（默认）  | 在有效、受支持的源标签上应用补丁。           |
| `mode: "replace"`        | 仅写入补丁中的非空值。                       |
| 字段为 `null` 或 `""`    | 删除字段。                                   |
| 字段省略或为 `undefined` | 不提供覆盖。                                 |
| `date`                   | 有效的 `YYYY-MM-DD` 日期，年份为 0001–9999。 |

文本保留空白与 Unicode，NUL 和未配对代理项会导致校验失败。未知元数据字段抛出 `UNSUPPORTED_METADATA_FIELD`。内嵌图片不会写入输出，可单独调用 [getEmbeddedPicture](/zh/api/embedded-picture) 读取。

## run

使用 [`run(options?)`](/zh/api/run) 执行转换，返回 Promise，每次调用独立管理资源。

## BlobResult

默认输出包含 `blob`、`mimeType`、`size`、`suggestedFilename` 和 `report`。字段与单位详见 [BlobResult](/zh/api/run#blobresult)。

## FileResult

文件目标仅在成功关闭后返回结果，详见 [FileResult](/zh/api/run#fileresult)。

## MediaReport

每次成功转换都包含解析配置、选中与排除轨道、元数据变化及警告，详见 [MediaReport](/zh/api/run#mediareport)。
