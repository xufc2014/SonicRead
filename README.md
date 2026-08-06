# SonicRead 智能小说播放器

轻量级 Android 有声小说播放器（uni-app 开发）。核心功能：**自动跳过文件尾部的静音段**，实现无缝连播。

## 功能特性

- 📁 **用户自选目录**：内置目录浏览器，自由选择存放小说的文件夹，自动扫描其中的 MP3
- 🎧 **顺序播放**：按文件名数字自然排序，点击列表即播，播完自动下一集
- 🔇 **静音自动跳转**（核心）：播放前用 Web Audio 预分析文件尾部音量，检测到连续 3 秒低于 -45dB 的静音段时自动跳转下一集，无需手动跳过
- ⏩ **播放控制**：播放/暂停、上一首/下一首（500ms 防抖）、进度条拖动
- 💾 **播放记忆**：记住上次播放的文件与进度，重新打开自动续播
- 🔒 **锁屏续播**：后台/息屏状态下播放不中断

## 技术要点

| 项目 | 方案 |
|------|------|
| 框架 | uni-app（Vue2）+ HBuilderX 打包 |
| 播放核心 | `uni.createInnerAudioContext()`（原生播放器） |
| 静音检测 | renderjs + Web Audio API 预分析（非实时检测） |
| 文件访问 | `plus.android` 反射 `java.io`（绕开 Android 10+ 分区存储对 `plus.io` 的绝对路径限制） |
| targetSdk | 28（避开分区存储强制约束，传统存储权限全机型通用） |

## 运行方式

1. 用 HBuilderX 打开本项目目录
2. 运行到 Android 设备或云打包生成 APK
3. 首次打开授权存储权限 → 选择小说文件夹 → 自动扫描播放

## 目录结构

```
SonicRead/
├── pages/index/index.vue        # 主页面（列表 + 播放 + 静音跳转 + 目录选择）
├── pages/index/silence-analyzer.js  # renderjs 静音分析模块
├── manifest.json                # 应用配置与 Android 权限
├── pages.json
├── 需求文档.md                   # 产品需求文档（V1.1）
└── main.js / App.vue / uni.scss
```

详细设计见 [需求文档.md](需求文档.md)。
