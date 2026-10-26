---
title: 关键帧
description: 解码离某个时间最近的编码关键帧，列出时间范围内的关键帧图像，或在不创建视频解码器的情况下计数。
---

# 关键帧

`thumbnail()` 返回覆盖某个时间的显示帧，这个帧可以是 B 帧。下面三个函数读取的是编码关键帧。它们不改变 `thumbnail` 或 `thumbnails`。

`getKeyFrameCount` 像 LAVFilters 的关键帧计数一样返回一个整数。两个图像函数的名字是这个库自己的选择。Android、Media3、AVFoundation、Mediabunny、FFmpeg 和 GStreamer 都不会用这些名字返回编码关键帧图像。[关键帧契约](https://github.com/Yukiniro/fluent-mediabunny/blob/main/spec/keyframes.zh-CN.md)记录了这个偏离。

## getClosestKeyFrameImage

```ts
import { getClosestKeyFrameImage } from "fluentbunny";

const image = await getClosestKeyFrameImage(file, { time: 2, width: 640 });
if (image) console.log(image.blob, image.sourceTimestamp);
```

```ts
function getClosestKeyFrameImage(
  source: MediaInput,
  options: KeyFrameImageOptions,
): Promise<KeyFrameImage | null>;
```

距离在请求时间的两侧计算。时间戳精确相等时取该帧。距离相等时取更早的关键帧。请求落在第一帧之前或最后一帧之后时，返回边界上的那一帧。没有确认过的关键帧时返回 `null`。

## getKeyFrameImages

```ts
import { getKeyFrameImages } from "fluentbunny";

for await (const image of getKeyFrameImages(file, { start: 1, end: 4 })) {
  console.log(image.sourceTimestamp);
}
```

```ts
function getKeyFrameImages(
  source: MediaInput,
  options?: KeyFrameImagesOptions,
): AsyncGenerator<KeyFrameImage>;
```

关键帧的包起点落在 `[start, end)` 内才会包含。省略某一端表示这一侧不设界。两端都省略，或直接调用 `getKeyFrameImages(file)`，会包含每一个确认过的关键帧，包括时间戳为负的包。`start: 0` 会排除这些包。元数据遍历结束后，图像按显示时间产出。`return()` 会停掉后续的确认和解码。

原始时间戳相同的包合并为一张图像。容器标记为关键帧、但验证后不再是关键包的样本会被丢弃。

## getKeyFrameCount

```ts
import { getKeyFrameCount } from "fluentbunny";

const total = await getKeyFrameCount(file, { start: 1, end: 4 });
```

```ts
function getKeyFrameCount(source: MediaInput, options?: KeyFrameCountOptions): Promise<number>;
```

计数与 `getKeyFrameImages` 使用相同的候选和范围。它不构造视频解码器或画布，但仍可能读取编码包。计数不保证之后解码这些图像会成功。先计数再提取会再次读取来源。

## 选项

`time`、`start` 和 `end` 是有限非负秒。`-0` 会变成 `0`。同时给出两端时，`end` 必须大于 `start`。`track` 默认是主视频轨。

图像调用接受与 [`thumbnail()`](/zh/api/thumbnails) 相同的 `width`、`height`、`fit`、`type`、`quality` 和 `signal`。`KeyFrameImage` 具备缩略图字段，但没有 `requestedTime`。`getKeyFrameCount` 只接受 `track`、`start`、`end` 和 `signal`。

## 错误

| 代码                         | 何时出现                                                               |
| ---------------------------- | ---------------------------------------------------------------------- |
| `INVALID_OPTIONS`            | 选项、时间不合法，或数值 ID 不是视频轨。图像尺寸限制只对图像调用生效。 |
| `NO_TRACKS`                  | 没有主视频轨，或选中的视频轨没有任何包。                               |
| `CODEC_UNAVAILABLE`          | 图像调用无法解码选中的轨。计数不检查解码器。                           |
| `UNSUPPORTED_INPUT`          | 来源不受支持、时间戳超出安全整数，或解码帧的时间与关键包不一致。       |
| `IMAGE_ENCODING_UNAVAILABLE` | 画布编码不可用，或编码器改了 MIME 类型。仅图像调用。                   |
| `OUTPUT_TOO_LARGE`           | 解析后的图像超过单边 4096 像素或 16,000,000 像素面积。仅图像调用。     |
| `READ_FAILED`                | 读取来源失败。                                                         |
| `PROCESSING_FAILED`          | 解码、绘制或清理失败。计数只在清理失败时使用这个代码。                 |
| `ABORTED`                    | 信号在调用完成前中止。                                                 |

空轨是 `NO_TRACKS`。轨里有包但没有确认过的关键帧时，结果是 `null`、空迭代或 `0`。
