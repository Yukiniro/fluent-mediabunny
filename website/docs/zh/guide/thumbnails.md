# 提取缩略图

`thumbnail(source, options)` 返回一张 `ThumbnailImage` 或 `null`。`thumbnails(source, options)` 返回 `ThumbnailItem` 的异步迭代器。两者接受的输入与转换相同，可以是 Blob、字节，或 HTTP 或 HTTPS URL。转换设置在这里不起作用。

选项字段在 [thumbnail](/api/thumbnails)。没有帧时结果是 `null`。非法选项、缺少解码器、不支持的输入、读取失败、图像过大和编码失败都会拒绝，不会变成 `null`。

## 请求一个时间点

`time` 是秒，可以为 0。`width` 或 `height` 是不超过 4096 的正整数。

```ts
import { thumbnail } from "fluent-mediabunny";

const poster = await thumbnail(file, { time: 2, width: 640 });
if (poster) {
  const imageUrl = URL.createObjectURL(poster.blob);
}
```

图像不再使用时释放对象 URL。返回的 blob 在后续请求、取消和释放之后仍保有自己的字节。

## 请求一批

传入 `times`，或者传入 `start`、`end` 和 `count`。不要两种都传。每批 1 到 1000 个时间点。`times` 必须非递减。重复的时间各自保留位置。

```ts
import { thumbnails } from "fluent-mediabunny";

const controller = new AbortController();
for await (const item of thumbnails(file, {
  times: [0, 2, 2, 5],
  width: 160,
  type: "image/png",
  signal: controller.signal,
})) {
  if (item.image) showPreview(item.index, item.image.blob);
  else showPlaceholder(item.index);
  if (previewClosed()) break;
}
```

`showPreview`、`showPlaceholder` 和 `previewClosed` 属于应用。

区间采样取 `[start, end)` 上等分区间的起点。`start` 为 2、`end` 为 10、`count` 为 4 时，请求 2、4、6 和 8。`end` 必须大于 `start`。`count` 是 1 到 1000 的整数。这里不会扫描时长。

## 读取时间

时间相对于 `max(0, input.getFirstTimestamp())`，各轨道共用。默认使用主视频轨道。把 `track` 设成 [probe](/api/probe) 返回的视频轨道 id。

视频开始前、空隙里，或最后一帧结束及之后，返回 `null`。最后一帧不会被无限延长。比较使用四舍五入后的微秒。返回的时间保留源采样值。帧跨过零点时，`actualTime` 可以为负。

`break` 和 `return()` 会正常清理。自己驱动迭代器时，提前停止要 await `return()`。同一个迭代器上的调用必须串行。在挂起期间中止会立刻开始清理。下一次 `next()` 以 `ABORTED` 拒绝。显式 `return()` 会等待清理结束。取消解决之前，进行中的浏览器编码可能还要跑完，迟到的输出会被丢弃。

## 选择图像

`type` 默认是 `"image/jpeg"`。另一个值是 `"image/png"`。`quality` 只用于 JPEG，范围 0 到 1，默认 0.8。PNG 拒绝 `quality`。

两个尺寸都不设时，使用带方向的显示尺寸。只设 `width` 或 `height` 时保持显示宽高比，另一个尺寸会四舍五入。两个尺寸必须和 `fit` 一起给出。`"contain"` 和 `"cover"` 居中。`"fill"` 拉伸。

每一边最多 4096。面积最多 16,000,000 像素。允许奇数尺寸和放大。请求的边长超过 4096，或请求的面积超过 16,000,000，会抛出 `INVALID_OPTIONS`。按宽高比取整之后才超出限制时，抛出 `OUTPUT_TOO_LARGE`。

源的旋转、翻转和像素宽高比会应用。PNG 保留已解码的透明度和透明留白。JPEG 合成到黑色背景上。解码器丢掉的透明度无法在这里补回。采样漏报了非正方形像素比，且编码尺寸没变时，提取使用轨道上的比例。解码器已经把比例烘焙进另一张栅格时，保留那张栅格。

`IMAGE_ENCODING_UNAVAILABLE` 表示缺少 Canvas 编码或 2D 绘制，或编码器替换了请求的 MIME 类型。`CODEC_UNAVAILABLE` 表示所选视频解码器不可用。`NO_TRACKS` 表示没有视频轨道，或所选视频轨道是空的。
