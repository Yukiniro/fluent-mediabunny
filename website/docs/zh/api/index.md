---
title: API 参考
description: fluent-mediabunny 导出的公开函数、转换构建器方法、结果类型与错误。
---

# API 参考

从 `fluent-mediabunny` 导入公开函数与类型。每次操作读取一个来源，转换生成一个输出。

```ts
import {
  media,
  probe,
  thumbnail,
  thumbnails,
  getEmbeddedPicture,
  MediaError,
} from "fluent-mediabunny";
```

## 媒体转换

| 参考                                  | 用途                               |
| ------------------------------------- | ---------------------------------- |
| [media / MediaBuilder](/zh/api/media) | 配置格式、轨道、画面、编码和元数据 |
| [run / 结果](/zh/api/run)             | 执行构建器、接收进度并检查输出报告 |

构建器的配置过程是同步且不可变的，`run()` 返回 Promise。方法参数错误会立即抛出；依赖源内容的校验在执行时拒绝。

## 检查与提取

| 函数                                           | 返回类型                                   | 用途                               |
| ---------------------------------------------- | ------------------------------------------ | ---------------------------------- |
| [probe](/zh/api/probe)                         | `Promise<ProbeResult>`                     | 容器、时长、音视频轨道与文本元数据 |
| [thumbnail](/zh/api/thumbnails#thumbnail)      | `Promise<ThumbnailImage \| null>`          | 一帧解码后的视频图片               |
| [thumbnails](/zh/api/thumbnails#thumbnails)    | `AsyncGenerator<ThumbnailItem>`            | 每个请求时间对应一项，包含缺帧位置 |
| [getEmbeddedPicture](/zh/api/embedded-picture) | `Promise<Uint8Array<ArrayBuffer> \| null>` | 一张内嵌原图，返回独立字节副本     |

## 共用约定

所有操作都接受 [MediaInput](/zh/api/probe#mediainput)。选项必须是普通对象，未知字段会导致校验失败。通过 `AbortSignal` 取消工作，并在任务结束前保持输入字节和远程内容稳定。

失败使用 [MediaError](/zh/api/errors)。图片结果为 `null` 表示读取成功但没有匹配图片，不代表解码或网络失败。
