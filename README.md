# fluent-mediabunny

基于官方 Mediabunny `Conversion` 的不可变链式浏览器媒体转换库。第一版固定 Mediabunny **1.61.6**，使用 **Vite+ 1.3.0**（Vite、Vitest、Oxlint、Oxfmt、库打包和类型检查）。本地实现，尚未发布 npm。

```ts
import { media, probe } from "fluent-mediabunny";

const info = await probe(file);
const result = await media(file)
  .format("mp4")
  .trim({ start: 0.2, end: 1.2 })
  .resize({ width: 640 })
  .metadata({ title: "片段", comment: null })
  .run({ signal, onProgress: ({ phase, ratio }) => console.log(phase, ratio) });
// result.kind === 'blob'; result.blob 可用于下载、播放或后续处理。
```

`format` 必填。配置方法返回新 Builder，重复 `run()` 使用独立资源。`video` / `audio` 按字段合并；bitrate 和 quality 后设置者替换前者；再次调用 `metadata` 会替换整个 metadata 指令。重复 source 字节不复制，调用方须保持源数据稳定。

## 功能边界

单输入、单输出；File/Blob、ArrayBuffer、Uint8Array、绝对 HTTP(S) URL。输入容器：MP4/M4A/MOV、WebM/MKV、MP3、WAV、Ogg、FLAC、ADTS。输出：MP4、WebM、M4A、WAV。提供 auto/copy/transcode、trim、resize、crop、90 度倍数旋转、编码选项、轨道选择、metadata、probe、取消和进度。

无 preset、多输入拼接、混音、滤镜图、字幕合成、HLS、实时流、任意 FFmpeg 参数、自动 Worker、服务端转码或编码插件。FFmpeg 仅用于测试素材与独立验证，不进入运行时。

| 格式 | auto/transcode 默认     | copy 白名单                           |
| ---- | ----------------------- | ------------------------------------- |
| mp4  | AVC + AAC               | AVC/HEVC + AAC                        |
| webm | VP9 + Opus；可显式 VP8  | VP8/VP9/AV1 + Opus/Vorbis             |
| m4a  | AAC                     | AAC，恰好一条音轨，无视频             |
| wav  | PCM s16；可显式 s24/f32 | PCM s16/s24/f32，恰好一条音轨，无视频 |

自动模式固定目标编码，不偷偷换 codec；HEVC→MP4 默认转 AVC，保留 HEVC 要使用 copy。复制无需解码/编码能力。重编码按实际参数检查能力，不回退采样率或声道；默认编码质量 high。WAV 不接受 bitrate/quality。显式 trim 强制重编码，时间相对于所选轨的最早非负起点；精度受样本/帧边界影响。

`tracks({video:false,audio:'primary'})` 可提取音频；默认保留全部音视频轨。ID 来自 probe，不是序号；m4a/wav 不自动丢弃视频或挑选音轨。无法完整保留所选轨返回 TRACK_LOSS。

```ts
const audio = await media(file).tracks({ video: false, audio: "primary" }).format("m4a").run();
```

metadata 仅支持 `title / artist / album / albumArtist / genre / comment / description / date`，四种格式均支持这八字段。date 是有效 `YYYY-MM-DD`，null/空串删除。默认 merge 从源允许字段开始，replace 从空字段开始；封面、lyrics、raw 等不复制，省略内容进入报告。WAV 使用 ID3，部分播放器不会展示其中标签。MP4/M4A 使用 mdir，WebM 使用 SimpleTags；详见 [正式规格](spec/design-v1.md)。

## 文件写入与取消

调用方提前取得句柄与 readwrite 权限，再传给库；库不弹选择器、不请求权限。源文件与目标必须不同，File/Blob 无法反推源句柄。

```ts
// 在用户点击事件中由应用获取句柄。
const handle = await window.showSaveFilePicker({ suggestedName: "output.mp4" });
const result = await media(file)
  .format("mp4")
  .mode("copy")
  .run({ target: { type: "file", handle }, signal });
// 只有真实文件 close 成功后，才得到 commitState: 'committed'。
```

底层 Conversion 的 finalize/cancel 不提交真实文件。commit 前取消会等待执行退出并 abort 写流；进入 committing 后取消忽略，close 失败返回 WRITE_FAILED、targetState=unknown。权限不足不打开写流；同模块内同目标的并发写入返回 TARGET_BUSY。锁不覆盖其他标签页、Worker、其他库实例或外部程序。

文件替换使用 `keepExistingData:false`，成功后无旧尾部；不会删除 picker 创建的空文件。不能承诺断电原子性、外部程序竞争或已失败 close 的回滚。WAV 限普通 RIFF 逻辑文件长 ≤ `0xffffffff`，不自动 RF64。

Blob 输出会占用整文件内存。文件输出保留背压，但 muxer 索引仍会增长。为拒绝动态视频尺寸，重编码前扫描所选区间的解码帧，再由 Conversion 执行转换，意味着额外解码成本。长文件请在调用方管理的 Worker 中运行并自行传输适合的输入/句柄。

URL 是匿名 GET（credentials=omit），无自动重试，仍受 CORS 限制。取消通过 Input.dispose 中止请求；底层异步释放并无全部完成的公开确认接口。对外展示原始 error.cause 前请去除 URL 查询参数、凭据与文件路径。库关闭 Conversion 的自动警告，不记录输入 URL 或遥测。

## 开发与验证

需要 Node 24、项目指定的 pnpm 12.14.0；安装 Vite+ 后也可直接使用 `vp`。不要用旧 pnpm 改写新锁文件。

```sh
pnpm install --frozen-lockfile
pnpm exec vp check
pnpm exec vp test run
pnpm exec vp pack
pnpm exec playwright install chrome firefox webkit
pnpm test:browser
pnpm dev
```

FFmpeg/ffprobe 必须在 PATH；`pnpm fixtures` 重新生成所有合成素材。自动化测试直接使用仓库内的固定素材。开发页是测试入口，不是产品 UI。`tests/native.html` 为原生文件选择器人工验收页，只选择专用测试文件。

构建产物为 `dist/index.mjs` 与 `dist/index.d.mts`，Mediabunny 保持 peer dependency。在其他项目可通过本地目录依赖或 `pnpm pack` 后安装；浏览器使用项目 bundler，不把包含裸包导入的 ESM 直接当 CDN 脚本。File System Access API 的扩展 TypeScript 声明可由应用安装 `@types/wicg-file-system-access`。

测试结果、逐项 AC 映射与未验收范围见 [验证报告](docs/validation.md)。CI 工作流已提供但尚未在 GitHub 执行。未选择本库开源许可证、未发布；上游 Mediabunny 的许可证为 MPL-2.0，保持外置依赖及其声明。
