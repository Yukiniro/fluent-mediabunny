---
title: 简介
description: 使用 fluentbunny 在浏览器中转换媒体、提取视频帧和读取内嵌图片。
---

# fluentbunny

在浏览器中转换媒体、提取视频帧和读取内嵌图片的 TypeScript 链式 API，底层由 [Mediabunny](https://mediabunny.dev/) 提供媒体处理能力。

## 从一个媒体任务开始

```ts title="转换视频"
import { media } from "fluentbunny";

const result = await media(file)
  .format("webm")
  .trim({ start: 2, end: 12 })
  .resize({ width: 1280 })
  .run();

const previewUrl = URL.createObjectURL(result.blob);
```

这里的 `file` 是浏览器 `File`，时长需覆盖第 2 到第 12 秒。预览不再使用时，调用 `URL.revokeObjectURL(previewUrl)` 释放 URL。

首次使用？先阅读[开始使用](/zh/guide/getting-started)，完成构建与安装，再执行第一个任务。

## 选择合适的操作

| 任务                       | API                                              | 返回结果                                   |
| -------------------------- | ------------------------------------------------ | ------------------------------------------ |
| 转换、裁剪、缩放或提取音频 | [media()](/zh/api/media)                         | 构建器；`run()` 返回 Blob 或文件结果       |
| 查看时长、轨道与元数据     | [probe()](/zh/api/probe)                         | `Promise<ProbeResult>`                     |
| 解码一帧视频               | [thumbnail()](/zh/api/thumbnails#thumbnail)      | `Promise<ThumbnailImage \| null>`          |
| 生成视频预览序列           | [thumbnails()](/zh/api/thumbnails#thumbnails)    | `AsyncGenerator<ThumbnailItem>`            |
| 读取文件内嵌的封面图片     | [getEmbeddedPicture()](/zh/api/embedded-picture) | `Promise<Uint8Array<ArrayBuffer> \| null>` |

## API 的工作方式

**先配置，再执行。** 转换方法返回新的不可变构建器，直到 `run()` 才读取媒体。每次执行独立管理并清理资源。

**共用输入约定。** 所有操作都接受 `File` / `Blob`、字节缓冲区或绝对 HTTP(S) URL。远程来源需要允许 CORS，详见[输入与输出](/zh/guide/inputs-and-outputs)。

**结果可以检查。** 转换结果包含解析后的配置、轨道选择、元数据变化和警告。无法保留指定轨道时，任务会失败，详见[执行与结果](/zh/api/run)。

## 浏览器要求

容器支持与编解码器支持是两回事。能识别 MP4，不代表当前设备能解码或编码其中的轨道。转码依赖浏览器的媒体能力，不提供自动服务器或 WASM 回退。

转换支持输出 MP4、WebM、M4A 和 WAV；缩略图输出 JPEG 或 PNG；内嵌图片直接返回原始图片字节，不进行解码。

继续阅读[使用指南](/zh/guide/)，或查阅 [API 参考](/zh/api/)。
