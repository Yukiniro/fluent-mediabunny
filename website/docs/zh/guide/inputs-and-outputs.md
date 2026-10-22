# 选择输入与输出

传入 `File` 或 `Blob`、`ArrayBuffer`、由 `ArrayBuffer` 支撑的 `Uint8Array`，或绝对的 HTTP 或 HTTPS URL。远程资源必须允许 CORS。请求不带凭据，也不重试。带用户名或密码的 URL 抛出 `UNSUPPORTED_INPUT`。空的 `ArrayBuffer` 抛出 `INVALID_OPTIONS`。空的 `Uint8Array` 抛出 `UNSUPPORTED_INPUT`。

能识别容器不表示这个浏览器能解码或编码它。[probe](/api/probe) 在不转换的情况下读取容器、时长、音视频轨道和受支持的元数据。

## 返回 blob

`run()` 不传目标，或 `target: "blob"`，得到 `BlobResult`。字节在 `result.blob`。对象 URL 由应用创建和释放。`suggestedFilename` 是 `output.` 加上格式。

## 写入文件

```ts
await media(file)
  .format("mp4")
  .run({
    target: { type: "file", handle },
  });
```

`handle` 是文件的 `FileSystemFileHandle`，并且具备 `queryPermission`、`createWritable` 和 `isSameEntry`。`run` 之前就要授予读写权限。这个库不会打开文件选择器，也不会请求权限。没有授权时抛出 `PERMISSION_REQUIRED`。句柄做不到这些操作时抛出 `TARGET_UNSUPPORTED`。

两个任务不能同时占有同一个文件。第二个抛出 `TARGET_BUSY`。可写流以 `keepExistingData: false` 创建，所以成功打开会替换文件内容。

## 取消并读取进度

把 `signal` 设为 `AbortSignal`。传入 `onProgress` 接收 `{ phase, ratio }`。

`phase` 从 `"preparing"` 到 `"processing"`，再到 `"committing"`。`ratio` 是 0 到 1 的数。底层进度不是有限数时，`ratio` 为 `null`。回调抛错或返回 Promise 后会被停用。报告里随后包含 `CALLBACK_FAILED`。

提交前取消会中止已打开的文件流。一旦开始提交，中止会被忽略，任务等待文件关闭。只有处理进度并不能说明文件已经保存。

## 读取 targetState

只有 `run` 使用了文件目标并且随后失败时，才会设置 `targetState`。`"untouched"` 表示输出文件没有打开。`"aborted"` 表示已打开的流已中止。`"unknown"` 表示文件已打开，但中止或关闭没有证明字节状态。

blob 运行不设置 `targetState`。成功的文件运行有 `commitState: "committed"`，没有 `targetState`。

WAV 输出长于 4294967295 字节时抛出 `OUTPUT_TOO_LARGE`。输出长度为负或不是安全整数时，也是这个错误码。
