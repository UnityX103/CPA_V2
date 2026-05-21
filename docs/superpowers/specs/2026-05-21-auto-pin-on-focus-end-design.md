# 专注结束后自动置顶设计

**日期**: 2026-05-21
**范围**: `AUI/PUI.pen`, `app/src/domain/{settings,pomodoro,settingsPersistence}.ts`, `app/src/domain/bridge/{protocol,host}.ts`, `app/src/App.tsx`, `app/src/ui/SettingsPanel.tsx`, 相关测试
**不在范围**: Server、番茄钟计时规则、休息结束自动开始下一轮、native 置顶 command 重写

## 目标

当前专注计时自然结束后，番茄钟会进入休息阶段。默认情况下，主窗口要自动置顶，并把主窗口上的置顶 pin 标签设置为激活状态。这样用户休息回来时，番茄钟仍在前方，便于手动开始下一轮专注。

该行为可以在全局设置中关闭，默认开启。关闭后，专注结束仍按现有规则进入休息阶段，但不会自动改变 pin 状态，也不会主动置顶窗口。

## 方案选择

推荐方案：在前端状态层处理自动 pin。

- `Pomodoro` store 继续持有 `isPinned` 作为 pin UI 和 native 置顶副作用的唯一来源。
- `App.tsx` 订阅 `lastEndEvent`。当事件满足 `fromPhase === 'focus'`, `toPhase === 'break'`, `triggeredBy === 'timer'`，并且全局设置开启时，把 `isPinned` 设置为 `true`。
- 现有 `PomodoroPanel` 已经监听 `isPinned` 并调用 `set_main_window_pinned`，所以自动 pin 复用同一条 native 路径。

备选方案 A：在 Rust/Tauri 层新增“专注结束置顶” command。缺点是 native 层不知道番茄钟状态，仍要由前端转发事件，职责更分散。

备选方案 B：在 `PomodoroPanel` 内直接监听 `lastEndEvent` 并 invoke native command。缺点是 pin 按钮视觉状态和真实置顶状态会出现两个来源，容易回归到“窗口置顶但标签未激活”的状态。

因此采用推荐方案。

## Pencil 设计

修改 `AUI/PUI.pen` 中的 `Global Settings Panel` (`Pdj9C`)。

- 新增一行全局设置，命名为 `gspAutoPinOnFocusEnd`。
- 文案为 `专注结束后自动置顶`。
- 右侧使用现有 `Toggle Switch` (`NGo9f`)。
- 默认视觉为开启状态。
- 推荐位置：紧跟 `gspAutostart`，放在现有 `gspDailyPlan` 和 `gspAutoUpdate` 之前。它与开机自启动、自动更新都属于全局自动化行为，放在一起最容易理解。
- 使用现有普通全局设置行样式：`cornerRadius: 16`, `fill: #F6F7F8`, `justifyContent: space_between`, `alignItems: center`, `padding: 16`, `width: fill_container`。

如果当前 Pencil 中已有仅设计稿使用但前端暂未实现的全局行，不删除它们；只新增本次需要的行并保持布局顺序清晰。

## 状态与持久化

在 `settings.ts` 增加：

- `autoPinOnFocusEnd: boolean`
- `setAutoPinOnFocusEnd(enabled: boolean)`

默认值为 `true`，主窗口 store 和 settings-window store 保持一致。settings-window 里的 setter 通过 bridge dispatch 到主窗口；主窗口 setter 立即更新状态并写入 `settings.json`。

`settingsPersistence.ts` 保持 v1 结构兼容，新增可选字段：

- 读取旧文件时，如果缺少 `autoPinOnFocusEnd`，按 `true` 处理。
- 写入时包含 `autoPinOnFocusEnd`。
- 既有字段 `uiScale`, `showActiveAppWindowTitle`, `autostartEnabled` 语义不变。

`App.tsx` 启动 hydration 需要把 persisted/default 值纳入启动快照。任何保存全局设置的路径都要带上当前 `autoPinOnFocusEnd`，避免修改其它全局开关时把该值丢回默认值。

## Pomodoro Pin 行为

在 `pomodoro.ts` 增加一个显式 action：

- `setPinned(isPinned: boolean)`

`togglePin` 继续供按钮点击使用；自动置顶逻辑使用 `setPinned(true)`，避免通过 toggle 造成已置顶时被反向取消。

触发条件：

- 只在 `triggeredBy === 'timer'` 的专注结束事件触发。
- 手动点击 `跳过` 从专注进入休息不触发自动置顶。
- 从休息进入下一轮专注、进入 completed 阶段不触发。
- 如果当前已经 `isPinned === true`，`App.tsx` 的订阅逻辑直接返回，不重复写状态，也不额外触发 native invoke。

关闭设置后不主动取消当前 pin。关闭开关只影响未来的专注结束事件；用户若想取消当前置顶，仍用主窗口 pin 按钮。

## Bridge 与 Settings UI

`BridgeSnapshot.settings` 增加 `autoPinOnFocusEnd`，settings window 镜像后能显示真实状态。

`DispatchPayload` 增加：

```ts
{ v: BRIDGE_VERSION; store: 'settings'; action: 'setAutoPinOnFocusEnd'; args: [boolean] }
```

`applyDispatch` 调用主窗口 settings store 的 `setAutoPinOnFocusEnd`。

`GlobalTab` 新增一张普通卡片行：

- label: `专注结束后自动置顶`
- toggle: `checked={settings.autoPinOnFocusEnd}`
- `onChange={settings.setAutoPinOnFocusEnd}`
- `ariaLabel="专注结束后自动置顶"`

该设置和“显示打开的文件名”“开机自启动”一样立即生效，不走底部 Apply。

## 错误处理

自动 pin 本身只改前端 `isPinned`。native 置顶仍由 `PomodoroPanel` 的既有 effect 调用 `set_main_window_pinned`。

- native command 失败：沿用现有 console error 行为，不回滚 pin UI。
- settings 持久化失败：沿用 `settingsPersistence` 的 console warn，不阻塞 UI。
- settings window 未打开：bridge 不参与触发逻辑，主窗口状态仍可正常自动 pin。

## 测试计划

Pencil / UI：

- `AUI/PUI.pen` 的 `Pdj9C` 包含 `专注结束后自动置顶` 行，位置在全局自动化设置组内。
- `SettingsPanel` 渲染全局 tab 时显示该文案。
- 点击 toggle 会调用 `setAutoPinOnFocusEnd`，settings-window 模式下会 dispatch 到主窗口。

Settings / persistence：

- `autoPinOnFocusEnd` 默认 `true`，主窗口和 settings-window store 都一致。
- hydration 读取缺失字段的旧设置时默认 `true`。
- hydration 读取 `false` 时保持 `false`。
- `setAutoPinOnFocusEnd(false)` 更新状态并持久化所有全局设置字段。
- 修改其它全局设置时不会丢失当前 `autoPinOnFocusEnd`。

Pomodoro / App integration：

- 专注自然结束且设置开启时，`isPinned` 变为 `true`。
- 专注自然结束但设置关闭时，`isPinned` 保持不变。
- 手动 `skip` 从专注进入休息时不自动 pin。
- 已经 pin 时，专注结束不重复触发状态变化。
- `PomodoroPanel` 现有 pin command 测试继续覆盖 `isPinned -> set_main_window_pinned` 的 native 同步。

验证命令：

```bash
cd app && npm test
cd app && npm run build
```

本功能不新增 Rust command，通常不需要额外 Rust 单测；若实现过程触碰 `src-tauri/`，再补 `cd app/src-tauri && cargo check`。

## 验收标准

1. 新用户默认开启 `专注结束后自动置顶`。
2. 专注自然结束进入休息后，主窗口 pin 标签自动变为激活，窗口进入置顶状态。
3. 用户关闭全局设置后，后续专注自然结束不会自动激活 pin。
4. 关闭设置不会立即取消当前置顶。
5. 手动跳过专注不会触发自动置顶。
6. 旧的 `settings.json` 不需要迁移脚本，缺失字段自动按开启处理。
