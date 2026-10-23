# probe

`probe` 读取容器，不做转换。

```ts
function probe(source: MediaInput, options?: ProbeOptions): Promise<ProbeResult>;
```

`MediaInput` 是 `Blob | ArrayBuffer | Uint8Array<ArrayBuffer> | URL | string`。字符串或 `URL` 必须是绝对的 `http` 或 `https` URL，不能带用户名或密码。请求使用 CORS，并且不带凭据。没有重试。

接受的容器是 MP4、QTFF、WebM、Matroska、MP3、WAVE、OGG、FLAC 和 ADTS。无法识别的容器抛出 `UNSUPPORTED_INPUT`。

## ProbeOptions

| 字段        | 类型                     | 默认                 |
| ----------- | ------------------------ | -------------------- |
| `signal`    | `AbortSignal`            | 无                   |
| `duration`  | `"metadata"` 或 `"scan"` | 元数据，即省略该字段 |
| `tracks`    | `TracksOptions`          | 全部音视频轨道       |
| `frameRate` | `"estimate"`             | 不估算               |

`"metadata"` 读取 `getDurationFromMetadata`。`"scan"` 读取 `computeDuration`。未知键抛出 `INVALID_OPTIONS`。

## ProbeResult

| 字段                  | 类型                                     |
| --------------------- | ---------------------------------------- |
| `container`           | `string`，格式名                         |
| `durationSeconds`     | `number` 或 `null`                       |
| `durationOrigin`      | `"metadata"`、`"scanned"` 或 `"unknown"` |
| `tracks`              | `ProbeTrackInfo[]`                       |
| `metadata`            | `MetadataValues`                         |
| `omittedSourceFields` | `string[]`                               |

`durationSeconds` 为 `null` 时，`durationOrigin` 是 `"unknown"`。`duration` 为 `"scan"` 时是 `"scanned"`。其余情况是 `"metadata"`。

`tracks` 只含所选音视频轨道，保留源顺序。分别支持 all、primary、非空且不重复的源轨道 ID 列表或 false，与转换一致。不存在或类型错误的 ID 返回 `INVALID_OPTIONS`，选择为空返回 `NO_TRACKS`。容器、顶层时长和元数据仍描述完整输入；顶层时长保留上游最大结束时间戳的口径，不改为所选轨道持续时间。不接受时间区间参数。

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

## ProbeTrackInfo

Probe 结果改为 `ProbeTrackInfo[]`，在上表基础上增加下列字段。转换报告仍使用原 TrackInfo。

| 字段                                    | 含义                                                      |
| --------------------------------------- | --------------------------------------------------------- |
| `language`、`name`                      | 源语言、名称或 null；und 转为 null                        |
| `isDefault`                             | 源默认轨道标记                                            |
| `peakBitrate`、`averageBitrate`         | 元数据峰值、平均码率，单位 bit/s，未知为 null，不是包统计 |
| `startTimestamp`、`endTimestamp`        | 源时间戳，单位秒或 null；起点可为负                       |
| `durationSeconds`                       | 持续时间 `max(0, end - start)`，未知为 null               |
| `durationOrigin`                        | metadata、scanned 或 unknown，跟随 duration 选项          |
| `codedWidth`、`codedHeight`、`rotation` | 视频编码尺寸、源旋转角度                                  |
| `frameRate`、`frameRateOrigin`          | 视频估算帧率或 null；来源 estimated 或 unknown            |

`frameRate: "estimate"` 以 256 个包的前缀为采样目标，从不同显示时间戳估算平均帧率，不解码；重排序可能额外读取，不承诺字节或耗时上限，也不证明全片恒定帧率。默认不估算，时间戳不足也返回 null。空轨道的时间未知；scan 模式同时扫描完整输入和所选轨道的结束时间。

```ts
const info = await probe(file, {
  tracks: { video: "primary", audio: false },
  frameRate: "estimate",
});
```

编辑器时间轴另用[波形数据](/zh/api/waveforms)。Probe 只报告源事实，不报告解码能力；轨道并发读取失败时也会等待在途读取和清理后才结束。
