# fluentbunny

<img src="https://raw.githubusercontent.com/Yukiniro/fluent-mediabunny/main/website/docs/public/logo.png" alt="fluentbunny 标志" width="96" height="96" />

[English](README.md) | 简体中文

为 [Mediabunny](https://mediabunny.dev/) 提供更简单、易理解的 TypeScript 链式 API。

受 fluent-ffmpeg 链式风格的启发，fluentbunny 在 Mediabunny 之上提供便捷的上层 API，将配置与执行组织成可读的调用，减少表达媒体处理任务所需的准备代码。

底层媒体处理能力由 Mediabunny 提供，fluentbunny 专注于通过 API 设计，让这些公开能力更容易理解和使用。当前版本覆盖单输入、单输出的媒体转换、有数量上限的批量视频图像提取，以及一次内嵌图片读取。

## 为什么使用它

**让任务更容易读懂。** 通过链式调用描述输出格式、时间范围和尺寸。配置不可变，可以从同一个起点派生不同输出，不会修改原有构建器。

**减少接入代码。** 通过任务 API 协调输入准备、执行、取消和清理，减少使用 Mediabunny 时需要自行编写的生命周期衔接代码。

**让处理决策可见。** 转换结果会报告最终采用的参数、选中和排除的轨道、元数据及警告。如果无法保留某条选中的轨道，或请求的编码配置不可用，任务会失败，不会静默丢弃该轨道或替换编码参数。

## 开始使用

请使用 Node 24（版本固定在 [.node-version](.node-version)）和 pnpm 12.14.0 从源码构建。维护者发布之后，`pnpm add fluentbunny` 会从 npm 安装这个包。

```sh
git clone https://github.com/Yukiniro/fluent-mediabunny.git fluentbunny
cd fluentbunny
pnpm install --frozen-lockfile
pnpm build
pnpm pack --out fluentbunny.tgz
```

然后进入你的应用目录，安装生成的压缩包和固定版本的 Mediabunny 对等依赖：

```sh
pnpm add /path/to/fluentbunny/fluentbunny.tgz mediabunny@1.62.1
```

将压缩包路径替换为实际位置。应用需要使用浏览器打包工具。

### 处理一段视频

```ts
import { media } from "fluentbunny";

const result = await media(file)
  .format("webm")
  .trim({ start: 2, end: 12 })
  .resize({ width: 1280 })
  .run();

const previewUrl = URL.createObjectURL(result.blob);
```

这里的 `file` 是应用提供的浏览器 `File`，时长应足以覆盖请求的第 2–12 秒。预览不再使用时，请调用 `URL.revokeObjectURL()` 释放 `previewUrl`。

转换支持输出 MP4、WebM、M4A、WAV 或 Ogg，默认选中全部音视频轨道。纯音频的 M4A、WAV 和 Ogg 需要显式选择一条音轨并排除视频。默认模式会在符合最终参数时复制轨道，否则按需转码；显式裁剪时间范围会使所有选中的轨道转码。

### 生成视频预览图

```ts
import { thumbnail } from "fluentbunny";

const poster = await thumbnail(file, { time: 2, width: 640 });
if (poster) {
  const imageUrl = URL.createObjectURL(poster.blob);
  // 在界面中使用 imageUrl，不再使用时释放它。
}
```

请求时间没有帧覆盖时，结果为 `null`。需要一组预览图时，`thumbnails()` 会按需生成图像，并保留每个请求的位置，包括没有帧的位置。每批支持 1–1000 个请求，输出 JPEG 或 PNG；图像每边最多 4096 像素，总面积不超过 16,000,000 像素。

### 读取内嵌图片

```ts
import { getEmbeddedPicture } from "fluentbunny";

const picture = await getEmbeddedPicture(file);
if (picture) {
  const imageUrl = URL.createObjectURL(new Blob([picture]));
  // 在界面中使用 imageUrl，不再使用时释放它。
}
```

`getEmbeddedPicture()` 返回一张内嵌图片的字节；如果内嵌图片都不是 JPEG、PNG、GIF、WebP 或 BMP，则返回 `null`。有多张图片时按固定顺序选择：正面封面，然后是没有正背面标签的图片，最后是背面封面，同一类按文件顺序取第一张。这些字节是文件自带的图片，保留图片内部的元数据，不是从视频解码出来的帧。

### 绘制音频波形

```ts
import { getWaveformData, probe, renderWaveform } from "fluentbunny";

const info = await probe(file);
const audio = info.tracks.find((track) => track.type === "audio");
const data = await getWaveformData(file, audio ? { track: audio.id } : {});
const image = await renderWaveform(data, { width: 800, height: 160 });
const imageUrl = URL.createObjectURL(image.blob);
```

`probe()` 报告轨道时间、尺寸和码率，不进行解码。`getWaveformData()` 再把一条音轨读成各声道的 min 与 max 数组，默认每秒 50 个点。`renderWaveform()` 只根据这些数组绘制一张 PNG，不会再次打开 `file`。图片不再使用时，请释放 `imageUrl`。

## 输入与输出

输入可以是 `File`/`Blob`、`ArrayBuffer`、基于 `ArrayBuffer` 的 `Uint8Array`，或绝对 HTTP(S) URL。远程资源需要允许 CORS，网络请求不携带凭据。编解码能力取决于浏览器、操作系统和设备，因此能够识别容器并不代表能够解码或编码其中的内容。

转换默认返回包含内存中 Blob 的结果。应用也可以提供已获读写授权、与输入不同的输出文件句柄。库不会打开文件选择器或请求权限。提交前取消会中止已打开的文件流；一旦进入提交阶段，任务会等待实际的文件关闭结果。仅凭处理进度不能判断文件已经保存。

## 参与贡献

开发契约：[媒体转换](spec/conversion.zh-CN.md)、[波形](spec/waveforms.zh-CN.md)、[缩略图](spec/thumbnails.zh-CN.md)、[内嵌图片](spec/embedded-picture.zh-CN.md)。

欢迎通过 [GitHub issues](https://github.com/Yukiniro/fluent-mediabunny/issues) 或 Pull Request 提交问题和范围明确的改进。反馈浏览器相关问题时，请附上浏览器、操作系统，以及使用可分享媒体的最小复现示例。

项目使用 [Vite+](https://viteplus.dev/) 进行开发、检查、测试和打包。运行 `pnpm dev` 可打开本地验证页面，也可以使用以下命令检查改动：

```sh
pnpm check
pnpm test
pnpm build
pnpm test:package
pnpm exec playwright install chrome firefox webkit
pnpm test:browser
```

浏览器测试需要先构建 `dist`、安装 Playwright 浏览器，并在 `PATH` 中提供 FFmpeg/ffprobe。仓库已提交合成测试素材；`pnpm fixtures` 使用 FFmpeg 重新生成这些素材，FFmpeg 仅为测试依赖。自动化 WebKit 和 OPFS 测试不能证明原生文件选择器或 Safari/iOS 的实际支持情况。

如果 Pull Request 修改了 `src/`，请运行 `pnpm changeset`，并提交它在 `.changeset/` 下生成的文件。版本低于 1.0 时，破坏性变更选择 `minor`，其他变更选择 `patch`。摘要会成为更新日志条目，请用英文填写。如果 `src/` 的改动不需要发布，请改为运行 `pnpm changeset --empty`。维护者的发布流程见 [RELEASING.md](RELEASING.md)。

## 许可证

fluentbunny 使用 [MIT 许可证](LICENSE)。Mediabunny 是独立的 MPL-2.0 依赖，详见[第三方声明](THIRD_PARTY_NOTICES.md)。
