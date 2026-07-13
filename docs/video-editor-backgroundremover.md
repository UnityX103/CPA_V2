# BackgroundRemover 视频编辑与自包含运行时

CPA_V2 在设置窗口中提供“视频编辑”栏目。用户可以导入任意主体视频，裁剪时间与画面、调整 alpha 阈值、用画笔静态剔除区域，生成透明视频后立即预览，再按需导出并设为番茄钟结束提示。

## 处理链

原生侧按以下顺序运行：

1. FFprobe 读取时长、帧率、旋转和显示尺寸。
2. FFmpeg 按时间段与矩形裁剪出中间视频。
3. BackgroundRemover + U2NetP 生成逐帧 matte。
4. FFmpeg 将软阈值和画笔 PGM mask 合并到 alpha。
5. 将 VP8 Alpha WebM 生成到应用缓存中的唯一受管路径，并验证 `codec_name=vp8` 与 `alpha_mode=1`。
6. macOS 播放时用同一份内置 FFmpeg 转成 HEVC Alpha MOV；Windows 直接使用 WebM。
7. 生成完成后自动预览临时成品；最终导出只复制已生成文件，不再重复运行 BackgroundRemover。

画笔坐标相对于裁剪后画面，并静态应用到片段的每一帧。阈值只把低于阈值的 alpha 清零，保留阈值以上的软边缘。

## 运行时目标

运行时目录与 Tauri/Rust 编译目标一一对应：

| Tauri target | runtime target | manifest architecture |
|---|---|---|
| `x86_64-apple-darwin` | `macos-x86_64` | `x86_64` |
| `aarch64-apple-darwin` | `macos-arm64` | `arm64` |
| `x86_64-pc-windows-msvc` | `windows-x86_64` | `x86_64` |

映射基于编译目标，不基于构建机的 `uname`。macOS x86_64 与 ARM64 分别构建为 thin 包；Windows 保持 x86_64。Apple Silicon 构建 ARM 包时使用 `aarch64-apple-darwin` 并只查找 `macos-arm64`，构建 Intel/Rosetta 包时使用 `x86_64-apple-darwin` 并只查找 `macos-x86_64`。

每个安装包只携带一个 thin payload：

```text
video-runtime/<target>/
├── bin/{ffmpeg,ffprobe}
├── backgroundremover/
│   ├── backgroundremover
│   └── _internal/        # CPython、PyTorch、TorchVision、NumPy、SciPy 等
├── models/u2netp.pth
├── licenses/*
└── runtime-manifest.json
```

Windows 使用相同布局和 `.exe` 文件名。

## 当前固定来源

- BackgroundRemover：`nadermx/backgroundremover` commit `fa480627829759b902f8c233388d7aa67ab38099`。worker 先逐文件核对干净 commit，再应用仓库内 `force-cpu-device-env-v1` 补丁；补丁只让现有 `BACKGROUNDREMOVER_DEVICE=cpu` 生效，避免 Rosetta/Apple Silicon 的 MPS 路径返回全黑或高频条纹 matte。
- U2NetP：4,683,258 bytes，SHA-256 `e7567cde013fb64813973ce6e1ecc25a80c05c3ca7adbc5a54f3c3d90991b854`。
- FFmpeg：8.1.2，自固定源码构建。
- libvpx：1.16.0，静态链接；FFmpeg 仍提供 `libvpx` 和 `hevc_videotoolbox`。
- PyInstaller：6.16.0，one-dir worker，发布 staging 去除 symlink。
- macOS x86_64：CPython 3.9.6、PyTorch 2.2.2、TorchVision 0.17.2、NumPy 1.26.4、SciPy 1.13.1、scikit-image 0.24.0。
- macOS ARM64：CPython 3.12.12、PyTorch 2.13.0、TorchVision 0.28.0、NumPy 2.4.6、SciPy 1.18.0、scikit-image 0.26.0。

FFmpeg 使用 `--disable-autodetect --disable-network` 和静态 libvpx，只依赖 macOS 系统 dylib/framework。候选预编译 ARM 资产因包含 `--enable-nonfree` 已被拒绝；构建门禁也会扫描并拒绝任何含该标志的 FFmpeg/ffprobe。

两套当前 macOS worker 内都有最低部署目标为 macOS 14.0 的 Python/PyTorch Mach-O，因此 x86_64 与 ARM64 安装包都声明 `minimumSystemVersion: 14.0`。这不是 ARM 专属限制；降低任一包的声明会让安装包声称支持实际无法加载 worker 的旧系统。

MoviePy 被设置为 `FFMPEG_BINARY=auto-detect`，worker 不再捎带 imageio-ffmpeg 或 PyAV 的另一套 FFmpeg，而是复用同一 payload 的 `bin/ffmpeg`。

冻结 worker 启动时设置 `NUMBA_DISABLE_JIT=1`，并把 `NUMBA_CACHE_DIR` 指向任务/系统临时目录。原因是 PyInstaller 中的 `pymatting` 没有可供 Numba `cache=True` 使用的源码定位器；只更换缓存目录仍会在启动时失败。该设置同时覆盖构建 smoke、运行时健康探测和正式抠图任务，猫狗全帧 alpha 语义 E2E 用于防止兼容设置悄悄破坏 matte。

## 仓库保存与忽略内容

Git 保存：

- `app/src-tauri/video-runtime/source-policy.json`：允许的目标、固定 commit/model hash、编码器和许可证规则。
- `app/src-tauri/video-runtime/release-lock.example.json`：release lock 结构示例。
- `app/scripts/patches/backgroundremover-force-cpu.patch`：固定 SHA-256 的最小设备选择补丁。
- `app/scripts/prepare-video-runtime.mjs`：lock、prepare、verify CLI。
- `app/scripts/self-contained-video-build.mjs`：Tauri 构建门禁和包后验证。

大型 payload 位于被忽略的 `app/src-tauri/video-runtime/<target>/`。`prepare` 在写入目标前删除其他 target，避免 Tauri 把多套 Python/PyTorch 一起装包。

`app/tmp/` 仅用于构建输入、真实媒体 E2E 和本地产物，不是应用运行时依赖。

## 校验规则

`video-runtime:prepare` 与 `video-runtime:verify` 会检查：

- manifest target/architecture 与 release lock 一致；
- source-policy、release lock 与 manifest 中的 BackgroundRemover patch id/path/SHA-256 完全一致，且仓库内 patch 文件未漂移；
- FFmpeg、ffprobe、BackgroundRemover launcher 和 worker 内所有 Mach-O/PE 均为目标 thin 架构；
- 拒绝 Universal Mach-O、32 位文件、混合架构、symlink、未声明文件与 hash 漂移；
- U2NetP 大小与 SHA-256 固定；
- FFmpeg/ffprobe 不含 `--enable-nonfree`；
- smoke 模式验证版本、`libvpx`、macOS `hevc_videotoolbox` 和 worker `--help`；
- smoke 子进程均有截止时间：FFmpeg/ffprobe 10 秒，BackgroundRemover `--help` 240 秒（覆盖复制后首次执行时 macOS/Rosetta 对新 inode 的一次性验证），避免构建门禁永久挂起；
- macOS 构建门禁用 `otool` 展开 `@loader_path` / `@executable_path` / `@rpath`，拒绝越出 payload、外部 Homebrew/`/usr/local` 路径及缺失 dylib；
- 同一次 `otool -l` 扫描会解析每个 Mach-O 的 `LC_BUILD_VERSION minos` 或 `LC_VERSION_MIN_MACOSX version`，取最大值并拒绝低于它的 Tauri `minimumSystemVersion`；
- license pack 至少包含 BackgroundRemover、FFmpeg/libvpx、Python、PyTorch、TorchVision、PyInstaller 和 U2NetP 声明。

开发时仍可显式设置：

```text
CPA_FFMPEG=/absolute/path/to/ffmpeg
CPA_FFPROBE=/absolute/path/to/ffprobe
CPA_BACKGROUND_REMOVER=/absolute/path/to/backgroundremover
U2NETP_PATH=/absolute/path/to/u2netp.pth
```

这些 override 只用于 debug 开发构建。界面会区分“完整内置 payload”与“仅发现外部路径”；外部 BackgroundRemover 会在正式保存前执行最长 120 秒的有界健康检查，失败后回收子进程并继续尝试内置候选，但它仍不能作为发布证明。release 构建会忽略这些环境变量，避免自包含应用被外部工具替换。

release 应用只从当前可执行文件推导安装包内 payload：macOS 使用 `.app/Contents/Resources/video-runtime/<target>`，Windows 使用 `<exe-dir>/video-runtime/<target>`。源码 `src-tauri/video-runtime` 只在 debug 构建中作为开发候选，避免 release 从仓库启动时误执行包外二进制。FFmpeg/ffprobe 的运行时健康检查有 3 秒截止时间并在超时后 `kill + wait`；前端 10 秒仍未收到状态时会显示可重试错误，不会永久停在“正在检查”。

smoke 只在同一操作系统且宿主能执行目标架构时默认开启：Apple Silicon 可原生执行 ARM64，也可通过 Rosetta 执行 x86_64；Intel Mac 不会尝试执行 ARM64；Windows 只接受 x86_64 host/target。无论是否执行 smoke，静态校验都会拒绝 Universal、混合架构和错误架构文件。

每次点击生成都使用唯一的应用缓存路径，避免 macOS HEVC 兼容预览复用旧缓存。同一应用会话内不会抢删仍可能被 Windows 预览占用的 WebM；下一次启动并首次使用视频编辑器时，会清理上次会话的受管生成目录。macOS 中由受管临时源生成的 MOV 单独存入 `alpha-videos/video-editor-generated/` 并随下次会话清理，用户自行选择的透明视频缓存即使文件名也是 `result.webm` 也不会被误删。生成后的兼容预览只有触发 `canplay` 才能确认为可播放；`loadedmetadata` 不再被当成可解码证明。导出只将该受管临时 WebM 复制到用户选择的最终路径，不触发第二次抠图；番茄钟结束视频只使用最终导出路径，不持久引用可能被清理的应用缓存文件。

## 准备目标 payload

先生成包含精确来源、版本和 hash 的 lock：

```bash
cd app
npm run video-runtime:lock -- \
  --target macos-x86_64 \
  --out /release-inputs/macos-x86_64.lock.json \
  --ffmpeg /release-inputs/bin/ffmpeg \
  --ffprobe /release-inputs/bin/ffprobe \
  --background-remover-root /release-inputs/backgroundremover \
  --u2netp /release-inputs/u2netp.pth \
  --licenses /release-inputs/licenses \
  --ffmpeg-source 'immutable source + recipe reference' \
  --ffmpeg-version '8.1.2' \
  --ffprobe-source 'immutable source + recipe reference' \
  --ffprobe-version '8.1.2' \
  --background-remover-source 'git commit + worker recipe reference' \
  --python-version '3.9.6' \
  --python-source 'immutable x86_64 Python reference' \
  --torch-version '2.2.2' \
  --torch-source 'immutable target wheel reference' \
  --packager 'PyInstaller 6.16.0 + pinned spec hash' \
  --licenses-source 'immutable license-pack reference'
```

再原子化 staging 并做 smoke：

```bash
npm run video-runtime:prepare -- \
  --target macos-x86_64 \
  --lock /release-inputs/macos-x86_64.lock.json \
  --ffmpeg /release-inputs/bin/ffmpeg \
  --ffprobe /release-inputs/bin/ffprobe \
  --background-remover-root /release-inputs/backgroundremover \
  --u2netp /release-inputs/u2netp.pth \
  --licenses /release-inputs/licenses \
  --smoke
```

ARM64 使用同一流程，把 runtime target 和所有二进制/worker 来源换成 ARM64 对应项，例如：

```bash
npm run video-runtime:prepare -- \
  --target macos-arm64 \
  --lock video-runtime-locks/macos-arm64.json \
  --ffmpeg /release-inputs/macos-arm64/bin/ffmpeg \
  --ffprobe /release-inputs/macos-arm64/bin/ffprobe \
  --background-remover-root /release-inputs/macos-arm64/backgroundremover \
  --u2netp /release-inputs/u2netp.pth \
  --licenses /release-inputs/macos-arm64/licenses \
  --smoke
```

## 自包含构建

推荐入口：

```bash
npm run build:self-contained -- \
  --target x86_64-apple-darwin \
  --bundles app,dmg

npm run build:self-contained -- \
  --target aarch64-apple-darwin \
  --bundles app,dmg
```

该入口会：

1. 根据 Tauri target 选择 runtime target；
2. 对同机目标默认执行 smoke 与 macOS dylib 闭包检查；
3. 删除该 target 的旧 bundle，防止误验旧 `.app`；
4. 调用 Tauri release build；
5. 对精确的 `<productName>.app` 再次验证包内 manifest、hash、架构、依赖和 smoke。

`tauri.conf.json` 同时设置 `beforeBuildCommand` 与 `beforeBundleCommand`，所以裸 `tauri build` 或 `tauri bundle` 也不能绕过 payload 门禁。自包含 wrapper 拒绝 `--debug`，只验证 release 包。

macOS 分别生成 thin x86_64 与 thin ARM64 包，不生成 Universal 包。每个安装包只包含与其 Tauri target 对应的一套 FFmpeg、ffprobe、BackgroundRemover、Python/PyTorch、模型和许可证。

## 平台验证边界

- macOS x86_64 必须跑真实媒体推理、最终 VP8 Alpha、HEVC Alpha 转换、包内 runtime 和 `.app` 启动验证。
- macOS ARM64 必须在 Apple Silicon 上跑同等范围的真实媒体推理、最终 VP8 Alpha、HEVC Alpha 转换、包内 runtime 和 `.app` 启动验证。
- 两个 macOS 安装包当前都要求 macOS 14.0 或更高版本；最终 `.app/Contents/Info.plist` 的 `LSMinimumSystemVersion` 也必须为 `14.0`。
- Windows x64 的目录、PE 架构和 manifest 契约已有测试，但最终 DLL 闭包、NSIS 内资源和真实推理必须在 Windows x64 构建机验证，不能用 macOS fixture 宣称完成。
- 公共 macOS 下载仍需要 Developer ID 与 Apple notarization；仓库默认 ad-hoc 签名只保证本地资源封装和代码签名结构，不等同于公证。

## 测试

```bash
cd app
npx vitest run scripts/prepare-video-runtime.test.mjs \
  scripts/self-contained-video-build.test.mjs
npm test

cargo test --manifest-path src-tauri/Cargo.toml \
  --target x86_64-apple-darwin
cargo test --manifest-path src-tauri/Cargo.toml \
  --target aarch64-apple-darwin
```

真实媒体测试由 `CPA_VIDEO_EDITOR_E2E=1` 门控，并在最终 payload 与最终 `.app` 路径上单独执行。E2E 会解码全部 alpha 帧，并拒绝动态范围不足、没有软边缘、静态不变、高频条纹或异常帧间跳变；只验证退出码、文件非空或 `alpha_mode=1` 不算通过。
