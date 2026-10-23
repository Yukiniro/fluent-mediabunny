---
title: 视频图像提取 — fluent-mediabunny 0.2 设计
version: specification-2.3
status: implemented
date_created: 2026-10-19
last_updated: 2026-10-22
owner: fluent-mediabunny
tags: [design, api, video, extraction, artwork]
---

[English](spec-design-v0-2.md) | 简体中文

# 简介

本文将原先范围较广的 0.2 提案替换为一项完整的业务能力：从视频中提取图像，用于封面、截图和时间轴预览。单张提取、指定时间批量提取和等间隔批量提取在同一批次中定义并交付。下文是 0.2 实现遵循的接口规格；实际验证结果见[验收记录](../docs/thumbnail-validation.md)。

项目旨在简化 Mediabunny 的公开能力，范围不限于 Conversion。本批使用其视频读取基础能力。设计基线为提交 f1a4b9a 的 fluent-mediabunny 0.1.0 和 Mediabunny 1.61.6；公开类型声明已于 2026-10-20 重新核对。本设计不包含依赖升级。

## 1. 目标与范围

### 本批包含

- 在指定呈现时间提取一张图片。
- 根据明确的时间列表按顺序批量提取图片。
- 在明确的时间区间内生成等间隔提取请求。
- 选择主视频轨或指定视频轨 ID。
- 输出 JPEG 或 PNG，支持尺寸控制和 JPEG 质量设置。
- 应用源媒体的方向、翻转和像素宽高比。
- 返回实际帧时间、请求时间、尺寸和 MIME 信息。
- 支持取消、提前退出迭代、有界的封装层缓冲及自动资源清理。
- 将 API 文档、合成测试素材、生命周期测试和浏览器验证记录作为同一批次交付。

### 本批不包含

不提供公共 reader/会话 API、转换计划 API、增强 probe、超出第 12 节单次 `getEmbeddedPicture` 读取的内嵌图片、PCM、波形、原始帧/编码包、精灵图、拼贴缩略图、动图格式、图片文件输入、场景检测、自动最佳封面选择、字幕渲染、叠加图层、裁剪矩形、额外旋转或时间线编辑。不增加输入容器、编码、HLS/直播输入、流适配器、服务端支持、自动 Worker、文件写入、文件选择器、下载、上传或编码器安装能力。

保持 `media(source)...run()` 和现有 `probe()` 的行为不变。图像提取直接读取源媒体，不继承任何转换构建器设置。现有 AVC 序列限制仍只用于转换；图像提取不得增加整文件转码预检。

## 2. 术语定义

- 呈现时间：帧被显示的时间，与编码包解码顺序或帧索引无关。
- 时间原点（Origin）：`max(0, input.getFirstTimestamp())`，输入的所有轨道共用该原点。
- 请求时间：调用者提供或由区间采样生成的、相对 Origin 的秒数。
- 源时间戳：所选帧在源媒体中的原始开始时间戳，单位为秒。
- 实际时间：源时间戳减去 Origin；对于覆盖时间零点的帧，该值可以为负。
- 缺帧：输入和选定视频轨有效，但没有帧覆盖请求时间。它不同于媒体无效或不支持解码。
- 独立结果：后续结果产生、取消或输入释放之后，其数据仍然有效的 Blob。

## 3. 需求、约束与准则

- REQ-001：仅新增 `thumbnail`、`thumbnails` 和 `getEmbeddedPicture` 这三个运行时导出入口，以及文档约定的 TypeScript 类型，其中包括 `EmbeddedPictureOptions`。不添加对应的转换构建器方法或别名。
- REQ-002：复用现有 MediaInput 类型、有限文件输入格式白名单、URL 规范化、匿名 CORS GET 策略和不重试行为。调用者拥有的媒体字节及 URL 内容在操作终止前必须保持稳定。
- REQ-003：使用 Mediabunny 公开 API 完成解复用、轨道选择、解码、时间处理和几何变换。不自行实现编解码器或替代解复用器。
- REQ-004：在任何源数据读取前，验证并保存调用者全部选项和完整时间列表的快照。不复制媒体字节。未知选项键应按现有 API 的一致规则报错。
- REQ-005：一次批量操作打开一个 Input、选择一条轨道并复用一条解码流水线。不得反复调用单张 API，也不得缓冲全部编码后的图片。
- REQ-006：缺帧保留其请求位置。不得静默截断请求时间、丢弃、重排、替换时间戳或回退编码。
- REQ-007：提取解码后的帧不应要求视频编码器可用；图片编码使用浏览器 Canvas 能力。
- CON-001：不提供公共会话、轨道锁、可配置缓存、并发设置或进度回调。批量操作通过已完成条目数和已知总数表达进度，无需第二套事件 API。
- CON-002：现有转换安全规则、默认值、错误及文件提交行为保持不变。
- SEC-001：不将源 metadata 复制到输出图片，也不在成功结果中返回输入 URL。允许浏览器生成的图片头信息；这不保证可见画面中不含私人信息。

## 4. 接口与数据契约

### 4.1 公开 API 形态

以下声明定义已实现 API。类型名、字段名和示例代码与英文版保持一致。

```ts
type ThumbnailImageOptions = {
  track?: "primary" | number;
  width?: number;
  height?: number;
  fit?: "contain" | "cover" | "fill";
  type?: "image/jpeg" | "image/png";
  quality?: number;
  signal?: AbortSignal;
};

type ThumbnailOptions = ThumbnailImageOptions & { time: number };
type ThumbnailsOptions = ThumbnailImageOptions & (
  | { times: readonly number[]; start?: never; end?: never; count?: never }
  | { start: number; end: number; count: number; times?: never }
);

type ThumbnailImage = {
  blob: Blob;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  trackId: number;
  requestedTime: number;
  actualTime: number;
  sourceTimestamp: number;
  durationSeconds: number;
  timeOriginSeconds: number;
};

type ThumbnailItem = {
  index: number;
  requestedTime: number;
  image: ThumbnailImage | null;
};

thumbnail(source: MediaInput, options: ThumbnailOptions): Promise<ThumbnailImage | null>;
thumbnails(source: MediaInput, options: ThumbnailsOptions): AsyncGenerator<ThumbnailItem, void, unknown>;
```

导出类型名为 `ThumbnailImage`、`ThumbnailItem`、`ThumbnailImageOptions`、`ThumbnailOptions` 和 `ThumbnailsOptions`。不公开新的运行时类。

`thumbnail` 在缺帧时返回 null。`thumbnails` 为每个请求产出一个条目，包含缺帧条目，直到成功、失败、取消或调用者终止。成功完成的批次产出数量必须与请求数量完全相同。index 从零开始。批量操作失败时停止该批次，使正在等待或下一次调用的 `next()` 拒绝；不得将失败转换成 null 或静默继续。此前已产出的结果仍然有效。

### 4.2 轨道选择

`track` 默认为 `primary`，通过 Mediabunny 的主视频轨 API 选择，不增加自定义偏好策略。数值必须是非负安全整数轨道 ID，不能当作数组索引。复用现有 `probe()` 返回的 ID。

没有主视频轨或选中视频轨为空时，返回 NO_TRACKS。语法有效但未指向视频轨的 ID 返回 INVALID_OPTIONS。无法识别编码或轨道解码能力检查不通过时，返回 CODEC_UNAVAILABLE。通过能力检查的解码器仍可能在执行时失败。

空轨道不是普通的时间越界。在把 null 帧查找结果视为缺帧之前，必须确认选中轨道至少包含一个视频编码包。只解码选定的视频轨；其他音视频轨无需具备解码器，但确定共同 Origin 时可能需要读取其 metadata。

### 4.3 时间选择与精度

所有外部时间值必须是有限、非负数。Infinity、NaN、负数及负零处理歧义不得进入时间计算；将 -0 视为 0。数值在微秒精度下必须仍可安全表示。

使用 `Math.round(seconds * 1_000_000)`，将参与比较的时间戳转换为最近的整数微秒。拒绝超出安全整数范围的数值或“原点加请求时间”运算。该精度规则同时适用于源帧开始时间、持续时间和请求查找时间。requestedTime 返回调用者通过验证的秒数或生成的秒数；sourceTimestamp/durationSeconds 来自所选样本，actualTime 按约定做差。不承诺精确一致的图片字节或亚微秒级选帧。

对请求 `t`，将 `Origin + t` 按约定舍入为整数微秒，再除以 1_000_000，传入上游按呈现顺序进行的查找。令 S 为舍入后的源帧开始时间，D 为舍入后的持续时间。仅当 `S <= requestMicroseconds < S + D` 时存在图片。上游返回 null，或查找时间不在该帧覆盖范围内时，返回 null。不得无限保持最后一帧或跳转到第一帧。如果返回样本包含非有限时间、不安全运算或舍入后小于等于零的持续时间，应返回 UNSUPPORTED_INPUT，而不是猜测其覆盖区间。呈现开始时间完全相同的帧遵循上游查找选择，不增加基于帧索引的消歧 API。

由此得到以下规则：

- 延迟开始的视频轨在首个被覆盖时刻之前返回 null，即使音频已经开始。
- 时间间隙返回 null，不将上一张图片延长至间隙内。
- 帧覆盖范围不包含结束时刻；在连续帧的交界处选择下一帧。
- 请求位于最终帧结束时刻或之后时返回 null。音频时长不能延长最后一帧视频。
- 开始时间戳为负但覆盖零点的帧可以返回负的 actualTime。
- 可变帧率和 B 帧输入使用真实呈现时间戳，不能使用 `time * fps` 推算。

### 4.4 指定时间批量提取与区间采样

显式 `times` 必须包含 1..1000 个非递减条目。I/O 前验证完整的列表副本。允许重复时间，必须分别产出；内部可以复用不可变的编码后字节。不得排序或去重用户请求。时间越界是有效的缺帧请求。

区间模式必须同时提供 start、end、count，并禁止提供 times。要求在微秒舍入前后均满足 `end > start`，count 为 1..1000 范围内的整数。生成规则为：

`time[i] = start + i * (end - start) / count`，其中 `i = 0..count-1`。

该规则在 `[start, end)` 内划分 count 个等宽区间，采样每个区间的起点。包含 start，不包含 end；count=1 时选择 start。例如 start=2、end=10、count=4 时生成 `[2, 4, 6, 8]`。亚微秒间隔可能使多个请求映射到同一帧或同一个舍入后时间戳，仍需保留所有条目。媒体查找边界继续采用统一舍入规则。

不自动查询时长，不允许省略 end，不支持按 fps 采样，也不隐式扫描整文件。如需覆盖整文件，应用应自行获取并明确提供 end。不采样终点可避免将已知的最终边界误当作存在图片的时间。

### 4.5 尺寸、方向与图片编码

| 选项                     | 契约                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| 未提供宽高               | 使用所选样本应用方向后的显示尺寸，舍入为最近的正整数                                          |
| 仅提供 width             | 保持显示宽高比；height = max(1, round(width / aspectRatio))                                   |
| 仅提供 height            | 保持显示宽高比；width = max(1, round(height * aspectRatio))                                   |
| 同时提供宽高             | 必须显式提供 fit；输出尺寸与请求完全一致                                                      |
| 未同时提供宽高却提供 fit | INVALID_OPTIONS                                                                               |
| contain                  | 保持宽高比，将完整图像居中放入目标矩形，填充剩余区域                                          |
| cover                    | 保持宽高比，填满目标矩形，居中裁掉溢出区域                                                    |
| fill                     | 拉伸到目标矩形，允许改变宽高比                                                                |
| 限制                     | 显式或计算得到的每个维度均为 1..4096 的整数；最终面积不得超过 16,000,000 像素                 |
| 放大 / 奇数尺寸          | 允许，不采用视频编码器的偶数尺寸规则                                                          |
| type                     | 默认 image/jpeg；仅额外接受 image/png                                                         |
| quality                  | 仅用于 JPEG，为包含端点的 0..1 有限数，默认 0.8；为 PNG 显式提供 quality 返回 INVALID_OPTIONS |

先应用源像素宽高比、旋转和翻转，再计算输出几何尺寸。上游公开样本几何信息时，应使用该信息，而不是静默将每个样本拉伸到第一帧尺寸。当一个或两个输出维度由计算得出时，不同返回帧的结果尺寸可以不同。本批不保证所有动态分辨率码流可用，也不纠正解码器不支持的行为；解码失败仍是错误。不得运行仅用于转换的 AVC 序列扫描。

实现兼容性补充：当解码样本报告方形像素、编码尺寸与轨道一致、轨道却提供非方形像素比例时，以轨道比例补齐样本尺寸；macOS WebKit 实测需要此回退。如果解码器改变了画面像素尺寸，则保留样本几何：Linux WebKit 将该 2:1 像素比例转换为 80×20 的方形像素画面，而非 160×40，再次应用轨道比例会造成拉伸。因此不同解码后端的原始输出尺寸可能不同，但应保持显示宽高比。样本暴露的非方形比例优先，不重复应用轨道比例。固定的轨道元数据无法区分未被解码器正确暴露的动态像素比例变化，因此不保证该类码流的正确显示。

JPEG 将透明区域和 contain 留白合成到不透明黑色背景。PNG 在可获取解码后 alpha 时予以保留，contain 留白使用透明背景。不提供自定义背景选项。解码器未提供的源 alpha 无法重建。不承诺 HDR 保留、受控色调映射或跨浏览器渲染流水线的颜色完全一致。

在分配输出 Canvas 前拒绝超限的最终尺寸，不得静默缩小。原生解码帧内存不受此 Canvas 分配限制保护。PNG/JPEG 编码后必须确认返回 Blob 非空，且 MIME 与请求一致。浏览器替换格式返回 IMAGE_ENCODING_UNAVAILABLE；编码返回 null 或编码操作失败返回 PROCESSING_FAILED。结果 MIME、Blob MIME 及尺寸必须与编码后的图片一致。

不返回 Canvas、VideoFrame、VideoSample、对象 URL、base64、文件句柄或已下载文件。应用负责对象 URL 的创建、撤销及保存。输出为独立 Blob，池化或复用不得改变此前返回的图片。

### 4.6 调用、取消与迭代生命周期

`thumbnail` 是异步操作，验证错误使其 Promise 拒绝。`thumbnails` 是工厂函数，同步保存选项快照并验证；选项格式错误时同步抛出 INVALID_OPTIONS。首次 next() 之前不进行源 I/O 或分配解码器。有效但已取消的 signal 会使首次 next() 以 ABORTED 拒绝，且不发生读取。单张调用先验证静态选项，再检查 signal 是否已取消。对尚未启动的迭代器调用 return() 不执行任何操作，也不发生 I/O。

每次调用拥有各自的 Input、sink、样本、Canvas 和 abort 订阅。独立调用不共享隐藏的全局 reader 或缓存。允许并发调用，但各自消耗独立资源。批量迭代器面向单消费者，文档约定按顺序调用 next()/return()。

批次内所有请求共用一个 Input 和一个 sink。每次只编码一张请求图片，消费者请求下一条目之前不得开始下一张图片编码。允许上游进行有界的解码预读。除消费者保留的对象外，封装层最多保留一张编码图片及可复用渲染缓冲。上游源缓存和浏览器编解码分配应分别计算，不宣称总内存始终为常量。

成功、错误、取消、迭代器 return() 或 for-await 提前 break 时，都必须释放资源。手动使用迭代器的调用者在放弃操作时必须等待 return()；仅丢弃迭代器引用不是受支持的清理方式。即使生成器在 yield 后处于暂停状态，abort signal 也必须主动触发清理，无需等到下一次 next()。随后调用 next() 时以 ABORTED 拒绝；显式 return() 表示正常终止并等待清理。

取消无法强制中断所有浏览器编解码或 Canvas 编码操作。应停止新工作，请求输入/解码器取消，并等待封装层拥有的在途操作和清理。如果结果交付前已先观察到取消，丢弃随后到达的编码结果。观察到取消后不得交付新结果。已交付的图片仍然有效。单张 Promise 已成功完成或批次正常完成后，abort 不再生效。最先观察到的终止性失败优先；后续清理错误作为诊断附加，不替换首个错误。如果正常完成/return() 时只有清理失败，应报告 PROCESSING_FAILED。

单张调用的 Promise 成功完成，以及批次最终 done/return 完成，均应发生在自身资源清理之后。每个样本必须在对应 Blob 交付前释放。消费者提前 break 属于正常终止，不是 ABORTED。外部 I/O 缓慢时，不保证取消在固定毫秒数内完成。

### 4.7 错误映射

复用现有 MediaError 类和首个失败优先的处理。提取错误使用现有 phase preparing 或 processing，不会进入 committing；由于没有可写目标，不提供 targetState。现有 ErrorCode 联合类型仅增加 IMAGE_ENCODING_UNAVAILABLE。

| 条件                                                    | 结果                       |
| ------------------------------------------------------- | -------------------------- |
| 选项格式错误、轨道 ID/类型错误、区间/列表/尺寸/质量无效 | INVALID_OPTIONS            |
| 不支持的源类型/容器、解码后的时间/几何数据无效          | UNSUPPORTED_INPUT          |
| 没有主视频轨或选中轨道没有编码包                        | NO_TRACKS                  |
| 所选视频无法解码 / 编码无法识别                         | CODEC_UNAVAILABLE          |
| 缺少渲染/编码 API，或图片 MIME 被替换                   | IMAGE_ENCODING_UNAVAILABLE |
| 源 fetch/读取失败                                       | READ_FAILED                |
| 解码、渲染或图片编码执行失败                            | PROCESSING_FAILED          |
| 输出图片超过约定尺寸限制                                | OUTPUT_TOO_LARGE           |
| 完成前观察到取消                                        | ABORTED                    |
| 轨道有效，但没有帧覆盖请求时间                          | null 图片，不是错误        |

静态尺寸限制失败返回 INVALID_OPTIONS；推算尺寸或源原生尺寸超限返回 OUTPUT_TOO_LARGE。不能仅因一次转换失败，就把运行时解码错误误标为不支持编码。原生 cause 仍是诊断数据，应用在展示前应进行脱敏。

## 5. 验收标准

所有标准都属于本批，不能延后到无关 API 版本中完成。

| ID     | 前提 / 操作                                                      | 必须达到的结果                                                      |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| AC-001 | 可解码的有限视频；请求位于帧覆盖范围内                           | 返回 JPEG/PNG Blob，轨道与时间字段正确，解码后的图片尺寸与结果一致  |
| AC-002 | 有序时间列表包含重复项和缺帧时间                                 | 按原始顺序为每个请求返回一项，index/time 稳定，保留 null            |
| AC-003 | 区间 2..10，count=4；另测 count=1                                | 请求时间恰好为 2、4、6、8；count=1 恰好为 2；不包含 end             |
| AC-004 | 空列表/乱序列表/混用列表与区间选项、NaN/Infinity、无效质量或尺寸 | 任何源读取前返回约定的验证错误                                      |
| AC-005 | 两条不同的视频轨；分别按显式 ID 和 primary 选择                  | 正确选择轨道；音频 ID 被拒绝，不静默替换轨道                        |
| AC-006 | 仅音频输入或空视频轨                                             | NO_TRACKS，不将其误报为成功但无图片                                 |
| AC-007 | 延迟起点、负时间戳覆盖零点、间隙、精确边界、视频早于音频结束     | 验证半开覆盖区间及两套时间基准                                      |
| AC-008 | 带已知画面标记的 VFR 与 B 帧素材                                 | 呈现图像正确，不猜测帧索引，也不选择最近关键帧代替                  |
| AC-009 | 旋转、翻转、非方形像素、contain/cover/fill、奇数尺寸             | 几何、居中和画面正确；输出分配前执行限制                            |
| AC-010 | 透明素材与 contain 留白                                          | JPEG 黑底合成；解码器支持时 PNG 保留 alpha                          |
| AC-011 | 源原生尺寸或推算尺寸超过输出限制                                 | OUTPUT_TOO_LARGE；不分配超大输出 Canvas                             |
| AC-012 | PNG 携带 quality、图片 API 不可用、MIME 回退、编码返回 null      | 返回精确约定的错误，不静默替换格式                                  |
| AC-013 | 在后续 yield、完成、取消之后保留此前图片                         | 之前的 Blob 字节及解码图像内容不变                                  |
| AC-014 | 预取消、读取/解码/编码过程中取消、yield 后暂停时取消             | 不延迟交付新图片，无未处理的拒绝，无需再次 next() 即触发清理        |
| AC-015 | 正常完成、提前 break、显式 return()、批次中途失败                | 释放样本和拥有的资源；已完成图片可用；保留首个错误                  |
| AC-016 | 缓慢消费 1000 个条目且不保留 Blob                                | 仅一个 input/sink，不累积编码图片，活跃渲染/样本资源数量有界        |
| AC-017 | 创建但不启动批次；创建后修改原选项/times                         | 初始不发生 I/O；迭代器使用原始已验证快照                            |
| AC-018 | 所选解码器不支持，但源可被探测或复制                             | 提取返回 CODEC_UNAVAILABLE；原有 probe/copy 行为不受影响            |
| AC-019 | 浏览器消费者导入打包后的函数                                     | 两个 API 及声明的结果类型都能通过构建产物使用，而不只是开发源码可用 |
| AC-020 | 运行现有转换、metadata 和文件安全测试                            | 行为及默认值无回归，所有必需检查通过                                |

## 6. 自动化测试策略

使用 Vite+ 和现有 Playwright Chrome/Firefox/WebKit 项目。创建短小、可再分发的合成素材，包含已知颜色、帧标识、时间戳、方向和轨道 ID。仅在现有素材无法覆盖验收标准时补充针对性素材。通过独立 ffprobe 时间结果及解码后图像断言验证；避免要求有损 JPEG 在不同浏览器中字节完全相同。在固定的浏览器环境中，PNG 和 JPEG 均必须有真实成功用例，每个浏览器项目至少实际执行一种受支持的视频解码器。其他不可用编码单独记录，不能计为提取成功。

单元/生命周期测试验证静态规则、请求生成、安全时间运算、错误优先级、清理次数、有界封装层资源、MIME 替换及延迟图片编码。浏览器测试验证真实解码内容、尺寸、受支持时的透明度、稀疏选帧、URL 失败/取消和构建产物使用。JavaScript 堆检查不能完整测量原生编解码内存；记录重复运行观察，不据此宣称无泄漏。

不能将历史失败 CI 当作当前证据重复使用。实现交付必须记录依赖/浏览器版本、实际结果、有理由的跳过项及新提交的 CI 状态。自动化 WebKit 不等于 Safari/iOS 验收。开发中发现实现限制时，应明确调整设计并记录，不能静默放宽测试。

## 7. 设计理由与背景

本批是完整的视频图像提取业务，不是仅发布一个方法，也不是大范围扩展媒体工具箱。单张截图、指定时间批量截图和时间轴采样共享解码、渲染及生命周期契约，因此一起交付。

两个面向任务的函数免去了强制的公共会话管理，与现有独立 probe 一样，可以和 fluent 转换 API 共存。批量提取在有实际收益的场景中复用资源。按等宽区间起点采样的规则明确，不会意外请求不包含在范围内的最终边界。缺帧条目保留 UI 中的位置。

## 8. 依赖与实现方案

保持固定的 Mediabunny 版本和 Vite+ 技术栈，不计划新增运行时依赖。复用现有输入规范化/打开流程和 MediaError 约定。尽可能与 Scope 集成，但不能仅为了适配暂停中的提取迭代器而改变其转换语义。

计划流程：

1. 规范化并保存选项快照，生成有限请求列表。
2. 打开一个 Input，确定视频轨及共同 Origin，检查其解码能力。
3. 使用 VideoSampleSink 的 getSample/samplesAtTimestamps；若时间与逐样本几何信息足够，也可使用 CanvasSink。有序请求采用上游稀疏读取能力。
4. 检查帧覆盖区间。使用公开样本/Canvas 能力处理方向与尺寸，编码一个独立 Blob 并验证 MIME。
5. 释放当前样本，再完成 Promise 或 yield 结果。没有覆盖帧时，产出带索引的 null 条目。
6. 任何终止路径都关闭上游迭代器/样本，释放 Input 和渲染资源，并移除 abort 监听器。

两个公开函数共用一条内部提取路径。允许可复用的内部资源管理作用域，不要求公共 Reader、全局缓存、自定义调度器或插件系统。未经验证，不能仅依赖 CanvasSink 就假定帧结束覆盖检查或动态样本几何正确。由于关键帧依赖，可能需要读取和解码请求时间之前的数据；不承诺随机访问延迟。

预计实现涉及导出/类型、独立的图像提取模块、可复用输入/错误辅助函数、单元与浏览器测试、合成素材生成、README 示例和验证记录。现有转换规划、目标文件提交逻辑、编码白名单及依赖版本不在修改范围内，除非确认存在必须修正的共享缺陷。

## 9. 使用示例与边界情况

```ts
import { thumbnail, thumbnails } from "fluent-mediabunny";

const poster = await thumbnail(file, { time: 2, width: 640 });

for await (const entry of thumbnails(file, {
  times: [0, 2, 2, 5],
  width: 160,
  type: "image/png",
  signal,
})) {
  if (entry.image) showPreview(entry.index, entry.image.blob);
  else showPlaceholder(entry.index);
}

for await (const entry of thumbnails(file, {
  start: 2,
  end: 10,
  count: 4,
  width: 160,
  height: 90,
  fit: "cover",
  quality: 0.8,
  signal,
})) {
  showTimelineEntry(entry);
  if (previewClosed()) break;
}
```

示例展示应用调用方式，界面辅助函数由调用方提供。应用管理 Blob URL 及其撤销。主动保留每个 yield 的 Blob 会增加应用内存。不保证底层输入快照或远程内容锁定。仅有解码帧尺寸变化，不应触发转换预检；如果解码器正确暴露这些信息，就按每个样本计算几何，否则不得宣称支持该码流/浏览器组合。

## 10. 交付门槛与后续批次

本设计取代 draft-1 对公共 reader、增强 probe、PCM/波形、封面及 plan 的交付承诺。`plan()` 从近期路线中移除。满足上述全部需求和验收标准之后，才能宣称视频图像提取已交付。用户已于 2026-10-21 授权按本规格实现本批功能。

后续批次仅保留方向，不分配版本号，也不视为已批准的 API 契约：

| 业务能力       | 候选范围                                          |
| -------------- | ------------------------------------------------- |
| 媒体信息与标签 | 详细 probe、轨道属性、内嵌封面、metadata 支持扩展 |
| 音频提取与分析 | PCM、时间区间、波形、明确的时间/声道行为          |
| 媒体创建       | 从帧/Canvas/音频生成文件、时间戳、交错写入、背压  |
| 转换能力扩展   | 有兼容性证据支撑的所需格式/编码及逐轨控制         |

第 12 节先于该批次交付一次内嵌图片读取。这并不批准该行的其余范围。

录制、HLS 和服务端适配器需要以后单独确定范围，不得隐式纳入上述批次。

## 11. 能力清单与参考资料

下列历史基线清单仅保留为背景信息。它不是 0.2 的交付范围，也不承诺封装每一种上游基础能力。

| 能力              | Mediabunny 基线                                                                                      | 当前封装的公开能力                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 文件与缓冲输入    | Blob、缓冲、文件路径、自定义源及范围读取源                                                           | File/Blob、ArrayBuffer、Uint8Array                                                                     |
| 网络与流输入      | URL、流、路径型源、可配置 fetch                                                                      | HTTP(S) URL、匿名 CORS GET、不重试                                                                     |
| 输入容器          | ISO BMFF、QuickTime、Matroska、WebM、MP3、WAVE、Ogg、ADTS、FLAC、MPEG-TS、HLS                        | 除 MPEG-TS 和 HLS 外的所列格式族；并非每种容器变体都接受或已测试                                       |
| 输出容器          | MP4、MOV、MKV、WebM、Ogg、MP3、WAVE、ADTS、FLAC、MPEG-TS、CMAF、HLS                                  | MP4、WebM、M4A、WAV                                                                                    |
| 编码类别          | AVC、HEVC、VP8/9、AV1、ProRes；AAC、Opus、MP3、Vorbis、FLAC、AC-3/E-AC-3、DTS；PCM 变体；WebVTT 写入 | 显式编码选项为 AVC/VP8/VP9、AAC/Opus/PCM s16/s24/f32；复制白名单在指定容器中额外包含 HEVC、AV1、Vorbis |
| 文件探测          | MIME、时长、开始时间、标签、轨道查询                                                                 | 容器、时长、基础音视频字段、8 个文本/日期标签                                                          |
| 轨道探测          | 语言、名称、用途、时间、解码器配置、码率、帧率统计、几何及色彩信息                                   | ID、编码、显示尺寸或采样率/声道数                                                                      |
| 运行时能力查询    | 精确配置的编解码查询，可感知自定义编解码器                                                           | 仅内部预检                                                                                             |
| 编码包读取        | 定位、关键帧、按解码顺序迭代、只读包信息                                                             | 仅内部 AVC 预检                                                                                        |
| 解码后视频读取    | 随机/区间/稀疏访问、VideoSampleSink、CanvasSink                                                      | 仅内部尺寸扫描                                                                                         |
| 解码后音频读取    | AudioSampleSink、AudioBufferSink                                                                     | 没有独立提取 API                                                                                       |
| Metadata          | 结构化标签、封面、歌词、编号、自定义标签和附件                                                       | 8 个受支持的文本/日期字段；不透传封面或 raw 标签                                                       |
| 文件转换          | 复制/转码、时间裁剪、几何变换、重采样、轨道策略                                                      | 当前主要实现能力，带严格默认值与错误处理                                                               |
| 高级 Conversion   | 翻转、alpha、逐轨选项/轨道分流、处理回调、暂停、分段执行、组合输出                                   | 未公开                                                                                                 |
| 媒体创建          | Canvas、音视频样本、AudioBuffer、编码包写入轨道                                                      | 没有创建 API                                                                                           |
| 录制              | 调用者提供的 MediaStream 轨道、背压和输出源                                                          | 未公开                                                                                                 |
| 字幕处理          | 通过文本源输出 WebVTT；不支持字幕读取                                                                | 未公开                                                                                                 |
| 输出传输          | Buffer、定位写入流、仅追加流、路径、范围/路径型目标                                                  | Blob 和已授权文件句柄，带提交屏障                                                                      |
| HLS               | VOD/live 读写、变体、分片、播放列表目标、特定加密方案                                                | 未公开                                                                                                 |
| 扩展              | 注册自定义编解码器；官方 AAC/MP3/FLAC、AC-3、DTS、ProRes 和 server 包                                | 没有封装注册 API；外部注册的兼容编解码器可能影响上游能力检查                                           |
| 服务端运行时      | 可选 server 扩展、原生编解码器和变换                                                                 | 仅浏览器                                                                                               |
| 播放/编辑基础能力 | 定位、样本、调度所需输入、自定义处理、可组合轨道                                                     | 没有播放器或编辑器                                                                                     |

容器支持、编码识别、解码、编码和执行成功仍是不同概念。清单基于已安装的 1.61.6 公开能力，不代表每种编码/容器组合都能在每个浏览器运行。

- [第一版契约](design-v1.md)
- [现有验证记录](../docs/validation.md)
- [官方 media sinks：帧查找、稀疏采样与生命周期](https://mediabunny.dev/guide/media-sinks)
- [官方 packets 与 samples](https://mediabunny.dev/guide/packets-and-samples)
- [官方读取指南](https://mediabunny.dev/guide/reading-media-files)
- [官方格式与编码说明](https://mediabunny.dev/guide/supported-formats-and-codecs)
- [官方 media sources](https://mediabunny.dev/guide/media-sources)
- [官方输出格式](https://mediabunny.dev/guide/output-formats)
- [官方 Conversion 指南](https://mediabunny.dev/guide/converting-media-files)
- [官方 HLS 读取](https://mediabunny.dev/guide/reading-hls)及[写入](https://mediabunny.dev/guide/writing-hls)
- [官方 server 扩展](https://mediabunny.dev/guide/extensions/server)

## 12. 内嵌图片读取

本节增加一次内嵌图片字节读取。它是与 `probe` 和 `thumbnail` 并列的独立函数。返回的是文件自带的图片字节，不是解码后的视频帧。操作者于 2026-10-22 要求增加该 API，并在同一天改为遵循已有库的操作。

操作名和结果基数遵循 Android [`MediaMetadataRetriever.getEmbeddedPicture()`](<https://developer.android.com/reference/android/media/MediaMetadataRetriever#getEmbeddedPicture()>)，该方法返回一个 `byte[]` 或 null。同一次调研还核对了 music-metadata 的 [`selectCover`](https://github.com/Borewit/music-metadata)（一张图片或 null）、jsmediatags 的 `tags.picture`、Mediabunny 的 `MetadataTags.images`、FFmpeg 的附加图片、fluent-ffmpeg 的 `disposition.attached_pic`，以及 AndroidTagLib 的 `getArtwork()`（`Artwork[]`）。本库采用 Android 的单张图片字节结果。

与该方法的差异只保留本库已经具备的契约：

- 源是 `MediaInput` 参数，并可附带 `AbortSignal`。没有 retriever 会话，也没有 `setDataSource`。
- 有多张图片时，选择是确定的。Android 文档允许返回其中任意一张。下面的固定顺序让重复调用保持稳定。
- 开头字节必须匹配 JPEG、PNG、GIF、WebP 或 BMP 签名。匹配只用于内部资格判断。函数不返回 MIME 类型。SVG、ID3 `-->` URL、HEIC、AVIF、TIFF 和截断的签名结果为 null。
- 结果是用 `slice()` 复制的独立 `Uint8Array<ArrayBuffer>`，之后修改源视图不会影响它。

### 12.1 范围

包含：一个函数 `getEmbeddedPicture`，以及类型 `EmbeddedPictureOptions`。它读取 Mediabunny 作为 metadata 图片暴露的画面（ID3v2 APIC、MP4 `covr`、FLAC PICTURE、Ogg METADATA_BLOCK_PICTURE、Matroska 图片附件），从中选择一张，并返回独立的字节副本。

不包含：列出全部图片、按角色或索引选择、图片名称或描述文本、公开的 MIME 类型或图片角色、图像尺寸、解码、重新编码、缩放、去除 EXIF、存成视频轨的图片、图片写入、转换时的图片透传、`metadata()` 的图片字段，以及 probe 行为变更。不抓取图片 URL，也不返回链接。不新增错误码、选项、缓存或构建器方法。

### 12.2 需求

- REQ-008：新增一个运行时导出入口 `getEmbeddedPicture`，以及类型 `EmbeddedPictureOptions`。不添加转换构建器方法或别名。
- REQ-009：复用现有 MediaInput 类型、输入格式白名单、URL 规范化、匿名 CORS GET 策略和不重试行为。只使用 Mediabunny 公开 API。
- REQ-010：在观察 signal 或读取源之前，验证选项对象（普通对象、仅允许 `signal`、提供时必须是 AbortSignal）和源类型。
- REQ-011：根据图片开头字节判断是否合格，使用 WHATWG MIME Sniffing 中 JPEG、PNG、GIF、WebP 和 BMP 的图片类型模式。绝不使用声明类型。字节不匹配这些模式的图片不合格。这些模式是内部的，不是返回的 MIME 类型。
- REQ-012：在合格图片中，按文件顺序选择第一张正面封面。否则选择第一张没有正/背面标签的图片。否则选择第一张背面封面。否则结果为 null。选择只接收在 metadata 边界上构造的 `{ data: Uint8Array; kind: AttachedImage["kind"] }`。它看不到声明的 MIME 类型、名称或描述。标签是一张以 Mediabunny 图片 `kind` 为键的穷尽表。公开结果不包含该标签。
- REQ-013：返回 `Uint8Array<ArrayBuffer> | null`。数组中恰好是所选图片的字节。之后对调用者拥有的输入字节的修改不得影响它。只复制所选图片，使用 `data.slice()`。不要复制 `data.buffer`，该缓冲区可能延伸到图片之外。不返回 Blob、MIME 类型或图片角色。
- REQ-014：每次调用打开并释放自己的 Input。对未改变的源重复调用会返回字节相同、彼此不同的 `Uint8Array`，且绝不修改源。
- CON-003：`resolveMetadata`、`ProbeResult`、转换时的 metadata 剥离，以及 `metadata()` 的补丁校验保持不变。源暴露图片时，`probe().omittedSourceFields` 仍列出 `"images"`。该条目表示该字段在文本投影之外，不是表示它不可读。转换输出仍然不携带内嵌图片。`metadata({ images })` 仍以 UNSUPPORTED_METADATA_FIELD 拒绝。
- SEC-002：原样返回内嵌字节，包括图片内部的元数据，例如 EXIF。这些是返回给提供该源的调用者的源内容，不是库生成的输出，因此 SEC-001 不适用。绝不返回 SVG 或其他可执行脚本的类型。不匹配合格图片签名的字节不会返回。

### 12.3 接口

类型名、字段名和示例代码与英文版保持一致。

```ts
type EmbeddedPictureOptions = { signal?: AbortSignal };

getEmbeddedPicture(
  source: MediaInput,
  options?: EmbeddedPictureOptions,
): Promise<Uint8Array<ArrayBuffer> | null>;
```

Null 表示没有找到合格图片。它不能证明文件里没有图片。WAV 没有图片，源大小未知时 Mediabunny 会跳过 Matroska 标签。中止一次本来会得到 null 的读取时，Promise 以 `ABORTED` 拒绝。Null 不是取消结果。

用于排序的内部标签只有在文件把图片标成正面或背面时才是正面或背面（ID3 和 FLAC 图片类型 3 和 4，MP4 `covr` 为正面，名为 `cover.*` 或 `back.*` 的 Matroska 附件）。其他标签都视为无标签。调用者拿不到该标签。

### 12.4 错误与生命周期

| 条件                                                                              | 结果              |
| --------------------------------------------------------------------------------- | ----------------- |
| 选项不是普通对象、未知键、`signal` 不是 AbortSignal、空字节                       | INVALID_OPTIONS   |
| 不支持的源类型或 URL、无法识别的容器                                              | UNSUPPORTED_INPUT |
| 源获取/读取失败，或标签解析失败                                                   | READ_FAILED       |
| 在得到结果前观察到取消，包括预先取消的 signal，以及一次本来会得到 null 的标签读取 | ABORTED           |
| 没有合格的内嵌图片                                                                | null，不是错误    |

所有错误的阶段都是 `preparing`。静态校验错误优先于已取消的 signal。观察到取消之后不再交付结果。与 `probe` 一样，成功读取之后的 Input 清理失败不会使 Promise 拒绝，失败之后则作为诊断信息附上。返回的数组已经是独立副本，清理不能影响它。

### 12.5 验收标准

| ID     | 给定 / 当                                                                                                             | 要求结果                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| AC-021 | 生成的 MP3 中背面 APIC 位于正面 APIC 之前                                                                             | 正面图片字节，与源图片一致                                                                  |
| AC-022 | 无标签图片加背面图片；只有背面；两张无标签图片；两张正面图片；不合格的正面加合格的背面                                | 选无标签；选背面；按文件顺序选第一张；选第一张正面；选合格的背面                            |
| AC-023 | 声明为 `image/*`、`image/jpg`、标错的类型、ID3 `-->` URL、SVG、空数据、截断 JPEG、HEIC、TIFF、AVIF、缺少 `VP` 的 WebP | 合格字节原样返回；只有不合格图片时结果为 null                                               |
| AC-024 | WAV，或容器中没有图片                                                                                                 | null                                                                                        |
| AC-025 | 得到结果后修改字节输入；图片位于源缓冲区的非零偏移处                                                                  | 数组不变；长度等于图片长度                                                                  |
| AC-026 | 无效选项或不支持的源带有预先取消的 signal；有效且预先取消；中止一次本来会得到 null 的标签读取                         | 不打开输入即返回 INVALID_OPTIONS 或 UNSUPPORTED_INPUT；返回 ABORTED 而不是 null；释放 Input |
| AC-027 | 对同一源调用两次；前后各做一次 `probe`                                                                                | 字节相同、数组不同；probe 结果相同且仍列出 `"images"`                                       |
| AC-028 | `metadata({ images })`                                                                                                | UNSUPPORTED_METADATA_FIELD                                                                  |
| AC-029 | 从构建后的包导入                                                                                                      | 可以使用 `getEmbeddedPicture` 和 `EmbeddedPictureOptions`；未知选项无法通过类型检查         |
| AC-030 | 运行现有的转换、probe、metadata 和图像提取测试                                                                        | 行为与默认值没有回退                                                                        |

单元测试在模拟输入后面使用合成的 Mediabunny 图片，并用 `getEmbeddedPicture()` 和 `probe()` 读取一个小型生成素材。这条路径不使用 canvas 或浏览器编码器，因此不增加 Playwright 规格。触及点为 `src/embedded-picture.ts`、`src/types.ts`、`src/index.ts`、单元测试、包类型测试、素材脚本、两份 README、`AGENTS.md` 和两份规格。
