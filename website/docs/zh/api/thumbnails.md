# thumbnail

`thumbnail` 返回一张图像或 `null`。`thumbnails` 为每个请求时间产出一项，包括没有帧的时间。

```ts
function thumbnail(source: MediaInput, options: ThumbnailOptions): Promise<ThumbnailImage | null>;

function thumbnails(
  source: MediaInput,
  options: ThumbnailsOptions,
): AsyncGenerator<ThumbnailItem, void, unknown>;
```

`MediaInput` 与 [probe](/api/probe) 相同。静态校验在任何读取之前运行，并快照选项。迭代器在第一次 `next()` 之前保持惰性。单次请求失败时 `thumbnail` 拒绝。`null` 表示没有帧覆盖该时间。

## ThumbnailOptions

`ThumbnailOptions` 是 `ThumbnailImageOptions & { time: number }`。

`time` 是有限的秒数，可以为 0。它必须能放进四舍五入后的微秒。

## ThumbnailsOptions

`ThumbnailsOptions` 是 `ThumbnailImageOptions` 加上下面两个对象之一。

```ts
{ times: readonly number[]; start?: never; end?: never; count?: never }
{ start: number; end: number; count: number; times?: never }
```

`times` 的长度是 1 到 1000。值有限、非负，并且非递减。`start` 和 `end` 遵守同样的时间规则，并且 `end` 的微秒大于 `start`。`count` 是 1 到 1000 的整数。`times` 与 `start`、`end` 或 `count` 同时出现时抛出 `INVALID_OPTIONS`。

区间时间是 `start + i * (end - start) / count`，`i` 从 0 到 `count - 1`。也就是 `[start, end)` 上等分区间的起点。

## ThumbnailImageOptions

| 字段      | 类型                               | 规则                                            |
| --------- | ---------------------------------- | ----------------------------------------------- |
| `track`   | `"primary"` 或 `number`            | 默认 `"primary"`。数字是视频轨道 id，可以为 0。 |
| `width`   | `number`                           | 正整数，最多 4096。                             |
| `height`  | `number`                           | 正整数，最多 4096。                             |
| `fit`     | `"contain"`、`"cover"` 或 `"fill"` | 两个尺寸都给出时必须有，否则禁止。              |
| `type`    | `"image/jpeg"` 或 `"image/png"`    | 默认 `"image/jpeg"`。                           |
| `quality` | `number`                           | 仅 JPEG，0 到 1，默认 0.8。                     |
| `signal`  | `AbortSignal`                      | 取消读取和编码。                                |

`width * height` 大于 16,000,000 时抛出 `INVALID_OPTIONS`。两个尺寸都省略时使用带方向的显示尺寸。只给一个尺寸时保持该宽高比并四舍五入另一边。两个尺寸使用 `fit`。`"contain"` 和 `"cover"` 从中心留边或裁切。`"fill"` 拉伸。

解析后的宽或高超过 4096，或解析后的面积超过 16,000,000，抛出 `OUTPUT_TOO_LARGE`。

## ThumbnailImage

| 字段                | 类型                            |
| ------------------- | ------------------------------- |
| `blob`              | `Blob`                          |
| `mimeType`          | `"image/jpeg"` 或 `"image/png"` |
| `width`             | `number`                        |
| `height`            | `number`                        |
| `trackId`           | `number`                        |
| `requestedTime`     | `number`                        |
| `actualTime`        | `number`                        |
| `sourceTimestamp`   | `number`                        |
| `durationSeconds`   | `number`                        |
| `timeOriginSeconds` | `number`                        |

`requestedTime` 是调用方的时间。`timeOriginSeconds` 是 `max(0, first timestamp)`。`actualTime` 是 `sourceTimestamp - timeOriginSeconds`，可以为负。`sourceTimestamp` 和 `durationSeconds` 是采样自身的值。

时间以四舍五入后的微秒与采样区间 `[timestamp, timestamp + duration)` 比较。时长非正，或时间戳无法四舍五入时，抛出 `UNSUPPORTED_INPUT`。

## ThumbnailItem

| 字段            | 类型                       |
| --------------- | -------------------------- |
| `index`         | `number`                   |
| `requestedTime` | `number`                   |
| `image`         | `ThumbnailImage` 或 `null` |

一批请求复用一个输入和一个解码器，并按需编码。每个 blob 拥有自己的字节。`break` 和 `return()` 释放输入。手动消费时，放弃迭代器要 await `return()`。同一个迭代器上的调用是串行的。在一次 yield 之后中止，下一次 `next()` 以 `ABORTED` 拒绝。`return()` 等到清理结束。

数字 `track` 不是视频轨道时抛出 `INVALID_OPTIONS`。`NO_TRACKS` 表示输入没有视频轨道，或所选视频轨道为空。`CODEC_UNAVAILABLE` 表示解码器不可用。`IMAGE_ENCODING_UNAVAILABLE` 表示缺少 Canvas 2D 或 `convertToBlob` / `toBlob`，或编码器改了 MIME 类型。`PROCESSING_FAILED` 表示编码器没有返回字节。`READ_FAILED` 表示输入读取失败。
