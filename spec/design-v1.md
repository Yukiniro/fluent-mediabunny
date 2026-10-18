---
title: fluent-mediabunny 第一版 API 与执行契约
version: 1.0.0-spec
date_created: 2026-10-18
last_updated: 2026-10-18
status: specification-only
language: zh-CN
tags: [design, typescript, media, mediabunny, browser]
---

# Introduction

本规格定义基于官方 Mediabunny Conversion 的浏览器端 TypeScript 封装。开发者通过不可变链式配置描述单输入、单输出任务，调用一次 `run()` 完成处理。封装承担输入输出适配、确定性默认值、参数校验、轨道完整性检查、metadata 策略、取消及资源生命周期。

本版已纳入用户要求的两项修订：**删除 preset；metadata 改为支持 merge、replace 与字段删除的对象接口。** 本文件取代此前聊天中与之冲突的设计提案。

状态：正式设计规格，尚无库实现、依赖安装、构建、媒体转码或跨浏览器验收。代码块仅描述接口或预期用法，不是已存在的 API。官方行为以 Mediabunny **v1.61.6** 源码核查为依据；本文中的产品策略属于本封装的决定，不等同于官方默认值。

## 1. Purpose & Scope

### 1.1 首版目标

为调用方隐藏 `Source → Input → Conversion → Output → Target` 接线，同时使转换、轨道取舍、字段丢弃和失败原因可解释。目标用户为浏览器媒体工具开发者。

| 维度     | 首版范围                                                                |
| -------- | ----------------------------------------------------------------------- |
| 平台     | 支持所需能力的浏览器；核心不访问 DOM；调用方可自行放入 Dedicated Worker |
| 输入     | 一个 File / Blob / ArrayBuffer / Uint8Array / 绝对 HTTP(S) URL          |
| 输出     | 一个 MP4 / WebM / M4A / WAV；Blob 或调用方提供的 FileSystemFileHandle   |
| 视频     | 换封装、转码、时间裁剪、缩放、画面裁切、旋转、帧率调整                  |
| 音频     | 提取、移除、转码、重采样、声道调整                                      |
| 控制     | 原文件探测、进度、AbortSignal、结构化错误、结果报告、所有退出路径清理   |
| metadata | 八个描述性字段的复制、覆盖、删除、整体替换                              |

### 1.2 不进入首版

不包含 preset、拼接、多素材合成、叠加、字幕处理、混音、转场、变速、滤镜集合、缩略图、直播/HLS、网络协议转换、Node 适配、自动 Worker 调度、暂停恢复、队列、自动任务重试、任意底层参数透传、用户自定义逐帧回调、任意流输入/输出。

不承诺 FFmpeg 功能兼容、任意编解码器可用、指定文件大小、字节级文件一致、全部容器信息保留、HDR/透明度/色彩管理无损或所有播放器表现一致。首版重编码验收面为普通 SDR 不透明音视频；复制路径允许保留列表内压缩数据，但不据此扩展显示质量保证。

## 2. Definitions

| 术语            | 本文含义                                                            |
| --------------- | ------------------------------------------------------------------- |
| Builder         | 不可变配置描述；不持有已打开的媒体资源                              |
| Run             | 一次独立执行；每次创建自己的 Input、Output、Conversion 和资源作用域 |
| copy            | 复制编码包并重新封装；不代表复制所有 metadata 或原文件字节          |
| transcode       | 解码后重新编码                                                      |
| auto            | 按明确目标编码与处理要求允许复制或重编码                            |
| selected tracks | 根据 `.tracks()` 选中的、底层可读取的音视频轨                       |
| metadata        | 本规格管理的描述性标签；不是容器、轨道、文件系统所有元信息          |
| commit          | 封装层开始关闭真实文件写流以提交结果；进入后不能取消                |
| MUST / MUST NOT | 必须 / 禁止；验收条件                                               |
| SHOULD          | 建议；偏离需在实现说明中说明原因                                    |

## 3. Requirements, Constraints & Guidelines

| ID      | 要求                                                                              |
| ------- | --------------------------------------------------------------------------------- |
| REQ-001 | 提供第 4 节定义的显式配置 API；不得实现 preset 或 copy/strip 字符串 metadata 重载 |
| REQ-002 | Builder 不可变、无媒体 I/O；`probe` 和 `run` 为独立异步终端操作                   |
| REQ-003 | 编码和格式遵守固定矩阵；不得按设备可用性悄悄替换目标编码、采样率或声道数          |
| REQ-004 | 严格检查所有已选音视频轨；未主动排除的轨道丢失必须失败                            |
| REQ-005 | metadata 投影、合并、删除、replace、字段限制和丢弃报告遵守第 4.7 节               |
| REQ-006 | 取消与提交采用单一状态仲裁；提交前取消不得通过 close 提交半成品                   |
| REQ-007 | 只有媒体收尾及文件提交均成功，才返回成功结果                                      |
| REQ-008 | 网络、浏览器权限、输入生命周期和同目标并发遵守第 4.8–4.10 节                      |
| REQ-009 | 结果、错误和进度仅报告真实可观测信息；预测值必须标识为 resolved/planned           |
| REQ-010 | 正常、失败、取消均执行清理；清理失败不得覆盖原始错误                              |
| CON-001 | 仅以官方公开 API 集成 Mediabunny；禁止读取下划线内部字段或依赖私有方法            |
| CON-002 | 严格轨道保留仅指底层暴露的音视频轨；不承诺未暴露字幕、附件等的完整检测            |
| CON-003 | 自定义 WASM 编码器、服务端后端不自动加载；缺能力明确失败                          |
| SEC-001 | 不自动上传、下载、弹保存窗口、申请授权或记录完整带签名 URL                        |
| SEC-002 | metadata 清空不得宣传为隐私擦除；清理不能抹去视频内容、编码位流或所有技术字段     |
| GUD-001 | 使用普通 TypeScript 函数复用配置；无需库内配置模板系统                            |

## 4. Interfaces & Data Contracts

### 4.1 公开接口轮廓

以下为声明性签名，不是实现。实际发布类型必须限制未知属性，并提供运行时校验。

```ts
type MediaInput = Blob | ArrayBuffer | Uint8Array | URL | string;
type Format = "mp4" | "webm" | "m4a" | "wav";
type Mode = "auto" | "copy" | "transcode";
type Quality = "low" | "medium" | "high";
type TrackSelection = "all" | "primary" | readonly number[] | false;
type VideoOptions = {
  codec?: "avc" | "vp8" | "vp9";
  bitrate?: number;
  quality?: Quality;
  frameRate?: number;
};
type AudioOptions = {
  codec?: "aac" | "opus" | "pcm-s16" | "pcm-s24" | "pcm-f32";
  bitrate?: number;
  quality?: Quality;
  sampleRate?: number;
  channels?: number;
};
type ResizeOptions = {
  width?: number;
  height?: number;
  fit?: "contain" | "cover" | "fill";
};
type MetadataPatch = {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  genre?: string | null;
  comment?: string | null;
  description?: string | null;
  date?: string | null; // 严格 YYYY-MM-DD
};
type Target = "blob" | { type: "file"; handle: FileSystemFileHandle };
type RunOptions = {
  target?: Target;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
};
interface MediaBuilder {
  format(value: Format): MediaBuilder;
  mode(value: Mode): MediaBuilder;
  trim(value: { start: number; end?: number }): MediaBuilder;
  resize(value: ResizeOptions): MediaBuilder;
  crop(value: { x: number; y: number; width: number; height: number }): MediaBuilder;
  rotate(value: 0 | 90 | 180 | 270): MediaBuilder;
  video(value: VideoOptions): MediaBuilder;
  audio(value: AudioOptions): MediaBuilder;
  tracks(value: { video?: TrackSelection; audio?: TrackSelection }): MediaBuilder;
  metadata(value: MetadataPatch, options?: { mode?: "merge" | "replace" }): MediaBuilder;
  run(options?: RunOptions): Promise<MediaResult>;
}
declare function media(source: MediaInput): MediaBuilder;
declare function probe(
  source: MediaInput,
  options?: {
    signal?: AbortSignal;
    duration?: "metadata" | "scan";
  },
): Promise<ProbeResult>;
```

`File` 属于 Blob。字符串只解释为绝对 HTTP(S) URL，不解释为路径、相对 URL、data URL 或 blob URL；本地文件直接传 Blob/File。编解码名称使用 Mediabunny 名称，不提供 h264 等别名。

`run()` 必须通过重载或泛型按 target 收窄返回类型：省略 target 或 `'blob'` 返回 BlobResult；文件 target 返回 FileResult。无 `.format()` 时返回 `INVALID_OPTIONS`，不得按文件名、MIME 或输入容器猜测输出。

### 4.2 配置与覆盖语义

- 所有方法返回新 Builder；对象/数组参数复制为配置快照。URL 在创建时快照为字符串。媒体字节不默认复制；调用方必须在 probe/run 完成前保持 ArrayBuffer/Uint8Array 不变且不 detach，不接受 SharedArrayBuffer-backed 输入。
- `format/mode/trim/resize/crop/rotate` 后一次整体替换前一次。
- `video/audio/tracks` 只合并本次显式提供的字段，`undefined` 不覆盖。空对象不改变配置。
- `bitrate` 与 `quality` 为同一互斥配置组：同次都提供时报错；分次设置时后者清除前者。
- 每次 `metadata()` 替换整份 metadata 指令及 mode；其 merge 只与源字段合并，不与前次调用合并。
- 不提供通用 reset、clone 或 build；不可变对象可直接复用。每次 run 创建全新资源；不得复用已关闭 Input/Output。
- 可同步判断的无效参数在相应 Builder 方法抛 `MediaError`；依赖最终配置或输入的校验在 run 的准备阶段拒绝 Promise。probe/run 永远返回 Promise。

### 4.3 参数、时间与几何约束

| 参数                  | 约束与含义                                                              |
| --------------------- | ----------------------------------------------------------------------- |
| bitrate               | 正有限整数，bits/s；不接受单位字符串，不保证最终文件大小                |
| frameRate             | 正有限数，frames/s；不设置则保留原帧率行为，包括 VFR                    |
| sampleRate / channels | 正有限整数；不设置则保留该轨原值，不自动降为 48 kHz/双声道              |
| trim                  | start ≥ 0，end 若提供须 > start；均为有限秒数；以所选轨共同播放起点为零 |
| crop                  | x/y 为非负整数，width/height 为正整数；必须位于旋转后的画面内；超界失败 |
| resize                | 至少一个尺寸；显式宽高为正偶数，避免底层自动对齐改变指定值              |
| fit                   | 两个尺寸均提供时必填；只提供一个尺寸时禁止 fit                          |

裁剪时间原点定义为 `max(0, 所选音视频轨最早的 firstTimestamp)`；请求区间在此基础上换算成底层绝对时间，并将输出起点归零，保留轨间相对偏移。负时间裁剪不支持。显式 trim 必须在准备阶段确定所选轨的结束位置；start 在结束位置或其后、end 超过结束位置均报 `INVALID_OPTIONS`，不静默截短。end 省略时使用结束位置。稀疏轨、编码延迟和帧边界可能使首个样本并非恰好位于零；不得声称样本级连续内容在所有文件中存在。

首版任何 trim 均强制对所选音视频轨重编码；与 copy 冲突。输出时间精度以帧/采样及目标容器时间基为限，不承诺任意小数时刻精确命中一帧。

几何顺序固定为源方向/翻转信息 → 追加旋转 → crop → resize；链式调用顺序不改变该顺序。resize 单边推导遵守固定基线的偶数对齐规则：`even(n)=2×ceil(n/2)`，另一边为 `even(round(已知边/相应宽高比))`；在报告中列出 resolved 尺寸。不得默认“不放大”；显式 resize 可以放大。视频处理参数用于所有所选视频轨，逐轨验证。首版重编码尺寸在轨内发生变化时失败，不暗中选择 pass-through 或新的尺寸策略。

当显式 video/几何参数作用不到任何选中视频轨，或显式 audio 参数作用不到任何选中音轨时，报 `INVALID_OPTIONS`。仅 format 的音频默认值不会要求无声源必须有音轨。`tracks` 已明确排除的类型不能同时带非空处理参数。

### 4.4 输入与输出格式矩阵

#### 输入白名单

| 容器                                    | probe / run | 说明                                         |
| --------------------------------------- | ----------- | -------------------------------------------- |
| MP4、M4A、MOV                           | 纳入        | M4A 使用 MP4 读取器；按文件内容识别          |
| WebM、MKV                               | 纳入        | 只处理可读取音视频轨                         |
| MP3、WAV、Ogg、FLAC、ADTS AAC           | 纳入        | 按内容识别，不以扩展名作为可信依据           |
| HLS、MPEG-TS、CMAF 分段、AVI/ASF/FLV 等 | 不纳入      | 不启用 fallback，也不通过 URL 扩展名变相接受 |

输入编码可由底层识别，但能否执行取决于所需复制/解码路径。未知或不能保留的已选编码明确失败。首版显式使用对应 InputFormat 白名单，不使用包含 HLS 的无限扩展注册表。

#### 输出与编码矩阵（封装的支持面，非容器理论全集）

| format | auto/transcode 默认视频 / 音频 | 可显式指定的编码               | copy 允许的源编码                     | 所选轨约束                                           |
| ------ | ------------------------------ | ------------------------------ | ------------------------------------- | ---------------------------------------------------- |
| mp4    | avc / aac                      | 视频 avc；音频 aac             | 视频 avc、hevc；音频 aac              | 至少一条音视频轨；上限取底层 getSupportedTrackCounts |
| webm   | vp9 / opus                     | 视频 vp8、vp9；音频 opus       | 视频 vp8、vp9、av1；音频 opus、vorbis | 至少一条；合计不超过底层上限，基线为 127             |
| m4a    | 无 / aac                       | 音频 aac                       | 音频 aac                              | 无视频，恰好一条音轨                                 |
| wav    | 无 / pcm-s16                   | 音频 pcm-s16、pcm-s24、pcm-f32 | 音频 pcm-s16、pcm-s24、pcm-f32        | 无视频，恰好一条音轨                                 |

M4A 是封装策略：使用 `Mp4OutputFormat` 写 audio-only MP4，加 `.m4a` 扩展名和 `audio/mp4` MIME；不假设存在 `M4aOutputFormat`。m4a/wav 不会自动移除视频或挑第一音轨，调用方必须用 tracks 明确选择。

| 输出 | 扩展名 | 返回 MIME                          | 固定写入配置                                 |
| ---- | ------ | ---------------------------------- | -------------------------------------------- |
| mp4  | .mp4   | 有视频 video/mp4，否则 audio/mp4   | metadataFormat: mdir；fastStart: false       |
| webm | .webm  | 有视频 video/webm，否则 audio/webm | appendOnly: false                            |
| m4a  | .m4a   | audio/mp4                          | 同 MP4，受上述音轨约束                       |
| wav  | .wav   | audio/wav                          | metadataFormat: id3；large: false，普通 RIFF |

MP4 两种 target 均固定 fastStart=false，避免目标选择悄悄改变封装策略；首版不保证 progressive-download fast start。WAV 不自动切 RF64；封装保守限制最终逻辑文件长度不超过 `0xffffffff` 字节，预计或实际越界报 OUTPUT_TOO_LARGE，文件目标在提交前中止。适配器在写入前按位置检查上限，不等到头部整数已溢出才判断。文件流输出降低整文件缓冲，但不承诺恒定内存，muxer 索引仍可能随文件增长。[S2][S3]

### 4.5 默认编码与模式决策

**auto/transcode 的编码默认由输出矩阵决定，不是沿用源编码，也不依设备挑第一个可用编码。** `.format('mp4')` 处理 HEVC 输入时，auto 将目标解析为 AVC；要保留 HEVC 压缩数据需显式 `.mode('copy')`。删除 preset 后仍需要确定的技术默认值，这些默认值只来自本表。

逐轨执行以下规则：

1. 先解析轨道选择和容器约束，再解析每类轨的目标 codec：显式参数优先，否则用矩阵默认。
2. auto：只有源 codec 与目标 codec 一致，且几何、时间、编码质量及时间戳约束允许时才复制；否则用解析后的 codec 重编码。
3. transcode：全部所选轨重编码，不保留复制分支。
4. copy：忽略矩阵的编码默认，保留源编码；禁止非空 video/audio、trim/resize/crop 和非零 rotate。format、tracks、metadata 可用；rotate(0) 是无操作。源编码不在 copy 白名单，或任何已选轨无法复制时，整项失败。
5. 显式 codec 与 format 不兼容时，不依调用顺序修复，报 `UNSUPPORTED_OUTPUT_COMBINATION`。
6. bitrate/quality 未指定时，编码阶段使用底层基线的 `Quality('high')`；为保持 auto 复制路径，不应仅为默认值就向 Conversion 注入 quality。显式提供 bitrate 或 quality 必须重编码。
7. PCM 的码率由采样率、声道和位深决定，显式 bitrate/quality 在 WAV 下报 `INVALID_OPTIONS`。不得忽略参数装作执行成功。
8. 未指定采样率/声道则保留源值；指定则使用请求值。必须按最终参数验证可编码性，不允许底层失败后悄悄重采样为 48 kHz/双声道。
9. 复制路径不得要求解码器/编码器可用。重编码路径必须检查源解码能力及指定编码的最终尺寸、帧率、采样率、声道等参数；静态查询成功仍不保证运行时编码成功。

基线 Conversion 会优先复制，也包含音频参数 fallback；因此不能只传空选项就声称实现了上述确定性契约。[S1]

### 4.6 轨道选择与完整性

- 默认 `{ video: 'all', audio: 'all' }`，仅针对底层暴露的音视频轨。
- `'primary'` 使用底层主轨选择；默认 all 或 primary 对某类型没有源轨的情况允许为空。
- ID 数组取 `probe` 返回的源轨 `id`，不是数组索引或轨道序号。重复、跨类型、未知 ID、空数组均失败；明确丢弃整类使用 false。
- 未提供的类型保持之前的选择；没有任何选中轨报 `NO_TRACKS`。
- 所选轨不满足目标数量约束报 `TRACK_LOSS`，不得自动截取到容器上限。
- 初始化后同时检查 isValid、utilizedTracks、discardedTracks；主动排除须能解释，其他丢弃一律失败。若实现使用全轨+discard 回调，应核对结果与预期 ID 集合一致。
- 轨道报告包含 selected/excludedByUser；不将底层没有暴露的轨道伪造为“已全部检查”。检测到非音视频内容可报告 `NON_AV_CONTENT_NOT_PRESERVED`，但不得声称检测穷尽。

### 4.7 Metadata 类型、支持矩阵与策略

#### 首版公开字段

| 字段        | 输入类型          | MP4 / M4A（mdir） | WebM（SimpleTags） | WAV（ID3v2.4） |
| ----------- | ----------------- | ----------------- | ------------------ | -------------- |
| title       | string / null     | ©nam              | TITLE              | TIT2           |
| artist      | string / null     | ©ART              | ARTIST             | TPE1           |
| album       | string / null     | ©alb              | ALBUM              | TALB           |
| albumArtist | string / null     | aART              | ALBUM_ARTIST       | TPE2           |
| genre       | string / null     | ©gen              | GENRE              | TCON           |
| comment     | string / null     | ©cmt              | COMMENT            | COMM           |
| description | string / null     | ©des              | DESCRIPTION        | TIT3           |
| date        | YYYY-MM-DD / null | ©day              | DATE               | TDRC           |

表内字符串均按 Unicode 支持设计，必须以中文和 emoji 回读用例验证；各播放器是否展示这些标签不属于本表保证。WAV 明确使用 ID3v2.4，而非底层默认 RIFF INFO；INFO 的 Unicode 限制和字段缺失不被当作本封装的写入行为。ID3-in-WAV 为非默认方案，播放器标签兼容性必须单独标明。[S4][S5][S6][S7]

date 只接受有效公历日期字符串，年份 0001–9999；禁止 Date 对象、带时区日期时间、无效闰日和仅年份。内部构造 UTC 日历日期，避免 JavaScript 0–99 年份构造偏移；输出保留日期，不承诺时间或时区。禁止嵌入 NUL 和不成对 UTF-16 surrogate。空字符串视为明确删除该字段，等同 null，避免 muxer 对空标签存在性的差异；不得 trim 非空文本的首尾空白。

上述用户 patch 类型限制不适用于底层返回的原生类型：源 `metadata.date` 为 Date，投影时先验证有效性及 UTC 年份，再转换为 UTC `YYYY-MM-DD`；生成原生 tags 时再构造 UTC Date。不得因原生 Date 不是字符串而错误丢弃正常源日期。

#### 操作语义

| 调用                                                  | 精确定义                                       |
| ----------------------------------------------------- | ---------------------------------------------- |
| 不调用 metadata                                       | 复制源文件中可读、可验证且属于上述八字段的内容 |
| `.metadata({ title: '新标题' })`                      | 默认 merge；在源字段投影上覆盖 title           |
| `.metadata({ comment: null })`                        | 从投影结果删除 comment                         |
| `.metadata({ title: '新标题' }, { mode: 'replace' })` | 只写本次指定的非空、非 null 字段               |
| `.metadata({}, { mode: 'replace' })`                  | 不写本接口管理的描述性标签                     |
| 再次调用 metadata                                     | 整份指令替换；没有 mode 时重新按 merge 解释    |

缺失/undefined 表示本次没有提供该字段。null 或空字符串内部转换为删除/undefined，不直接作为原生 MetadataTags 的值传入。replace 中的 null 同样表示不写该字段。

**原始字段投影是必要步骤。** 即使不调用 metadata，也不能原样透传 `inputTags`：只复制八个规范字段，始终剔除 raw、images、附件及其他键。否则删除规范字段后，旧 raw 标签可能在同容器转换时被重新写回。[S4][S5][S6]

源 metadata 的处理与用户输入采用不同失败策略：

- 用户显式传入未知字段（如 copyright、creationTime、lyrics、images、raw）报 `UNSUPPORTED_METADATA_FIELD`；显式非法值报 `INVALID_OPTIONS`。不得悄悄忽略用户要求。
- 在默认复制或 merge 下，底层暴露但不在允许列表的源字段不复制，并在报告列为 `omittedSourceFields`，附 `METADATA_SOURCE_FIELDS_OMITTED`。不能获得的 raw 内部字段不逐一猜测，只报告 raw 类别。
- 源字段值无效时省略并报告原因，不让一个损坏标题阻断媒体转换。若同字段被有效显式值覆盖或明确删除，则最终按该指令处理。
- replace 丢弃源字段是主动策略，报告 `replacedSourceMetadata: true`，不逐字段制造警告。
- 用户明确删除的字段列入 `removedByUser`；源本来不存在仍视为成功的幂等操作。

首版不开放 creationTime、copyright、lyrics、封面、track/disc number、BPM、任意 key/value。它们有不同原生映射或额外边界，不能从本表推导支持。尤其基线 ID3 lyrics 存在 Unicode 长度计算不一致的静态风险，暂不纳入公开/复制字段集。[S7]

`metadata({}, {mode:'replace'})` 只清描述性标签。MP4 仍可生成技术创建时间，WebM 仍可写 muxing/writing application；轨道方向、编码配置、媒体内容和文件系统元信息也不受此操作控制。不得称作“删除全部 metadata”。[S8]

### 4.8 URL、输入所有权与 probe

- URL 输入只支持静态有限 HTTP(S) 资源，通过浏览器 GET/CORS 读取；credentials 固定 omit。首版不提供自定义 headers、Request、认证配置或自定义 fetch 入口。
- 网络受同源/CORS、混合内容及浏览器安全策略约束；不代理、不绕过访问控制。仅 URL 中的签名可按浏览器请求正常传递，错误和日志应移除查询参数及凭据。
- 不要求服务器一定支持 Range；允许底层顺序读取，但报告 `rangeSupport: 'unknown'`，除非确有响应证据。不能宣称任意大远程文件都具有随机访问性能。
- 明确关闭 UrlSource 默认无限重试，映射 `getRetryDelay` 为不重试。首次网络/HTTP 失败按原因为 READ_FAILED；取消仍映射 ABORTED。[S9]
- 调用方必须保证 URL 对象内容在一次 run 内一致。源在读取过程中变化时尽可能失败；首版不实现 ETag 快照事务或内容哈希锁定，不能保证检测全部远端变化。
- File/Blob 使用浏览器快照语义；字节数组不得被调用方修改。库不修改、detach 或接管输入对象。
- `probe` 默认 `duration:'metadata'`，时长未知返回 null；scan 才允许扫描计算。结果只描述源文件，与 Builder 输出配置无关。
- ProbeResult 至少包含识别出的容器、durationSeconds/null、durationOrigin（metadata/scanned/unknown）、track id/type/codec|null、视频显示尺寸、音频采样率/声道（可获取时）、八字段 metadata 和已知省略信息。未知值明确为 null，禁止用零伪装。
- probe 支持相同的 signal 和输入清理契约；不写输出、不自动测试所有编码器、不调用解码器只为显示容器信息。

### 4.9 执行状态、取消与事件竞争

内部状态：`preparing → processing → committing → completed`。preparing/processing 可转入 `canceling → canceled` 或 failed；committing 只能完成或失败，不接受取消。Blob 也有很短的 committing 阶段，用于原子决定发布结果。

| 取消时机                             | 必须行为                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 调用前 signal 已 aborted             | 直接拒绝 ABORTED；无读取、网络、Conversion 初始化或文件写流                                                                        |
| 准备阶段（含 probe/Conversion.init） | 记录取消，dispose 已创建 Input；任何晚到的 Output/Conversion 都清理，不得进入 execute                                              |
| processing，包括底层 finalize 期间   | 封装记录取消并阻止后续有效写入；请求 conversion.cancel、dispose Input，并中止真实文件写流；不依赖底层 cancel 一定能打断 finalizing |
| 执行已完成、尚未进入 commit          | 取消胜出，销毁 Blob 结果或 abort 文件暂存写入                                                                                      |
| committing 已开始                    | 忽略随后 abort，等待 close/结果发布；成功返回或按写入错误失败，不能再返回 ABORTED                                                  |
| Promise 已结束                       | 无动作                                                                                                                             |

在首次异步操作前注册监听并检查 signal；在各异步边界检查已锁存状态。进入 commit 时同步执行“检查取消/失败 → 锁定 committing”，二者之间不能 await。commit 通知在锁定后发送；监听该通知再 abort 已经太晚。

首个观察到的终止事件胜出：取消先于处理错误则主错误 ABORTED；处理错误先于取消则保留处理错误；后续错误作为 diagnostics。重复 abort 不重复关闭资源。取消为协作式，不承诺固定毫秒数内终止原生编码或文件系统操作。

库必须跟踪自己创建的异步操作，避免仅用 Promise.race 提前拒绝后让任务继续写出。等待可等待的执行/写入/取消操作落定，调用 Input.dispose，并解除监听；Input.dispose 本身同步且内部部分回收异步，不能声称 Promise 拒绝时所有浏览器内部资源已物理销毁。[S9]

### 4.10 文件写入与提交边界

文件 target 接受调用方已经取得授权的句柄。库不调用 picker 或 requestPermission；首版文件 target 要求 createWritable、isSameEntry、queryPermission 可用，先查询 readwrite，非 granted 报 `PERMISSION_REQUIRED`。这些句柄 API 不完整报 `TARGET_UNSUPPORTED`，不能在无法查询授权时尝试写入并暗中触发授权。浏览器仍可因权限变化在 create/write/close 时拒绝，按实际阶段映射错误。

1. 在纯配置、格式、轨道、编码及 metadata 校验完成前，不创建真实文件写流。Conversion 初始化使用不会打开真实文件的输出适配器。
2. 校验完成后 `createWritable({keepExistingData:false})`；不是追加，不保留旧文件尾部。使用位置写入，维护 `max(position + byteLength)` 作为逻辑输出大小，不累加重复覆盖的字节数。
3. 使用封装拥有的中间 WritableStream 连接 StreamTarget。它的 write 转发为真实文件流的带位置写入并传播背压；**它的 close 不得直接关闭真实文件流**。
4. 原因是基线 `Output.cancel()` 会调用 target 的关闭路径，而 StreamTarget 的关闭路径也调用流的 close。直接把真实文件流交给 StreamTarget，会把“停止转换”与“提交文件”混在一起。[S10]
5. 正常 execute/finalize 结束后，确认写入队列已完成、无先前失败/取消，按 4.9 锁定 committing，然后且仅然后关闭真实文件流。close 成功才报告 `committed`。
6. 提交前失败或取消：禁止真实 close；调用真实流 abort，处理残留队列和输出清理。浏览器的文件暂存语义用于避免未 close 的写入成为正式结果。[S11]
7. close 失败不报告成功，也不假设原文件一定完好；返回 WRITE_FAILED，`targetState:'unknown'`。abort/清理失败同样保留原错误并标记 unknown。
8. 无真实写流时失败的 targetState 为 untouched；成功 abort 后为 aborted（指本任务没有提交，不是对外部文件内容的全局证明）。失败不返回可用的半成品 Blob 或文件成功结果。
9. 不删除调用方通过 picker 新建的空文件；不自动重试覆盖；不把 close 成功等同于断电持久化保证。
10. 同一模块实例内，通过 isSameEntry 在开流前串行判重，针对同一文件的并发 run 报 TARGET_BUSY；成功、失败、取消均释放占用。跨标签页、不同包实例和外部程序不在此互斥保证内。
11. 首版不支持有意原地覆盖输入文件。File 对象不能可靠反查句柄身份，调用方须提供不同目标；不能按文件名相同就断言同一文件，也不能承诺检测全部原地覆盖。

### 4.11 进度、结果与错误

ProgressEvent 为 `{ phase: 'preparing' | 'processing' | 'committing', ratio: number | null }`。ratio 仅表示处理阶段可测进度；preparing/committing 为 null，processing 在时长未知时可为 null。是否订阅进度会影响底层扫描成本，应文档化。只有 run Promise 成功才代表完成。

onProgress 是同步观察回调，不是流程控制入口。回调抛错不得导致已经提交的文件变成失败任务：捕获后记录 CALLBACK_FAILED，停用该回调，继续任务。异步回调不属于支持契约；实现仍应为意外返回的 Promise 安装 rejection handler，避免未处理拒绝，不等待其完成，也不据其状态修改已结束结果。run Promise 结束后不得再发送进度或修改已返回 report。

| 结果       | 字段                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| BlobResult | kind:'blob'、blob、mimeType、size、suggestedFilename、report                                                             |
| FileResult | kind:'file'、filename（句柄实际名称）、mimeType、size、report、commitState:'committed'                                   |
| report     | resolved 格式/模式/逐轨参数；selected 与 excludedByUser；metadata 写入投影、removedByUser、omittedSourceFields；warnings |

输出名与实际 format 不一致不自动改名，记录 FILENAME_EXTENSION_MISMATCH；Blob 默认建议 `output.<extension>`，不暴露源 URL。size 必须为最终逻辑文件长度；无法测量不得用累计网络/写入量替代。报告中的 resolved 编码配置不是逐帧验证结论。没有可靠实际观测接口时不提供“实际使用硬件编码”或“实际 copy/transcode”断言，也不虚构精确最终时长。

MediaError 字段：`code`、`phase`、`message`、`details`、`cause`、`diagnostics`；文件相关错误另含 `targetState:'untouched'|'aborted'|'unknown'`。运行时原始 cause 仅用于本地排错，库不自动日志/遥测；文档要求对外展示前去除 URL 查询、凭据和用户路径。

| code                                                   | 情况                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| INVALID_OPTIONS                                        | 参数值、互斥设置、空轨、时间/几何越界等；空选轨另用 NO_TRACKS |
| UNSUPPORTED_INPUT                                      | 输入容器/输入类型超出白名单                                   |
| UNSUPPORTED_OUTPUT_COMBINATION                         | format 与显式 codec 不兼容                                    |
| CODEC_UNAVAILABLE                                      | 重编码所需解码/编码能力不可用，含最终参数不支持               |
| COPY_NOT_POSSIBLE                                      | copy 白名单不匹配或已选轨必须重编码                           |
| NO_TRACKS / TRACK_LOSS                                 | 无所选轨 / 已选轨无法全部保留                                 |
| UNSUPPORTED_METADATA_FIELD                             | 用户显式请求首版不支持的字段                                  |
| TARGET_UNSUPPORTED / TARGET_BUSY / PERMISSION_REQUIRED | 文件 API、并发或权限条件不满足                                |
| READ_FAILED / WRITE_FAILED / OUTPUT_TOO_LARGE          | 读取、写入/提交、目标格式长度限制失败                         |
| PROCESSING_FAILED                                      | 其他处理失败，保留底层 cause                                  |
| ABORTED                                                | 在 commit 前接受取消；保留 signal.reason 为 cause             |

清理错误不覆盖上述主错误。媒体和文件提交已成功后，非关键输入释放异常应作为 CLEANUP_FAILED 警告报告，不谎称文件未生成；主执行失败时将清理异常放 diagnostics。

## 5. Acceptance Criteria

以下均为待实现的验收要求，当前没有通过记录。

| ID     | Given / When / Then                                                                                        | 关联            |
| ------ | ---------------------------------------------------------------------------------------------------------- | --------------- |
| AC-001 | 给定 base Builder，派生 resize/metadata 分支，原配置不变；重复 run 使用独立资源                            | REQ-001/002     |
| AC-002 | 同类覆盖、字段合并及 metadata 后调用替换分别符合 4.2；不得出现 preset                                      | REQ-001         |
| AC-003 | HEVC→mp4 auto 解析 AVC；copy 保留 HEVC；设备没有 AVC encoder 时 auto 明确失败且 copy 不被编码检查误拒      | REQ-003         |
| AC-004 | WebM 显式 avc、WAV 显式 bitrate、copy+trim 在开文件写流前失败                                              | REQ-003         |
| AC-005 | 指定或源采样率不能编码但 48 kHz 可编码时，必须失败，不能悄悄降采样                                         | REQ-003         |
| AC-006 | 有视频的源导出 m4a 未排除视频时报错；显式排除后保留所选音轨                                                | REQ-004         |
| AC-007 | 多音轨导出 wav 未选择时失败；选 primary/ID 成功；源无音轨的 mp4 处理正常                                   | REQ-004         |
| AC-008 | merge 保留允许字段、null 删除、replace 只写所给字段；同容器 raw 中旧 title 不能复活                        | REQ-005         |
| AC-009 | 八字段在四种 format 中写入后回读，中文/emoji/闰日符合矩阵；unsupported 显式字段在开流前报错                | REQ-005         |
| AC-010 | 源封面/lyrics/raw 等可见字段未复制时有报告；replace 的主动清空不逐字段报警                                 | REQ-005         |
| AC-011 | 预先 aborted 的 run/probe 无读取、fetch、createWritable；初始化中 abort 的晚到资源被回收                   | REQ-006/008/010 |
| AC-012 | 数据写入与底层 finalize 期间 abort，真实 close 调用次数为零，真实 abort 被调用且无成功结果                 | REQ-006/007     |
| AC-013 | commit 锁定后 abort 不将成功改为 ABORTED；close 拒绝则 WRITE_FAILED+unknown                                | REQ-006/007     |
| AC-014 | 网络断开不无限重试，取消中止 URL 读取，不发生未处理 Promise 拒绝                                           | REQ-008/010     |
| AC-015 | 同一目标两个并发 run 只允许一个开流；已有较长文件被成功替换后无旧尾部                                      | REQ-008         |
| AC-016 | 重复位置写入的 size 取最终逻辑长度；文件重新读取可识别，音画轨齐全                                         | REQ-007/009     |
| AC-017 | progress=1 不提前返回成功；观察回调抛错不取消任务、不破坏提交语义                                          | REQ-009         |
| AC-018 | 原始时间戳非零、旋转视频、VFR 裁剪缩放输出正确，音画同步误差纳入素材基准；不把 sample 粒度误差当精确秒保证 | REQ-003         |
| AC-019 | 读取/编码/写入失败+清理失败保留主错误；取消与处理错误竞争按首个已观察事件决策                              | REQ-006/010     |
| AC-020 | WAV 超出普通 RIFF 长度限制时在提交前失败，不静默切换 RF64或生成成功结果                                    | REQ-007         |

## 6. Test Automation Strategy

- 单元测试：建议 Vitest；覆盖参数、覆盖规则、日期与字符串、矩阵、metadata 投影、状态仲裁和错误映射。不得仅镜像 getter/setter 实现。
- 集成测试：真实 Mediabunny；测试公开 API 适配及编解码决策，特别验证底层音频 fallback 不绕过契约。配置不支持的编码能力可以使用受控替身进行失败路径测试，但不能把它当真实编码通过。
- 浏览器测试：建议 Playwright Chromium 为首个实现基线；WebKit/Firefox 以实际能力记录成功路径和明确失败路径。自动化 WebKit 不等同于真实 Safari/iOS 验收。文件句柄真实写入可用 Chromium OPFS；用户可见文件系统的授权、覆盖、取消需额外人工浏览器验收，不以 OPFS 代替全部证据。
- 素材：固定可合法使用的短 MP4 AVC/AAC、HEVC 输入、WebM VP8/VP9/Opus、MP3、WAV；补无音轨、多音轨、非零时间起点、旋转、VFR、奇数输入尺寸、非标准采样率、损坏输入、Unicode/raw metadata。每份素材记录来源、预期轨道和时间基准。
- 验证输出：重新 demux 检查轨道、尺寸、时长、metadata；至少一个独立解析器或播放器交叉验证关键字段，避免仅同库写读掩盖共同错误。
- 文件提交：受控写流注入 write/close/abort 失败与延迟，验证调用顺序；真实文件验收确认未提交写入不替换旧内容。
- CI：运行单元和可稳定运行的浏览器测试；缺少目标 codec 的环境必须明确标记 capability-unavailable，不得作为该成功路径已验收。核心成功组合必须至少在一个具备能力的环境通过才可发布。
- 性能/资源：长视频文件输出与重复成功/失败/取消循环，记录峰值内存、活动读取和句柄趋势；首版不设无依据的通用吞吐量或恒定内存指标。用小型故障注入验证 RIFF 上限保护，不要求 CI 每次生成数 GB 文件。
- 覆盖判定：以 AC-001 至 AC-020 的契约路径全部覆盖为门槛，不用单一行覆盖百分比代替。

## 7. Rationale & Context

1. 删除 preset，减少隐藏尺寸/质量策略和优先级；格式仍必须有公开、稳定的编码默认值。
2. 固定输出编码默认使同一请求不因设备而改变文件类型；能力不足作为可处理错误返回。
3. metadata 八字段覆盖常见用途；统一投影能保证同格式删除不被 raw 反向恢复。默认复制范围的收窄必须在公开文档中明确说明。
4. WAV 固定 ID3 保留 Unicode，接受部分播放器不展示标签的代价；首版不增加第二套 metadata schema 切换接口。
5. trim 首版统一重编码，避免同时承诺关键帧复制速度和任意边界精度。
6. 文件写流关闭与 Conversion 收尾分离，保留可证明的取消/提交边界；这是比缩短调用代码更重要的封装责任。

### 7.1 实现模块与顺序

| 模块                    | 职责                                                |
| ----------------------- | --------------------------------------------------- |
| Builder / config        | 不可变设置、复制参数、合并与互斥规则                |
| Validator / resolver    | 格式、轨道、编码默认、时间几何、metadata 投影与诊断 |
| Input adapter           | Source 白名单、URL策略、probe、Input 所有权         |
| Conversion adapter      | 只用公开 API 创建并检查转换，将配置映射为底层选项   |
| Target adapter / runner | 位置写、背压、状态仲裁、提交屏障、错误与清理        |

执行流程：验证静态配置 → 获取源事实与所选轨 → 解析目标参数和 metadata → 判断复制/重编码所需能力 → 初始化正式 Conversion 并核对轨道 → 创建真实目标流 → execute → 处理收尾 → 提交 → 清理及返回。

复制可行性不得通过“必须能解码”粗略推断。如需区分实际不能复制的轨，可使用临时 Output/NullTarget 上的公开 `Conversion.init({copy:{mode:'forced'}})` 做只初始化的可行性探测，读取 `cannot_copy` 等报告，随后取消该临时转换；不得 execute、打开真实文件流或让临时取消释放仍需复用的 Input。正式转换必须重新验证。

重编码逐轨将目标 codec 固定；显式质量映射为 `Quality(level)` 或 `Quality({bitrate})`，channels 映射 numberOfChannels，crop x/y 映射 left/top。能力查询须显式传入解析后的质量（未指定时为 high）和实际参数，不能使用查询函数自身的 medium/示例尺寸默认值。正式 Conversion 中未显式请求质量的可复制轨仍不注入 quality。精确音频配置通过 canEncodeAudio 检查后才初始化正式转换，以阻止基线音频 fallback 成为静默行为；如果无法用公开 API 及测试维持该契约，则该参数组合必须失败，而不是读取内部字段或修改底层库掩盖问题。输入在执行期间变化不属于稳定参数假设。

实现里程碑：A 配置/矩阵/metadata 契约；B Blob 转换与严格轨道检查；C URL/取消和错误清理；D 文件提交适配；E 浏览器验收与文档。每阶段完成相关验收后再扩大范围，不以源码调研结论代替运行证据。

## 8. Dependencies & External Integrations

| ID      | 依赖与边界                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------- |
| EXT-001 | 官方 Mediabunny Conversion 及公开 Input/Output/Source/Target/Quality/能力探测 API，唯一媒体处理底座 |
| PLT-001 | WebCodecs 或 Mediabunny 已有内建路径；按需要探测，不以存在某个全局变量替代实际 codec/config 验证    |
| PLT-002 | Blob、Fetch、AbortSignal、WHATWG Streams；文件输出额外要求可用且已授权的 FileSystemFileHandle       |
| DAT-001 | 调用方提供的稳定单输入媒体；无默认外部素材或服务                                                    |
| INF-001 | 开发和 CI 浏览器环境；可选真实设备验收，不是运行时服务依赖                                          |
| COM-001 | 保留所分发依赖要求的许可证与声明；本规格不作法律合规验收结论                                        |

服务端服务、账号、遥测、云存储依赖：无。mediabunny 作为 peer dependency；本规格源证据锁定 1.61.6，不宣称全部未来 1.x 行为相同。初次实现锁定该验证基线；公开 peer 范围只能覆盖测试通过的版本，升级必须复核 metadata 和取消/close 路径。

## 9. Examples & Edge Cases

以下均为拟定用法，不能当作已安装可运行代码。

```ts
// 显式转换，不使用 preset。
const result = await media(file)
  .format("mp4")
  .trim({ start: 10, end: 30 })
  .resize({ width: 1280 })
  .video({ bitrate: 2_000_000 })
  .audio({ bitrate: 128_000 })
  .metadata({ title: "片段", comment: null })
  .run({ signal });

// 重复配置由调用方函数复用；不要求库新增机制。
const configureVideo = (task: MediaBuilder) => task.format("mp4").resize({ width: 1280 });

// 提取一条音轨，明确排除视频。
await media(file)
  .tracks({ video: false, audio: "primary" })
  .format("m4a")
  .metadata({ title: "音频" }, { mode: "replace" })
  .run();

// 目标句柄和权限由调用方提前取得；库不会弹出 picker。
await media(file)
  .format("mp4")
  .mode("copy")
  .metadata({}, { mode: "replace" })
  .run({ target: { type: "file", handle }, signal });
```

上述第一个示例显式配置 audio，因此适用于有选中音轨的输入；无声输入应省略 audio 设置。再次调用 metadata 会替换前一次指令：仅当未提供 mode 时才重新默认为 merge，从源字段开始；显式 replace 从空字段集开始，不能假设前一次 title 仍在。WAV 中文标签支持由 ID3 写入契约提供，但播放器可能不显示；不以播放器 UI 的缺省展示判定文件中一定没有标签。

## 10. Validation Criteria

规格交付检查：前述两项修订已整合；输入/输出/编码/metadata 矩阵明确；没有待选择的核心默认值；取消与文件提交竞争有唯一判定；每项关键契约对应可执行验收条件。

实现发布检查：AC-001–AC-020 有证据；真实支持的浏览器/codec/config 组合有版本记录；所有缺能力路径具有可解释错误；文件取消不提交半成品；metadata 删除不被 raw 恢复；peer 版本范围经测试；未纳入范围的功能不出现在公开宣传中。

本次验证仅为文档一致性及官方源码核查。尚未完成任何实现发布检查，不得将此文件称作构建、性能、文件回读或跨浏览器验收证明。

## 11. Related Specifications / Further Reading

固定版本源码为主要证据；在线指南可能随版本更新。链接服务于核对机制，不代表本规格所有产品默认值来自官方。

- **S1** [Conversion v1.61.6](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/conversion.ts)：复制、目标编码选择、音频 fallback、轨道报告、取消及 metadata；[转换指南](https://mediabunny.dev/guide/converting-media-files)。
- **S2** [Output formats v1.61.6](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/output-format.ts)：容器、轨道数量、codec 列表及配置；[输出格式指南](https://mediabunny.dev/guide/output-formats)。
- **S3** [Target v1.61.6](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/target.ts)：带位置流式写入与 close；[写入指南](https://mediabunny.dev/guide/writing-media-files)。
- **S4** [MetadataTags 类型](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/metadata.ts#L30-L90)。
- **S5** [MP4 标签写入及 raw 回退](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/isobmff/isobmff-boxes.ts#L1693-L1834)。
- **S6** [WebM 标签写入及 raw 回退](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/matroska/matroska-muxer.ts#L539-L651)。
- **S7** [WAV metadata 分支](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/wave/wave-muxer.ts#L181-L190)、[ID3 字段路由](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/id3.ts#L675-L767)、[文本/comment/lyrics 编码](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/id3.ts#L897-L956)。
- **S8** [MP4 技术 creationTime](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/isobmff/isobmff-muxer.ts#L225)、[WebM MuxingApp/WritingApp](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/matroska/matroska-muxer.ts#L310-L313)。
- **S9** [UrlSource 请求、重试与销毁](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/source.ts)、[Input.dispose](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/input.ts#L518-L545)。
- **S10** [Output.cancel/finalize](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/output.ts#L970-L1050)、[StreamTarget 关闭路径](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/target.ts#L570-L591)。
- **S11** [WHATWG File System：createWritable](https://fs.spec.whatwg.org/#api-filesystemfilehandle-createwritable)、[File System Access：permissions](https://wicg.github.io/file-system-access/#api-filesystemhandle-querypermission)。

输入上下文为 2026-10-18 的两份 handoff 及本聊天设计讨论；本规格已包含实施所需决定，无需访问临时 handoff 才能理解契约。
