# 凯格尔运动独立功能包

`wellness.kegel` 使用主程序的受限 WebView 窗口，无额外通用运行包。运动控制器、
泡泡动画、编钟和计数逻辑在此目录独立构建，不由主程序入口导入。
主程序提供通用休息活动协调、窗口命中测试、数据持久化、可信设置适配器及受限原生 PCM 播放通道。

桌面应用中的编钟跟随“番茄钟 → 声音 → 播放设备”的选择。主程序同步设备设置到已打开的
模块，运动中切换设备不会重置计时或重敲当前提示，未结束的尾音从当前播放位置转到新设备。
找不到指定设备时回退到系统默认输出并提示；模块音量和静音仍独立控制。
编钟图和随机音高继续由模块通过 `OfflineAudioContext` 合成，主程序仅接收不超过 10 秒的
双声道或单声道 PCM16，使用与番茄钟提示音相同的 CPAL 设备解析器播放。
暂停、停用、卸载和退出时清理原生输出，过期会话或渲染结果不能重新播放。
浏览器预览使用 Web Audio 默认输出，真实硬件选择须在桌面应用中验证。

从 `app/` 运行：

```powershell
node node_modules/vite/bin/vite.js --config feature-packs/kegel/vite.config.ts
node node_modules/vite/bin/vite.js build --config feature-packs/kegel/vite.config.ts
python feature-packs/kegel/build_pack.py --version 1.0.0
```

预览地址为 `http://127.0.0.1:1422`，使用内存记录，不代表实际安装状态。
输出为 `tmp/kegel-module/package/kegel-module-1.0.0.zip`。每个文件、清单和压缩包均有
SHA256；包声明所有支持的平台和固定主机 ABI。

正式分发需要生成精确 GitHub/CNB 版本 URL 的索引并使用既有更新密钥签名。
主程序只接受已签名索引和校验通过的文件，不加载远程设置 JavaScript。
打包脚本不签名、不发布，也不改变已有应用或模块版本。

GitHub Actions 的 **Kegel module release** 独立构建本目录，通过已发布主应用 tag 核对
主机 ABI、原生适配器和能力声明，用已有 updater 密钥签署 `kegel-module-index.json` 及预签名 CNB 变体。
模块逻辑可独立更新；需要改变主机适配器时，必须先发布相应主应用。
首次模块版本沿用本目录约定的 `1.0.0`。手动运行默认仅验证，明确设置 `publish=true` 后，
只补充当前公开 Release 的缺失附件；相同哈希的已有文件跳过，不覆盖主应用安装包或不同内容。
模块 ZIP 先上传，客户端可见的签名索引最后上传。CNB 镜像必须使用更新后的索引处理脚本，
验证 CNB 变体后提供 CNB 首选下载地址与 GitHub 同版本回退。

本机测试安装包可以在编译时提供 `CPA_KEGEL_LOCAL_PACKAGE_PATH`、
`CPA_KEGEL_LOCAL_PACKAGE_SHA256` 和 `CPA_KEGEL_LOCAL_MANIFEST_SHA256`。
此构建仅安装对应固定哈希的本地包；普通发行构建不设置这些变量，仍须签名索引。
安装、升级、停用和卸载统一通过扩展包管理器。升级保留开关；卸载保留个人记录和设置。
