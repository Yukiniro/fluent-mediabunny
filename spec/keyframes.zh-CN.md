# 关键帧

[English（规范原文）](keyframes.md) | 简体中文

`getClosestKeyFrameImage(source, options)` 返回 `Promise<KeyFrameImage | null>`。`getKeyFrameImages(source, options?)` 返回 `AsyncGenerator<KeyFrameImage>`。`getKeyFrameCount(source, options?)` 返回 `Promise<number>`。公开类型见 [types.ts](../src/types.ts)。

这些读取使用共享的[输入契约](conversion.zh-CN.md#输入与探测)，不继承转换 builder 的设置，也不改变 [`thumbnail`](thumbnails.zh-CN.md) 或 [`thumbnails`](thumbnails.zh-CN.md)。缩略图是覆盖请求时间的显示帧，可以是 B 帧。关键帧图像是 Mediabunny 承认为关键包的编码随机访问样本。

## 命名

`getKeyFrameCount` 与 LAVFilters `IKeyFrameInfo.GetKeyFrameCount` 的基数一致，都返回一个整数。可选时间范围是额外能力。下列库都没有用这些名字返回编码关键帧图像：

| 库                               | 操作                                      | 返回内容                                                              |
| -------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| Android `MediaMetadataRetriever` | `getFrameAtTime`                          | 一张位图。`OPTION_CLOSEST_SYNC` 是寻址模式，不是列表或计数。          |
| AndroidX Media3                  | `FrameExtractor.getFrame`                 | 一帧。`CLOSEST_SYNC` 是寻址参数。                                     |
| Apple `AVAssetImageGenerator`    | `image(at:)` / `images(for:)`             | 调用方给定时间上的图像。容差可能落在邻近 I 帧，但不会枚举编码关键帧。 |
| LAVFilters                       | `GetKeyFrameCount` / `GetKeyFrames`       | 一个计数，或多条时间戳。不是图像。                                    |
| Mediabunny                       | `getKeyPacket`                            | 一个不晚于给定时间的编码包。不是图像，也不是两侧距离最近的包。        |
| FFmpeg                           | `av_index_search_timestamp`               | 一个索引。                                                            |
| GStreamer                        | `GST_SEEK_FLAG_KEY_UNIT` + `SNAP_NEAREST` | 寻址标志。距离相等时取更早的关键帧。                                  |

`getClosestKeyFrameImage` 和 `getKeyFrameImages` 是相对上表的有意偏离。单张函数使用 closest，避免被读成 Mediabunny 里“不晚于请求时间”的 `getKeyPacket`。

## 选择

- `track` 沿用缩略图规则。默认是 Mediabunny 的主视频轨。数值必须是非负安全整数视频轨 ID。缺失或不是视频轨时为 `INVALID_OPTIONS`。没有主视频轨，或选中的视频轨没有任何包，为 `NO_TRACKS`。
- 时间原点和微秒舍入沿用缩略图规则。原点是 `max(0, input.getFirstTimestamp())`。比较使用 `Math.round(seconds * 1_000_000)`。不要使用会截断的 `VideoSample.microsecondTimestamp`。
- 显式的 `time`、`start`、`end` 是有限非负秒。`-0` 变成 0。同时给出两端时，`end` 必须在微秒舍入前后都大于 `start`。
- 关键帧的包起点（绝对微秒）落在 `[start, end)` 内才属于该范围。省略的一端不设界。两端都省略时包含每一个确认过的关键帧，包括时间戳为负的包。`start: 0` 会排除这些包，因为原点被夹到 0。
- 元数据遍历按解码顺序。结果按显示时间戳排序。原始时间戳完全相等的关键包（包括 `-0` 和 `0`）合并为一个候选。这与“保留每一个时间戳相同的包”不同：`VideoSampleSink` 对一个显示时间戳只解出一帧，若不合并，计数会和图像对不上。
- 容器里的关键帧标记不够。每个候选用 `getPacket(timestamp, { verifyKeyPackets: true })` 确认。扫描本身只读元数据。`verifyKeyPackets` 不能和 `metadataOnly` 一起用。只有验证后的包仍是关键包，且时间戳舍入到同一微秒，才会保留。被降级的包直接丢弃，这一次调用不会在内部改找上一个包。随后再看下一个候选。解码和编码失败会抛出，不会静默跳过。
- 最近指 `origin + time` 两侧显示时间距离最小，比较在共享的微秒网格上进行。精确命中优先。距离相等时取更早的时间戳。请求落在第一帧之前或最后一帧之后时，返回边界上的那个关键帧。没有任何确认过的关键帧时，结果是 `null`、空迭代或 `0`。这和空轨的 `NO_TRACKS` 不同。
- 图像按确认后的包的原始时间戳解码。把该时间戳舍入到微秒后可能落到包的前面。例如 `2002 / 30000` 会舍入成 `0.066733`，比原始值更早，用舍入后的时间查询可能选中上一个包。若解码样本的起点在微秒网格上与包不一致，或舍入后的时长不是正数，调用抛出 `UNSUPPORTED_INPUT`。没有样本则为 `PROCESSING_FAILED`。
- `getKeyFrameCount` 使用与图像调用相同的候选、范围和确认。它不构造视频样本 sink 或画布，也不调用 `canDecode`。计数是确认过的包的个数，不是用时长或 GOP 估算出来的。扫描编码元数据仍然必要。计数不保证之后的图像解码会成功。元数据遍历结束之后才会产出第一张图像。提前 `return()` 会停掉后续确认和解码。不保证第一张图像立即产出，也不保证只靠索引、不读包就能计数。
- 不带选项的 `getKeyFrameImages()` 产出每一个确认过的关键帧。每次调用拥有自己的输入。没有公开的会话或缓存。先计数再提取会再次读取来源。

## 图像

图像选项和限制与[缩略图](thumbnails.zh-CN.md)相同：`width`、`height`、`fit`、`type`、`quality`。`KeyFrameImage` 是去掉 `requestedTime` 的 `ThumbnailImage`。调用方持有 `Blob`。JPEG 把透明合成到黑色上。PNG 保留透明。样本在交付 blob 之前关闭。

## 生命周期

- `getKeyFrameImages` 同步检查选项，第一次 `next()` 才开始读取。对尚未开始的迭代器调用 `return()` 不会产生 I/O。`getClosestKeyFrameImage` 和 `getKeyFrameCount` 返回 Promise，非法选项会使 Promise 拒绝。
- 静态选项先于已中止的信号检查。合法但事先已中止的请求以 `ABORTED` 拒绝，并且不读取来源。
- 每次调用拥有自己的资源。完成、失败、取消、`return()` 和 `for await` 中断都会释放资源。已经交付的 blob 仍可使用。第一次失败优先。之后的清理错误记入诊断。只有清理失败时拒绝为 `PROCESSING_FAILED`。
- 在 yield 之后挂起时中止，会开始清理。下一次 `next()` 以 `ABORTED` 拒绝。显式 `return()` 在清理后正常结束，不是 `ABORTED`。

## 错误

错误使用 `MediaError`，阶段为 `preparing` 或 `processing`，没有文件目标状态。

| 代码                         | 图像                                                                   | 计数                                          |
| ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| `INVALID_OPTIONS`            | 选项、时间、视频轨 ID 或显式尺寸不合法                                 | 相同，但图像尺寸、fit、类型和质量属于未知选项 |
| `NO_TRACKS`                  | 没有主视频轨，或选中的视频轨没有任何包                                 | 相同                                          |
| `CODEC_UNAVAILABLE`          | 编解码器未知，或选中的轨不能解码                                       | 计数路径不产生                                |
| `UNSUPPORTED_INPUT`          | 来源或容器不受支持、时间戳超出安全整数，或解码样本的时间与关键包不一致 | 来源或容器不受支持，或时间戳超出安全整数      |
| `IMAGE_ENCODING_UNAVAILABLE` | 缺少绘制或编码能力，或输出 MIME 被替换                                 | 计数路径不产生                                |
| `OUTPUT_TOO_LARGE`           | 解析后的尺寸或面积超过图像限制                                         | 计数路径不产生                                |
| `READ_FAILED`                | 读取来源失败                                                           | 相同                                          |
| `PROCESSING_FAILED`          | 解码、绘制、空图像或清理失败                                           | 仅清理失败                                    |
| `ABORTED`                    | 完成前取消                                                             | 相同                                          |
