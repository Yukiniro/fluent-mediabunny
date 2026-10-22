# 开始使用

fluent-mediabunny 目前尚未在 npm 上提供安装包。请使用 Node 24 和 pnpm 12.14.0 从源码构建，连同 `mediabunny@1.61.6` 安装压缩包，然后各跑一次转换和缩略图。

## 从源码构建

Node 24 固定在 `.node-version`，具体版本是 24.11.1。包管理器是 pnpm 12.14.0。

```sh
git clone https://github.com/Yukiniro/fluent-mediabunny.git
cd fluent-mediabunny
pnpm install --frozen-lockfile
pnpm build
pnpm pack
```

`pnpm pack` 在仓库目录写出 `fluent-mediabunny-0.2.0.tgz`。

## 安装压缩包

在应用目录安装该压缩包和对等依赖。

```sh
pnpm add /path/to/fluent-mediabunny-0.2.0.tgz mediabunny@1.61.6
```

把压缩包路径换成 `pnpm pack` 写出的文件。应用需要使用浏览器打包工具。

## 转换一段视频

`file` 是应用提供的浏览器 `File`，时长要覆盖第 2 秒到第 12 秒。

```ts
import { media } from "fluent-mediabunny";

const result = await media(file)
  .format("webm")
  .trim({ start: 2, end: 12 })
  .resize({ width: 1280 })
  .run();

const previewUrl = URL.createObjectURL(result.blob);
```

预览离开页面后调用 `URL.revokeObjectURL(previewUrl)`。[转换文件](/guide/convert) 说明格式、轨道和文件输出。

## 提取一张缩略图

```ts
import { thumbnail } from "fluent-mediabunny";

const poster = await thumbnail(file, { time: 2, width: 640 });
if (poster) {
  const imageUrl = URL.createObjectURL(poster.blob);
}
```

请求时间没有帧覆盖时，`thumbnail` 返回 `null`。图像不再使用时释放 `imageUrl`。[提取缩略图](/guide/thumbnails) 说明批量提取。
