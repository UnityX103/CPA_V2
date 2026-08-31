# 小动物视频主体提取与透明交付：开源 AI 方案调研

Date: 2026-08-31

## 决策摘要

- **最值得做的可发布路线不是单一“去背景模型”，而是两阶段管线：**用 [SAM 2.1](https://github.com/facebookresearch/sam2) 或 [Cutie](https://github.com/hkchengrex/Cutie) 保持猫狗主体身份和视频时序，再用 [BiRefNet 的 general-matting / HR-matting 权重](https://github.com/ZhengPeng7/BiRefNet)恢复毛发软边。BiRefNet 的官方模型表明确包含 `AM-2k` 动物抠图数据；三者代码许可证分别为 Apache-2.0、MIT、MIT，是本轮候选里兼顾动物、成熟度和产品许可风险最低的组合。
- **质量上限对照应选 [SAM2Matting](https://github.com/FudanCVL/SAM2Matting)。**它是 2026 年直接面向开放世界图像/视频 alpha matting 的模型，官方明确列出 humans、animals、anime、translucent objects、rapid motion，且把 VOS 跟踪与低层 matting 解耦，正好对应“猫狗移动视频 + 毛发 + 时序一致性”。但其仓库 `LICENSE` 是 `CC BY-NC 4.0`、README 又写成 `CC BY-NC-SA 4.0`，两者都只允许非商用研究；训练代码尚未发布，不能直接成为 CPA_V2 的可发布依赖。发行前还应要求上游澄清这处许可文本不一致。
- **动物专用基线选 [GFM / AM-2K](https://github.com/JizhiziLi/GFM)。**它是目前核实到最明确的动物 alpha 模型：AM-2K 含 20 类、2,000 张高分辨率动物图和人工 alpha，代码/数据协议标为 MIT。缺点是模型停留在 PyTorch 1.4/CUDA 10.1 时代、逐帧推理、无视频记忆；适合作为“动物毛发能力”对照，不适合作为完整视频方案。
- **不要再把二值分割当成毛发抠图。**SAM 2、Cutie、XMem、Track-Anything、DIS、RMBG-2.0 的核心输出是对象/显著物分割 mask 或软分数。即使文件是 8-bit 灰度，也不代表网络学习了真实前景透明度；直接拿这类结果做 alpha，最常见后果就是毛发被削平、边缘白边/黑边和帧间闪烁。
- **RVM、MODNet、BackgroundMattingV2、MatAnyone/MatAnyone 2 都不是动物优先解。**前几者是人像模型；BackgroundMattingV2 还要求预拍空背景；MatAnyone 系列官方同样明确写的是 human video matting，且为非商用 S-Lab License。它们可作为速度或时序设计参考，但不应因“能输出 alpha”就当作猫狗主模型。
- **Git 历史里的旧方案差，不只是模型小。**旧实现固定 `BackgroundRemover@fa480627 + u2netp`，把输入缩到高 320px 后逐帧推理，没有目标提示、视频记忆，也没有启用 BackgroundRemover 的 `alpha_matting`。这同时损失动物语义、毛发空间细节和帧间稳定性；换编码器或给 mask 做模糊都不能补回这些信息。
- **当前 CPA_V2 的直接输入合同仍是透明 `.webm`。**Windows 原样播放 WebM；macOS 现有 Rust 代码用 FFmpeg/libvpx 解码，再转成带 alpha 的 HEVC `.mov` 缓存。建议生成工具保留无损 `RGBA PNG + alpha` 帧序列为母版，交付透明 WebM；内置素材同时预生成 macOS HEVC-alpha MOV，避免用户机器缺少 FFmpeg。透明图集当前没有直接消费路径，只应作为未来宠物渲染器的可选派生物。

## 结论边界：segmentation mask 不等于 alpha matte

对本需求，先把三类输出分开，否则很容易再次得到“主体大致切出来，但毛发很差”的结果。

| 输出 | 像素含义 | 擅长 | 不擅长 |
| --- | --- | --- | --- |
| **Binary/object segmentation** | 每个像素属于/不属于对象，或类别概率 | 主体身份、遮挡恢复、长视频跟踪、交互修正 | 毛发、运动模糊、半透明边缘、前景颜色去污染 |
| **Soft saliency/DIS score** | 模型对显著前景的置信度，常保存成 0–255 灰度 | 自动选一个主要对象、粗背景移除 | 灰度值未必是物理透明度；阈值和背景变化会造成边缘闪烁 |
| **Alpha matting** | 合成方程中的前景不透明度 `alpha ∈ [0,1]`，通常还应估计前景 RGB | 毛发、细须、软边、运动模糊、透明/半透明区域 | 单独做逐帧 matting 时可能身份漂移或闪烁；往往需要 trimap/mask/背景参考 |

因此建议的数据流是：**分割负责“这只动物是谁、这一帧在哪里”，matting 负责“边界应该有多透明”。**

## 当前软件的真实交付合同

代码核对结果：

- [`app/src/domain/videoFiles.ts`](../../app/src/domain/videoFiles.ts) 的文件选择器只接受 `.webm`。
- [`app/src-tauri/src/video_files/windows.rs`](../../app/src-tauri/src/video_files/windows.rs) 在 Windows 直接返回原 WebM。
- [`app/src-tauri/src/video_files/macos.rs`](../../app/src-tauri/src/video_files/macos.rs) 在 macOS 显式用 `libvpx` 解码 WebM，再用 `hevc_videotoolbox`、`hvc1` 和 `alpha_quality=1` 写入 `.mov` 缓存；FFmpeg 候选来自 `CPA_FFMPEG`、PATH、Homebrew 和 `/usr/local/bin`。
- [`app/src/domain/pomodoroVideos.ts`](../../app/src/domain/pomodoroVideos.ts) 的内置视频按平台选择 `/videos/ms1.webm` 或 `/videos/ms1-alpha.mov`。

这意味着本次生成流程的“当前软件可用形式”应定义为：

1. 必交：**透明 WebM**，保持原帧率和固定画布；CPA_V2 当前可选择该文件。
2. 生成母版：**RGBA PNG 帧序列**，另存独立 8-bit/16-bit alpha（至少保留 RGBA PNG）。它不是当前 UI 的直接输入，而是避免多次有损编码、方便重做 WebM/MOV/图集的可信源。
3. 内置资源或发行流水线：额外生成 **HEVC with Alpha MOV** 供 macOS；Apple 官方说明该格式自 macOS Catalina/iOS 13 起可在 AVFoundation 和 Safari 中合成播放，并使用单视频轨的 base layer + alpha auxiliary layer。[Apple WWDC19](https://developer.apple.com/videos/play/wwdc2019/506/) · [Apple sample code](https://developer.apple.com/documentation/AVFoundation/using-hevc-video-with-alpha) · [interoperability profile](https://developer.apple.com/av-foundation/HEVC-Video-with-Alpha-Interoperability-Profile.pdf)
4. 可选归档/交换：**ProRes 4444 MOV**。Apple 官方说明它支持全分辨率 4:4:4:4 RGBA 和最高 16-bit、数学无损 alpha，但 1080p29.97 的目标码率约 330 Mbps，适合中间母版，不适合桌宠运行时分发。[Apple ProRes](https://support.apple.com/en-mt/102207)
5. 可选未来格式：**RGBA PNG atlas + manifest**。当前播放器不读取 atlas；只有未来实现帧动画宠物渲染器后才值得生成。图集必须固定帧尺寸/anchor，manifest 保存 FPS、帧数、矩形、pivot、循环段和 alpha 模式。

WebM 项目官方定义了在 WebM 中以附加块携带 alpha 的方案；FFmpeg 的官方问题记录也可见 `libvpx-vp9`/`yuva420p`/`alpha_mode=1` 的 VP9-alpha 实例。浏览器/解码器支持并不一致，尤其 Safari 不保留 WebM alpha，因此 CPA_V2 现有的 macOS 转码分支是合理的兼容层。[WebM alpha channel](https://wiki.webmproject.org/alpha-channel) · [FFmpeg VP9 alpha issue](https://ffmpeg.org/pipermail/ffmpeg-trac/2024-September/070729.html) · [MDN codec compatibility](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Video_codecs)

## Git 历史里的旧实现：已核实的结构性问题

### 提交时间线

| 提交 | 日期 | 变化 |
| --- | --- | --- |
| `e3d0cf5` | 2026-07-12 | 首次加入 `BackgroundRemover` 视频编辑器、Rust 处理管线和前端裁剪/阈值/擦除 UI，约 3,058 行新增。 |
| `59e22e5` | 2026-07-13 | 加入 macOS Intel/ARM thin 自包含运行时：FFmpeg、FFprobe、冻结的 Python/PyTorch BackgroundRemover、U2NetP、模型与许可包。 |
| `55dd509` | 2026-07-13 | 把“AI 生成临时透明视频”和“导出最终文件”拆成两个步骤，避免重复跑抠图。 |
| `b45b6a2` | 2026-07-13 | 加入受管生成缓存清理和 macOS 兼容预览缓存隔离。 |
| `0bf3217` | 2026-08-13 | 删除视频编辑 UI、runtime prepare/build 脚本、锁文件、文档和大部分测试，共约 9,346 行删除。 |
| `66ce6cf` | 2026-08-14 | 删除剩余 `video_editor` Rust 模块、冻结 worker、runtime policy 与 `video_files`，完成整套模块移除。 |
| `ccdd398` | 2026-08-21 | 只恢复番茄钟结束视频播放器、自定义 `.webm` 选择和跨平台播放适配；没有恢复 AI 视频编辑器。 |

这些提交都没有正文解释删除原因。因此 Git 历史只能证明“实现是什么、何时被移除”，不能证明是因为质量差而删除；“原方案去背景效果太差”来自本次用户反馈。不过从代码结构可以直接解释为什么它在猫狗视频上容易失败。

旧代码的事实链如下：

- 依赖固定在 `BackgroundRemover` commit `fa480627`，模型选最小的 `u2netp`（约 4.7 MB）。
- 上游 `iter_frames` 在模型推理前把帧缩到**高度 320px**，批量处理仍是逐帧独立推理。
- 命令只使用 `-mk`，没有启用 BackgroundRemover 已提供的 `alpha_matting` 路径。
- 没有首帧点/框/mask、对象 ID、视频 memory、遮挡恢复或跨帧纠错。
- 输出已经是 **VP8 / `yuva420p` / `alpha_mode=1` 的透明 WebM**；当前 macOS 再转 HEVC-alpha MOV，Windows 原样播放。
- 当前恢复版 `validate_webm_path` 只检查绝对路径、扩展名、存在性和可读性，不再验证 VP8/alpha 元数据。新生成流程应恢复旧版 `ffprobe` 内容校验，否则一个普通不透明 `.webm` 也会被 UI 接受。

| 维度 | 旧方案 | 推荐方案 | 为什么能改善 |
| --- | --- | --- | --- |
| 主体选择 | U2NetP 每帧自动显著物，无法指定“这只猫/狗” | BiRefNet animal-aware seed；歧义时一个点/框；SAM2/Cutie 固定 object ID | 人宠同框、多动物和遮挡时不再每帧重新猜目标 |
| 空间细节 | 高度 320px 推理；胡须/耳毛可能已低于 1 像素 | 720p/1080p 固定画布，必要时对 union ROI 全分辨率 matting | 先保留信息，再谈边缘恢复 |
| 时序 | 无 memory，逐帧结果天然闪烁 | SAM2/Cutie 前后向传播 + keyframe/reseed | 主体形状、身份和遮挡恢复跨帧一致 |
| alpha | 默认 mask；`alpha_matting` 未启用 | BiRefNet-matting 或 ViTMatte 在 temporally stable unknown band 内预测 soft alpha | 网络真正学习毛发透明度，而非只把 mask 模糊 |
| 编码 | VP8 alpha WebM | 仍以透明 WebM 交付，保留 RGBA PNG 母版；内置素材预制 HEVC-alpha | 保持现有软件合同，避免把模型升级和播放器改造绑在一起 |

即便给旧命令打开 `alpha_matting`，最多也只是用单帧 mask 做传统边缘求解；320px 已丢失的毛发、U2NetP 选错的对象和跨帧抖动不会被恢复。因此它可以加入 PoC 作为“旧模型 + alpha_matting on”的低成本对照，但不是最终架构。

## 候选矩阵一：视频对象分割/跟踪（只解决主体身份，不直接解决毛发 alpha）

| 候选 | 动物适配 | 首帧/提示要求 | 时序一致性 | 毛发/alpha | GPU、CPU与部署 | 许可证 | 活跃度与成熟度（截至 2026-08-31） | 判断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [SAM 2.1](https://github.com/facebookresearch/sam2) | **强：开放世界、SA-V 多域；不是动物专训** | 视频官方 API 需要点、框或 mask；“automatic mask generator”只在**图像** API 提供，视频并非无提示自动选目标 | 流式 memory，支持多对象、后续追加/修正提示；官方 A100 编译基准 39.5–91.2 FPS，取决于 38.9M–224.4M 模型 | **对象 mask，不是自然 alpha**；毛发会被语义边界压平 | Python ≥3.10、PyTorch ≥2.5.1；官方以 CUDA GPU 为主，Windows 建议 WSL；自定义 CUDA 后处理编译失败仍可运行但功能受限 | Apache-2.0（代码、检查点、训练与 demo；demo 字体另有 OFL） | 约 19.8k stars，代码最后 push 2026-05-30；训练、HF、Web demo 完整，成熟度最高 | **首选 VOS 主干**；必须再接 matting |
| [Cutie](https://github.com/hkchengrex/Cutie) | **强：类别无关 VOS**；没有动物 alpha 训练 | 脚本首帧需要对象 mask；GUI 可点击生成/修正，并可加入 permanent memory | XMem 后继，官方定位为更一致、稳健、快速；视频记忆强 | 输出 probability/object mask，最终示例显式转 `uint8` mask；**不是 alpha** | PyTorch/CUDA；官方“tested on Ubuntu only”，未提供官方 CPU/ONNX 产品路径 | MIT；GUI 中再分发的 RITM 代码遵循 RITM 自身许可 | 约 1.1k stars，最后 push 2024-11-08；CVPR 2024 Highlight、代码/权重/GUI 完整 | **许可友好的 VOS 备选**，适合长片/人工修正 |
| [XMem](https://github.com/hkchengrex/XMem) | **强：类别无关**；官方 demo 甚至使用 raccoon | 必须给首帧或任意关键帧 mask/点击/涂鸦；作者明确说明模型不知道要跟哪个对象，自动化需外部显著物/检测器初始化 | 三级记忆，面向超长视频；官方称可轻松处理 10,000+ 帧，约 20 FPS（依硬件） | mask/概率，不是物理 alpha | PyTorch/CUDA GUI，低 CPU/GPU memory；无官方 ONNX/CoreML 路线 | MIT | 约 2.0k stars，最后 push 2024-11-15；ECCV 2022，成熟但已被 Cutie 取代 | 长视频稳定基线；新实现优先 Cutie/SAM 2 |
| [Track-Anything](https://github.com/gaomingqi/Track-Anything) | **强：SAM 可选任意物体** | 用户点击；SAM 生成起始 mask，XMem 传播，途中可改目标/修正 | 继承 XMem，支持镜头切换时修正 | 只生成分割/跟踪 mask；E2FGVI 是补洞，不是 alpha matting | Gradio/PyTorch，官方 Linux/Windows、`cuda:0`；可选 SAM ViT-B 降显存 | 主仓 MIT，但完整应用还需核对 SAM/XMem/E2FGVI 依赖与权重 | 约 7.0k stars、235 commits，最后 push 2025-12-13；UI 成熟 | **成熟交互参考实现**，不是更好的去背景模型 |

### 这一组的关键结论

SAM 2、Cutie、XMem 的比较主要影响“跑多长、遇到遮挡会不会换对象、是否易于人工修正”，不会自行把二值轮廓变成自然猫毛。若旧实现主要依赖 SAM/XMem mask 直接写 alpha，效果差是结构性问题，而不是简单换更大的分割 checkpoint 就能解决。

## 候选矩阵二：真正的视频 alpha matting

| 候选 | 动物适配 | 首帧/辅助输入 | 时序能力 | 毛发/软 alpha | GPU、CPU与部署 | 许可证 | 活跃度与成熟度 | 判断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [SAM2Matting](https://github.com/FudanCVL/SAM2Matting) | **最强匹配：官方明确 animals、fur、open-world** | 视频脚本给首帧 mask；交互支持 mask/点/框，SAM3 版支持 text | 将 VOS tracker 与专用低层 matting 解耦；论文/官方仓库强调强时序和视频 SOTA | **真正 soft alpha**，官方 demo 明确 hair、fur、translucent edges | Python/Conda，官方脚本使用 CUDA/bfloat16；HF 全部检查点约 4.11 GB；无官方 CPU 产品路径 | **仓库 LICENSE 为 CC BY-NC 4.0，README 写 CC BY-NC-SA 4.0；均非商用且文本不一致** | 2026-06 发布，约 121 stars、11 commits、最后 push 2026-06-30；检查点/推理/demo 已有，训练代码未发布 | **PoC 质量上限第一名；不可直接商用集成** |
| [MatAnyone 2](https://github.com/pq-yang/MatAnyone2) | **弱：官方写 human video matting** | 必须首帧 segmentation mask；本地 Gradio 可点选，内部借助 SAM/SAM2 | memory propagation，强调真实场景与稳定细节 | 真正 alpha，避免 segmentation-like boundary | Python 3.10、PyTorch/HF/CLI，官方示例 `cuda:0`；第三方 CoreML port 仅作为社区信息 | **NTU S-Lab License 1.0：非商用，商用需联系授权** | CVPR 2026 Highlight，约 825 stars、最后 push 2026-07-28；推理/评测有，视频训练、质量评估器训练和 VMReal 仍在 TODO | 人像强、动物未证实；只做对照 |
| [MatAnyone](https://github.com/pq-yang/MatAnyone) | **弱：官方写 human video matting** | 首帧 mask；Gradio 点选；支持用不同 mask 提取不同人物 | consistent memory propagation；可处理长 1080p、人像多目标按 mask 分开 | 真正 alpha 和 foreground video | Python 3.8、PyTorch/HF、FFmpeg；官方未给 CPU/ONNX 路线 | **S-Lab License 1.0，非商用** | CVPR 2025，约 1.6k stars、42 commits，最后 push 2026-03-04；训练代码已于 2026-03 发布 | 成熟人像视频基线，不应假设会泛化猫狗 |
| [VideoMaMa](https://github.com/cvlab-kaist/VideoMaMa) | **强：多域、真实视频的 mask-to-matte，非人像专用** | 需要**每帧粗 mask 序列**，不是只给首帧；通常先用 SAM2/Cutie 生成 | 视频生成先验，16 帧窗口为默认；论文强调跨帧 matting | 真正 alpha，目标就是 coarse mask → pixel-accurate matte | 基于 Stable Video Diffusion，HF 模型约 2B 参数/13.5 GB；CUDA 扩散推理，明显重于桌面本地常驻方案 | 代码 CC BY-NC 4.0；VideoMaMa 权重另受 Stability AI Community License | CVPR 2026，约 511 stars、12 commits，最后 push 2026-04-01；推理/训练已发布，评测和 MA-V 数据仍 TODO | **离线高质量研究对照**，过重且许可复杂 |
| [RVM](https://github.com/PeterL1n/RobustVideoMatting) | **差：官方明确 human video matting，训练只保留 humans** | 无 trimap/背景/首帧提示，仅 RGB 视频 | recurrent state，真实视频时序成熟 | 人像 hair alpha 很强；动物通常会漏主体或误判 | PyTorch/TorchScript/ONNX/TF/TF.js/CoreML；ONNX 官方测试 CPU/CUDA；GTX1080Ti 官方 HD 104 FPS | **GPL-3.0** | 约 9.5k stars，最后 push 2024-04-02；接口和部署最成熟之一 | 速度/部署参考；猫狗主线不选，分发集成需 GPL 审核 |
| [BackgroundMattingV2](https://github.com/PeterL1n/BackgroundMattingV2) | **弱：训练/示例以人物和 strand-level hair 为主，无动物证据** | 需要额外拍摄一张无主体、视角对齐的背景图 | 没有显式视频 memory；固定背景参考带来稳定约束 | 真正高分辨率 alpha，毛发细节强 | PyTorch/TorchScript/TF/ONNX；RTX2080Ti 官方 4K30/HD60 仅为网络吞吐，视频 I/O 还需产品工程 | MIT | CVPR 2021，约 7.2k stars，最后 push 2024-06-19，稳定但方法条件严格 | 若能固定机位拍空背景可做特殊基线；不适合普通手机宠物视频 |

## 候选矩阵三：动物/通用单帧自动抠图与边缘精修

| 候选 | 动物适配与提示 | 时序 | alpha 真实性 | GPU、CPU与部署 | 许可证 | 活跃度/成熟度 | 判断 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | **强。**无需提示；`general use 2048` 与 `general matting` 官方训练集均包含 `AM-2k`，并另有 HR-matting/动态分辨率权重 | 单帧；官方有视频 notebook 但本质逐帧，需外部 VOS/稳定器 | **必须选 `matting` 权重。**原始 DIS/general 权重更偏二值；官方也明确 RMBG-2.0 权重“不感知透明度” | PyTorch/HF/ONNX；1024² FP16 官方约 17 FPS、3.45 GB（RTX4090），ONNX 已发布但比 PyTorch 慢；无可靠 CPU 视频实时基准 | MIT | 约 4.1k stars，最后 push 2026-07-24；权重、HF、ONNX、训练/微调说明完整，仍活跃 | **许可友好、动物优先的 alpha 主模型** |
| [GFM + AM-2K](https://github.com/JizhiziLi/GFM) | **最明确的动物专用。**无 trimap；AM-2K 含 20 类/2,000 张高分辨率动物和人工 alpha | 单帧；官方仅展示逐帧跑动物视频，没有视频 memory | 真正端到端 alpha，专门解决自然动物毛发 | 老 PyTorch 1.4/CUDA10.1/Ubuntu18.04；代码、训练、权重、Colab 均有，无现代 ONNX 产品路线 | MIT；AM-2K/BG-20K 页面也链接 MIT 数据协议 | IJCV 2022、约 941 stars，最后 push 2023-04-13；研究完整但技术栈老 | **动物质量基线/训练数据来源；不单独承担时序** |
| [ViTMatte](https://github.com/hustvl/ViTMatte) | 通用自然图像；需要每帧 trimap，动物可由 SAM2/Cutie mask 自动生成 trimap | 单帧，无官方时序模块 | **真正 alpha**；专门补细节，Composition-1K/Distinctions-646 上验证 | PyTorch/Detectron2；已进 Hugging Face Transformers，官方小模型约 103 MB；CPU 可运行但视频通常应 GPU | 代码 MIT；HF checkpoint 页面标 Apache-2.0，发行前仍应固定具体 revision 并复核权重/训练数据条款 | 约 553 stars，最后 push 2025-08-13；论文、权重、HF 集成成熟 | **很适合作为 VOS mask → trimap → alpha 的可替换精修器** |
| [Matte Anything / MatAny](https://github.com/hustvl/Matte-Anything) | 点或文本选目标；SAM → 膨胀/腐蚀伪 trimap → ViTMatte，并可用 GroundingDINO 标记透明物 | 单帧 | 真正 alpha；官方强调 transparent objects 和 RGBA | 多模型 PyTorch/Gradio，较重；无视频原生 memory | MIT 主仓；组合发布须逐项审核 SAM、GroundingDINO、ViTMatte 权重 | 约 592 stars，最后 push 2024-06-06；代码更像研究 demo | **推荐架构的现成单帧参考，不是完整视频方案** |
| [MAM / SHI-Labs Matting-Anything](https://github.com/SHI-Labs/Matting-Anything) | 点/框/文本；SAM 特征 + 2.7M 参数 M2M 迭代精修，覆盖 semantic/instance/referring matting | 单帧 | 真正 alpha，官方展示比 SAM 改善 transition area 和孔洞 | PyTorch/SAM，较重；无官方 CPU/ONNX | MIT | 约 717 stars，最后 push 2023-11-18；代码/检查点有，更新较慢 | ViTMatte 的另一单帧对照；没有动物专项或时序优势 |
| [ZIM](https://github.com/naver-ai/ZIM) | 开放世界，支持点/框；也提供 image automatic mask generator，不必提示即可枚举整张图的 matte 候选 | 单帧 | 目标是真正 micro-level matte，强于 SAM 细边；但透明/非显著物仍有公开 failure issue | `pip install zim_anything`，ONNX Runtime；CPU 可用、GPU 用 onnxruntime-gpu | **CC BY-NC 4.0** | ICCV 2025 Highlight，约 421 stars，最后 push 2025-08-28；训练代码/SA1B-Matte 尚未发布 | 很好的研究/自动首帧对照；非商用，不能作为发行依赖 |
| [RMBG-2.0](https://huggingface.co/briaai/RMBG-2.0) | 无提示，通用背景移除；官方训练分布 `animals only` 仅 **1.89%**，另有“people with objects/animals” | 单帧 | 输出 8-bit 灰度，但官方类型是 dichotomous segmentation；BiRefNet 作者明确指出该权重不感知透明度，**不能等同真实 alpha** | PyTorch/HF、ONNX、Transformers.js；易部署 | **CC BY-NC 4.0，商用需 BRIA 协议** | 模型成熟、生态广；GitHub 最后 push 2025-12-11 | 可测自动首帧/粗 mask，不应当毛发精修器，也不是开放许可 |
| [DIS / IS-Net](https://github.com/xuebinqin/DIS) | 无提示；官方明确 DIS V1 训练中 animal/human/car 很少，学术权重可能表现差；另有 general-use 权重 | 单帧 | 高精度二值/显著物图，不是物理 alpha | 老 PyTorch/Conda；无原生视频或现代跨平台部署 | Apache-2.0；数据集有独立条款 | ECCV 2022、约 2.6k stars，最后 push 2024-09-23；V2 仍未发布 | 不符合“动物 + 毛发 + 视频”核心需求 |
| [MODNet](https://github.com/ZHKKKe/MODNet) | 无 trimap，但**只做人像 portrait** | 官方提供视频 demo 和无标注视频 SOC adaptation，但网络仍逐帧/人像语义 | 人像 soft alpha，非动物模型 | PyTorch；社区 ONNX/TorchScript/TensorRT/Docker；官方宣称 7M 移动模型未公开 | Apache-2.0（仓库代码、模型、demo，GIF 除外） | AAAI 2022、约 4.4k stars，最后 push 2024-05-06；成熟但领域错配 | 旧人像方案常见来源；猫狗直接排除 |

## 为什么“更偏小动物”的答案不是单一仓库

已核实的公开候选里，三类能力没有在一个许可友好且成熟的模型中同时满足：

- **动物语义/毛发训练：**GFM、BiRefNet-matting 明确用了 AM-2K，但都是单帧。
- **强时序和遮挡：**SAM 2、Cutie、XMem 很强，但只输出对象 mask。
- **开放世界视频 soft alpha：**SAM2Matting 最贴题，但很新且非商用；VideoMaMa 很重且同样非商用/社区许可；MatAnyone 系列是人像且非商用。

因此产品方案应组合两个成熟模块，而不是寻找一个看起来“端到端”的旧人像去背景网络。

### 值得跟踪但不能列为成熟实现：Matting Anything 2

[ICLR 2026 的 Matting Anything 2（MAM2）](https://openreview.net/forum?id=6K08FPo2cf)在论文层面非常贴题：以 SAM2 为基础，接受点/框/mask，联合预测 mask 与 trimap，并用分离的时序记忆处理通用自然对象和透明目标。但截至本报告日期，[官方 GitHub](https://github.com/ChenyiZhang007/Matting-Anything-2)只有 README、2 个 commits，并明确写着 “Code (including training code) will be released soon.”，没有推理代码、checkpoint 或许可可审计。它是后续 watchlist，不是当前可做 PoC 的“成熟开源实现”。

## 推荐架构

### A. 可发布的主线：SAM 2.1/Cutie + BiRefNet-matting

1. **解码与预处理**
   - 保持原始 FPS/time base；转成 RGB 帧，音频对桌宠素材通常丢弃或另存。
   - 不逐帧裁框。先在固定原始画布中完成整段 alpha，再按整段 union bbox 加固定 padding 裁一次，避免主体在桌面播放时抖动。
   - 对过长视频先做镜头切分；桌宠素材优先 2–10 秒单镜头循环。

2. **自动初始化**
   - 默认在清晰且主体面积合适的帧跑 **BiRefNet-HR-matting / general-matting**，从 alpha 生成保守 seed：高阈值为“确定前景”、低阈值外为“确定背景”。
   - 如果一帧有多只动物、人物/家具比动物更显著、主体贴边或严重遮挡，自动选择在语义上无唯一答案。UI 必须允许用户补一个点/框；不要承诺 100% 无交互。
   - 对猫狗已知类别的批处理，可在首帧增加检测/文本定位，但不要把检测框直接当 alpha。

3. **时序主体跟踪**
   - 默认用 **SAM 2.1 Base+** 从 seed frame 向前和向后传播；需要较低显存或更成熟的人工修正 UI 时比较 **Cutie**。
   - 保存每帧概率/mask、置信度、对象 ID；检测画面切换、mask 面积突变、对象消失后暂停并请求重新 seed，而不是继续污染 memory。

4. **动物 alpha 恢复**
   - 每帧运行 **BiRefNet-matting** 得到动物友好的 `alpha_raw`。
   - 从时序 VOS mask 生成 `eroded_core` 与 `dilated_outer`：核心强制接近 1，外部强制 0，只在二者之间的 unknown band 采用 `alpha_raw`。这让 VOS 负责身份和大形状，BiRefNet 只负责毛发/软边，避免二值 mask 截掉细毛。
   - 备选 A/B：用 VOS mask 的同一 temporally stable trimap 驱动 **ViTMatte**。它对 trimap-guided 细边有成熟实现，但动物训练证据弱于 BiRefNet-matting，因此作为对照而非默认。

5. **有限时序稳定**
   - 只在 unknown band 内做光流/运动置信度引导的前后帧融合或三帧中值；实体核心不平滑，快速运动/高梯度毛发降低融合权重。
   - 禁止对整张 alpha 做简单 EMA：会留下拖影、把快速摆动的尾巴和胡须变透明。

6. **质量检查和导出**
   - 在黑、白、棋盘格和高饱和背景上预览；只看透明棋盘会漏掉白边/黑边。
   - 母版输出 RGBA PNG sequence + manifest；再编码透明 WebM。对内置素材另编码 HEVC-alpha MOV。
   - manifest 至少记录：源 SHA-256、模型/权重 revision、seed frame/prompt、FPS、帧数、画布、crop rect、alpha 是 straight 还是 premultiplied、编码命令和工具版本。

### B. 研究质量上限：SAM2Matting

- 用相同输入和 seed，直接跑 `SAM2Matting-SAM2.1-B+`，记录 alpha 质量、时序、速度和显存。
- 它不应进入发行包；PoC 仅用于回答“许可友好组合距离当前最佳开放研究实现还有多远”。
- 如果它显著胜出，再联系作者获取商业许可或用其论文架构思路自研/训练可授权模型；不要绕过非商用条款复制权重。

### C. 动物专项对照：GFM

- 在同一组关键帧跑 GFM AM-2K 权重，专门比较长毛猫、狗耳朵、尾巴、胡须边界。
- 若 GFM 毛发优于 BiRefNet 但整体语义弱，可将 AM-2K 数据用于合规的 BiRefNet 微调实验；固定数据协议和下载快照，避免仅凭主仓 MIT 就忽略训练数据来源。

## 建议 PoC

### 数据集

先用 12–20 段自有或有明确授权的 3–10 秒视频，不必追求大规模，但必须覆盖真实失败面：

- 长毛猫、短毛猫、长毛狗、短毛狗；浅色毛/浅色背景、深色毛/深色背景；
- 快速甩尾/奔跑、动作模糊、胡须和耳毛；
- 主体被家具遮挡后重现、短暂离开画面、贴画面边缘；
- 相机移动、压缩噪声、低照度；
- 单只动物、两只动物、动物与人同框；
- 地面阴影、反光地板、栅栏/草丛等细碎背景。

### 对照组

1. 当前/历史旧实现（由 Git 历史还原其具体模型和参数）。
2. SAM 2.1 mask 直接作为 alpha：故意保留，证明 segmentation 上限。
3. BiRefNet-matting 逐帧：测动物毛发，但暴露闪烁。
4. SAM 2.1 Base+ + BiRefNet-matting band fusion：**推荐主线**。
5. Cutie + BiRefNet-matting band fusion：测长视频和交互修正价值。
6. SAM 2.1 trimap + ViTMatte：精修对照。
7. GFM：动物单帧对照。
8. SAM2Matting Base+：研究质量上限。

不要把 RVM/MODNet 当主要对照；最多选 1 个证明“人像模型在动物上的域错配”。RMBG/DIS 只放在粗 mask/自动 seed 组，不和 alpha 模型混为同一排名。

### 指标与验收

- **Alpha 关键帧质量：**每段人工精修 5–10 帧真值，计算 SAD、MSE、Gradient、Connectivity；单纯 IoU 无法衡量毛发。
- **时序：**静止背景区域 alpha 方差、光流 warp error、mask 面积突变、遮挡后 identity recovery；同时人工看循环接缝和“呼吸边缘”。
- **合成视觉：**黑/白/红/蓝/棋盘背景上看 halo、毛发丢失、前景颜色污染、半透明拖影。
- **性能：**720p/1080p 每帧时延、整段处理时间、峰值 VRAM/RAM、模型下载大小和输出大小；分别记录 NVIDIA CUDA、Apple Silicon（如果能跑）和 CPU fallback，而不是把 A100/4090 数据直接当用户设备性能。
- **软件验收：**Windows x86_64 WebM 播放、macOS x86_64/ARM64 的 HEVC-alpha 转换与播放、循环首尾、透明窗口叠加、无 FFmpeg 时的错误提示。

建议第一轮通过门槛：推荐主线在 80% 以上样本中不需逐帧修正；一处人工 seed 后能处理完整单镜头；相对旧实现显著降低毛发硬边和稳定区闪烁；两平台播放通过。若未达到，优先分析 seed/VOS/alpha 哪一层失败，不要继续堆形态学模糊。

## 风险

1. **许可不是“仓库公开”就等于可商用。**SAM2Matting、MatAnyone/2、ZIM、RMBG-2.0、VideoMaMa 均有非商用或社区许可限制；RVM 为 GPL-3.0。代码、checkpoint、训练数据可能是三套条款。发行前应固定 SHA/revision，保存每个权重的模型卡和许可证快照。
2. **全自动选目标存在语义歧义。**两只宠物、人宠同框、宠物很小或家具更显著时，没有提示的算法无法知道用户想要哪一个。一个点/框的低成本纠错比静默导出错误视频更可靠。
3. **二值时序和软边时序目标冲突。**VOS 越稳定越可能削掉细毛；逐帧 matting 越敏感越可能闪。融合只能在 unknown band 进行，并保留可视化中间产物方便定位问题。
4. **动物毛发仍是小数据问题。**AM-2K 只有 2,000 张、20 类，未覆盖所有品种、毛色、湿毛、低照度和强运动模糊。PoC 必须用本项目真实素材，而不是只看论文 demo。
5. **长视频/镜头切换会污染 memory。**SAM2、Cutie、XMem 都可能把错误写入记忆。桌宠素材应先切单镜头，超长视频分段处理并在关键帧重置。
6. **透明编码不是模型问题。**alpha 已经正确，若 straight/premultiplied 搞反、颜色层被错误预乘、WebM 解码器丢 alpha，最终仍会出现黑边。PNG 母版和黑/白背景双重验证不可省略。
7. **当前 macOS 自定义视频依赖外部 FFmpeg。**用户机器没有可用 FFmpeg 时，WebM → HEVC-alpha 会失败。短期生成工具应给出明确依赖检测；发行内置素材应预生成 MOV；长期可考虑随应用打包许可兼容的 FFmpeg 或改用 AVFoundation 原生写入。
8. **透明图集不是当前可直接使用格式。**过早只做 atlas 会迫使同时改播放器、计时、纹理尺寸和内存管理；本轮以 WebM/MOV 为交付，PNG sequence 保证未来可派生。

## 推荐顺序

1. 用历史实现参数跑出可重复 baseline。
2. 在同一批宠物视频上跑 `BiRefNet-matting`、`GFM` 和 `SAM2Matting` 单帧/视频质量对照。
3. 实现最小的 `SAM 2.1 Base+ → BiRefNet-matting band fusion → RGBA PNG → WebM` 离线 CLI。
4. 若时序仍差，加入 Cutie 对照和受限 unknown-band 稳定；若边缘仍差，再测 ViTMatte，不先换成人像模型。
5. PoC 通过后才决定是否把模型运行时随 CPA_V2 分发；更稳妥的产品形态是独立离线素材生成工具，CPA_V2 只消费已生成透明视频。

## 一手来源

### 分割与视频跟踪

- [Meta SAM 2 official repository](https://github.com/facebookresearch/sam2) · [paper](https://arxiv.org/abs/2408.00714) · [VOS inference toolkit](https://github.com/facebookresearch/sam2/blob/main/tools/README.md)
- [Cutie official repository](https://github.com/hkchengrex/Cutie) · [paper/project](https://hkchengrex.com/Cutie/)
- [XMem official repository](https://github.com/hkchengrex/XMem) · [interactive demo documentation](https://github.com/hkchengrex/XMem/blob/main/docs/DEMO.md)
- [Track-Anything official repository](https://github.com/gaomingqi/Track-Anything) · [paper](https://arxiv.org/abs/2304.11968)

### 视频 alpha matting

- [SAM2Matting official repository](https://github.com/FudanCVL/SAM2Matting) · [paper](https://arxiv.org/abs/2606.27339) · [official model card](https://huggingface.co/FudanCVL/SAM2Matting)
- [MatAnyone official repository](https://github.com/pq-yang/MatAnyone) · [paper](https://arxiv.org/abs/2501.14677) · [license](https://github.com/pq-yang/MatAnyone/blob/main/LICENSE)
- [MatAnyone 2 official repository](https://github.com/pq-yang/MatAnyone2) · [paper](https://arxiv.org/abs/2512.11782)
- [VideoMaMa official repository](https://github.com/cvlab-kaist/VideoMaMa) · [paper](https://arxiv.org/abs/2601.14255) · [model card](https://huggingface.co/SammyLim/VideoMaMa)
- [Robust Video Matting official repository](https://github.com/PeterL1n/RobustVideoMatting) · [paper](https://arxiv.org/abs/2108.11515) · [training documentation](https://github.com/PeterL1n/RobustVideoMatting/blob/master/documentation/training.md)
- [BackgroundMattingV2 official repository](https://github.com/PeterL1n/BackgroundMattingV2) · [project page](https://grail.cs.washington.edu/projects/background-matting-v2/) · [paper](https://arxiv.org/abs/2012.07810)

### 动物/通用图像 matting 与背景移除

- [BiRefNet official repository](https://github.com/ZhengPeng7/BiRefNet) · [paper](https://arxiv.org/abs/2401.03407) · [MIT license](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE)
- [GFM / AM-2K official repository](https://github.com/JizhiziLi/GFM) · [paper](https://arxiv.org/abs/2010.16188)
- [ViTMatte official repository](https://github.com/hustvl/ViTMatte) · [paper](https://arxiv.org/abs/2305.15272) · [Hugging Face checkpoint](https://huggingface.co/hustvl/vitmatte-small-composition-1k)
- [Matte Anything official repository](https://github.com/hustvl/Matte-Anything) · [paper](https://arxiv.org/abs/2306.04121)
- [MAM official repository](https://github.com/SHI-Labs/Matting-Anything) · [paper](https://arxiv.org/abs/2306.05399)
- [ZIM official repository](https://github.com/naver-ai/ZIM) · [paper](https://arxiv.org/abs/2411.00626)
- [BRIA RMBG-2.0 official model card](https://huggingface.co/briaai/RMBG-2.0)
- [DIS official repository](https://github.com/xuebinqin/DIS)
- [MODNet official repository](https://github.com/ZHKKKe/MODNet) · [paper](https://arxiv.org/abs/2011.11961)

### 透明视频格式

- [WebM Project: Alpha Channel](https://wiki.webmproject.org/alpha-channel)
- [Apple: HEVC Video with Alpha](https://developer.apple.com/videos/play/wwdc2019/506/)
- [Apple: Using HEVC video with alpha](https://developer.apple.com/documentation/AVFoundation/using-hevc-video-with-alpha)
- [Apple HEVC Video with Alpha Interoperability Profile](https://developer.apple.com/av-foundation/HEVC-Video-with-Alpha-Interoperability-Profile.pdf)
- [Apple: About Apple ProRes](https://support.apple.com/en-mt/102207)

活跃日期来自 GitHub 官方 REST API 对各主仓 `pushed_at` 的 2026-08-31 快照；stars 只用作生态成熟度旁证，不代表模型质量。所有性能数字均保留官方测试硬件语境，不能外推到 CPA_V2 用户机器。
