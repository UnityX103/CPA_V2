# 摄像头工位在场自动控制设计

**日期**：2026-08-14

**状态**：已确认

**范围**：macOS 14+（x86_64 / ARM64 thin package）与 Windows x86_64

**实施来源**：本文是摄像头在场自动控制的唯一实施依据。

## 文档关系与替代说明

本文基于只读调研 `docs/superpowers/specs/2026-08-14-camera-presence-detection-research.md` 重新核对当前代码后形成。

- 原调研继续作为选型证据，不作为实现规范。
- 本文替代原调研中的产品开放问题、状态机草案、持久化路径和分阶段实施建议。
- 原调研提出的 `settingsPersistence.ts v1 -> v2` 已过时。当前权威持久化路径是 `userPreferences.ts` / `userPreferencesPersistence.ts`；本文基于隐私与设备差异，明确把摄像头设置作为该统一云同步策略的设备本地例外。
- 原调研建议的依赖版本、下载量和生态统计是 2026-08-14 的调研快照，不构成实现锁定条件。
- 隔离 worktree 中不存在原调研文件，因此本任务不复制或删除用户原工作区中的未提交文件。

领域术语见仓库根目录 `CONTEXT.md`。

## 背景与目标

用户希望摄像头定时判断工位前是否有人，并据此自动控制番茄钟：人在休息期间重新回到工位后自动进入专注；专注期间长时间离场后自动停止继续计时；由自动化停止的专注可在用户返回后继续。

本功能的目标是减少用户离开或返回工位后的手动操作，同时保证：

1. 摄像头画面仅在本机内存中短暂处理。
2. 摄像头不可用或检测不确定时，番茄钟保持原行为，不把错误当成离场。
3. 手动操作始终高于自动化，自动化不得恢复用户手动暂停的计时器。
4. macOS 与 Windows 具有相同的前端状态和 Tauri command 契约。

## 已确认事实

以下事实来自当前基线 `223f917d7bc98071659fa70cf50747409106edf9`：

- 番茄钟阶段为 `focus | break | completed`，`isRunning` 与阶段相互独立。
- `focus -> break` 的结束事件会驱动结束提示、自动置顶和打卡计数；不能用伪造的 focus 结束事件表达离场，否则会把未完成专注记入打卡。
- `break -> focus` 后默认停在 `focus + isRunning=false`，现有 UI 将其呈现为「休息结束」。
- 主窗口拥有权威 Zustand 状态；设置窗口通过 bridge snapshot / dispatch 镜像和修改状态。
- 主窗口在本地偏好水合后才启动持续性服务。
- 用户偏好使用 `UserPreferencesSnapshot schemaVersion: 1` 同时进行本地保存与账号云同步；`settingsPersistence.ts` 只是兼容旧数据的读取路径。
- 房间广播 `RemoteState` 只包含番茄钟、前台应用和按键信息。目前没有摄像头模块、摄像头 usage description 或摄像头 IPC。

## 用户请求

- 使用摄像头反馈自动控制番茄钟。
- 重新确认旧调研中的需求，输出可执行的新规范并清理过时约束。
- 新原生能力必须同时支持 macOS 与 Windows。
- 规范必须覆盖权限、检测语义、自动暂停/继续、防误判、隐私、失败降级、设置、IPC、测试和可观察验收。

## 范围

### 包含

- 默认摄像头的按需单帧采集。
- 基于人脸存在与否的三值观测：`present | absent | unknown`。
- 休息期间或自然休息结束后的自动进入专注。
- 专注期间持续离场后的自动动作，以及仅对自动动作的自动恢复。
- macOS 摄像头授权、Windows 摄像头隐私限制和两端错误分类。
- 设备本地设置、设置窗口状态、主窗口动作提示。
- Tauri 原生适配、前端调度、状态机和覆盖关键边界的测试。

### 非目标

- 人脸识别、身份验证、注视检测、姿态判断或生产力判断。
- 保存图片、录像、缩略图、人脸框或生物特征。
- 上传或向房间广播任何摄像头派生状态。
- 多摄像头选择、画面预览、外接摄像头优先级。
- 用键盘、鼠标或前台应用活动替代摄像头判断。
- Linux、移动端或 Windows ARM64。
- 常驻系统服务；主窗口退出后不继续检测。
- v1 中引入 ONNX Runtime、下载模型或运行时在线拉取模型。

## 参与者与职责

| 参与者 | 职责 |
|---|---|
| 本地用户 | 明确启用功能、处理系统权限、设置时间参数、保留手动控制权 |
| 主窗口 | 权威配置与运行态、调度采样、执行番茄钟动作、持久化设备本地设置 |
| 设置窗口 | 镜像配置和运行状态，通过 bridge 向主窗口提交动作，不自行采样 |
| 原生在场适配器 | 查询权限/可用性，按需打开摄像头，完成单帧人脸检测并立即释放资源 |
| 番茄钟状态机 | 接受明确的 presence action，不直接依赖摄像头或平台 API |

## 检测语义

### 观测定义

- `present`：单次采样成功，画面中检测到至少一张人脸。
- `absent`：单次采样成功，画面中没有检测到人脸。
- `unknown`：权限不足、没有设备、设备忙、打开/取帧/检测超时或原生检测失败。
- 多张人脸仍为 `present`。
- 本功能不判断画面中的人是谁，也不判断是否在工作。
- `unknown` 绝不能折算为 `absent` 或 `present`。

### 默认配置与合法范围

| 设置 | 默认值 | 合法范围 | 持久化 |
|---|---:|---:|---|
| 摄像头自动控制 | 关闭 | 开 / 关 | 设备本地 |
| 检测间隔 | 10 秒 | 5-600 秒，整数 | 设备本地 |
| 离席判定阈值 | 严谨 | 关闭防抖 / 严谨 / 中等 / 宽松 | 设备本地 |

### 非对称离席确认

为了降低撑脸、侧看、调整摄像头时的人脸漏检，离席使用可配置的连续 `absent` 阈值，返回仍保持立即响应：

- 关闭防抖：1 次 `absent`，立即判定离席。
- 严谨（默认）：2 次连续 `absent`；开启防抖时的最低阈值为 2。
- 中等：3 次连续 `absent`。
- 宽松：6 次连续 `absent`。
- 达到当前阈值后才把最近确认状态切换为 `absent`，并暂停正在运行的 focus。
- 第一次 `present` 可立即恢复 Presence-Owned Pause、启动自然休息结束后等待的 focus，或提前结束 break。
- `present`、`unknown`、阈值配置变更或相关番茄钟上下文变化都清空未确认的 `absent` 计数。
- `unknown` 永不改变番茄钟运行状态。
- 手动暂停不属于 Presence-Owned Pause，不能由 `present` 自动恢复。
- 同一时刻最多一个采样请求。上一次未完成时跳过本次调度，不排队、不并发打开摄像头。
- 单次采样应有 10 秒超时；超时产生 `unknown` 并释放摄像头。

## 核心流程

### 启用

1. 用户在番茄钟设置中打开「摄像头自动控制」并点击现有「应用」。
2. 主窗口保存设备本地配置。
3. macOS 若权限为 `notDetermined`，设置窗口显示「需要授权」，仅在用户点击「授权」时弹系统提示；应用启动或打开设置页不得自行弹权限框。
4. Windows 在第一次显式启用后的探测中验证系统相机访问；若系统隐私开关拒绝访问，显示「权限被拒绝」。
5. 权限可用后立即执行一次采样，之后按配置间隔调度。

### 关闭

1. 用户关闭设置并应用后，取消后续调度。
2. 正在执行的采样允许完成，但其结果必须因 generation 不匹配而被丢弃。
3. 清空未确认的离席计数、最近结果和 Presence-Owned Pause 标记。
4. 已被自动暂停的计时器保持暂停；关闭功能本身不得擅自恢复计时。

### 休息中自动进入专注

资格状态：`currentPhase === 'break'`，不论休息计时是否正在运行。

第一次成功 `present` 观测后：

- 通过新的番茄钟 action 以 `triggeredBy: 'presence'` 执行 `break -> focus`。
- 若仍有下一轮，进入下一轮 `focus` 并立即运行。
- 若当前 break 是最后一轮之后的休息，按既有规则进入 `completed`，不得自动创建新一组番茄钟。
- 该阶段变化可以复用现有「休息结束」提示，但不能播放 focus 结束视频或增加打卡计数。

### 自然休息结束后自动开始专注

资格状态同时满足：

- `currentPhase === 'focus'`；
- `isRunning === false`；
- 最近一次真实阶段事件是 `break -> focus`；
- 之后没有发生手动 `pause / reset / applySettings`。

第一次成功 `present` 观测后直接启动当前 focus。初次启动、reset 后的 focus、用户手动暂停的 focus 和 `completed` 都不具备该资格。

### 专注中离场

资格状态：`currentPhase === 'focus' && isRunning === true`。

连续 `absent` 达到当前离席判定阈值后：

- 保持 `currentPhase`、`currentRound` 和触发时刻的 `remainingSeconds`，只把 `isRunning` 设为 false。
- 标记为 Presence-Owned Pause，不生成 focus 完成事件，不增加连续专注或打卡计数。
- 主窗口显示一次「检测到离开，已暂停专注」。
- 之后第一次成功 `present` 观测时，自动继续同一 focus，并显示一次「检测到返回，已继续专注」。
- `unknown` 时维持暂停，不自动继续。
- 一次离场自动动作最多触发一次；手动动作立即取消自动恢复资格。
- 不得通过伪造 `focus -> break` 完成事件复用提示 UI，否则会污染连续专注次数和打卡计数。

### 手动操作优先级

- 用户手动暂停的 focus 永不因 `present` 自动恢复。
- 用户在 Presence-Owned Pause 状态手动点击开始，视为用户接管：立即开始并清除自动暂停归属。
- 用户执行 skip、reset 或应用会重置进度的番茄钟设置后，清除所有 presence 自动化归属。
- 用户在 break 中手动暂停不阻止「检测到在场后进入 focus」；这是 R2 的既定行为。

## D-01：已确认决策

**决定**：运行中的 focus 连续检测到离场且达到所选阈值后保留进度并自动暂停；第一次检测到用户返回后自动继续同一 focus。

### 选定方案：保留进度并自动暂停/继续

- 保持 `currentPhase`、`currentRound` 和 `remainingSeconds`，只把 `isRunning` 设为 false。
- 标记为 Presence-Owned Pause，不生成 focus 完成事件，不增加连续专注或打卡计数。
- 主窗口显示一次「检测到离开，已暂停专注」。
- 之后第一次成功 `present` 观测时，自动继续同一 focus，并显示一次「检测到返回，已继续专注」。
- `unknown` 时维持暂停，不自动继续。

理由：符合任务对「自动暂停/继续状态机」的要求；不会因误判丢失当前专注；不会制造虚假的 focus 完成记录；用户可通过任意手动操作接管。

### 未选方案：当前 focus 作废并推进阶段

- 把当前 focus 标记为未完成并进入 break 或下一待专注状态。
- 必须新增「作废」语义，确保不增加完成计数或打卡。
- 用户返回后的动作取决于进入的阶段，不再是恢复同一 focus。

代价：需要新增非完成式阶段推进，用户会丢失当前 focus 进度，且与「自动继续」目标不一致。

用户于 2026-08-14 明确选择推荐方案。代码编写员必须实现选定方案，不得用现有 `skip()` 或 `advancePhase()` 替代。

## 权限与平台要求

### macOS

- bundle 必须包含 `NSCameraUsageDescription`：`用于判断你是否在工位前，以自动暂停或继续番茄钟。画面只在本机内存中处理，不会保存或上传。`
- 状态查询不得弹系统权限框；只有用户在设置中点击「授权」才请求权限。
- 请求系统权限前复用现有置顶窗口让位思路，避免透明置顶窗口遮挡系统提示；流程结束后恢复窗口层级。
- 已拒绝或后续撤销时停止采样，状态为 `permissionDenied`，提供「打开系统设置」和「重试」。
- 正式签名包与开发包的系统授权可能是独立记录；这是手动验证项，不改变产品状态机。

### Windows

- 使用桌面应用相机访问能力；系统隐私设置拒绝、没有设备和设备占用必须映射为结构化状态。
- 提供打开 `ms-settings:privacy-webcam` 的入口。
- 不伪造类似 macOS 的应用内授权成功状态；以实际打开设备结果为准。

### 跨平台错误分类

| 状态 | 含义 | 调度行为 | 番茄钟行为 |
|---|---|---|---|
| `disabled` | 功能关闭 | 不采样 | 无动作 |
| `permissionRequired` | 尚未请求授权 | 等用户操作 | 无动作 |
| `checking` | 正在探测或采样 | 禁止并发 | 无动作 |
| `ready` | 最近一次采样成功 | 正常调度 | `present` 立即动作；`absent` 达阈值后动作 |
| `permissionDenied` | 系统拒绝 | 暂停调度到重试/重启 | 无动作 |
| `noDevice` | 无可用摄像头 | 暂停调度到重试/重启 | 无动作 |
| `busy` | 设备被占用 | 下一间隔重试 | 无动作 |
| `error` | 其他原生失败 | 下一间隔重试，连续错误去重提示 | 无动作 |

## 原生实现边界

新增 `app/src-tauri/src/presence_detection/`：

```text
presence_detection/
  mod.rs       # 平台中性类型、错误分类与 command 表面
  macos.rs     # AVFoundation 采集 + Vision 人脸检测
  windows.rs   # Media Foundation 采集 + Windows FaceDetector
  stub.rs      # 非目标平台仅用于可编译的 unsupported 返回
```

采集使用 Rust 原生路径和 `nokhwa` 的 AVFoundation / Media Foundation 后端；检测层分别使用 macOS Vision `VNDetectFaceRectanglesRequest` 与 Windows `Windows.Media.FaceAnalysis.FaceDetector`。不得使用 WebView `getUserMedia` 作为正式实现。

每次采样执行「打开默认摄像头 -> 预热/取一帧 -> 检测 -> 丢弃帧 -> 关闭摄像头」。不得常开摄像头。平台差异封装在模块内，前端契约完全一致。

期望 command：

```ts
type PresenceAvailability =
  | 'permissionRequired'
  | 'ready'
  | 'permissionDenied'
  | 'noDevice'
  | 'busy'
  | 'error';

type PresenceObservation = 'present' | 'absent' | 'unknown';

interface PresenceCapability {
  platform: 'macos' | 'windows' | 'other';
  availability: PresenceAvailability;
}

interface PresenceSample {
  observation: PresenceObservation;
  availability: Exclude<PresenceAvailability, 'permissionRequired'>;
  errorCode: string | null;
}

camera_presence_status(): PresenceCapability
request_camera_presence_access(): PresenceCapability
open_camera_privacy_settings(): Result<void, string>
sample_camera_presence(): PresenceSample
```

约束：

- 预期的权限、占用和设备错误通过结构化 payload 返回，不依赖解析错误字符串。
- `Result::Err` 仅表示 IPC/内部不可恢复错误；前端统一转为 `unknown + error`。
- command 不返回图片、像素、人脸框、置信度或设备名称。
- 原生采样在阻塞任务中执行，不能阻塞 Tauri 主线程。
- Rust 侧用互斥或单飞保护拒绝并发采样；前端 generation 同时防止过期结果落地。
- 采样函数返回前必须释放摄像头句柄；失败路径同样释放。

## 前端领域与 IPC 边界

新增 `app/src/domain/presence.ts`，负责：

- 设备本地配置：`enabled`、`intervalSeconds`、`absenceSensitivity`。
- 运行态：availability、最近确认观测、连续 `absent` 计数、最近成功时间、in-flight、generation、lastError。
- 自动化归属：是否为 Presence-Owned Pause，以及自然 break 结束后的自动启动资格。
- `usePresenceMonitor({ enabled: localHydrated })`，只挂载在主窗口。

设置窗口不得直接调用采样 command。扩展现有 bridge：

- `BridgeSnapshot.presence` 同步配置和可展示运行态，但不包含人脸数据。
- `DispatchPayload` 增加 presence 的 `applySettings`、`requestAccess`、`retry`、`openPrivacySettings`。
- settings mirror 只派发动作，由主窗口执行并回推 snapshot。
- bridge version 只有在保持兼容不可行时才升级；同一发布内所有窗口必须使用相同契约。

番茄钟新增窄 action，不让 presence 模块直接 `setState`：

- `startFocusFromPresence()`：处理 break 中或自然 break 结束后的自动进入 focus。
- `pauseFocusFromPresence()` / `resumeFocusFromPresence()`：分别建立和消费 Presence-Owned Pause。
- `PomodoroEndEvent.triggeredBy` 增加 `presence`，只用于真实阶段变化。
- Presence-Owned Pause 的提示使用独立 presence action/notice，不伪造阶段结束事件。

## 持久化、云与网络边界

摄像头设置写入独立的设备本地 Tauri store，例如 `presence-preferences.json`。`absenceSensitivity` 加入 schemaVersion 2；读取 v1 时默认为 `strict`。

不得把以下字段加入 `UserPreferencesSnapshot`、`CloudAccountData`、Server `UserDataStore` 或房间 `RemoteState`：

- enabled、interval、absenceSensitivity；
- 权限、设备、busy/error 状态；
- present/absent/unknown；
- 自动暂停归属；
- 任何图片或检测元数据。

这是 `2026-05-22-local-first-settings-sync-design.md` 的显式隐私例外：摄像头能力与授权是设备特定的，从其他设备同步 `enabled=true` 可能在未经该设备用户确认的情况下启动摄像头探测。

本地持久化加载失败时使用默认关闭；字段越界时分别回退默认值，不能因一个坏字段丢弃其他有效字段。

## 设置与用户反馈

实现前先通过 Pencil MCP 更新 `AUI/PUI.pen` 的番茄钟设置页，再同步 `SettingsPanel.tsx`。

设置页包含：

- 「摄像头自动控制」开关，默认关。
- 「检测间隔」数值控件，单位秒，5-600。
- 「离席判定阈值」下拉菜单：关闭防抖、严谨、中等、宽松。默认严谨，即连续两个检测周期都为 `absent` 才暂停。
- 「摄像头状态」值：未启用、需要授权、检测中、可用、权限被拒绝、未找到摄像头、摄像头被占用、检测失败。
- 按状态提供「授权」「打开系统设置」「重试」，不显示无效动作。
- 「工位状态」显示防抖后确认的「在场 / 离场 / 未知」，不冒充最近一次原始观测，不显示画面或人脸数量。

三个配置参与番茄钟页现有 dirty/apply 流程。关闭、间隔或阈值变更必须在点击「应用」后生效；权限和重试动作立即执行，不参与 dirty 状态。

主窗口只在动作或可用性发生变化时显示一次短提示，不在每次采样时提示：

- 自动进入 focus：复用「休息结束」。
- 自动暂停：`检测到离开，已暂停专注`。
- 自动继续：`检测到返回，已继续专注`。
- 运行中失去权限或设备持续不可用：`摄像头不可用，自动控制暂不可用`，同一状态不重复刷屏。

## 隐私与安全

- 图片只存在于单次 command 的本机内存，检测结束立即释放。
- 禁止写文件、日志、Tauri event、前端 state、localStorage、Tauri store、云数据或 WebSocket。
- 日志只允许平台、分类错误码、耗时和状态变化；不得包含图片、设备序列号或人脸数据。
- 不采集身份，不做跨样本跟踪，不把「在场」描述为「正在工作」。
- 按需开合摄像头，系统指示灯闪烁是预期隐私信号。
- CSP 不放宽，`capabilities/default.json` 不为摄像头增加广泛 Web API 权限；原生能力只通过注册的 command 暴露。

## 失败与边界场景

| 场景 | 期望结果 |
|---|---|
| 摄像头被会议软件占用 | `unknown + busy`，番茄钟不动作，下个间隔重试 |
| 运行中撤销权限 | 停止有效观测，若已 Presence-Owned Pause 则继续保持暂停 |
| 功能关闭时仍有请求返回 | generation 不匹配，结果丢弃 |
| 系统睡眠后恢复 | 恢复后的成功观测继续按所选阈值处理 |
| 用户撑脸、侧看、戴口罩、背对或暗光 | 可能得到短时 absent；严谨/中等/宽松档通过连续次数防抖，不引入身份或人体检测猜测 |
| 检测到照片或屏幕中的脸 | v1 可能视为 present；活体检测不在范围内 |
| breakDurationSeconds = 0 | 离席仍按所选档位处理，不借用休息时长作为阈值 |
| completed | 不自动开始新番茄钟 |
| 初始 focus 停止态 | 不因在场自动开始 |
| 手动暂停 focus | 永不由摄像头恢复 |
| Presence-Owned Pause 后 unknown | 保持暂停，不恢复、不推进 |

## 测试要求

### 前端单元测试

至少覆盖：

1. 默认关闭，不调用原生采样。
2. 启用后立即采样，之后按间隔采样；in-flight 时不并发。
3. 关闭防抖/严谨/中等/宽松分别在连续 1/2/3/6 次 absent 时暂停运行中的 focus；启用防抖的阈值不得小于 2，阈值前不改变已确认状态或番茄钟。
4. 第一次成功 present 立即恢复 Presence-Owned Pause；`present`、`unknown`和相关状态变更清空未确认的 absent 计数。
5. break 运行中和暂停中第一次 present 都进入下一 focus 并运行。
6. 最后一轮 break 第一次 present 时进入 completed，不新开一组。
7. 自然 break 结束后的 focus 可由第一次 present 启动；初始/reset/手动暂停 focus 不可。
8. 手动 start/pause/skip/reset 优先并清空自动化状态。
9. completed 对任意观测无动作。
10. 关闭时丢弃过期采样结果；已自动暂停的 focus 保持暂停。
11. 离场只暂停并保留 round/remaining，不产生 focus completion；返回后只恢复 Presence-Owned Pause。
12. 检测间隔合法范围、关闭防抖与三档阈值、设备本地持久化损坏回退，以及 v1 数据默认迁移到严谨档。

### Bridge 与 UI 测试

- presence snapshot 在设置窗口正确镜像。
- 设置窗口 action 只由主窗口执行。
- dirty/apply 包含启用开关和检测间隔；权限/重试不污染 dirty。
- 每个 availability 状态显示正确文案和可用操作。
- 主窗口提示按状态变化去重。
- `triggeredBy: 'presence'` 的 break 结束不触发 focus 完成视频、自动置顶或打卡增加。

### Rust 与平台测试

- 纯逻辑测试覆盖平台错误到统一 availability 的映射。
- 并发采样只能有一个成功进入原生采集区。
- 所有成功/失败/超时路径都释放摄像头资源。
- macOS release bundle 可检查到 `NSCameraUsageDescription`。
- Windows x86_64 构建必须实际编译 Windows 实现，不能落到 stub。

需要在真实 macOS 与 Windows 机器各执行：授权、拒绝、撤销、无设备、设备占用、正常 present、正常 absent、应用退出后资源释放。

## 可观察验收标准

以下标准全部为实施验收基线：

1. **AC-01 默认隐私**：全新安装首次启动 10 分钟内不出现摄像头权限提示或摄像头指示灯，直到用户明确启用并授权。
2. **AC-02 按需释放**：启用后每次采样结束或失败后摄像头被释放；FaceTime/Camera/会议软件可在采样间隔内重新取得设备。
3. **AC-03 在场进入 focus**：break 中第一次成功 present 后，下一轮 focus 已运行。
4. **AC-04 休息结束后启动**：自然 break 结束进入停止的 focus 后，第一次成功 present 会开始 focus；应用初始停止态不会自动开始。
5. **AC-05 可关闭的三档离席防抖**：focus 运行中，关闭防抖/严谨/中等/宽松分别在连续 1/2/3/6 次 absent 时暂停；Presence-Owned Pause 中第一次成功 present 立即恢复；unknown 无动作。
6. **AC-06 失败安全**：权限拒绝、设备忙、无设备、超时连续发生时，番茄钟阶段、轮次、剩余时间和运行状态不因 presence 自动化改变。
7. **AC-07 手动优先**：手动暂停 focus 后收到 present，计时器仍保持暂停。
8. **AC-08 睡眠恢复**：系统恢复后的成功观测继续按所选阈值处理，unknown 无动作。
9. **AC-09 数据边界**：本地 store、云账号 payload、房间 WebSocket payload和日志中均不存在图片、人脸框或在场状态；云账号切换不会改变本机摄像头开关。
10. **AC-10 在场检测暂停与恢复**：focus 运行中连续 absent 达所选阈值后，phase/round/remaining 保持、isRunning=false、无 focus completion；第一次成功 present 后恢复同一 remaining，手动暂停则不恢复。
11. **AC-11 双平台**：macOS x86_64、macOS ARM64 和 Windows x86_64 的发布构建均包含非 stub 摄像头实现，并通过正常/拒绝/占用三条人工路径。
12. **AC-12 退出清理**：退出应用后 2 秒内摄像头指示灯熄灭，进程不因摄像头任务或线程滞留。

## 已确认决策与假设

### 已确认事实/请求

- 摄像头是主信号，macOS 与 Windows 都必须实现。
- 需要自动进入 focus、自动暂停/继续、权限、隐私和可观察验收。
- 只修改文档；本规范不实施代码、依赖、构建或测试。

### 用户确认决策

- focus 连续检测到离场且达所选阈值后，保留当前进度并进入 Presence-Owned Pause；第一次检测到返回后自动继续同一 focus。

### 实施基线

- 人脸存在是「工位在场」代理，不声称用户在工作。
- 默认关闭、10 秒检测间隔，范围 5-600 秒；离席判定默认严谨档。
- 每次按需开合摄像头：`present` 立即处理，`absent` 按关闭防抖/严谨/中等/宽松的 1/2/3/6 次阈值处理。
- 摄像头设置设备本地，不进行账号云同步或房间同步。
- 默认摄像头唯一，v1 不做设备选择、预览或模型回退。
- 原生采集与原生系统人脸检测，前端只做调度和状态机。

### 合理假设

- 桌面用户通常面向摄像头；暗光、背对和遮挡仍可能产生持续误判，可关闭的三档阈值用于在响应速度与抗漏检之间取舍。
- 系统默认摄像头能满足 v1；无默认设备时使用 `noDevice` 降级。
- 5 秒是按需开合、系统指示灯和自动控制响应之间可接受的最小间隔。

## 未决问题

无。本文可直接交给代码编写员拆解和实现。

## 相关文档

- `CONTEXT.md`
- `docs/superpowers/specs/2026-05-15-cpa-tauri-rewrite-design.md`
- `docs/superpowers/specs/2026-05-15-adversarial-review.md`
- `docs/superpowers/specs/2026-05-16-pomodoro-auto-start-break-design.md`
- `docs/superpowers/specs/2026-05-16-key-counter-accessibility-permission-design.md`
- `docs/superpowers/specs/2026-05-22-local-first-settings-sync-design.md`
