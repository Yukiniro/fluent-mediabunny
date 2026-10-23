# probe

`probe` 读取容器，不做转换。

```ts
function probe(source: MediaInput, options?: ProbeOptions): Promise<ProbeResult>;
```

`MediaInput` 是 `Blob | ArrayBuffer | Uint8Array<ArrayBuffer> | URL | string`。字符串或 `URL` 必须是绝对的 `http` 或 `https` URL，不能带用户名或密码。请求使用 CORS，并且不带凭据。没有重试。

接受的容器是 MP4、QTFF、WebM、Matroska、MP3、WAVE、OGG、FLAC 和 ADTS。无法识别的容器抛出 `UNSUPPORTED_INPUT`。

## ProbeOptions

| 字段       | 类型                     | 默认                 |
| ---------- | ------------------------ | -------------------- |
| `signal`   | `AbortSignal`            | 无                   |
| `duration` | `"metadata"` 或 `"scan"` | 元数据，即省略该字段 |

`"metadata"` 读取 `getDurationFromMetadata`。`"scan"` 读取 `computeDuration`。未知键抛出 `INVALID_OPTIONS`。

## ProbeResult

| 字段                  | 类型                                     |
| --------------------- | ---------------------------------------- |
| `container`           | `string`，格式名                         |
| `durationSeconds`     | `number` 或 `null`                       |
| `durationOrigin`      | `"metadata"`、`"scanned"` 或 `"unknown"` |
| `tracks`              | `TrackInfo[]`                            |
| `metadata`            | `MetadataValues`                         |
| `omittedSourceFields` | `string[]`                               |

`durationSeconds` 为 `null` 时，`durationOrigin` 是 `"unknown"`。`duration` 为 `"scan"` 时是 `"scanned"`。其余情况是 `"metadata"`。

`tracks` 只含音频和视频轨道。其他轨道被略去。

`metadata` 保留通过校验的受支持字段。源里的 `Date` 形式的 `date` 记为 `YYYY-MM-DD`。其他源字段，以及校验失败的受支持字段，名字出现在 `omittedSourceFields`。源里有图片时，这份名单包含 `"images"`。用 [getEmbeddedPicture](/api/embedded-picture) 读取其中一张。

## TrackInfo

| 字段         | 类型                   |
| ------------ | ---------------------- |
| `id`         | `number`               |
| `type`       | `"video"` 或 `"audio"` |
| `codec`      | `string` 或 `null`     |
| `width`      | `number`，仅视频       |
| `height`     | `number`，仅视频       |
| `sampleRate` | `number`，仅音频       |
| `channels`   | `number`，仅音频       |

视频的 `width` 和 `height` 是显示尺寸。读取失败抛出 `READ_FAILED`。中止信号抛出 `ABORTED`。
