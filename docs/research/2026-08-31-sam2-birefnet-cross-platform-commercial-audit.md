# SAM 2.1 + BiRefNet-matting 第四方案：跨平台与商用审计

Date: 2026-08-31

> 范围：本报告只审计本次对比中的第四种实现：**Meta SAM 2.1 Hiera Base+ + ZhengPeng7/BiRefNet-matting + 我们自己的 mask-band fusion + VP8 Alpha WebM 导出**。它不是 FudanCVL/SAM2Matting，也没有使用 MatAnyone 或 VideoMaMa。本文不是法律意见；公开发行前仍应由发行主体完成正式法务复核。

## 结论

1. **第四方案并不是一个“明确禁止商用”的方案。**SAM 2.1 的代码和 checkpoint 明确为 Apache-2.0；BiRefNet 源码为 MIT；`ZhengPeng7/BiRefNet-matting` 官方模型卡也把权重标成 MIT。我们自己的 band fusion 可以保持闭源。这里与明确限制非商用的 Fudan SAM2Matting、MatAnyone、VideoMaMa 有本质区别。
2. **但现成 BiRefNet-matting 权重目前不能写成 `commercial-clean / 零风险商用`。**官方模型卡列出 PPM-100 为训练集，而 PPM 官方仓库规定原始照片允许商用、人工标注的 alpha matte 为 CC BY-NC-SA 4.0。模型卡给权重标 MIT，却没有解释训练数据中的 NC 条款如何处理，也没有提供商业清洁性声明。权重并非因此被自动判定为不可商用，但这是必须由作者书面澄清或由法务接受的来源风险。
3. **成品视频的播放交付路线基本正确，AI 推理运行时还没有做到三目标可发布。**Windows 继续使用 VP8 Alpha WebM；macOS 转为 HEVC with Alpha MOV。当前样片已在 M4 Pro 上通过项目现有的精确 FFmpeg 命令转码并验证 alpha 一致，但 Windows x86_64 和 macOS x86_64 尚无实机验证。
4. **macOS ARM64 能正确离线处理，但当前性能不适合内置编辑器。**SAM 2.1 在 M4 Pro 的 MPS 后端产出噪声；CPU 正确，但 220 帧前后双向传播约 14 分 41 秒。BiRefNet 在 MPS FP16、batch 2 下约 202 秒。Meta 自己也把 MPS 支持称为 preliminary，并警告可能数值不同、性能下降或因 MPS 内存导致崩溃。
5. **macOS x86_64 是当前精确推理栈的硬阻塞项。**SAM 2 要求 `torch>=2.5.1`；BiRefNet 当前 requirements 要求 `torch>=2.5.0`，因此组合栈的最低版本仍由 SAM 2 提高到 2.5.1。PyTorch 官方从 2.3 起停止发布 macOS x86_64 二进制，当前发布矩阵只列 macOS ARM64。若坚持完全相同的 PyTorch 路线，Intel Mac 需要自行维护源码构建，且只能 CPU 推理。
6. **Windows x86_64 在依赖层面可行，但尚未被验证为产品路径。**PyTorch 官方发布矩阵支持 Windows 10+ x86_64；SAM 2 官方却强烈建议 Windows 使用 Ubuntu WSL，并以 CUDA 为主要性能路径。官方仓库没有产品化的 ONNX、CoreML 或 DirectML 导出/运行后端。现有 Parallels Windows 目标不能作为 Windows x86_64 验证环境，因此目前只有静态代码审查，不能宣称“Windows 已兼容”。
7. **当前 Homebrew FFmpeg 绝不能直接作为闭源应用内捆绑基线。**本机 `ffmpeg 8.1.2` 的 configure 行同时包含 `--enable-gpl`、`--enable-version3`、`--enable-libx264`、`--enable-libx265`。FFmpeg 官方说明启用 GPL 部分后整体由 LGPL 切换为 GPL；启用 version3 后为 GPLv3+。发行时应制作最小化、可复现的 LGPL-compatible build，或改用 AVFoundation/VideoToolbox 原生转换，或继续让 FFmpeg 成为用户显式安装的外部工具。

因此，第四方案当前的准确状态是：

- **模型/代码许可证：绿灯偏黄，可商用，不是 NC，但 BiRefNet 权重训练数据来源待澄清。**
- **已生成素材在现有播放器中的格式路线：可继续。**
- **把 AI 裁剪能力作为 macOS ARM64 + macOS x86_64 + Windows x86_64 的自包含桌面功能发布：现在还不合格。**

## 一、方案身份与可复现快照

第四方案由三个可分离部分组成：

```text
SAM 2.1 Hiera Base+ 时序 mask
        +
BiRefNet-matting 单帧 soft alpha
        +
自有 erode/core + dilate/support band fusion
        ↓
固定画布 RGBA → VP8 Alpha WebM
        ├─ Windows: 原样交给 WebView2 <video>
        └─ macOS: libvpx 解码 → VideoToolbox HEVC Alpha MOV
```

本次审计记录的上游快照：

| 项目 | 审计快照 | 说明 |
| --- | --- | --- |
| Meta SAM 2 源码 | [`2b90b9f5ceec907a1c18123530e92e794ad901a4`](https://github.com/facebookresearch/sam2/tree/2b90b9f5ceec907a1c18123530e92e794ad901a4) | 2026-08-31 浅克隆的官方 `main` |
| SAM 2.1 Hiera Base+ 官方 HF 模型 | [`b7320756a13354e7530a63935656d35b2f91a290`](https://huggingface.co/facebook/sam2.1-hiera-base-plus/tree/b7320756a13354e7530a63935656d35b2f91a290) | 模型卡 `license: apache-2.0`；包含原始 `.pt` 与 Transformers safetensors |
| SAM 2.1 Base+ 官方 Meta checkpoint | [Meta 下载地址](https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt) | 323,606,802 bytes；本次 PoC 文件 SHA-256 `a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5` |
| BiRefNet 源码 | [`25cb9309bacf3dde954e4584594e16e142c51de5`](https://github.com/ZhengPeng7/BiRefNet/tree/25cb9309bacf3dde954e4584594e16e142c51de5) | 2026-08-31 官方 `main` |
| BiRefNet-matting 权重/远程模型代码 | [`eccde0a8cbdce7ac5fecfeb06340fe7b949e85d9`](https://huggingface.co/ZhengPeng7/BiRefNet-matting/tree/eccde0a8cbdce7ac5fecfeb06340fe7b949e85d9) | 本机实际缓存 revision；`model.safetensors` SHA-256 `a9875de5b1e6c8eb5fdaa8c727a82927ce442cdc87ba3abee6a77e6fa46c25bb` |

产品实现不能再使用浮动的 `main` 或 `from_pretrained(..., revision=None, trust_remote_code=True)`。必须固定 revision、逐文件哈希，并保存模型卡与许可证快照；尤其是 HF `trust_remote_code` 会执行模型仓库中的 Python 文件，revision 不固定同时是供应链风险。

## 二、商业许可判断

### 2.1 核心组件

| 组件 | 上游明确条款 | 商用 | 闭源分发的主要义务/风险 |
| --- | --- | --- | --- |
| SAM 2.1 代码、demo、训练代码和 checkpoints | [官方 README](https://github.com/facebookresearch/sam2/blob/2b90b9f5ceec907a1c18123530e92e794ad901a4/README.md#license)明确统一为 Apache-2.0 | 可以 | 附 Apache-2.0；保留 copyright、attribution、上游 NOTICE（若有）；修改过的文件要作显著说明；不得暗示 Meta 背书。Apache 专利授权带终止条款 |
| SAM 2 中的 connected-components 派生代码 | [LICENSE_cctorch](https://github.com/facebookresearch/sam2/blob/2b90b9f5ceec907a1c18123530e92e794ad901a4/LICENSE_cctorch) 为 BSD-3-Clause | 可以 | 二进制分发材料中保留版权、许可和免责声明，不用贡献闭源代码 |
| BiRefNet 源码 | [官方 LICENSE](https://github.com/ZhengPeng7/BiRefNet/blob/25cb9309bacf3dde954e4584594e16e142c51de5/LICENSE) 为 MIT | 可以 | 在软件或材料中保留 MIT 版权和许可文本，不用公开闭源代码 |
| `ZhengPeng7/BiRefNet-matting` 权重和随权重发布的远程 Python 代码 | [固定 revision 模型卡](https://huggingface.co/ZhengPeng7/BiRefNet-matting/blob/eccde0a8cbdce7ac5fecfeb06340fe7b949e85d9/README.md)标 `license: mit` | **许可证表面上可以** | 应把模型卡快照、MIT 全文、revision 和文件哈希放进发行归档；但有下述 PPM-100 训练数据风险 |
| 自有 mask-band fusion | 本项目原创实现 | 可以 | 可闭源；保留设计与参数的可复现记录即可 |

Apache-2.0、MIT 和 BSD-3-Clause 都允许收费、修改、二进制再分发，也都允许与闭源产品组合；“允许闭源”不等于“没有 NOTICE 义务”。建议在应用内增加 `第三方软件与模型` 页面，并随每个 thin package 放一份完整 `THIRD_PARTY_NOTICES`。

### 2.2 BiRefNet-matting 的训练数据风险

[BiRefNet-matting 官方模型卡](https://huggingface.co/ZhengPeng7/BiRefNet-matting/blob/eccde0a8cbdce7ac5fecfeb06340fe7b949e85d9/README.md)明确把 `PPM-100` 列为 training set，而 [PPM 官方仓库的 License 段](https://github.com/ZHKKKe/PPM#license)写明：

- 原始 Flickr portrait 图像的许可允许商业使用和修改；
- **人工标注的 alpha mattes 为 CC BY-NC-SA 4.0。**

这形成了两层不同事实：

1. BiRefNet 权重发布者确实在模型卡上授予 MIT；
2. 权重训练数据至少含一个带 NonCommercial 条款的标注集，而上游没有提供该标注的额外商业授权、权重与数据之间的法律分析或 commercial-clean 声明。

不同法域对“训练后的权重是否是训练数据的衍生作品”并无一个可以在工程报告里代替法务判断的统一答案。因此不能把 PPM 的 NC 条款直接等同为“第四方案必然不可商用”，也不能忽略它并写成“完全无风险”。建议按以下顺序关闭风险：

1. 向 BiRefNet 作者索取书面确认：`BiRefNet-matting` 权重是否获得了所有训练集用于商业模型训练与商业部署的必要权利；保存回复和所对应的 revision。
2. 若无法确认，使用 MIT 的 BiRefNet 代码，在许可明确允许商业训练的 matting 数据、自有标注和授权素材上从商业清洁的 backbone 开始自训/微调，并对每个数据集与 backbone 权重单独建账。不能只删除 PPM-100 名字就假设其余集合都已清洁。
3. 或采购有合同、赔偿与商业授权条款的模型/数据服务。

在风险关闭前，第四方案适合内部 PoC、质量评估和不公开的素材实验；是否可以把现成 BiRefNet 权重用于收费产品，应由发行主体法务决定。

### 2.3 与真正的非商用候选区分

- [FudanCVL/SAM2Matting](https://github.com/FudanCVL/SAM2Matting#license)明确是 CC BY-NC-SA 4.0、仅非商用研究；它**没有参与第四方案**。
- [MatAnyone](https://github.com/pq-yang/MatAnyone/blob/main/LICENSE)使用 S-Lab License 1.0，免费范围限非商用，商业使用需另行联系；它**没有参与第四方案**。
- [VideoMaMa](https://github.com/cvlab-kaist/VideoMaMa#license)代码为 CC BY-NC 4.0，特定 checkpoint 另受 Stability AI Community License；它**没有参与第四方案**。

此前把“第四方案”和“Fudan SAM2Matting”混在一起，才会得到“第四个没法商用”的错误结论。

## 三、关键运行依赖许可证

以下只给出默认上游许可；最终发行要对**锁定后的 wheel、DLL、dylib 和其内嵌第三方库**再跑一次 SBOM/NOTICE 审计。不能仅凭顶层 PyPI metadata 覆盖 wheel 内的 OpenBLAS、image codec、CUDA runtime 等组件。

| 依赖 | 上游许可 | 能否用于闭源商业发行 | 发行注意 |
| --- | --- | --- | --- |
| [PyTorch](https://github.com/pytorch/pytorch/blob/main/LICENSE) | BSD-3-Clause 风格 | 可以 | 保留完整版权、许可、免责声明；同时携带该具体 wheel 的第三方 notices |
| [torchvision](https://github.com/pytorch/vision/blob/main/LICENSE) | BSD-3-Clause | 可以 | 同上；本方案 BiRefNet 代码实际导入 `torchvision.ops.deform_conv2d` |
| [Transformers](https://github.com/huggingface/transformers/blob/main/LICENSE) | Apache-2.0 | 可以 | Apache NOTICE/修改说明义务；固定版本与 revision |
| [timm](https://github.com/huggingface/pytorch-image-models/blob/main/LICENSE) | Apache-2.0 | 可以 | 这里只使用 BiRefNet 随权重保存的 backbone，不应在运行时再下载一个许可未知的 timm pretrained weight |
| [OpenCV](https://github.com/opencv/opencv/blob/4.x/LICENSE) | Apache-2.0（现代 4.x/5.x） | 可以 | `opencv-python` wheel 可能包含额外媒体/图像库，随实际 wheel 审计 |
| [NumPy](https://github.com/numpy/numpy/blob/main/LICENSE.txt) | 核心 BSD-3-Clause | 可以 | [官方 pyproject](https://github.com/numpy/numpy/blob/main/pyproject.toml)列有 0BSD/MIT/Zlib/CC0 等 vendored components，wheel 还可能含 OpenBLAS、libgfortran 等独立条款 |
| [Pillow](https://github.com/python-pillow/Pillow/blob/main/LICENSE) | HPND/PIL-style permissive | 可以 | 保留 Pillow/PIL 许可；具体 wheel 的 libjpeg/libpng/zlib 等 notices 一并打包 |
| [Kornia](https://github.com/kornia/kornia/blob/main/LICENSE) | Apache-2.0 | 可以 | 保留许可和 NOTICE；HF BiRefNet 远程代码实际导入它 |
| [einops](https://github.com/arogozhnikov/einops/blob/master/LICENSE) | MIT | 可以 | 保留 MIT 文本 |
| [libvpx](https://github.com/webmproject/libvpx/blob/main/LICENSE) + [PATENTS](https://github.com/webmproject/libvpx/blob/main/PATENTS) | BSD-style + 额外专利授权 | 可以 | 同时保留 LICENSE、AUTHORS、PATENTS；它负责 VP8 alpha 编解码 |
| [FFmpeg](https://ffmpeg.org/doxygen/trunk/md_LICENSE.html) | 默认 LGPL-2.1+；启用 `--enable-gpl` 后整体切为 GPL-2.0+，再启用 version3 则为 GPL-3.0+ | **取决于实际 build** | 见下一节 |

如果发行 Windows CUDA 加速包，还要对实际 PyTorch wheel 携带的 NVIDIA CUDA/cuDNN 运行库逐项核对 NVIDIA 再分发条款；CPU-only 包不涉及这组运行库，但速度会明显下降。

## 四、FFmpeg：当前最大的闭源分发陷阱

项目 macOS 适配器当前通过外部进程调用 FFmpeg：[`app/src-tauri/src/video_files/macos.rs`](../../app/src-tauri/src/video_files/macos.rs)。候选依次是 `CPA_FFMPEG`、PATH、`/opt/homebrew/bin/ffmpeg`、`/usr/local/bin/ffmpeg`。这意味着当前应用并没有真正自包含 FFmpeg，干净用户机上可能直接失败。

本机用于验证的 Homebrew build 是：

```text
ffmpeg 8.1.2
--enable-version3 --enable-gpl --enable-libvpx
--enable-libx264 --enable-libx265 ...
```

[FFmpeg 官方 LICENSE](https://ffmpeg.org/doxygen/trunk/md_LICENSE.html)明确说明 `--enable-gpl` 会让整个 FFmpeg build 从 LGPL 切换成 GPL；libx264、libx265 也属于需要 GPL 模式的外部库。这个 Homebrew binary 可以作为本地测试工具，但不能复制进闭源安装包并把它当成“已经解决许可”的产品依赖。

可发行路线按推荐顺序为：

1. **macOS 使用 AVFoundation/VideoToolbox 原生 API。**输入 WebM 的 VP8 alpha 仍需解码器；可直接集成 BSD 的 libvpx，随后用 `AVVideoCodecType.hevcWithAlpha` 写 MOV。这样可以完全移除 FFmpeg。
2. **自建最小 LGPL FFmpeg。**不传 `--enable-gpl`、不传 `--enable-nonfree`，只启用必须的 WebM/Matroska、libvpx、VideoToolbox 和 mov 支持；固定源码 commit、configure 行与二进制 hash。
3. 如果动态链接 FFmpeg 库，按 [FFmpeg 官方 LGPL checklist](https://ffmpeg.org/legal.html)保留许可证、对应源码、构建方法与修改 diff，并允许用户替换库。闭源静态链接不是绝对禁止，但 LGPL 要求提供可重链接的应用 object files，产品合规和维护成本更高，不建议。
4. 单独调用一个外部 `ffmpeg` 可降低与主程序形成单一衍生作品的风险，但若随安装包一起分发 GPL build，仍必须满足该 binary 的 GPL 源码等义务；不要把“子进程”当成无条件免责。

libvpx 本身是 permissive，`--enable-libvpx` 不会迫使 FFmpeg 进入 GPL 模式。当前需求也不需要 x264/x265。

## 五、AI 推理跨平台矩阵

### 5.1 Meta 官方支持边界

[SAM 2 官方安装说明](https://github.com/facebookresearch/sam2/blob/2b90b9f5ceec907a1c18123530e92e794ad901a4/README.md#installation)要求 Python 3.10+、PyTorch 2.5.1+、torchvision 0.20.1+，并指出：

- Windows 强烈建议 Ubuntu WSL；
- 默认安装会尝试编译自定义 CUDA kernel；编译失败仍能运行，但部分 post-processing 受限；
- 官方性能表是在 A100、PyTorch 2.5.1、CUDA 12.4 上测得，不能外推到 Mac/普通 Windows CPU。

[官方 demo 设备选择代码](https://github.com/facebookresearch/sam2/blob/2b90b9f5ceec907a1c18123530e92e794ad901a4/demo/backend/server/inference/predictor.py)确实提供 CUDA → MPS → CPU fallback，但原文同时警告 MPS support is preliminary、可能产生数值不同或降低性能，并默认把 MPS 视频帧卸载到 CPU 以避免可能导致整个进程崩溃的内存碎片。[官方 demo README](https://github.com/facebookresearch/sam2/blob/2b90b9f5ceec907a1c18123530e92e794ad901a4/demo/README.md)也说明 MPS/CPU FPS 会显著下降，macOS Docker 不能使用 MPS。

对该固定 SAM 2 官方源码树进行全文检查，没有官方 ONNX、CoreML 或 DirectML exporter/runtime；HF 上的 Transformers 版本仍是 PyTorch 路线。这里的结论是“**上游未提供或承诺这些部署后端**”，不是声称第三方永远无法转换。

BiRefNet 的 [官方 README ONNX 段](https://github.com/ZhengPeng7/BiRefNet/blob/25cb9309bacf3dde954e4584594e16e142c51de5/README.md#onnx-conversion)提供 PyTorch → ONNX 的 notebook/权重路线，但作者记录 ONNX 在 A100 上比原 PyTorch 慢约 75%–90%，并要求注意 ONNX Runtime GPU、CUDA、cuDNN 版本匹配。它不是 SAM 2 的导出方案，也不是经过官方验证的 CoreML/DirectML 产品路径。

### 5.2 目标平台判断

| 目标 | 推理可运行性 | 性能/可靠性 | 当前发布判断 |
| --- | --- | --- | --- |
| macOS ARM64 | PyTorch arm64 wheel、CPU 和 MPS 都有路径 | M4 Pro 实测：SAM2 MPS 输出噪声；CPU 正确但双向 220 帧约 14:41；BiRefNet MPS FP16 batch2 约 3:22 | **可做离线内部工具；不适合作为默认内置编辑器**。SAM2 必须默认 CPU，或换经验证的原生/远程 tracker |
| macOS x86_64 | 当前精确栈没有官方 PyTorch 2.5.1 x86_64 wheel；Intel Mac 无 MPS | 需要自行源码构建 PyTorch/SAM2/BiRefNet，且仅 CPU，预计比 M4 Pro CPU 更慢 | **阻塞**。不可在没有自维护运行时与实机性能数据时声称支持 |
| Windows x86_64 CPU | PyTorch 官方发布矩阵支持 Windows 10+ x86_64，SAM2 demo 有 CPU fallback | SAM2 官方安装仍建议 WSL；native Windows、custom extension 缺失情况下的正确性/性能未实测 | **技术上可能，产品上未验证** |
| Windows x86_64 + NVIDIA CUDA | PyTorch/CUDA 和 SAM2 的主路径最接近上游测试环境 | 需匹配 GPU driver、CUDA wheel；用户机器并非都有 NVIDIA；若 bundle CUDA 还需附加许可审计 | **最可能达到可接受速度，但必须真机矩阵测试** |
| Windows AMD/Intel GPU | SAM2 官方无 DirectML 路线 | CPU fallback 可用性待验证；不能假设 PyTorch 的其他 accelerator 会自动兼容 SAM2 | **不支持硬件加速承诺** |

PyTorch 官方在 [macOS x86 build deprecation 公告](https://dev-discuss.pytorch.org/t/pytorch-macos-x86-builds-deprecation-starting-january-2024/1690)明确说 2.3.0 起不再生产 x86_64 wheel/Conda binary；当前 [PyTorch release matrix](https://github.com/pytorch/pytorch/blob/main/RELEASE.md#operating-systems)只列 macOS ARM64 和 Windows x86_64。这不是普通的打包脚本问题，而是产品目标与上游二进制支持范围冲突。

本机可见的 Parallels Windows 11 实例为 ARM64/停止状态，并不是 CPA_V2 的 Windows x86_64 NSIS 目标，当前 Windows x86_64 验证环境因此无效。报告不把静态源码检查当作实机通过。

## 六、透明视频交付兼容性

### 6.1 VP8 Alpha WebM → Windows

[WebM Project alpha 规范](https://wiki.webmproject.org/alpha-channel)定义了 VP8 颜色数据放在正常 `Block`、alpha 平面另以 VP8 编码放入 `BlockAdditional` 的方式。[Chrome 官方](https://developer.chrome.com/blog/alpha-transparency-in-chrome-video)从 Chrome 31 起支持 `<video>` 播放带 alpha 的 VP8/VP9 WebM。

CPA_V2 的 Windows 适配器 [`windows.rs`](../../app/src-tauri/src/video_files/windows.rs)不转码，直接返回原 WebM；Tauri Windows 使用 WebView2。Microsoft 说明生产 WebView2 Runtime 与 Edge Stable 大体具有相同 web platform 能力和更新节奏，但其 [distribution 文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)没有单独给出“VP8 alpha”兼容承诺。因此“Chromium/Edge 内核长期支持”是强证据，但还不能替代项目自己的 WebView2 实机像素测试。

Windows 发布验收应至少包含：

- Windows 10 与 11 x86_64、Evergreen WebView2 当前版；必要时再测一个固定版 runtime；
- 用棋盘格/纯红/纯白背景播放本次 exact WebM，并从窗口截图检查透明像素，而不是只看 `canPlayType()`；
- 检查本地 `asset:` URL、循环首尾、窗口透明、GPU acceleration 开/关；
- 安装器检测/部署 WebView2 Runtime。Microsoft 明确提醒部分干净 Windows 10、Server、LTSC 机器可能缺少 runtime。

### 6.2 HEVC with Alpha → macOS

Apple 的 [AVFoundation sample](https://developer.apple.com/documentation/avfoundation/using-hevc-video-with-alpha)覆盖 alpha HEVC 的播放、写入和导出；[WWDC19 session 506](https://developer.apple.com/videos/play/wwdc2019/506/)说明播放在 macOS Catalina 及之后的所有设备可用，编码使用 `AVVideoCodecType.hevcWithAlpha`，且不理解 alpha 的 HEVC player 会忽略 alpha auxiliary layer 只显示 base layer。格式的权威边界见 [Apple interoperability profile](https://developer.apple.com/av-foundation/HEVC-Video-with-Alpha-Interoperability-Profile.pdf)。

因此 macOS 选择 HEVC Alpha MOV 比直接依赖 Safari/WKWebView 的 WebM alpha 更稳妥。两种 CPU 架构都在 Apple 的系统格式支持范围内，但仍需分别跑 thin build：

- ARM64：当前 M4 Pro 转码与播放链路已验证；
- x86_64：需在真实 Intel Mac 验证 VideoToolbox 软件/硬件编码 fallback、WKWebView 播放和签名后的包内路径。

### 6.3 当前样片证据

第四方案产物：

- WebM SHA-256：`04bfbf5ed8cc7a9a81073c085bc8fae832b8ebdf777fae2abf9d5f1ffccfa6f8`
- MOV SHA-256：`8b62112a4fb6927200f29edb4b947c01b5c361676690e63b107aaf916b327f4f`
- 共同规格：1008×720、30 fps、220 帧、约 7.333 秒；WebM 为 VP8、`ALPHA_MODE=1`
- MOV 是用项目 [`macos.rs`](../../app/src-tauri/src/video_files/macos.rs)同样的 `libvpx → format=bgra → hevc_videotoolbox → alpha_quality=1 → hvc1` 参数生成；此前逐帧解码核验表明 soft-alpha 范围与 WebM 一致。

这些证据只能证明 M4 Pro 上的 exact pipeline 和文件完整性，不能证明 Intel Mac 或 Windows x86_64 已通过。

## 七、两种产品形态要分开决策

### A. 只把第四方案作为内部素材生产工具

这是近期风险最低的落地：在一台经验证的 Mac ARM64 CPU 或 NVIDIA 工作站上离线生成 WebM/MOV，CPA_V2 安装包只携带已生成视频，不携带 Python、模型、CUDA 或 FFmpeg。这样：

- 用户平台只承担视频播放兼容性；
- 不需要解决 macOS x86_64 的 PyTorch 2.5.1 缺包；
- 安装包不会增加 324 MB SAM2 + 885 MB BiRefNet + PyTorch runtime；
- 仍需解决 BiRefNet 权重的商业来源风险，因为商用生产过程使用了该权重。

### B. 恢复用户可用的内置 AI 视频编辑器

必须先完成：

1. 决定 Intel Mac 是否继续支持本地 AI；若继续，维护自建 PyTorch x86_64 并接受 CPU 时延，或更换有原生跨平台推理后端的 tracker；不能用 Rosetta 解决“官方根本没有 2.5.1 x86 wheel”的问题。
2. Windows x86_64 原生 CPU 与 NVIDIA CUDA 两条路径实机跑相同 golden clip；WSL 只能是开发环境，不适合作为普通消费者依赖。
3. 对所有 wheel/DLL/dylib 生成锁文件、SBOM 和 notices；模型缓存必须固定 revision，禁止运行时拉取浮动代码。
4. 使用 LGPL-compatible FFmpeg 或原生媒体 API；不要捆绑当前 Homebrew GPL build。
5. 产品 UI 明示预计耗时、设备后端、降级策略、取消/恢复、磁盘空间和模型下载大小。

## 八、发布前必须通过的清单

- [ ] 获得 BiRefNet 作者对 `BiRefNet-matting` 商业使用及 PPM-100 训练数据的书面确认，或替换成商业清洁的自训权重。
- [ ] 固定 SAM2 源码、checkpoint、BiRefNet 模型 repo 的 revision 和 SHA-256；保存模型卡与许可证快照。
- [ ] 生成锁定 runtime 的 SBOM；随包发布 Apache/MIT/BSD/HPND/libvpx PATENTS 和所有 wheel 内嵌第三方 notices。
- [ ] macOS ARM64 golden test：强制 SAM2 CPU、BiRefNet MPS；把 MPS 噪声检测做成 fail-closed，不可静默输出坏 mask。
- [ ] 对 macOS x86_64 作明确产品决策；若宣称本地推理支持，必须有自建 PyTorch 2.5.1+ runtime、真机结果和耗时上限。
- [ ] Windows 10/11 x86_64 真机分别测试 CPU 和 NVIDIA CUDA；验证无 WSL、无 `nvcc` 的最终用户环境。
- [ ] Windows WebView2 对 exact VP8 Alpha WebM 做像素级透明测试，并在安装器处理 runtime 缺失。
- [ ] macOS ARM64/x86_64 thin 包分别验证 WebM → HEVC-alpha、缓存、循环播放、Gatekeeper/签名。
- [ ] 发行 FFmpeg 改成最小 LGPL build并归档源码/configure/hash，或实现 AVFoundation + libvpx 原生管线。
- [ ] 恢复输入内容校验：扩展名之外还要核查 codec、`ALPHA_MODE=1`、帧尺寸/时长上限，并对解码后的 alpha 做抽样。

## 最终建议

短期可以继续用第四方案做质量基准和内部素材生产，但不要马上恢复成面向所有用户的内置 AI 编辑器。商业上先向 BiRefNet 作者确认 PPM-100 问题；工程上优先补 Windows x86_64 和 Intel Mac 实机。若这两个前置条件关闭，第四方案的 SAM2 + 自有融合部分没有 NC 许可障碍，剩余主要是运行时打包、性能和 FFmpeg 合规工程，而不是 Fudan SAM2Matting 那种明确的非商用禁令。
