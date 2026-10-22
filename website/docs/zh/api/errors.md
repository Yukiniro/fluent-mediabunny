# 错误

`MediaError` 是转换、探测和缩略图提取抛出的错误类。它继承 `Error`。`name` 是 `"MediaError"`。

```ts
class MediaError extends Error {
  readonly code: ErrorCode;
  readonly phase: Phase;
  readonly details: Readonly<Record<string, unknown>>;
  readonly diagnostics: unknown[];
  targetState?: TargetState;
}
```

| 字段          | 类型                                            | 规则                                      |
| ------------- | ----------------------------------------------- | ----------------------------------------- |
| `message`     | `string`                                        | `Error` 的消息。                          |
| `code`        | `ErrorCode`                                     | 下面 17 个码之一。                        |
| `phase`       | `"preparing"`、`"processing"` 或 `"committing"` | 默认 `"preparing"`。                      |
| `details`     | `Readonly<Record<string, unknown>>`             | 默认 `{}`。                               |
| `diagnostics` | `unknown[]`                                     | 后续失败和清理错误被追加到第一个错误上。  |
| `cause`       | `unknown`                                       | 传给 `Error`。                            |
| `targetState` | `"untouched"`、`"aborted"` 或 `"unknown"`       | 仅当 `run` 使用了文件目标并且失败时设置。 |

`targetState` 为 `"untouched"` 表示文件没有打开。`"aborted"` 表示已打开的流已中止。`"unknown"` 表示文件已打开，但字节状态没有得到证明。

## ErrorCode

| 码                               | 何时使用                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_OPTIONS`                | 选项对象、数字、枚举、trim、crop、resize、元数据值或缩略图请求没有通过校验。                                                                                                           |
| `UNSUPPORTED_INPUT`              | 源不是 `File`、`Blob`、`ArrayBuffer`、`Uint8Array`，或没有凭据的绝对 HTTP 或 HTTPS URL。也包括无法识别的容器、交给轨道信息的非音频或非视频轨道、不安全的时间戳，或无效的帧覆盖与几何。 |
| `UNSUPPORTED_OUTPUT_COMBINATION` | 该编解码器没有为所选格式启用。                                                                                                                                                         |
| `IMAGE_ENCODING_UNAVAILABLE`     | 缺少 Canvas 图像编码或 2D 渲染，或编码器替换了请求的 MIME 类型。                                                                                                                       |
| `CODEC_UNAVAILABLE`              | 选中的轨道不能解码，或解析出的视频或音频编码器不可用。                                                                                                                                 |
| `COPY_NOT_POSSIBLE`              | 复制模式不能把选中轨道复制进该格式。                                                                                                                                                   |
| `NO_TRACKS`                      | 没有选中轨道，缩略图输入没有视频轨道，或所选视频轨道为空。                                                                                                                             |
| `TRACK_LOSS`                     | 输出装不下全部选中轨道，或转换没有保留全部选中轨道。                                                                                                                                   |
| `UNSUPPORTED_METADATA_FIELD`     | 元数据补丁使用了 `title`、`artist`、`album`、`albumArtist`、`genre`、`comment`、`description` 和 `date` 以外的字段。                                                                   |
| `TARGET_UNSUPPORTED`             | 文件目标不是带权限查询和可写流的文件句柄。                                                                                                                                             |
| `TARGET_BUSY`                    | 另一个任务占有这个输出文件。                                                                                                                                                           |
| `PERMISSION_REQUIRED`            | 文件句柄尚未拥有读写权限。                                                                                                                                                             |
| `READ_FAILED`                    | 读取输入失败。                                                                                                                                                                         |
| `WRITE_FAILED`                   | 打开、写入或关闭输出失败。                                                                                                                                                             |
| `OUTPUT_TOO_LARGE`               | 输出长度不是非负安全整数，WAV 超过 4294967295 字节，或解析出的缩略图某一边超过 4096 像素或面积超过 16000000 像素。                                                                     |
| `PROCESSING_FAILED`              | 操作失败且没有更具体的码，包括图像编码器没有返回字节。                                                                                                                                 |
| `ABORTED`                        | `AbortSignal` 在提交前触发。                                                                                                                                                           |

## Warning

`Warning` 不是 `MediaError`。它的 `code` 是 `string`，不是 `ErrorCode`。

```ts
type Warning = { code: string; message: string; fields?: readonly string[] };
```

`run` 目前会赋 `METADATA_OMITTED`、`NON_AV_CONTENT_NOT_PRESERVED`、`FILENAME_EXTENSION_MISMATCH`、`CALLBACK_FAILED` 和 `CLEANUP_FAILED`。这些字符串不是 `ErrorCode` 的成员。观察者抛错或返回 Promise 时，`onProgress` 被停用，并加上 `CALLBACK_FAILED`。成功输出之后的清理失败加上 `CLEANUP_FAILED`。错误之后的清理失败改为追加到 `diagnostics`。
