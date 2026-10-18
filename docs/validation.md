# 第一版实现验证

日期：2026-10-18。本报告为本地实际执行结果，不是全设备支持或发布证明。

## 结果

- Vite+ 1.3.0 `vp check`：格式、Oxlint、类型检查通过。
- Vitest：3 个文件，17 项测试通过，含真实 Mediabunny PCM 转换和故障注入。
- Vite+ `vp pack`：ESM + TypeScript 声明生成成功；约 32.23 kB ESM（gzip 9.62 kB），不含外置 Mediabunny。
- Playwright：33 项，29 通过、4 跳过、0 失败。跳过的是 WebKit/Firefox 的 OPFS 与资源趋势用例，这两类以 Chrome 为实现基线。
- 构建产物在三个浏览器中通过实际导入及 WAV 转换，非仅检查源代码。
- 独立 FFprobe 检查四格式容器、轨道数量和 Unicode title；FFmpeg 解码转换产物无错误。WebM 的 title 被 FFprobe 展示为 `MOVIE/TITLE`。

工具链 TypeScript 7.0.2 的声明生成仍有工具自身“API experimental”提示；构建与类型检查成功，但未来升级应复测。

## 浏览器观察

实际版本：[browser-versions.json](browser-versions.json)。完整测试名称与能力结果：[browser-results.json](browser-results.json)。

| 实测组合                                    | Chrome 155.0.8059.80        | Playwright WebKit 26.0             | Firefox 146.0.1             |
| ------------------------------------------- | --------------------------- | ---------------------------------- | --------------------------- |
| MP4/WebM/M4A/WAV copy、八 metadata 字段回读 | 通过                        | 通过                               | 通过                        |
| AVC/AAC 重编码 MP4；AAC 重编码 M4A          | 通过                        | 通过                               | CODEC_UNAVAILABLE           |
| VP8/Opus、VP9/Opus 与 WAV 重编码            | 通过                        | 通过                               | 通过                        |
| HEVC→MP4 auto 解析并输出 AVC                | 通过                        | 通过                               | CODEC_UNAVAILABLE           |
| HEVC copy                                   | 通过                        | 通过                               | 通过                        |
| 奇数尺寸 VP9 yuv444p 输入缩放               | 通过                        | CODEC_UNAVAILABLE                  | 通过                        |
| 动态尺寸输入                                | UNSUPPORTED_INPUT，未开文件 | 解码时 PROCESSING_FAILED，未开文件 | UNSUPPORTED_INPUT，未开文件 |
| OPFS 覆盖、回读、取消保留旧内容             | 通过                        | 未验收                             | 未验收                      |

“通过”只适用于本地测试中的素材、参数和机器。WebKit 自动化不等同于 Safari/iOS 真机。失败路径测试通过不代表该 codec 编码成功。静态能力检查不能阻止运行时解码/编码失败。

## AC 对应证据

| AC  | 实现及测试证据                                                                                     | 边界                                                   |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 001 | Builder 分支 metadata 不污染 base；同 Builder 并发 WAV run 独立 Blob                               | 输入字节由调用方保持稳定                               |
| 002 | metadata 后调用替换；WebM quality→bitrate 覆盖经真实转换验证；无 preset                            | 没有额外配置体系                                       |
| 003 | HEVC auto→AVC、copy→HEVC；无 WebCodecs 的 Node 仍可 copy；Firefox auto 明确失败                    | 不声明 HEVC 编码                                       |
| 004 | AVC/WebM、WAV 参数、copy+trim 等早期拒绝                                                           | 无文件写流副作用                                       |
| 005 | 12345 Hz 不可编码、48000 Hz 可编码的受控能力替身只收到一次精确查询；真实 48000 Hz 双声道四格式验证 | 替身只证明拒绝逻辑；浏览器成功另记                     |
| 006 | 有视频导出 m4a 不丢视频，TRACK_LOSS；显式排除后成功                                                | 采用规格 4.6 的轨道数量错误定义                        |
| 007 | 多音轨 WAV 拒绝，primary 导出 M4A 成功；无音轨 HEVC MP4 copy/auto                                  | ID 越界、重复/空列表验证                               |
| 008 | merge/null/replace、二次 metadata 指令、同容器删除 title 回读                                      | 不传 raw，避免旧 title 复活                            |
| 009 | 八字段 × 四格式 × 三浏览器；中文、emoji、2024-02-29；非法日期/Unicode/未知字段拒绝                 | 独立解析器交叉验证 title，全部八字段由 Mediabunny 回读 |
| 010 | raw 省略报告；replace 清空无逐字段报警                                                             | 不保证发现底层未暴露的内容                             |
| 011 | 预 aborted run/probe 不请求 URL；createWritable 晚到后 abort                                       | 底层异步释放无完全结束的公开证明                       |
| 012 | finalize 冲刷缓冲时真实 write 触发取消，实际 close=0、abort=1；OPFS 保留已提交数据                 | 原生用户目录见下方未完成项                             |
| 013 | close 延迟屏障，commit 后 abort 仍成功；close 拒绝 WRITE_FAILED+unknown                            | 不保证操作系统断电行为                                 |
| 014 | 网络失败仅一次请求；慢 URL 取消；捕获未处理页面错误为零；请求 credentials=omit / mode=cors         | 无跨互联网服务压测                                     |
| 015 | 同句柄并发 lease 拒绝；2 MB 旧 OPFS 文件成功被较短 MP4 替换                                        | 锁仅同模块实例内                                       |
| 016 | MP4 最终位置写回；result.size 等于实际文件长；回读两条音视频轨                                     | 与累计写入量无关                                       |
| 017 | processing ratio=1 后 close 仍等待；回调抛错变警告，不影响结果                                     | 不把比例当提交状态                                     |
| 018 | 非零起点、真实旋转矩阵、VFR、裁剪/旋转/缩放/帧率；FFmpeg 解码及音视频起点差 <80 ms                 | 验证帧级时间边界，不是主观口型同步或逐像素保真验收     |
| 019 | 写入失败+abort 清理失败保留 WRITE_FAILED；取消先发生保留 ABORTED                                   | 清理错误归 diagnostics                                 |
| 020 | WAV 预计 PCM 大小检查、每次位置写入前上限保护；边界算术故障注入                                    | 未创建 >4 GB 实体文件                                  |

## 性能与资源观察

Chrome 对 30 秒 640×360、24 fps 合成文件重复执行 8 轮成功/预取消，每轮另触发轨道约束失败，文件最终 6,778,236 字节；4 轮取消按预期返回。每次写入后能继续使用同一句柄，证明 lease 被释放。

采样的 JS heap 约 32.5–86.0 MB，记录见 JSON。该指标可能受 GC、浏览器采样精度和测试本身影响，不含完整原生解码器内存；不能据此声称无泄漏或恒定内存。没有小时级视频或大批量并发压力测试。

## 原生保存面板与其他未完成项

实际通过 Chrome 原生点击打开了 macOS 保存面板；在目录跳转后，当前桌面自动化无法稳定定位系统面板，未完成保存/覆盖/取消的原生用户目录验收。测试未修改用户媒体，专用占位文件已移除，验证标签页已关闭。

可在 `pnpm dev` 后访问 `/tests/native.html`，选择专用 `native-output.mp4` 完成人工复测。这个页面由调用方请求 picker，库本身不会请求权限。OPFS 和受控写流的通过不能替代该项。

尚未执行 GitHub CI（仅提供工作流）、真实 Safari/iOS/Android/Windows 验收、npm 发布和公开许可证选择。没有进行对抗性媒体模糊测试，也未宣称 FFmpeg 等价覆盖。发布前应补原生文件验收与目标平台实机检查。

## 复现

依赖版本锁在 package.json / pnpm-lock.yaml。合成素材来源与预期见 `public/fixtures/manifest.json`，完整生成方式在 `scripts/fixtures.mjs`，无第三方媒体。运行 README 中的检查、构建与浏览器命令即可重现；Playwright 结果默认写入 test-results，报告中的 JSON 为本次结果快照。
