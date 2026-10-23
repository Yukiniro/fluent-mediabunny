# 音频波形

[English](waveforms.md) | 简体中文

`getWaveformData(source, options?)` 返回 `Promise<WaveformData>`；`renderWaveform(data, options)` 返回包含单张 PNG 的 `Promise<WaveformImage>`。二者独立于转换构建器设置。公开类型见 [types.ts](../src/types.ts)。

## 波形数据

- 输入沿用 [MediaInput 契约](conversion.zh-CN.md#输入与探测)。`track` 默认选择主音轨，也可指定 probe 返回的音轨 ID。每次只处理一条音轨，不混合轨道或声道。
- `start` 默认 0；可选 `end` 必须大于 start。省略 end 时直接解码到所选音轨结束，不预先扫描时长。时间为非负有限秒数，四舍五入为安全整数微秒；舍入后为空的区间报错。省略 end 且 start 不早于解码结束时返回 `INVALID_OPTIONS`。
- 时间原点为 `max(0, input.getFirstTimestamp())`，与缩略图一致。保留所选音轨的延迟与时间戳空洞，排除相对原点为负的音频。显式区间完整保留请求长度，覆盖之外补零，完全无覆盖的区间也返回零包络。无音轨或所选音轨无编码包时返回 `NO_TRACKS`。
- `pointsPerSecond` 为正有限数，默认 50，即每桶 20ms。第 i 桶覆盖 `[start + i / pointsPerSecond, min(end, start + (i + 1) / pointsPerSecond))`；末桶可不足一整桶。样本位置和覆盖边界按微秒舍入，解码块内部也按 PCM 位置裁剪。
- 结果含 `trackId`、`timeOriginSeconds`、`start`、`end`、`pointsPerSecond` 和 `channels`。每声道分别拥有 `min`、`max` 两个独立的 `Float32Array<ArrayBuffer>`，长度为对微秒舍入后的区间长度乘以每秒点数再向上取整。数组不依赖后续请求或输入资源的存活。
- 缺失覆盖计入零值，包括部分桶内的空洞。保留有限原始振幅，不归一化、不截断，反相声道不会互相抵消。按每个解码样本的实际采样率定位；声道数量变化或 PCM 非有限值返回 `UNSUPPORTED_INPUT`。
- 逐块解码聚合，及时释放样本，不保留完整 PCM。结果数组合计最多 64 MiB，超过返回 `OUTPUT_TOO_LARGE`。该限制不含扩容与复制缓冲、解码器、原生缓存、输入和调用方保留的数据。四小时双声道、每秒 50 点的结果数组为 11,520,000 字节。

## PNG 图片

- 只读取已有波形数据，不打开媒体或重复解码。调用方须在完成前保持数据稳定。输入须为普通对象，包含长度匹配、非共享的 Float32 min/max 数组，极值有限且 min 不大于 max，时间和精度一致，至少包含一个声道。渲染不修改数据。
- `width`、`height` 必填，为正整数；单边最多 4096，面积最多 1600 万像素。高度至少等于声道数，各声道按源顺序上下分栏。
- `start`、`end` 默认使用数据边界，须为数据范围内的非空区间。包含与请求相交的完整桶，结果的 start/end 报告向外对齐后、受数据边界约束的实际覆盖区间。
- 缩小时合并参与像素列的所有桶的 min/max；放大时复用已有桶，不恢复桶内部细节。需要更细图片时须重新生成更高精度数据。
- `color` 默认 `#000000`，`backgroundColor` 默认 `#00000000`；仅接受 `#RRGGBB`、`#RRGGBBAA`。每栏顶部对应 +1、底部对应 -1，仅绘制时截断越界振幅。静音显示为栏中心的一像素线。
- 与缩略图共用 OffscreenCanvas 优先、DOM canvas 后备的编码逻辑。缺少 Canvas/PNG 能力或 MIME 被替换时返回 `IMAGE_ENCODING_UNAVAILABLE`；编码为空返回 `PROCESSING_FAILED`。
- 结果含独立非空 `blob`、`mimeType: "image/png"`、width、height、start、end。保存、对象 URL 和序列化由应用管理；不提供坐标轴、标签、渐变、多图或文件导出。

## 错误与生命周期

二者支持 `signal: AbortSignal`，未知选项或非法值返回 `INVALID_OPTIONS`。先进行静态校验；合法且预先取消的请求不读取媒体或分配画布。错误使用 `MediaError`，阶段为 preparing/processing，不含文件目标状态。所选解码器不可用返回 `CODEC_UNAVAILABLE`，源读取失败返回 `READ_FAILED`。

每次调用独立拥有资源，在结束前等待在途工作和清理。取消丢弃迟到结果并返回 `ABORTED`，失败不交付成功的部分结果。首次错误优先，后续错误计入 diagnostics；仅清理失败时返回 `PROCESSING_FAILED`。取消不保证固定延迟。Worker 和编解码器由应用管理；不新增 Worker、WASM 后备、缓存、进度回调或流式结果。

## 接口调研与范围

`getWaveformData` 的命名与单对象结果参考 [Peaks.js](https://github.com/bbc/peaks.js/blob/master/doc/API.md#instancegetwaveformdata)，其 WaveformData 提供分声道 min/max。同时核对 [BBC waveform-data.js](https://github.com/bbc/waveform-data.js/blob/master/doc/API.md)、[audiowaveform](https://github.com/bbc/audiowaveform) 从已有数据生成单张 PNG 的流程，以及 [wavesurfer](https://wavesurfer.xyz/docs/classes/wavesurfer.default)。renderWaveform 是本库独立渲染函数的命名，不宣称多库共享同名方法。适配保留本库 MediaInput、AbortSignal 和结果所有权，使用已确认的 Float32 表示，不宣称兼容 BBC 文件格式；wavesurfer 的单峰值和图片列表也不等同于本接口。

本次不改变转换设置或缩略图时间契约。Probe 仍报告源事实，不报告解码能力；不增加 probe 时间区间或深度包统计。
