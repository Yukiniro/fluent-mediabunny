---
title: 转换文件
description: 配置格式、复制或转码、时间与画面裁剪、缩放、轨道和元数据。
---

# 转换文件

`media(source)` 返回 `MediaBuilder`。每个方法都返回新的构建器，不会修改原构建器。`run` 之前要调用 `format`。默认模式是 `"auto"`，视频和音频默认选中全部轨道。

字段列表在 [media](/zh/api/media)。失败时以 [MediaError](/zh/api/errors) 拒绝。

## 设置格式

传入 `"mp4"`、`"webm"`、`"m4a"` 或 `"wav"`。

```ts
media(file).format("webm");
```

MP4 编码 `avc` 和 `aac`。WebM 编码 `vp9` 或 `vp8`，以及 `opus`。M4A 编码 `aac`，不能有视频。WAV 编码 `pcm-s16`、`pcm-s24` 或 `pcm-f32`，不能有视频。不在上述集合里的编解码器会抛出 `UNSUPPORTED_OUTPUT_COMBINATION`。省略编解码器时，转码使用上述编解码器中的第一个。

## 设置模式

```ts
media(file).format("mp4").mode("copy");
```

`"auto"` 先解析显式或格式默认编解码器，再在处理配置允许时复制兼容轨道，其余轨道转码。`"transcode"` 对每条选中轨道解码再编码。`"copy"` 复制每条选中轨道，并拒绝 `trim`、`resize`、`crop`、非零 `rotate` 以及非空视频或音频选项。允许 `rotate(0)`。

复制可以在 MP4 中保留 `avc` 和 `hevc`，在 MP4 或 M4A 中保留 `aac`，在 WebM 中保留 `vp8`、`vp9` 和 `av1`，在 WebM 中保留 `opus` 和 `vorbis`，在 WAV 中保留 `pcm-s16`、`pcm-s24` 和 `pcm-f32`。复制模式遇到其余编解码器时抛出 `COPY_NOT_POSSIBLE`。

显式 `trim` 会使每条选中轨道转码，`"auto"` 也一样。

## 裁剪时间

`start` 是秒，可以为 0。`end` 必须大于 `start`。省略 `end` 则保留时间线的剩余部分。

```ts
media(file).format("webm").trim({ start: 2, end: 12 });
```

两个值都会加上所选轨道里最早的起点，也就是 `max(0, min(first timestamps))`。范围超出该时间线时抛出 `INVALID_OPTIONS`。

## 调整画面尺寸

`width` 和 `height` 是正的偶数。至少传一个。`fit` 是 `"contain"`、`"cover"` 或 `"fill"`，两个尺寸都给出时必填，只给一个尺寸时禁止。只给一个尺寸时保持宽高比，并把另一个尺寸向上取整到偶数。

```ts
media(file).format("mp4").resize({ width: 1280 });
media(file).format("mp4").resize({ width: 1280, height: 720, fit: "contain" });
```

## 裁剪画面

`x`、`y`、`width` 和 `height` 是整数。`x` 和 `y` 可以为 0。`width` 和 `height` 为正。矩形在 90 度或 270 度旋转交换画面宽高之后应用，并且必须落在该画面内。

```ts
media(file).format("mp4").crop({ x: 0, y: 0, width: 640, height: 360 });
```

## 旋转画面

传入 `0`、`90`、`180` 或 `270`。旋转在裁剪和缩放之前应用。

```ts
media(file).format("mp4").rotate(90);
```

## 设置视频编码

`codec` 是 `"avc"`、`"vp8"` 或 `"vp9"`。`bitrate` 是正整数。`quality` 是 `"low"`、`"medium"` 或 `"high"`。比特率与质量只能设一个。后一次 `video` 调用用质量替换先前的比特率，反过来也一样。`frameRate` 是正的有限数。多次调用会合并到已有的视频选项上。

```ts
media(file).format("mp4").video({ codec: "avc", quality: "high", frameRate: 30 });
```

转码时既不设比特率也不设质量，解析出的质量是 `"high"`。

## 设置音频编码

`codec` 是 `"aac"`、`"opus"`、`"pcm-s16"`、`"pcm-s24"` 或 `"pcm-f32"`。`sampleRate` 和 `channels` 是正整数。比特率与质量的规则和视频相同。WAV 拒绝比特率和质量。多次调用会合并到已有的音频选项上。

```ts
media(file).format("webm").audio({ codec: "opus", channels: 2 });
```

## 选择轨道

`video` 和 `audio` 各自接受 `"all"`、`"primary"`、一组非空且互不重复的轨道 id，或 `false`。默认是 `"all"`。id 是整数，可以为 0，并且必须属于该媒体类型。

```ts
media(file)
  .format("mp4")
  .tracks({ video: "primary", audio: [1] });
```

M4A 和 WAV 需要恰好一条音轨，并且不能有视频。去掉视频并选一条音轨。

```ts
media(file).format("m4a").tracks({ video: false, audio: "primary" });
```

没有选中视频轨道时，不要传视频选项、裁剪、缩放或旋转。没有选中音频轨道时，不要传音频选项。选中结果为空时抛出 `NO_TRACKS`。格式装不下全部选中轨道时抛出 `TRACK_LOSS`。

## 编辑元数据

字段有 `title`、`artist`、`album`、`albumArtist`、`genre`、`comment`、`description` 和 `date`。`date` 是 `YYYY-MM-DD`，年份从 0001 到 9999。`null` 或 `""` 删除该字段。其他名字抛出 `UNSUPPORTED_METADATA_FIELD`。

```ts
media(file).format("mp4").metadata({ title: "Clip", date: "2026-10-22" });
media(file).format("mp4").metadata({ comment: null }, { mode: "replace" });
```

`mode` 默认是 `"merge"`。合并会保留你没有设置的、受支持的源标签。`"replace"` 只写入这份补丁。不受支持的源标签会被略去。报告里可能出现 `METADATA_OMITTED` 警告。

## 运行任务

不传目标，或 `target: "blob"`，返回内存中的 blob。`suggestedFilename` 是 `output.<format>`。

```ts
const result = await media(file)
  .format("webm")
  .trim({ start: 2, end: 12 })
  .resize({ width: 1280 })
  .run();

result.report.resolved;
result.report.selected;
result.report.excludedByUser;
result.report.metadata;
result.report.warnings;
```

要写入文件，传入已经拥有读写权限的句柄。这个库不会打开文件选择器，也不会请求权限。

```ts
await media(file)
  .format("mp4")
  .run({
    target: { type: "file", handle },
    signal,
    onProgress(event) {
      event.phase;
      event.ratio;
    },
  });
```

`phase` 是 `"preparing"`、`"processing"` 或 `"committing"`。`ratio` 是 0 到 1 的数，或 `null`。`"processing"` 阶段的进度不表示文件已经保存。提交前取消会中止已打开的文件流。进入提交之后，任务会等待文件关闭。

`onProgress` 必须是函数。它抛错或返回 Promise 时，后续进度会被跳过，报告里出现 `CALLBACK_FAILED` 警告。

文件目标失败时，错误上的 `targetState` 是 `"untouched"`、`"aborted"` 或 `"unknown"`。[选择输入与输出](/zh/guide/inputs-and-outputs) 说明这些状态。

非音频、非视频轨道会被略去，并可能加上 `NON_AV_CONTENT_NOT_PRESERVED` 警告。文件名不以该格式结尾时，可能加上 `FILENAME_EXTENSION_MISMATCH`。
