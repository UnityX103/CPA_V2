# BackgroundRemover 视频编辑运行时

CPA_V2 的设置窗口包含“视频编辑”栏目。前端负责裁剪框、时间段、软阈值和静态剔除画笔；Tauri 原生侧负责校验路径并依次运行 FFmpeg、BackgroundRemover 和最终 VP8 Alpha 编码。

## 输出约定

- 输出固定为 `.webm`。
- 视频编码固定为 VP8，包含 `alpha_mode=1`，可直接作为 CPA_V2 的自定义番茄钟结束视频。
- macOS 播放时继续复用现有的 WebM → HEVC Alpha MOV 缓存转换。
- 画笔坐标相对于裁剪后的画面，静态应用到片段的每一帧。
- “背景清除阈值”只把低于阈值的 alpha 清零，阈值以上的软 alpha 会保留，避免把毛发边缘强制二值化。

## 必需的外部运行时

当前源码集成没有把 Python、PyTorch、FFmpeg 和 BackgroundRemover 打进安装包。设置面板会检查以下四项，缺少任一项时禁用保存按钮并显示明确错误：

1. x64 `ffmpeg`
2. x64 `ffprobe`
3. BackgroundRemover CLI
4. U2NetP 模型文件

可通过环境变量显式配置：

```text
CPA_FFMPEG=/absolute/path/to/ffmpeg
CPA_FFPROBE=/absolute/path/to/ffprobe
CPA_BACKGROUND_REMOVER=/absolute/path/to/backgroundremover
U2NETP_PATH=/absolute/path/to/u2netp.pth
```

开发环境还会自动查找 `app/tmp/video-matting-lab/tools/BackgroundRemover` 中的实验运行时。`app/tmp/` 被 Git 忽略，只用于本机开发，不能当作发布包依赖。

## macOS x64

使用 x86_64 Python/FFmpeg/BackgroundRemover，或在启动 CPA_V2 前显式传入上面的路径。项目只验证和发布 x64 目标；不要把本机 arm64 Homebrew/Python 环境误当成可发布运行时。

## Windows x64

安装 x64 Python、BackgroundRemover 和 FFmpeg 后设置环境变量，或者把对应可执行文件加入 `PATH`。原生命令面和参数校验与 macOS 相同，输出仍为 VP8 Alpha WebM。

## 发布前剩余工作

若要让普通用户无需安装 Python，应分别在 macOS x64 和 Windows x64 构建并签名一个固定版本的 BackgroundRemover sidecar，并把 FFmpeg、U2NetP 模型、第三方许可证和校验值一起配置为 Tauri resources/externalBin。完成该步骤前，界面中的“运行时可用”只表示当前机器的外部依赖可用，不表示发布安装包已经自包含。
