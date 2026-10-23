---
title: probe
description: 无需转换即可检查媒体容器、时长、音视频轨道与受支持的文本元数据。
---

# probe

读取容器信息和元数据，不转换或解码媒体。编解码器名称描述源文件，不代表当前浏览器具备解码能力。

## 示例 {#example}

```ts
import { probe } from "fluentbunny";

const info = await probe(file, { duration: "scan" });
console.log(info.container, info.durationSeconds);

for (const track of info.tracks) {
  console.log(track.id, track.type, track.codec);
}
```

`file` 是浏览器 `File`。省略 `duration: "scan"` 时，仅读取容器元数据中的时长。

## 签名

```ts
function probe(source: MediaInput, options?: ProbeOptions): Promise<ProbeResult>;
```

| 参数      | 类型           | 必填 | 说明                           |
| --------- | -------------- | ---- | ------------------------------ |
| `source`  | `MediaInput`   | 是   | 源媒体，遵循下方共用输入约定。 |
| `options` | `ProbeOptions` | 否   | 时长策略与取消信号。           |

## MediaInput

```ts
type MediaInput = Blob | ArrayBuffer | Uint8Array<ArrayBuffer> | URL | string;
```

| 输入                      | 要求                                                       |
| ------------------------- | ---------------------------------------------------------- |
| `File` / `Blob`           | 浏览器文件或 Blob；`File` 继承 `Blob`。                    |
| `ArrayBuffer`             | 非空；空缓冲区报 `INVALID_OPTIONS`。                       |
| `Uint8Array<ArrayBuffer>` | 非空，底层是 `ArrayBuffer`；空视图报 `UNSUPPORTED_INPUT`。 |
| `URL` / `string`          | 绝对 `http:` 或 `https:` URL，不含用户名和密码。           |

远程读取使用 CORS，省略凭据，不重试。URL 对象会快照为字符串。字节输入不会被复制或修改，请在操作完成前保持源字节与远程内容稳定。不支持文件路径和 `SharedArrayBuffer`。

支持的容器包括 MP4、QTFF、WebM、Matroska、MP3、WAVE、OGG、FLAC 和 ADTS。无法识别容器时，以 `UNSUPPORTED_INPUT` 拒绝。

## ProbeOptions

| 字段       | 类型                   | 默认值       | 说明                                                                                                   |
| ---------- | ---------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `duration` | `"metadata" \| "scan"` | `"metadata"` | 使用 `getDurationFromMetadata` 读取已存时长，或使用 `computeDuration` 扫描。扫描可能需要读取更多数据。 |
| `signal`   | `AbortSignal`          | 未设置       | 取消读取，以 `ABORTED` 拒绝。                                                                          |

未知选项字段以 `INVALID_OPTIONS` 拒绝。每次调用都在结束前释放输入。

## ProbeResult

| 字段                  | 类型                                   | 说明                                                            |
| --------------------- | -------------------------------------- | --------------------------------------------------------------- |
| `container`           | `string`                               | 识别到的格式名称。                                              |
| `durationSeconds`     | `number \| null`                       | 秒数；`null` 表示未知，不是零。                                 |
| `durationOrigin`      | `"metadata" \| "scanned" \| "unknown"` | 时长来源；时长为 `null` 时为 `"unknown"`。                      |
| `tracks`              | `TrackInfo[]`                          | 源音视频轨道，省略其他轨道类型。                                |
| `metadata`            | `MetadataValues`                       | 有效的受支持文本字段，详见 [metadata](/zh/api/media#metadata)。 |
| `omittedSourceFields` | `string[]`                             | 不支持或无效的源元数据字段名。                                  |

源 `Date` 值使用 UTC 的 `YYYY-MM-DD` 日期。元数据暴露图片时，`omittedSourceFields` 包含 `"images"`；通过 [getEmbeddedPicture](/zh/api/embedded-picture) 单独读取图片。

## TrackInfo

| 字段              | 类型                 | 说明                                      |
| ----------------- | -------------------- | ----------------------------------------- |
| `id`              | `number`             | 源轨道 ID，不是数组下标，可用于轨道选择。 |
| `type`            | `"video" \| "audio"` | 媒体类型。                                |
| `codec`           | `string \| null`     | 识别到的编解码器名称，未知时为 `null`。   |
| `width`、`height` | `number`，可选       | 视频显示尺寸，单位为像素；音频不提供。    |
| `sampleRate`      | `number`，可选       | 音频采样率，单位为 Hz；视频不提供。       |
| `channels`        | `number`，可选       | 音频声道数；视频不提供。                  |

## 错误

| 错误码              | 原因                                     |
| ------------------- | ---------------------------------------- |
| `INVALID_OPTIONS`   | 选项无效或传入空 `ArrayBuffer`。         |
| `UNSUPPORTED_INPUT` | 不支持的输入形式、URL 或无法识别的容器。 |
| `READ_FAILED`       | 请求、容器、轨道或元数据读取失败。       |
| `ABORTED`           | 结果返回前观察到取消。                   |

失败以 [MediaError](/zh/api/errors) 拒绝。未知时长是成功结果，`durationSeconds` 为 `null`。
