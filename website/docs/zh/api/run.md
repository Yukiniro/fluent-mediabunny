---
title: run / 执行结果
description: 执行媒体转换，选择 Blob 或文件目标，处理进度与取消，并读取结果报告。
---

# run / 执行结果

执行配置好的 `MediaBuilder`。默认返回 Blob；文件目标仅在可写流成功关闭后返回结果。

## 示例

```ts
import { media } from "fluentbunny";

const controller = new AbortController();
const result = await media(file)
  .format("webm")
  .run({
    signal: controller.signal,
    onProgress({ phase, ratio }) {
      console.log(phase, ratio);
    },
  });

console.log(result.blob, result.report.warnings);
```

`file` 是应用提供的浏览器 `File`。从取消控件调用 `controller.abort()`。

## 签名

```ts
run(options?: RunOptions & { target?: "blob" }): Promise<BlobResult>;
run(options: RunOptions & { target: FileTarget }): Promise<FileResult>;
run(options: RunOptions): Promise<MediaResult>;

type MediaResult = BlobResult | FileResult;
type FileTarget = { type: "file"; handle: FileSystemFileHandle };
```

## RunOptions

| 字段         | 类型                             | 默认值   | 说明                                                              |
| ------------ | -------------------------------- | -------- | ----------------------------------------------------------------- |
| `target`     | `"blob" \| FileTarget`           | `"blob"` | 在内存中返回字节，或写入与输入不同的文件。                        |
| `signal`     | `AbortSignal`                    | 未设置   | 在提交开始前取消。有效但已取消的执行不进行媒体 I/O。              |
| `onProgress` | `(event: ProgressEvent) => void` | 未设置   | 同步观察者。抛错或返回 Promise 后停用，并添加 `CALLBACK_FAILED`。 |

执行前必须调用 `format()`。每次调用独立管理资源，并在完成清理后结束。源字节仍由调用者持有，必须保持稳定。

### 文件目标

```ts
const result = await media(file)
  .format("mp4")
  .run({
    target: { type: "file", handle },
  });

console.log(result.filename, result.commitState);
```

`handle` 必须已获得读写权限，并支持 `queryPermission`、`createWritable` 和 `isSameEntry`。请使用与输入不同的文件。本库不会打开选择器或申请权限。输出成功后替换旧文件内容，包括尾部残留字节。

在同一模块实例内，并发写入同一文件会报 `TARGET_BUSY`。该锁不覆盖其他标签页或程序。

## 进度与取消

```ts
type Phase = "preparing" | "processing" | "committing";
type ProgressEvent = { phase: Phase; ratio: number | null };
```

| 阶段         | 含义                               | ratio                |
| ------------ | ---------------------------------- | -------------------- |
| `preparing`  | 校验配置、输入、轨道和编解码支持。 | `null`               |
| `processing` | 读取并处理媒体，写入目标。         | 0–1；未知时为 `null` |
| `committing` | 完成 Blob 或等待文件实际关闭。     | `null`               |

:::warning 提交边界
进度达到 1 不代表文件已保存。提交前取消会中止已打开的暂存写入。一旦提交开始，取消会被忽略，包括在 `committing` 回调中取消。必须等待结果，才能确定关闭是否成功。
:::

取消是协作式的，不保证固定延迟。失败不返回成功的部分结果。首个观察到的失败优先，后续清理错误记录到 `diagnostics`。

## BlobResult

| 字段                | 类型          | 说明                                    |
| ------------------- | ------------- | --------------------------------------- |
| `kind`              | `"blob"`      | 结果判别字段。                          |
| `blob`              | `Blob`        | 完整输出字节，应用负责管理对象 URL。    |
| `mimeType`          | `string`      | 输出媒体类型，见下表。                  |
| `size`              | `number`      | 最终逻辑长度，单位为字节。              |
| `suggestedFilename` | `string`      | `output.<format>`，例如 `output.webm`。 |
| `report`            | `MediaReport` | 解析后的配置、元数据、轨道与警告。      |

## FileResult

| 字段          | 类型          | 说明                               |
| ------------- | ------------- | ---------------------------------- |
| `kind`        | `"file"`      | 结果判别字段。                     |
| `filename`    | `string`      | 文件句柄的实际名称，本库不重命名。 |
| `mimeType`    | `string`      | 输出媒体类型。                     |
| `size`        | `number`      | 最终逻辑长度，单位为字节。         |
| `commitState` | `"committed"` | 可写流已成功关闭。                 |
| `report`      | `MediaReport` | 与 Blob 输出相同的报告结构。       |

成功关闭不保证断电持久性。文件执行失败时，`MediaError.targetState` 为 `"untouched"`、`"aborted"` 或 `"unknown"`，详见[输入与输出](/zh/guide/inputs-and-outputs)。

### MIME 类型与大小限制

| 格式 | MIME 类型                                      |
| ---- | ---------------------------------------------- |
| MP4  | 选中视频时为 `video/mp4`，否则为 `audio/mp4`   |
| WebM | 选中视频时为 `video/webm`，否则为 `audio/webm` |
| M4A  | `audio/mp4`                                    |
| WAV  | `audio/wav`                                    |
| Ogg  | `audio/ogg`                                    |

输出长度必须为非负安全整数。WAV 的 RIFF 上限为 4,294,967,295 字节，不回退到 RF64。溢出时报 `OUTPUT_TOO_LARGE`。

## MediaReport

| 字段             | 类型                                                                          | 说明                                             |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| `resolved`       | `{ format: Format; mode: Mode; tracks: ResolvedTrack[]; trim?: TrimOptions }` | 解析后的配置，不表示实测硬件使用或逐帧执行。     |
| `selected`       | `TrackInfo[]`                                                                 | 选中的源音视频轨道。                             |
| `excludedByUser` | `TrackInfo[]`                                                                 | 通过选择规则排除的源音视频轨道。                 |
| `metadata`       | `MetadataReport`                                                              | 写入的文本值与元数据处理决策。                   |
| `warnings`       | `Warning[]`                                                                   | 非致命问题，详见[警告](/zh/api/errors#warning)。 |

`ResolvedTrack` 在 [TrackInfo](/zh/api/probe#trackinfo) 基础上增加非空字符串 `codec`，以及可选的 `quality`、`bitrate` 和 `frameRate`。视频报告输出宽高，音频报告采样率与声道数。

### MetadataReport

| 字段                     | 类型              | 说明                                   |
| ------------------------ | ----------------- | -------------------------------------- |
| `values`                 | `MetadataValues`  | 写入的受支持文本元数据。               |
| `removedByUser`          | `MetadataField[]` | 显式删除的字段，包含源中不存在的字段。 |
| `omittedSourceFields`    | `string[]`        | 输出中省略的不支持或无效源标签。       |
| `replacedSourceMetadata` | `boolean`         | 是否指定元数据替换模式。               |

转换不写入内嵌图片。请单独调用 [getEmbeddedPicture](/zh/api/embedded-picture) 读取。

## 错误

执行以 [MediaError](/zh/api/errors) 拒绝。常见原因包括未设置格式（`INVALID_OPTIONS`）、编解码器不可用（`CODEC_UNAVAILABLE`）、轨道丢失（`TRACK_LOSS`）、文件权限不足（`PERMISSION_REQUIRED`）、写入或关闭失败（`WRITE_FAILED`），以及已接受的取消（`ABORTED`）。
