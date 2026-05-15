# CPA → Tauri 2 + Rust 重写设计

**日期**：2026-05-15
**目标**：把 `/Users/xpy/Desktop/NanZhai/CPA`（Unity 6 + QFramework 桌宠番茄钟）整体迁移到 `/Users/xpy/Desktop/NanZhai/CPA_V2`，使用 **Tauri 2 + Rust** 作为运行时，**TypeScript + React + 原生 CSS** 作为前端，复用已迁入 `CPA_V2/Server/` 的 Node.js WebSocket 服务器。
**设计稿**：`CPA_V2/AUI/PUI.pen`（Pencil MCP 读取）。

## 范围

### 必须保留的功能（来自 Unity APP 命名空间）

| 模块 | Unity 关键文件 | 行为概要 |
|------|------------|---------|
| Pomodoro 计时 | `APP/Pomodoro/Model/PomodoroModel.cs`、`System/PomodoroTimerSystem.cs` | Focus(默认 25min) ↔ Break(默认 5min)，4 轮，可设置 AutoStartBreak、跳过、重置 |
| 阶段提示动作 | `System/PomodoroEndActionSystem.cs` | TopWindow(置顶弹窗) 或 PlayVideo(指定视频) |
| 联机房间 | `APP/Network/System/NetworkSystem.cs`、`DTO/*.cs`、`CPA_V2/Server/src/*` | 创建/加入/离开房间、`player_state_update` 心跳同步、ping/pong 保活、icon 上传/请求 |
| PlayerCard | `Assets/UI_V2/Controller/PlayerCard*.cs`、`APP/Pomodoro/Model/PlayerCardModel.cs` | 远端玩家卡片：姓名、阶段、剩余时间、当前 App 图标、按键计数 Pill |
| 设置面板 | `APP/Settings/Model/SettingsModel.cs`、`Assets/UI_V2/Controller/*Settings*.cs` | 番茄钟 / 联机 / 宠物 / 全局 四个 tab；UiScale、目标显示器；含「应用 / 取消未保存」对话框 |
| 按键绑定 + 计数 | `APP/Settings/Model/BindingKey*.cs`、`System/BindingKeyCounterSystem.cs` | 全局快捷键监听、按键计数、可标记其中一个为「同步键」推送给房间 |
| 前台 App 检测 | `APP/Network/System/ActiveAppSystem.cs` | macOS 无障碍 API → 当前前台 App 的 `name` / `bundleId` / icon |
| 透明窗口 | `UniWindowController` 用法 | 点击穿透、置顶、阴影屏占位、按比例持久化 |
| 阶段切换闪烁 | `System/PhaseTransitionFlashSystem.cs` | 计时结束时窗口短暂提亮提示 |
| 输入计数面板 | `Assets/UI_V2/Controller/InputCounterPanelController.cs` | 显示按键计数及 pin 状态的浮窗 |
| 房间历史 | `APP/SessionMemory/Model/*.cs` | 已加入过的房间列表持久化、相对时间显示 |

### 不在迁移范围

- HybridCLR 热更（Tauri 没有等价物，且不再需要绕过 Unity AOT 限制）
- DA_Assets / FFmpegOut / SVGMeshUnity / Color Recognizer 等第三方 Unity 包
- Unity Test Framework / VisualImageTestBase（用 Vitest + Playwright 替代）
- macOS Recorder / 视频导出（保留 EndAction 播放视频功能即可）

## 架构

```
CPA_V2/
├── Server/                  ← 已迁移：Node.js WebSocket（端口 8039）
├── AUI/PUI.pen              ← Pencil 设计稿（视觉真理源）
├── docs/superpowers/        ← 设计与计划
└── app/                     ← 新建：Tauri 2 应用
    ├── src/                 ← React + TS 前端
    │   ├── domain/          ← Pomodoro / Network / Settings / BindingKey 状态机
    │   ├── ui/              ← 与 Pencil 节点一一对应的组件
    │   ├── styles/          ← CSS 变量与组件样式
    │   └── ipc/             ← Tauri invoke / event 包装
    ├── src-tauri/
    │   ├── src/
    │   │   ├── window.rs        ← 透明窗口、点击穿透、置顶、屏幕定位
    │   │   ├── active_app.rs    ← macOS NSWorkspace + Accessibility 桥
    │   │   ├── key_counter.rs   ← CGEventTap 全局按键计数
    │   │   ├── store.rs         ← tauri-plugin-store 持久化封装
    │   │   └── lib.rs           ← Tauri command 注册
    │   └── tauri.conf.json
    └── package.json
```

### 状态层分层（沿用 QFramework 思路）

- **Domain Store（前端 Zustand）**：等价于 Model — Pomodoro / Settings / Network / BindingKey 各自一个 store。
- **Service（前端）**：等价于 System — `PomodoroTimerService`、`NetworkService`(WebSocket 客户端)、`KeyCounterService`(订阅 Tauri 事件)。
- **IPC 边界（Tauri commands / events）**：等价于 Utility — Rust 实现窗口控制、原生 API、持久化。
- 所有写操作走 Service 方法（≈ Command），前端组件只读 Store；跨域通信走 Tauri event 或前端 store 订阅。

## 数据模型

直接复用 Unity 现有字段名，方便对照：

```ts
// PomodoroModel
type PomodoroPhase = 'focus' | 'break' | 'completed';
interface PomodoroState {
    focusDurationSeconds: number;       // default 25*60
    breakDurationSeconds: number;       // default 5*60
    totalRounds: number;                // default 4
    currentRound: number;
    remainingSeconds: number;
    currentPhase: PomodoroPhase;
    isRunning: boolean;
    isPinned: boolean;
    windowAnchor: 'top' | 'bottom';
    autoJumpToTopOnComplete: boolean;
    autoStartBreak: boolean;
    targetMonitorIndex: number;
    completionClipIndex: number;
    endActionMode: 'topWindow' | 'playVideo';
    endActionVideoPath: string;
    endActionVideoIndex: number;
    pomodoroPanelPosition: { x: number; y: number } | null;
}

// 与 Server protocol 完全对齐
interface RemoteState {
    pomodoro: { phase: number; remainingSeconds: number; currentRound: number; totalRounds: number; isRunning: boolean };
    activeApp: { name: string; bundleId: string; iconId?: string } | null;
    bindingKey: { keyLabel: string; pressCount: number } | null;
}
```

## 子项目分解（按 /loop 迭代顺序）

每次迭代只追求一个内聚切片可运行：

1. **Iter-A 脚手架**：Tauri 2 + React + TS + Vite，透明窗口能开起来，前端能 invoke 一个 hello。
2. **Iter-B 番茄钟核心**：pomodoroPanel UI 像素级对齐 → 本地计时器 → 持久化。
3. **Iter-C 设置面板**：Unified / Pomodoro / Pet / Online / Global 五块 + Apply 流程 + 持久化。
4. **Iter-D 联机**：WebSocket 客户端、状态广播、PlayerCard 渲染、自动重连。
5. **Iter-E 原生桥**：macOS 前台 App、全局按键计数、绑定捕获。
6. **Iter-F 视觉对齐**：每个 Pencil 节点截图 vs 实现截图比对，修像素差。
7. **Iter-G 对抗审查**：`/codex:adversarial-review --background` 后修复。

## 错误处理与边界

- **WebSocket 断线**：5s 退避重连；UI 上方黄条提示「正在重新连接...」（与设计稿一致）。
- **服务器不可达**：保留本地番茄钟功能可用，仅禁用「联机」面板的房间操作。
- **持久化损坏**：捕获 JSON 解析异常 → 删除该 key → 回到默认值（沿用 PomodoroPersistence 的策略）。
- **macOS 权限缺失**（无障碍未授权）：禁用键盘计数 / 前台 App，弹窗引导用户去系统设置。

## 测试策略

- **单元（Vitest）**：Pomodoro 状态机（phase 推进、Tick 减秒、ApplySettings 行为）、协议序列化、Settings 持久化。
- **集成（Vitest + ws）**：客户端连真实 Server，跑 create→join→leave→state_update→snapshot 链路。
- **视觉（Playwright + Pencil 截图）**：对每个面板做与 PUI.pen 截图的像素差比对，阈值 < 2%。

## 不做的事（YAGNI）

- 不重写 QFramework 自己的事件/绑定库；用 Zustand + RxJS（按需）即可。
- 不实现热更；Tauri 自带的 updater 已经足够。
- 不引入 Tailwind / UI 组件库；设计稿坐标精确，原生 CSS 更直接。
- 不在 Iter-A 就接 macOS 原生 API；先把 UI 跑起来再桥。

## 成功标准

1. `npm run tauri dev` 在 `CPA_V2/app` 目录可启动透明置顶窗口。
2. 与 Pencil 设计稿核心节点（pomodoroPanel / Unified Settings / OnlinePanel/joined / PlayerCard）对应的实现截图视觉一致。
3. 与 `Server/` 真实 ws 后端跑 create→join→state_update 全链路无错误。
4. macOS 前台 App 名 / 图标显示在远端玩家卡片上。
5. 全局按键计数能被另一端 PlayerCard 实时看到。
6. `/codex:adversarial-review` 输出的关键 finding 已修复。
