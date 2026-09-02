# CPA_V2

CPA_V2 是一个使用 Tauri 2、Rust、React 和 TypeScript 重写的桌面宠物番茄钟，支持
macOS（Intel / Apple Silicon）和 Windows x86_64。项目包含透明置顶桌宠窗口、番茄钟、
多人 WebSocket 同步、活动应用与按键统计，以及按需下载的视频编辑和“蟑螂入侵”模块。

## 项目仓库

- GitHub：[UnityX103/CPA_V2](https://github.com/UnityX103/CPA_V2)
- CNB 镜像：[nanzhaigame-xpy/CPA_V2](https://cnb.cool/nanzhaigame-xpy/CPA_V2)
- GitHub Releases：[最新版本](https://github.com/UnityX103/CPA_V2/releases/latest)
- CNB Releases：[最新版本](https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest)

## 目录结构

```text
app/                         Tauri 桌面应用与 React 前端
Server/                      多人模式 WebSocket 服务端
video-editor-module/         可独立下载的视频编辑模块
cockroach-electron-module/   可独立下载的蟑螂模拟模块
AUI/                         Pencil 设计源文件与界面原型
```

## 本地开发

桌面应用：

```bash
cd app
npm install
npm run tauri dev
```

多人服务端：

```bash
cd Server
npm install --package-lock=false
npm start
```

运行前端和服务端测试：

```bash
cd app && npm test
cd Server && npm test
```

## 使用的开源项目

感谢以下开源项目的作者和贡献者。表中的链接均指向本项目实际集成、固定版本或发行来源；
完整版本、哈希和发行审计信息以模块内的来源清单为准。

### 视频编辑模块

视频编辑模块使用 SAM 2.1 传播视频目标，使用 BiRefNet-matting 生成软透明通道，并通过
FFmpeg/libvpx 导出带 Alpha 的 VP9 WebM。详细实现和来源审计见
[`video-editor-module/README.md`](video-editor-module/README.md) 与
[`source-policy.json`](video-editor-module/source-policy.json)。

| 项目 | 在 CPA_V2 中的用途 | 固定来源 | 上游许可 |
| --- | --- | --- | --- |
| [Meta SAM 2](https://github.com/facebookresearch/sam2) | 视频目标分割与双向掩码传播 | [`2b90b9f`](https://github.com/facebookresearch/sam2/tree/2b90b9f5ceec907a1c18123530e92e794ad901a4) | Apache-2.0 |
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | 高分辨率主体抠图与毛发软边 | [`25cb930`](https://github.com/ZhengPeng7/BiRefNet/tree/25cb9309bacf3dde954e4584594e16e142c51de5) | MIT |
| [BiRefNet-matting](https://huggingface.co/ZhengPeng7/BiRefNet-matting) | 视频抠图模型权重 | [`eccde0a`](https://huggingface.co/ZhengPeng7/BiRefNet-matting/tree/eccde0a8cbdce7ac5fecfeb06340fe7b949e85d9) | 模型卡标注 MIT；另见下方非商业说明 |
| [PPM-100](https://github.com/ZHKKKe/PPM) | BiRefNet-matting 权重的训练数据来源之一 | 上游仓库 | CC BY-NC-SA 4.0（alpha 标注） |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | 视频解码、转码及透明视频导出 | macOS 8.1.2；Windows [`1a748fe`](https://github.com/FFmpeg/FFmpeg/tree/1a748fe2cd43e3ead22fafb1b5b7d77f153898a8) | LGPL 兼容构建 |
| [libvpx](https://github.com/webmproject/libvpx) | VP9 Alpha 编码 | macOS v1.16.0；Windows [`9cc8e1c`](https://github.com/webmproject/libvpx/tree/9cc8e1c18024d6b64422ecb7fdd7a43c8e873908) | BSD-style + PATENTS |
| [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) | Windows LGPL FFmpeg 构建来源 | [`8267213`](https://github.com/BtbN/FFmpeg-Builds/tree/8267213e26c1031621e6e1210fe3aa4867214f6a) | 以构建产物及所含组件许可为准 |

> **非商业限制：** 当前公开的视频编辑模块使用的 BiRefNet-matting 权重列出 PPM-100
> 作为训练数据，而 PPM-100 的 alpha 标注采用 CC BY-NC-SA 4.0。因此 CPA_V2 仅以
> 非商业、开源学习与研究用途发布该可下载模块。详见
> [`NONCOMMERCIAL-NOTICE.md`](video-editor-module/licenses/NONCOMMERCIAL-NOTICE.md)。

### 蟑螂模拟模块

| 项目 | 在 CPA_V2 中的用途 | 固定来源 | 上游许可 |
| --- | --- | --- | --- |
| [jo9900/CockroachPet-Public-Electron](https://github.com/jo9900/CockroachPet-Public-Electron) | 桌面蟑螂模拟、渲染与行为逻辑 | [`a7d103d`](https://github.com/jo9900/CockroachPet-Public-Electron/tree/a7d103d2818b40e12b8a39948e9ebf4c6085bfd3)（v1.1.0） | MIT |
| [Electron](https://github.com/electron/electron) | 蟑螂模块的独立桌面运行时 | [v40.8.0](https://github.com/electron/electron/tree/v40.8.0) | MIT + Chromium 第三方声明 |

CPA_V2 只负责该模块的安全下载、完整性校验、配置写入与子进程生命周期管理。详细集成说明见
[`cockroach-electron-module/README.md`](cockroach-electron-module/README.md) 和
[`THIRD-PARTY-SOURCES.md`](cockroach-electron-module/licenses/THIRD-PARTY-SOURCES.md)。

### 应用与服务端基础设施

| 项目 | 用途 | 仓库 |
| --- | --- | --- |
| Tauri | 跨平台桌面应用壳与原生插件 | [tauri-apps/tauri](https://github.com/tauri-apps/tauri) |
| React | 前端界面 | [facebook/react](https://github.com/facebook/react) |
| Zustand | 前端领域状态管理 | [pmndrs/zustand](https://github.com/pmndrs/zustand) |
| Vite | 前端开发与构建 | [vitejs/vite](https://github.com/vitejs/vite) |
| Vitest | 前端与脚本测试 | [vitest-dev/vitest](https://github.com/vitest-dev/vitest) |
| ws | 多人模式 WebSocket 服务端 | [websockets/ws](https://github.com/websockets/ws) |

各项目的商标、版权和许可均归其各自权利人所有；上表不是第三方许可文本的替代品。发行包中的
第三方组件应保留对应许可与声明。
