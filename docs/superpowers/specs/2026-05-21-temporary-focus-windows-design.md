# 临时聚焦窗口设计

**日期**: 2026-05-21
**范围**: `AUI/PUI.pen`, `app/src/domain/{settings,pomodoroEndAction,checkinWindow}.ts`, `app/src/domain/bridge/{protocol,host}.ts`, `app/src/ui/{SettingsPanel,InputCounterPanel,PomodoroEndActionLayer}.tsx`, `app/src-tauri/src/lib.rs`, 相关测试
**不在范围**: 番茄钟计时规则、打卡数据模型、服务器同步、视频播放窗口策略

## 背景

全局设置里的 `显示打开的文件名` 已经不再有产品意义，需要从设置面板、持久化状态、桥接快照和 Pencil 设计中移除。输入计数面板继续显示当前应用名称，不再通过设置开关决定是否显示窗口标题或文件名。

现有 `专注结束后自动置顶` 会把主番茄钟窗口设为长期 always-on-top，并激活 pin 状态。新的目标不是长期置顶，而是在计时结束时把相关窗口带到前台，形成短暂提醒效果。今日打卡窗口也不应默认置顶；只有打卡计划编辑窗口在需要时被聚焦。

## 方案选择

### 推荐方案：新增“临时聚焦”命令，移除自动置顶设置

Rust 侧新增窄命令，只负责对指定允许列表窗口执行 `show + set_focus`。番茄结束动作为 `topWindow` 时调用该命令聚焦主番茄钟窗口；专注自然结束时额外聚焦打卡计划编辑窗口。今日打卡窗口默认非置顶，打开时只显示，不抢永久置顶层级。

优点是语义清楚：pin 仍代表用户手动长期置顶，临时提醒走独立路径，不污染 `isPinned`。同时跨平台表面一致，macOS 和 Windows 都复用 Tauri `show/set_focus`，失败时只降级为现有前端提示。

### 备选方案 A：继续复用 `isPinned`

专注结束时先 pin，几秒后自动 unpin。实现少，但会和用户手动 pin 冲突，需要记录并恢复先前 pin 状态，窗口层级也会闪烁，测试复杂度高。

### 备选方案 B：只显示前端浮层

保留当前 `PomodoroEndActionLayer` 的顶部提示，不改变窗口焦点。实现最轻，但无法满足“把计划窗口和番茄钟设置为聚焦窗口”的要求。

采用推荐方案。

## Pencil 设计

修改 `AUI/PUI.pen` 的 `Global Settings Panel` (`Pdj9C`)：

- 删除 `显示打开的文件名` 对应行。如果设计中找不到该行，确认无需新增或保留替代项。
- 删除 `专注结束后自动置顶` 行 `gspAutoPinOnFocusEnd`，因为该行为不再是用户可配置的长期置顶设置。
- 保持 `界面缩放`、`开机自启动`、`每日计划`、`自动下载并安装更新`、`按键计数` 等现有行的顺序和样式。

今日打卡和计划编辑的视觉结构不改。它们的变化是窗口行为，不需要在 `KB3Vp` 或 `s6g1w` 增加可见控件。

## 设置与持久化

从 `SettingsState`、settings-window mirror store、`PersistedSettingsSnapshot` 和 `settingsPersistence` 中移除 `showActiveAppWindowTitle` 与 `autoPinOnFocusEnd`。

读取旧 `settings.json` 时忽略这两个字段，不报错、不迁移、不写回。写入新设置时只包含仍有效的全局设置，例如 `uiScale` 和 `autostartEnabled`。云设置同步中的旧字段也应在构建客户端快照时停止发送，服务端若已有旧数据则由兼容读取路径自然忽略。

`SettingsPanel` 的全局 tab 删除两张卡片：

- `显示打开的文件名`
- `专注结束后自动置顶`

## 输入计数面板

`InputCounterPanel` 不再读取全局标题显示开关。显示规则固定为：

```ts
activeApp?.name?.trim() || '未聚焦应用'
```

如果 native 仍提供 `window_title`，前端忽略该字段。native active-app 结构可以暂时保留 `window_title` 字段，避免扩大 Rust 平台改动；本次只移除用户设置和 UI 行为。

## 临时聚焦行为

新增前端 helper，例如 `focusAppWindow(label)`，内部调用新的 Tauri command。允许聚焦的标签只包括本次需要的窗口：

- `main`
- `checkin-editor`

Rust command 使用 allowlist，避免从前端传入任意窗口标签。实现为在主线程获取窗口、必要时 `show()`，然后 `set_focus()`。不要调用 `set_always_on_top` 或 native always-on-top helper。

番茄结束处理：

- `PomodoroEndActionLayer` 在 `topWindow` 结果时聚焦 `main`，同时保留现有 4 秒提示文案。
- 视频模式仍优先打开视频窗口，不额外聚焦 `main`。
- 视频打开失败时回退为 `topWindow`：显示提示并聚焦 `main`。
- 休息结束和全部完成继续显示现有提示；它们也可以聚焦 `main`，使“计时结束”语义覆盖所有非视频结束事件。

专注结束与计划窗口：

- 当 `lastEndEvent` 满足 `fromPhase === 'focus'`, `toPhase === 'break'`, `triggeredBy === 'timer'` 时，打开并聚焦 `checkin-editor`。
- 手动跳过专注不打开计划窗口。
- 该动作不改变今日打卡记录和计划数据；它只把计划编辑窗口带到前台。
- 如果计划窗口打开失败，记录 warning，不阻塞番茄状态切换和今日打卡自动完成。

主窗口 pin：

- 保留番茄钟面板上的手动 pin 按钮和 `set_main_window_pinned` 命令。
- 自动行为不再调用 `setPinned(true)`，也不改变 pin 按钮状态。
- 用户已经手动 pin 时，临时聚焦仍可执行，但不会取消或重设 pin。

## 今日打卡窗口

`today-checkin` hidden builder 默认 `always_on_top(false)`，不调用 native always-on-top helper。`open_today_checkin_window` 只显示窗口，不设置长期置顶，也不强制 focus，避免启动时抢焦点。

`checkin-editor` hidden builder 也默认非 always-on-top。`open_checkin_editor_window` 显示并聚焦窗口，但不置顶。专注结束时复用同一路径。

## 错误处理

- 聚焦命令找不到窗口时返回错误，前端 catch 后 `console.warn`。
- `set_focus` 被操作系统拒绝时不重试、不改 pin 状态，保留前端提示。
- 旧设置文件含废弃字段时静默忽略。
- mirror window 还没 ready 时，专注结束聚焦逻辑仍从主窗口执行，不依赖 bridge。

## 测试计划

Pencil：

- `Global Settings Panel` 不再包含 `显示打开的文件名`。
- `Global Settings Panel` 不再包含 `专注结束后自动置顶` 或 `gspAutoPinOnFocusEnd`。

Settings / persistence：

- `SettingsPanel` 全局 tab 不渲染两个废弃设置。
- settings store 和 bridge snapshot 不包含 `showActiveAppWindowTitle`、`autoPinOnFocusEnd`。
- 读取含旧字段的 persisted settings 时正常 hydrate，并在下一次保存时不写回旧字段。

Input counter：

- active app 同时有 `name` 和 `window_title` 时，面板显示 app name。
- 没有 app name 时显示 `未聚焦应用`。

Pomodoro / focus integration：

- `topWindow` 动作会调用聚焦主窗口 helper 并显示提示。
- 视频动作成功时不聚焦主窗口。
- 视频动作失败时回退聚焦主窗口并显示提示。
- 专注自然结束会打开并聚焦 `checkin-editor`。
- 手动 skip 不打开计划窗口。
- 自动结束不再调用 `setPinned(true)`。

Tauri window config：

- `today-checkin` 和 `checkin-editor` builder 不设置 always-on-top。
- 打开今日打卡窗口不调用 `set_focus` 或 always-on-top helper。
- 打开计划编辑窗口调用 `set_focus` 但不置顶。
- 新聚焦 command 只允许 `main` 和 `checkin-editor`。

验证命令：

```bash
cd app && npm test
cd app && npm run build
cd app/src-tauri && cargo check
```

## 验收标准

1. 全局设置中没有 `显示打开的文件名`。
2. Pencil 的全局设置面板中没有对应设计项。
3. 全局设置中没有 `专注结束后自动置顶`。
4. 今日打卡窗口不再默认置顶，也不在启动时抢焦点。
5. 专注自然结束时，打卡计划窗口被打开并聚焦。
6. 番茄钟结束动作选择 `弹窗到顶部` 时，番茄钟主窗口被聚焦，但 pin 状态不变。
7. 手动 pin 仍按原逻辑提供长期置顶。
8. 旧设置文件继续可读，废弃字段被忽略。

## 自检

- Placeholder scan: 无 TBD、TODO 或空章节。
- Internal consistency: 自动置顶设置被移除，临时聚焦由独立 command 实现，pin 只保留手动语义。
- Scope check: 这是一次设置清理和窗口行为调整，不包含服务器模型重构或计时规则变更。
- Ambiguity check: “计时结束”在非视频结束动作中聚焦主窗口；“计划窗口”明确为 `checkin-editor`；“今日打卡不需要置顶”明确为不 always-on-top 且启动不抢焦点。
