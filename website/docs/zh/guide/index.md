---
title: 使用指南
description: 安装 fluentbunny 并构建浏览器媒体工作流的任务指南。
---

# 使用指南

先按任务构建浏览器媒体工作流，再通过 API 参考查询精确类型与校验规则。

## 准备环境

[开始使用](/zh/guide/getting-started)介绍源码构建、安装和第一次转换。[输入与输出](/zh/guide/inputs-and-outputs)说明 URL 要求、文件权限、取消和提交状态。

## 转换媒体

[转换文件](/zh/guide/convert)介绍格式选择、复制与转码、时间裁剪、画面变换、音频提取和元数据编辑。

## 读取图片与元数据

[提取缩略图](/zh/guide/thumbnails)介绍单张海报、批量提取、帧时间、图片尺寸和迭代器清理。

查看时长和轨道时，从 [probe 示例](/zh/api/probe#example)开始；读取封面时，使用 [getEmbeddedPicture](/zh/api/embedded-picture#example)。封面图片与解码的视频帧是两种独立操作。

## 处理失败

使用 [MediaError](/zh/api/errors)区分参数错误、编解码器不可用、取消和文件写入失败。把进度视为保存成功之前，请先阅读[执行与结果](/zh/api/run)。
