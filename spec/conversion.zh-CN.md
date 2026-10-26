# 媒体转换

[English（规范原文）](conversion.md) | 简体中文

`media(source)` 构建一次浏览器媒体转换，`run(options?)` 执行转换。公开方法和类型见 [index.ts](../src/index.ts) 与 [types.ts](../src/types.ts)。

处理使用 Mediabunny 的公开 API。Workers 和编解码器安装由应用管理；库不自动回退到 WASM/服务端，也不自动上传或发送遥测。

## 输入与探测

- `MediaInput` 接受 File/Blob、非空字节缓冲（ArrayBuffer 或基于 ArrayBuffer 的 Uint8Array），或绝对 HTTP(S) URL。不支持 SharedArrayBuffer、路径、带内嵌凭据的 URL 或其他 URL 协议。
- 支持的输入容器为 MP4/M4A/MOV、WebM/MKV、MP3、WAV、Ogg、FLAC 和 ADTS。编解码能力取决于运行环境。
- URL 对象保存为字符串快照。有限静态 URL 资源通过匿名 CORS GET 读取，不重试，也不要求支持范围请求。调用者须在完成前保持源字节和远程内容稳定；库不复制或修改媒体字节。
- 选项须为普通对象，未知键会失败。提供 `signal` 时须为 AbortSignal。
- `probe(source, options?)` 返回源容器、顶层时长、选中的音视频轨、筛选后的元数据和省略字段。轨道 ID 是源 ID，不是索引。未知值保持 `null`，不写成 0，也不用估算值填补。
- Probe 默认包含全部音轨和全部视频轨。`video` 与 `audio` 复用转换的轨道选择，即 `all`、`primary`、非空且唯一的源轨道 ID 列表，或 `false`。选择只改变 `tracks`。容器、顶层时长和文件元数据的含义不变。空选择返回 `tracks: []`，不抛出 `NO_TRACKS`。缺失或重复的 ID 为 `INVALID_OPTIONS`。
- 每条选中轨道报告 `startSeconds`、`endSeconds`、`elapsedSeconds`、`default`、`averageBitrate` 和 `peakBitrate`。起点是首个包的时间戳；没有包时为 `null`。终点是该轨的元数据或扫描结束时间戳。起止都已知时，经过时长为 `endSeconds - startSeconds`，否则为 `null`。顶层时长仍遵循下面的元数据或扫描语义。
- 视频轨还报告编码尺寸、显示尺寸、旋转角度 `0 | 90 | 180 | 270` 和 `frameRate`。音频轨还报告采样率、声道数、`language` 和 `name`。容器省略语言或写入 ISO 639-2 `und` 时，`language` 为 `null`。
- `frameRate` 默认为 `{ hertz: null, origin: "unknown" }`。`frameRate: "estimate"` 最多读取前 256 个包；至少两个不同时间戳且间隔为正时，返回 `{ hertz, origin: "estimated" }`，否则保持未知。该估算不是恒定帧率证明，256 个包也不是字节或耗时上限。Mediabunny 在时间戳不足时代入的 timebase 不作为帧率报告。
- 平均码率和峰值码率都是元数据值。缺失值保持 `null`。
- Probe 默认 `duration: "metadata"`。`"scan"` 同时扫描顶层时长和每条选中轨道的终点。未知顶层时长为 `null`，`durationOrigin` 为 `"unknown"`。Probe 报告源事实，不判断编解码能力，并在结束前释放输入。
- Probe 事实留在 `ProbeTrack` 上，不进入转换用的 `TrackInfo` 或转换报告。

## 配置

Builder 方法不进行媒体 I/O，复制选项并返回新 builder。每次 `run()` 独立持有资源。

| 调用                                                 | 重复调用行为                                    |
| ---------------------------------------------------- | ----------------------------------------------- |
| `format`、`mode`、`trim`、`resize`、`crop`、`rotate` | 替换前值                                        |
| `video`、`audio`、`tracks`、`flip`                   | 合并已提供字段；`undefined` 和空对象不覆盖原值  |
| `metadata`                                           | 替换整条指令和模式；默认 `merge` 与源元数据合并 |

`bitrate` 与 `quality` 互斥：同时提供会失败，后设置其中一项会移除另一项。无效方法参数同步抛出 `MediaError`；依赖最终配置或源内容的错误在准备阶段使 `run()` 拒绝。

## 格式与轨道

必须调用 `format()`。编码名称沿用 Mediabunny，不提供别名。每个编码单元格的首项为默认编码。

| 输出 | 视频编码 | 音频编码                  | 视频复制      | 音频复制                  |
| ---- | -------- | ------------------------- | ------------- | ------------------------- |
| MP4  | avc      | aac                       | avc, hevc     | aac                       |
| WebM | vp9, vp8 | opus                      | vp8, vp9, av1 | opus, vorbis              |
| M4A  | 无       | aac                       | 无            | aac                       |
| WAV  | 无       | pcm-s16, pcm-s24, pcm-f32 | 无            | pcm-s16, pcm-s24, pcm-f32 |

- 默认选择全部音视频轨。`primary` 使用 Mediabunny 的主轨道；`false` 排除该媒体类型。ID 列表须非空，包含不重复的非负安全整数，且指向对应类型的轨道。
- M4A/WAV 要求恰好一个音轨且无视频，调用者须显式排除视频。MP4/WebM 在后端限制内保留所选轨道，允许无声视频。
- 未选中轨道返回 `NO_TRACKS`；轨道数量不兼容或意外丢失所选轨道返回 `TRACK_LOSS`。
- 对不存在或已排除的媒体类型设置处理选项会失败。轨道保留不涵盖非音视频内容；发现此类内容时可能报告 `NON_AV_CONTENT_NOT_PRESERVED`。

## 编码与几何处理

- 默认模式为 `auto`：确定显式编码或格式默认编码，再在处理设置允许时复制兼容轨道。`transcode` 重新编码全部所选轨道。
- `copy` 在复制白名单内保留源编码，不需要解码器或编码器。它拒绝 trim、resize、crop、非零旋转、任一轴为 `true` 的 `flip`，以及非空音视频设置。两个轴都为 `false` 时允许。任一所选轨道无法复制时，整个任务失败。
- 编码默认采用 `quality: "high"`；显式质量或码率强制转码。码率为正有限整数，单位 bits/s。PCM 拒绝 quality 和 bitrate 选项。
- 帧率为正有限值，单位帧/秒；采样率和声道数为正整数。省略时保留源行为。请求的配置不可用时失败，不替换编码、采样率或声道数。
- Trim 使用有限的 `start >= 0` 和可选的 `end > start`，相对于 `max(0, min(selected firstTimestamp))`。省略 end 时使用所选轨道的结束时间。start 达到或超过该结束时间，或 end 超出该时间时失败。显式 trim 会转码全部所选轨道、归一化输出时间，并在帧/样本精度内保留轨道间偏移。
- 几何处理顺序固定为源方向/翻转 → 额外旋转 → 额外翻转 → 裁切 → 缩放，与调用顺序无关。旋转角度为 0、90、180 或 270 度。`flip` 分别设置 `horizontal` 和 `vertical`。省略的轴保留前值，`false` 清除该轴。翻转不改变画面尺寸。垂直翻转是水平翻转再加 180 度，因为 Mediabunny 在旋转之后只保存一次水平翻转。裁切 x/y 为非负整数，宽高为正整数，范围须位于旋转后的画面内。
- 缩放至少提供一个正偶数尺寸。同时提供宽高时必填 `fit: "contain" | "cover" | "fill"`；只提供一维时禁止 fit，另一维按 `2 * ceil(round(保持比例计算的尺寸) / 2)` 推算。允许放大。
- 转码拒绝变化的帧尺寸。AVC 转码要求 avcC 描述，且整个源文件的序列参数集保持一致，包括 trim 范围之外。复制不受此限制。

## 元数据

支持 `title`、`artist`、`album`、`albumArtist`、`genre`、`comment`、`description` 和 `date`。

| 指令                                   | 效果                          |
| -------------------------------------- | ----------------------------- |
| 不调用                                 | 复制有效且受支持的源字段      |
| `metadata(patch)`                      | 将 patch 合并到受支持的源字段 |
| `metadata(patch, { mode: "replace" })` | 仅写入 patch 的非空值         |
| 字段设为 `null` 或 `""`                | 删除该字段                    |
| 字段省略或为 `undefined`               | 不提供覆盖值                  |

文本保留空白和 Unicode，拒绝 NUL 和未配对代理项。日期为 0001–9999 年内有效的 `YYYY-MM-DD` 日历日期；源 Date 值取 UTC 日期。

即使不调用 metadata，也会省略原始标签、图片、附件及不支持的字段。默认/merge 模式通过 `METADATA_OMITTED` 报告省略或无效的源字段，显式覆盖优先。Replace 报告 `replacedSourceMetadata`，不逐字段报告省略警告。显式删除记录在 `removedByUser`，即使源中不存在该字段。

MP4/M4A 使用 mdir 标签，WebM 使用 SimpleTags，WAV 使用 ID3v2.4。删除描述性标签会保留技术性容器元数据和媒体内容。

| 字段        | MP4/M4A | WebM         | WAV  |
| ----------- | ------- | ------------ | ---- |
| title       | ©nam    | TITLE        | TIT2 |
| artist      | ©ART    | ARTIST       | TPE1 |
| album       | ©alb    | ALBUM        | TALB |
| albumArtist | aART    | ALBUM_ARTIST | TPE2 |
| genre       | ©gen    | GENRE        | TCON |
| comment     | ©cmt    | COMMENT      | COMM |
| description | ©des    | DESCRIPTION  | TIT3 |
| date        | ©day    | DATE         | TDRC |

## 输出与取消

- 默认目标返回 `BlobResult`；文件目标仅在成功关闭后返回 `FileResult`。报告包含解析后的设置、选中/排除的轨道、元数据变化和警告。解析后的设置不代表逐帧执行实测或实际硬件使用情况。
- 包含视频时 MIME 为 `video/mp4` 或 `video/webm`，否则为 `audio/mp4` 或 `audio/webm`；M4A 使用 `audio/mp4`，WAV 使用 `audio/wav`。
- Blob 文件名为 `output.<format>`。文件输出保留实际名称，必要时报告 `FILENAME_EXTENSION_MISMATCH`。大小为最终逻辑长度。MP4/M4A 禁用 fast start；WebM 不采用仅追加模式；WAV 限于普通 RIFF 的 `0xffffffff` 字节上限，不回退到 RF64。预估或实际大小超限时，在超限写入或提交前失败。
- 文件句柄须已获得读写权限，并提供 `queryPermission`、`createWritable` 和 `isSameEntry`。应用选择与输入不同的目标；库不打开选择器、请求权限、删除选择器创建的文件或自动重试覆盖写入。
- 配置、源、编码、轨道和元数据的准备完成后，才打开实际可写流。成功输出替换原有内容，包括旧尾部字节。同一模块实例内并发写入同一文件会以 `TARGET_BUSY` 失败。
- 预先取消的 signal 不进行媒体 I/O。提交前取消会停止新工作、中止暂存文件写入，并以 `ABORTED` 拒绝，cause 保留 signal 的 reason。失败不返回成功的部分结果。
- 媒体收尾和待完成写入结束后进入提交。在通知 `committing` 前已锁定取消，因此从该回调中 abort 也不再生效。任务等待实际文件关闭或 Blob 发布。仅成功关闭才表示已提交，不保证断电持久性。
- 首个观察到的失败/取消优先。等待自身在途操作和清理完成，后续失败附加为诊断。成功转换后的清理失败报告 `CLEANUP_FAILED`。结束后不再通知进度或修改结果。
- 文件错误通过 `targetState` 报告状态：打开前为 `untouched`，成功中止后为 `aborted`，关闭/中止失败时为 `unknown`。锁仅覆盖同一模块实例，不涵盖其他标签页或程序。

取消采用协作方式，没有固定延迟。任务结束前完成输入释放和自身清理，不保证浏览器内部资源已全部物理释放。重复取消或结束后取消不会重复清理。

`onProgress` 是同步观察回调，接收 `preparing`、`processing` 或 `committing` 阶段。只有 processing 可能提供数值进度，其他阶段或未知进度为 `null`。进度为 1 不代表已提交。回调抛错或返回 Promise 时，以 `CALLBACK_FAILED` 警告禁用回调，不使任务失败。

## 错误

`MediaError` 包含 code、phase、cause、details、diagnostics，以及适用时的文件目标状态。应用对外展示原始 cause 前须脱敏。

| 错误码                                                     | 含义                                      |
| ---------------------------------------------------------- | ----------------------------------------- |
| `INVALID_OPTIONS`                                          | 值、设置冲突、轨道 ID 或几何/时间范围无效 |
| `UNSUPPORTED_INPUT`                                        | 输入或容器不支持，或视频配置发生变化      |
| `UNSUPPORTED_OUTPUT_COMBINATION`                           | 显式编码与输出格式不兼容                  |
| `CODEC_UNAVAILABLE`                                        | 所需解码能力或精确编码配置不可用          |
| `COPY_NOT_POSSIBLE`                                        | 源编码或处理设置无法复制                  |
| `NO_TRACKS`、`TRACK_LOSS`                                  | 选择为空，或无法保留全部所选轨道          |
| `UNSUPPORTED_METADATA_FIELD`                               | 不支持的显式元数据键                      |
| `TARGET_UNSUPPORTED`、`PERMISSION_REQUIRED`、`TARGET_BUSY` | 缺少文件 API、权限或目标正被并发占用      |
| `READ_FAILED`、`WRITE_FAILED`、`OUTPUT_TOO_LARGE`          | 读取、写入/关闭或逻辑大小失败             |
| `PROCESSING_FAILED`、`ABORTED`                             | 执行失败或已接受取消                      |

相关契约：[缩略图](thumbnails.zh-CN.md)、[波形](waveforms.zh-CN.md)、[内嵌图片](embedded-picture.zh-CN.md)。
