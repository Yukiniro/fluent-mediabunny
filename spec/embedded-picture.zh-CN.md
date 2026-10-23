# 内嵌图片

[English（规范原文）](embedded-picture.md) | 简体中文

`getEmbeddedPicture(source, options?)` 返回 `Promise<Uint8Array<ArrayBuffer> | null>`，选项仅接受 `signal`。输入遵循共享的[输入契约](conversion.zh-CN.md#输入与探测)，公开类型见 [types.ts](../src/types.ts)。

## 选择与结果

- 读取 Mediabunny 元数据暴露的图片：ID3 APIC、MP4 covr、FLAC/Ogg 图片及 Matroska 图片附件。
- 合格字节须匹配 WHATWG MIME Sniffing 的 JPEG、PNG、GIF、WebP 或 BMP 签名。声明的 MIME 不决定资格；其他签名和图片 URL 被忽略。
- 优先取首张合格正面封面，其次是无正背面标签的图片，最后是背面封面；同类按文件顺序选择。分类沿用 Mediabunny 的文件标签：ID3/FLAC 类型 3/4、MP4 covr 作为正面、Matroska 中名为 `cover.*`/`back.*` 的附件；其他标签归为无标签。
- 返回所选图片准确字节范围的独立副本，保留 EXIF 等图片内部元数据。不解码或变换，也不返回 MIME 或角色字段。对未改变的源重复调用，得到字节相同、数组独立的结果。
- `null` 表示未暴露合格图片。WAV 不暴露图片；源大小未知时可能无法读取 Matroska 标签。
- 转换仍省略图片；`probe().omittedSourceFields` 仍列出已暴露的 images；`metadata({ images })` 拒绝 `UNSUPPORTED_METADATA_FIELD`。

命名与单张结果沿用 Android [MediaMetadataRetriever.getEmbeddedPicture](<https://developer.android.com/reference/android/media/MediaMetadataRetriever#getEmbeddedPicture()>)。接口调研还对照了 music-metadata 的 `selectCover`、jsmediatags、Mediabunny、FFmpeg/fluent-ffmpeg 和 AndroidTagLib。本接口保留 `MediaInput`、取消和独立字节副本，并采用确定的选择顺序。

## 错误与生命周期

每次调用独立持有输入，在结束前释放。观察取消或读取前先检查选项和输入类型。完成前取消会拒绝 `ABORTED`，包括原本将返回 null 的读取；不交付迟到结果。

| 错误码              | 含义                                         |
| ------------------- | -------------------------------------------- |
| `INVALID_OPTIONS`   | 选项格式错误、未知选项、无效 signal 或空字节 |
| `UNSUPPORTED_INPUT` | 输入、URL 或容器不支持                       |
| `READ_FAILED`       | 素材或元数据读取失败                         |
| `ABORTED`           | 完成前观察到取消                             |

错误阶段均为 `preparing`。与 `probe` 一致，单独的清理失败不使成功读取拒绝；已有失败时附加为诊断。清理不影响返回字节。
