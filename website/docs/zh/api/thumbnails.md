---
title: thumbnail / thumbnails
description: 按明确的时间与尺寸解码单帧视频，或惰性生成有数量上限的 JPEG、PNG 图片批次。
---

# thumbnail / thumbnails

将视频帧解码为 JPEG 或 PNG。单个时间使用 `thumbnail`，批量使用 `thumbnails`。读取原始封面请使用 [getEmbeddedPicture](/zh/api/embedded-picture)。编码关键帧请使用 [getClosestKeyFrameImage](/zh/api/keyframes)。

## thumbnail

```ts
import { thumbnail } from "fluentbunny";

const image = await thumbnail(file, { time: 2, width: 640 });
if (image) {
  console.log(image.blob, image.actualTime);
}
```

```ts
function thumbnail(source: MediaInput, options: ThumbnailOptions): Promise<ThumbnailImage | null>;
```

| 参数      | 类型                                   | 说明                               |
| --------- | -------------------------------------- | ---------------------------------- |
| `source`  | [MediaInput](/zh/api/probe#mediainput) | 原始媒体，不应用转换构建器的设置。 |
| `options` | `ThumbnailOptions`                     | 必填的时间及下方共用图片选项。     |

**返回：** 解析为 `ThumbnailImage` 的 Promise；没有帧覆盖请求时间时为 `null`。读取、解码、编码失败会拒绝，不返回 `null`。

## thumbnails

```ts
import { thumbnails } from "fluentbunny";

for await (const item of thumbnails(file, {
  start: 2,
  end: 10,
  count: 4,
  width: 160,
})) {
  console.log(item.index, item.requestedTime, item.image?.blob);
}
```

这里请求第 2、4、6、8 秒，不包含终点。

```ts
function thumbnails(
  source: MediaInput,
  options: ThumbnailsOptions,
): AsyncGenerator<ThumbnailItem, void, unknown>;
```

**返回：** 惰性异步生成器，每个请求位置对应一个 `ThumbnailItem`，包含缺帧位置。静态选项会同步快照并校验，第一次 `next()` 才开始媒体读取。请串行消费迭代器。

## ThumbnailOptions

```ts
type ThumbnailOptions = ThumbnailImageOptions & { time: number };
```

`time` 必填，是有限、非负的秒数。四舍五入后的微秒值必须是安全整数，允许为零。

## ThumbnailsOptions

从两种请求形式中选择一种，再搭配共用图片选项。混用会抛出 `INVALID_OPTIONS`。

```ts
type ThumbnailsOptions = ThumbnailImageOptions &
  (
    | { times: readonly number[]; start?: never; end?: never; count?: never }
    | { start: number; end: number; count: number; times?: never }
  );
```

| 字段           | 说明                                                    |
| -------------- | ------------------------------------------------------- |
| `times`        | 1–1000 个有限、非负、非递减时间。重复时间保留独立下标。 |
| `start`、`end` | 有限、非负秒数；微秒舍入前后均须满足 `end > start`。    |
| `count`        | 1 到 1000 的整数；为 1 时选择 `start`。                 |

第 `i` 次请求为 `start + i * (end - start) / count`，`i` 从 0 到 `count - 1`，不会自动扫描时长。

## ThumbnailImageOptions

| 字段              | 类型                             | 默认值               | 说明                                                               |
| ----------------- | -------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `track`           | `"primary" \| number`            | `"primary"`          | 主视频轨道，或 `probe()` 返回的非负安全整数视频轨道 ID。           |
| `width`、`height` | `number`                         | 应用方向后的显示尺寸 | 正整数像素，每边最多 4096，允许奇数和放大。                        |
| `fit`             | `"contain" \| "cover" \| "fill"` | 未设置               | 同时给宽高时必填，否则禁止。contain 和 cover 居中处理，fill 拉伸。 |
| `type`            | `"image/jpeg" \| "image/png"`    | `"image/jpeg"`       | 请求的图片 MIME 类型，发生替换时报错。                             |
| `quality`         | `number`                         | JPEG 为 `0.8`        | 0–1 的有限数，PNG 禁止提供。                                       |
| `signal`          | `AbortSignal`                    | 未设置               | 取消读取和编码。                                                   |

单尺寸保持显示宽高比，并对另一边四舍五入。缩放前应用源旋转、翻转和像素宽高比。JPEG 将透明像素和留边合成到黑色背景；PNG 保留解码器提供的透明度和透明留边。生成图片不复制源元数据。

面积上限为 16,000,000 像素。显式尺寸超限报 `INVALID_OPTIONS`；原生或推导尺寸超限时，在分配 Canvas 前报 `OUTPUT_TOO_LARGE`。

## ThumbnailImage

| 字段                | 类型                          | 说明                                                |
| ------------------- | ----------------------------- | --------------------------------------------------- |
| `blob`              | `Blob`                        | 非空编码图片，独立持有字节。                        |
| `mimeType`          | `"image/jpeg" \| "image/png"` | 实际编码类型，与请求一致。                          |
| `width`、`height`   | `number`                      | 输出像素尺寸。                                      |
| `trackId`           | `number`                      | 选中的源视频轨道 ID。                               |
| `requestedTime`     | `number`                      | 原始请求秒数。                                      |
| `actualTime`        | `number`                      | `sourceTimestamp - timeOriginSeconds`，可能为负。   |
| `sourceTimestamp`   | `number`                      | 源采样时间戳，单位为秒。                            |
| `durationSeconds`   | `number`                      | 源采样持续时间，单位为秒。                          |
| `timeOriginSeconds` | `number`                      | `max(0, input.getFirstTimestamp())`，所有轨道共用。 |

### 帧覆盖范围

比较使用四舍五入后的微秒。帧覆盖 `[timestamp, timestamp + duration)`。视频开始前、间隙内、末帧结束时及之后的请求返回 `null`，不会延长帧覆盖。跨过零点的帧可能具有负 `actualTime`。

舍入后的持续时间非正或时间戳不安全时，报 `UNSUPPORTED_INPUT`。返回时间保留源采样值，不使用用于比较的舍入值。

## ThumbnailItem

| 字段            | 类型                     | 说明                     |
| --------------- | ------------------------ | ------------------------ |
| `index`         | `number`                 | 从零开始的请求位置。     |
| `requestedTime` | `number`                 | 请求秒数，缺帧时也保留。 |
| `image`         | `ThumbnailImage \| null` | 编码图片或缺帧。         |

## 清理与取消

批次共用一个输入和解码管线，按需编码。已经返回的图片不受后续请求、取消和释放影响。应用负责对象 URL 和保存。

正常完成及 `for await` 中的 break 都会释放资源。手动驱动迭代器并提前停止时，必须等待 `return()`。未启动的迭代器直接返回不会进行媒体 I/O。

产出后取消会立即开始清理，下次 `next()` 以 `ABORTED` 拒绝。显式 `return()` 等待清理后正常结束。进行中的浏览器编码可能先完成，晚到的结果会被丢弃；取消不保证固定延迟。

## 错误

错误使用 [MediaError](/zh/api/errors)，阶段为 `preparing` 或 `processing`，不包含文件目标状态。

| 错误码                       | 原因                                                |
| ---------------------------- | --------------------------------------------------- |
| `INVALID_OPTIONS`            | 请求选项、显式尺寸无效，或数字 ID 不属于视频轨道。  |
| `NO_TRACKS`                  | 没有主视频轨道，或选中视频轨道没有数据包。          |
| `CODEC_UNAVAILABLE`          | 编解码器未知或视频解码器不可用。                    |
| `UNSUPPORTED_INPUT`          | 不支持的源/容器，或采样时间、几何信息无效。         |
| `IMAGE_ENCODING_UNAVAILABLE` | 缺少 Canvas 编码、2D 绘制 API，或 MIME 类型被替换。 |
| `OUTPUT_TOO_LARGE`           | 解析尺寸或面积超过图片限制。                        |
| `READ_FAILED`                | 源读取失败。                                        |
| `PROCESSING_FAILED`          | 解码、绘制、空图片输出或清理失败。                  |
| `ABORTED`                    | 完成前取消。                                        |
