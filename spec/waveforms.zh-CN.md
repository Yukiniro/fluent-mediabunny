# 波形

[English（规范原文）](waveforms.md) | 简体中文

`getWaveformData(source, options?)` 为一条音轨返回 `Promise<WaveformData>`。`renderWaveform(data, options)` 只根据这份数据返回一张 PNG，类型为 `Promise<WaveformImage>`。公开类型见 [types.ts](../src/types.ts)。

`getWaveformData` 按共用[输入契约](conversion.zh-CN.md#输入与探测)读取原始来源。`renderWaveform` 只接受波形数据，不打开、不解码、也不再读取源文件。结果不是 BBC waveform-data.js 文件，也不是 wavesurfer 的峰值列表。

## 波形数据

- `track` 默认使用 Mediabunny 的主音轨。数值是 `probe()` 返回的非负安全整数源音轨 ID。
- `pointsPerSecond` 是正的有限数，默认 50。第 `i` 个桶覆盖 `[start + i / pointsPerSecond, start + (i + 1) / pointsPerSecond)`。
- `start` 默认 0，`end` 可省略。请求区间是半开区间 `[start, end)`。两个边界都是有限非负数，四舍五入到微秒后仍是安全整数。显式 `end` 必须大于 `start`。
- 时间相对于 `max(0, input.getFirstTimestamp())`，与[缩略图](thumbnails.zh-CN.md)共用该原点。`timeOriginSeconds` 报告这个原点。`startSeconds` 和 `endSeconds` 是原点上的位置。
- 默认区间从 0 到所选音轨结束。省略 `end` 时一直解码到样本结束，事先不调用 `computeDuration` 或 `getDurationFromMetadata`。此时 `endSeconds` 是最后一个已解码样本相对原点的结束时间。没有解码出样本时，`endSeconds` 等于 `start`，两组峰值数组都为空。
- 显式 `end` 保留调用方给出的终点。音频起步较晚、时间空洞，以及区间内没有样本的部分，min 和 max 都保持 0。这些零值属于结果。
- 峰值保留解码后的样本振幅。函数不归一化、不混合声道、也不写文件。
- `min[channel]` 和 `max[channel]` 是等长且相互独立的 `Float32Array`。`channels` 取第一次得到的声道布局。后续样本的声道数变化时，以 `UNSUPPORTED_INPUT` 拒绝，不返回结果。
- 样本按块解码，并在拉取下一块前关闭。函数不保留完整 PCM。
- 已知终点时，解码前按精确桶数分配数组。`count * channels * 8` 字节超过 64 MiB 时，在创建 `AudioSampleSink` 前以 `OUTPUT_TOO_LARGE` 拒绝。省略终点时数组会增长，并使用同一上限。64 MiB 只限制这些结果数组，不限制进程内存、浏览器缓存或解码耗时。
- `signal` 取消读取。失败和取消都会拒绝，不返回成功的部分对象。

## PNG

- `width` 和 `height` 是必填正整数。每边最多 4096 像素，面积最多 16,000,000 像素。超出限制为 `INVALID_OPTIONS`。`height` 至少等于 `channels`，使每个声道都有一条分道。多出的像素分给前面的分道。
- `start` 和 `end` 可省略，时间基准沿用波形数据。绘制区间向外扩展到与半开请求相交的每一个完整桶。图片返回扩展后的 `startSeconds` 和 `endSeconds`。请求与任何桶都不相交时为 `INVALID_OPTIONS`。
- 声道自上而下分道排列。`width` 小于或等于所选桶数时，每一列聚合对应桶的 min 和 max。对第 `x` 列和 `n` 个所选桶，来源范围是 `[floor(x * n / width), floor((x + 1) * n / width))`；宽度为零的切片仍读取一个桶。更宽的图片用 `floor(x * n / width)` 复用已有桶，不生成更细的峰值。
- 绘制以 ±1 为一条分道的满刻度。超出该范围的值只在计算像素时截断。输入数组保持不变。聚合后 min 和 max 都为 0 的列不绘制像素。正振幅朝分道顶部绘制。
- `color` 为 `#RGB`、`#RGBA`、`#RRGGBB` 或 `#RRGGBBAA`，默认 `#000`。省略 `background` 时不填充画布，PNG 背景保持透明。提供背景时，先铺满矩形再绘制波形。透明字节除以 255。
- 结果是一张非空 `image/png`、请求的像素尺寸，以及向外对齐后的时间范围。MIME 被替换时为 `IMAGE_ENCODING_UNAVAILABLE`。编码为空时为 `PROCESSING_FAILED`。
- `signal` 可在编码完成前取消。清理时画布重置为 1×1。失败和取消都不返回图片。

## 错误

错误使用 `MediaError`，阶段为 `preparing` 或 `processing`，没有文件目标状态。

| 错误码                       | 含义                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `INVALID_OPTIONS`            | 选项、颜色、尺寸、区间或数据无效，或 ID 不是音轨                    |
| `NO_TRACKS`                  | 没有主音轨，或所选音轨没有包                                         |
| `CODEC_UNAVAILABLE`          | 所选音轨不能解码                                                     |
| `UNSUPPORTED_INPUT`          | 来源不支持、缺少采样布局、采样时间无效，或读取中声道数变化           |
| `OUTPUT_TOO_LARGE`           | min 与 max 数组将超过 64 MiB                                         |
| `IMAGE_ENCODING_UNAVAILABLE` | 缺少 Canvas 2D 或 PNG 编码，或 MIME 被替换                           |
| `READ_FAILED`                | 素材读取失败                                                         |
| `PROCESSING_FAILED`          | 图片编码为空或清理失败                                               |
| `ABORTED`                    | 完成前观察到取消                                                     |
