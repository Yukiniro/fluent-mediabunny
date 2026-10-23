# getEmbeddedPicture

`getEmbeddedPicture` 返回一张内嵌图片的字节，或 `null`。这些字节是文件自带的图片，保留图片内部的元数据，例如 EXIF。它们不是从视频解码出来的帧。[thumbnail](/api/thumbnails) 才解码帧。

```ts
function getEmbeddedPicture(
  source: MediaInput,
  options?: EmbeddedPictureOptions,
): Promise<Uint8Array<ArrayBuffer> | null>;
```

`MediaInput` 与 [probe](/api/probe) 相同。没有对应的构建器方法。

`null` 表示没有合格图片。这不是错误。它也不能证明文件里没有图片标签：WAV 没有图片；源大小未知时，Mediabunny 会跳过 Matroska 标签。一次本来会返回 `null` 的读取如果被中止，抛出 `ABORTED`。

## EmbeddedPictureOptions

| 字段     | 类型          | 默认 |
| -------- | ------------- | ---- |
| `signal` | `AbortSignal` | 无   |

选项对象只接受 `signal`。未知键抛出 `INVALID_OPTIONS`，并且发生在打开输入之前。信号已经中止时也是如此。

## 选择

函数读取 Mediabunny 作为元数据图片暴露的画面：ID3v2 APIC、MP4 `covr`、FLAC PICTURE、Ogg METADATA_BLOCK_PICTURE，以及 Matroska 图片附件。存在视频轨道里的画面不在其中。

是否合格只看开头字节。声明的 MIME 类型、名称和描述都被忽略。

| 开头字节                                | 格式 |
| --------------------------------------- | ---- |
| `FF D8 FF`                              | JPEG |
| `89 50 4E 47 0D 0A 1A 0A`               | PNG  |
| `GIF87a` 或 `GIF89a`                    | GIF  |
| `RIFF`，四个长度字节，然后 `WEBPVP`     | WebP |
| `BM`                                    | BMP  |

SVG、ID3 的 URL 链接（`-->`）、空载荷、截断的 JPEG、HEIC、TIFF、AVIF，以及后面没有 `VP` 的 WebP，都不合格。每张图片都不合格，或者没有图片时，结果是 `null`。

合格图片里，按文件顺序取第一张正面封面。否则取第一张没有正背面标签的图片。否则取第一张背面封面。否则结果是 `null`。

只有文件自己标成封面时才算正面或背面。ID3 APIC、FLAC PICTURE 块，以及 Ogg 的 `METADATA_BLOCK_PICTURE` 里，图片类型 3 是正面，类型 4 是背面。MP4 的 `covr` 和 QuickTime 封面（`com.apple.quicktime.artwork`）算正面。Matroska 附件的名字以 `cover.` 开头算正面，以 `back.` 开头算背面；只有声明类型以 `image/` 开头时，Mediabunny 才会收录该附件。其余标签都算没有正背面标签。返回值不含该标签、MIME 类型或封面角色。

返回的 `Uint8Array<ArrayBuffer>` 是 `data.slice()` 得到的副本。长度等于图片长度。之后改源视图不会改变它。每次调用各自打开并释放输入。对未改变的源调用两次，得到相等的字节和不同的数组。

## 探测与转换

源暴露图片时，[probe](/api/probe) 仍在 `omittedSourceFields` 里列出 `"images"`。这个名字表示图片在文本元数据之外。转换不会把它们写入输出。`metadata({ images })` 抛出 `UNSUPPORTED_METADATA_FIELD`。

## 错误

| 条件                                                                           | 结果                |
| ------------------------------------------------------------------------------ | ------------------- |
| 选项不是普通对象、出现未知键，或 `signal` 不是 `AbortSignal`                   | `INVALID_OPTIONS`   |
| 不支持的源或 URL，或无法识别的容器                                             | `UNSUPPORTED_INPUT` |
| 获取、读取或标签解析失败                                                       | `READ_FAILED`       |
| 在得到结果前取消，包括信号已经中止                                             | `ABORTED`           |
| 没有合格图片                                                                   | `null`              |

这些错误的阶段是 `"preparing"`。空输入字节遵循 [选择输入与输出](/guide/inputs-and-outputs)。
