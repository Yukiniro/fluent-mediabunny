---
title: 波形
description: 把一条音轨读成各声道的 min/max 数组，再把这些数组画成一张 PNG。
---

# 波形

`getWaveformData` 把一条音轨读成峰值数组。`renderWaveform` 只根据这些数组绘制一张 PNG，不再打开媒体。

## 示例 {#example}

```ts
import { getWaveformData, probe, renderWaveform } from "fluentbunny";

const info = await probe(file);
const audio = info.tracks.find((track) => track.type === "audio");
const data = await getWaveformData(file, audio ? { track: audio.id } : {});
const image = await renderWaveform(data, { width: 800, height: 160 });
```

`file` 是浏览器 `File`。第二次调用读取一条音轨。`probe` 没有找到音轨时，它改用主音轨；文件没有音频时以 `NO_TRACKS` 拒绝。`image.blob` 是一张 PNG。`image.startSeconds` 和 `image.endSeconds` 是实际绘制的桶。

## getWaveformData

```ts
function getWaveformData(source: MediaInput, options?: WaveformOptions): Promise<WaveformData>;
```

| 参数      | 类型                                   | 说明                               |
| --------- | -------------------------------------- | ---------------------------------- |
| `source`  | [MediaInput](/zh/api/probe#mediainput) | 原始媒体。转换配置不适用。         |
| `options` | `WaveformOptions`                      | 轨道、桶密度、半开区间和取消信号。 |

**返回：** 一个 `WaveformData` 对象。失败和取消都会拒绝，不返回部分对象。

## WaveformOptions

| 字段              | 类型                  | 默认值      | 说明                                                 |
| ----------------- | --------------------- | ----------- | ---------------------------------------------------- |
| `track`           | `"primary" \| number` | `"primary"` | 主音轨，或非负安全整数音轨 ID。                      |
| `pointsPerSecond` | `number`              | `50`        | 正的有限桶密度。默认每个桶 20 ms。                   |
| `start`           | `number`              | `0`         | 包含的起点，单位为秒，位于共用时间原点上。           |
| `end`             | `number`              | 音轨结束    | 不包含的终点。省略时解码到样本结束，不预先扫描时长。 |
| `signal`          | `AbortSignal`         | 未设置      | 取消解码。                                           |

时间使用 `max(0, input.getFirstTimestamp())`，与[缩略图](/zh/api/thumbnails)相同。区间是半开的。起步较晚、空洞，以及请求范围内没有样本的部分，min 和 max 都保持 0。

峰值保留解码振幅。声道各自独立。函数不归一化、不混合声道，也不写文件。样本按块聚合后释放，不保留完整 PCM。

`min` 和 `max` 合计不超过 64 MiB，按 `bucketCount * channels * 8` 字节计算。已知终点时在解码前检查。该上限只约束这些数组，不是进程内存或解码耗时上限。

读取过程中声道数变化时，以 `UNSUPPORTED_INPUT` 拒绝。

## WaveformData

| 字段                | 类型             | 说明                                                    |
| ------------------- | ---------------- | ------------------------------------------------------- |
| `trackId`           | `number`         | 选中的源音轨 ID。                                       |
| `sampleRate`        | `number`         | 轨道采样率，单位为 Hz。                                 |
| `channels`          | `number`         | 声道数。`min` 和 `max` 各有这么多个数组。               |
| `pointsPerSecond`   | `number`         | 生成数组时使用的桶密度。                                |
| `startSeconds`      | `number`         | 请求的包含起点，相对于 `timeOriginSeconds`。            |
| `endSeconds`        | `number`         | 不包含的终点。省略 `end` 时是最后一个已解码样本的结束。 |
| `timeOriginSeconds` | `number`         | 共用输入原点，`max(0, input.getFirstTimestamp())`。     |
| `min`、`max`        | `Float32Array[]` | 各声道峰值。没有样本覆盖的桶为 0。                      |

第 `i` 个桶覆盖 `[startSeconds + i / pointsPerSecond, startSeconds + (i + 1) / pointsPerSecond)`。

## renderWaveform

```ts
function renderWaveform(data: WaveformData, options: WaveformRenderOptions): Promise<WaveformImage>;
```

| 参数      | 类型                    | 说明                                       |
| --------- | ----------------------- | ------------------------------------------ |
| `data`    | `WaveformData`          | `getWaveformData` 的峰值数组，或同形数据。 |
| `options` | `WaveformRenderOptions` | 必填像素尺寸、可选区间、颜色和取消信号。   |

**返回：** 一个 `WaveformImage`。输入数组不会被修改。

## WaveformRenderOptions

| 字段         | 类型          | 默认值   | 说明                                                                 |
| ------------ | ------------- | -------- | -------------------------------------------------------------------- |
| `width`      | `number`      | 必填     | 正整数像素，最多 4096。                                              |
| `height`     | `number`      | 必填     | 正整数像素，最多 4096，且至少每个声道 1 像素。                       |
| `start`      | `number`      | 数据起点 | 数据时间基准上的包含起点。                                           |
| `end`        | `number`      | 数据终点 | 数据时间基准上的不包含终点。                                         |
| `color`      | `string`      | `"#000"` | 十六进制 RGB 或 RGBA。接受 `#RGB`、`#RGBA`、`#RRGGBB`、`#RRGGBBAA`。 |
| `background` | `string`      | 透明     | 铺满图片的十六进制颜色。省略时不绘制背景。                           |
| `signal`     | `AbortSignal` | 未设置   | 在编码完成前取消。                                                   |

面积上限是 16,000,000 像素。尺寸超出限制时以 `INVALID_OPTIONS` 拒绝。

绘制范围扩展到与 `[start, end)` 相交的每一个完整桶。图片返回扩展后的范围。请求没有落到任何桶上时，以 `INVALID_OPTIONS` 拒绝。

声道自上而下分道。宽度小于或等于所选桶数时，每一列聚合 min 和 max。更宽的图片复用已有桶，不生成更细的峰值。

绘制以 ±1 为一条分道的满刻度。超出范围的值只在计算像素时截断。min 和 max 都为 0 的列不绘制。正振幅朝分道顶部绘制。

## WaveformImage

| 字段                         | 类型          | 说明                            |
| ---------------------------- | ------------- | ------------------------------- |
| `blob`                       | `Blob`        | 非空 `image/png` 字节。         |
| `mimeType`                   | `"image/png"` | 始终是 PNG。MIME 被替换是错误。 |
| `width`、`height`            | `number`      | 请求的像素尺寸。                |
| `startSeconds`、`endSeconds` | `number`      | 图片覆盖的完整桶。              |

编码之后画布重置为 1×1。编码失败或调用方取消时同样重置。

## 错误

错误使用 [MediaError](/zh/api/errors)，阶段为 `preparing` 或 `processing`，没有文件目标状态。

| 错误码                       | 原因                                               |
| ---------------------------- | -------------------------------------------------- |
| `INVALID_OPTIONS`            | 选项、颜色、尺寸、区间或数据无效，或 ID 不是音轨。 |
| `NO_TRACKS`                  | 没有主音轨，或所选音轨没有包。                     |
| `CODEC_UNAVAILABLE`          | 所选音频解码器不可用。                             |
| `UNSUPPORTED_INPUT`          | 来源不支持、缺少布局、采样时间无效，或声道数变化。 |
| `OUTPUT_TOO_LARGE`           | min 与 max 数组将超过 64 MiB。                     |
| `IMAGE_ENCODING_UNAVAILABLE` | 缺少 Canvas 2D 或 PNG 编码，或 MIME 被替换。       |
| `READ_FAILED`                | 读取来源失败。                                     |
| `PROCESSING_FAILED`          | 编码器没有返回字节，或清理失败。                   |
| `ABORTED`                    | 完成前取消。                                       |
