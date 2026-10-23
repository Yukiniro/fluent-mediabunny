# 音频波形

```ts
import { getWaveformData, renderWaveform } from "fluent-mediabunny";

const data = await getWaveformData(file, { pointsPerSecond: 50 });
const image = await renderWaveform(data, {
  width: 800,
  height: 160,
  color: "#4477ee",
  backgroundColor: "#00000000",
});
const url = URL.createObjectURL(image.blob);
// Revoke url after the application no longer needs it.
```

## getWaveformData

`getWaveformData(source: MediaInput, options?: WaveformOptions): Promise<WaveformData>` 沿用[输入契约](/zh/api/probe)，独立于转换设置，每次处理一条音轨。

| 选项              | 默认           | 规则                             |
| ----------------- | -------------- | -------------------------------- |
| `track`           | primary        | 主音轨或 probe 返回的源音轨 ID   |
| `start`           | 0              | 非负有限秒数，舍入为安全整数微秒 |
| `end`             | 解码到音轨结束 | 可选，须在舍入后大于 start       |
| `pointsPerSecond` | 50             | 每秒输出桶数，正有限数           |
| `signal`          | 无             | AbortSignal                      |

与缩略图共用整个输入的原点 `max(0, input.getFirstTimestamp())`，保留音轨偏移与时间戳空洞。区间左闭右开，解码块内部也按 PCM 位置裁剪。显式区间的无覆盖部分补零。省略 end 时不预先扫描时长；start 不早于解码结束时返回 `INVALID_OPTIONS`。

`WaveformData` 含 trackId、timeOriginSeconds、start、end、pointsPerSecond、`channels: WaveformChannel[]`。每声道独立拥有 min/max 两个 Float32 数组。第 i 桶为 `[start + i / pointsPerSecond, min(end, start + (i + 1) / pointsPerSecond))`，数组长度为微秒舍入后的时长乘每秒点数再向上取整，末桶可不足一整桶。空洞含零，不归一化、不截断原始振幅，反相声道分别保留。

逐块解码并释放样本，结果数组合计最多 64 MiB，超过返回 `OUTPUT_TOO_LARGE`；限制不包括解码器、输入保留或临时扩容与复制。四小时双声道、每秒 50 点的结果为 11,520,000 字节。按实际采样率定位；声道数量变化或 PCM 非有限值返回 `UNSUPPORTED_INPUT`。无音轨或空音轨返回 `NO_TRACKS`，解码不可用返回 `CODEC_UNAVAILABLE`。

## renderWaveform

`renderWaveform(data: WaveformData, options: WaveformImageOptions): Promise<WaveformImage>` 只读取已有波形数据，生成单张 PNG，不重复解码媒体。

| 选项              | 默认      | 规则                                                            |
| ----------------- | --------- | --------------------------------------------------------------- |
| `width`、`height` | 必填      | 正整数，单边最多 4096、面积最多 1600 万像素，高度至少等于声道数 |
| `start`、`end`    | 数据边界  | 同一时间坐标内、完整落在数据范围中的非空区间                    |
| `color`           | #000000   | #RRGGBB 或 #RRGGBBAA                                            |
| `backgroundColor` | #00000000 | 同样的十六进制格式，默认透明                                    |
| `signal`          | 无        | AbortSignal                                                     |

请求向外对齐相交的完整桶，并受数据边界约束。`WaveformImage` 含 blob、`mimeType: "image/png"`、width、height 和实际覆盖 start/end。声道上下分栏，仅绘制时把振幅截断到 ±1，静音为栏中心一像素线。缩小时合并极值，放大时复用已有桶，不增加细节。

数据须包含长度匹配、非共享的 Float32 数组，极值有限且 min 不大于 max，时间与精度一致，数组合计不超过 64 MiB。完成前须保持数据稳定。优先使用 OffscreenCanvas，后备使用 DOM canvas；无渲染/PNG 能力或 MIME 被替换时返回 `IMAGE_ENCODING_UNAVAILABLE`，编码为空返回 `PROCESSING_FAILED`。不提供坐标轴、标签、渐变或文件导出选项。

## 取消与所有权

未知或非法选项、畸形数据返回 `INVALID_OPTIONS`。先校验静态输入，合法且预先取消的调用不读取媒体或分配画布。取消返回 `ABORTED`，等待在途工作与清理并丢弃迟到结果；首次错误优先，后续错误计入 diagnostics，仅清理失败时返回 `PROCESSING_FAILED`。不交付成功的部分结果，也不保证固定取消延迟。

返回数组和 Blob 为独立结果。Worker、保存、序列化、对象 URL 由应用管理，不新增缓存、自动 Worker 或编解码后备。另见[错误码](/zh/api/errors)。
