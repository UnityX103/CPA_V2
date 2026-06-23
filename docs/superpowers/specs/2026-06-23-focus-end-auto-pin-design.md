# 专注结束后自动置顶设计

**日期**: 2026-06-23
**范围**: `app/src/domain/{settings,settingsPersistence,userPreferences,cloudAccountData}.ts`, `app/src/domain/bridge/{protocol,host,client}.ts`, `app/src/App.tsx`, `app/src/ui/SettingsPanel.tsx`, 相关测试
**不在范围**: `AUI/PUI.pen`, `Server/`, Rust/Tauri native command 重写、番茄钟计时规则、房间远端状态同步、业务实现代码

## 目标

当一次专注计时自然结束并进入休息阶段时，主番茄钟面板自动打开置顶 pin 标签，并保持置顶，直到用户手动点击主面板 pin 标签关闭。

该行为默认开启。用户可以在番茄钟设置页关闭 `专注结束后自动置顶`。关闭后，后续专注自然结束仍会进入休息阶段并执行现有结束提示逻辑，但不会自动改变 pin 状态。

## 当前上下文

`pomodoro.ts` 已经提供自动置顶所需的核心状态:

- `lastEndEvent` 记录阶段结束事件，包含 `fromPhase`, `toPhase`, `triggeredBy`。
- 自然计时结束的专注完成事件为 `fromPhase === 'focus'`, `toPhase === 'break'`, `triggeredBy === 'timer'`。
- 手动跳过专注进入休息时，`triggeredBy === 'skip'`。
- `isPinned` 是主番茄钟 pin 标签和 native 窗口置顶的前端状态源。
- `setPinned(isPinned)` 已经可以显式设置 pin 状态，避免自动逻辑误用 `togglePin()` 造成反向取消。

`PomodoroPanel.tsx` 已经监听 `isPinned` 并调用 `set_main_window_pinned`:

```ts
void invoke('set_main_window_pinned', { onTop: state.isPinned })
```

因此本功能不需要新增 Rust command，也不应绕过 `isPinned` 直接调用 native API。

`App.tsx` 已经订阅 `lastEndEvent` 做专注结束副作用，包括打卡计数和自然结束时唤起今日打卡面板。自动 pin 应放进同一条主窗口事件订阅流，作为本机窗口副作用处理。

## 方案选择

采用前端状态层自动 pin。

1. 在 `settings` store 增加 `autoPinOnFocusEnd: boolean` 和 `setAutoPinOnFocusEnd(enabled: boolean)`。
2. 在番茄钟设置页增加 `专注结束后自动置顶` Toggle。
3. 在 `App.tsx` 的 `lastEndEvent` 订阅里，当事件满足触发条件并且设置开启时调用 `usePomodoroStore.getState().setPinned(true)`。
4. 继续由 `PomodoroPanel` 的既有 effect 把 `isPinned` 同步到 native `set_main_window_pinned`。

备选方案 A 是把设置放回全局设置页，沿用旧的 2026-05-21 设计方向。它能工作，但用户这次明确要求在番茄钟设置内关闭，且该行为与 `自动开始休息` 一样属于番茄钟阶段切换行为。

备选方案 B 是把自动置顶绑定到 `endActionMode === 'topWindow'`。这会把短暂结束提示、视频播放策略和持久在线 pin 混在一起，用户也无法独立关闭自动 pin。

## 用户行为

默认状态:

- 新用户和旧数据缺失该字段的用户，`autoPinOnFocusEnd` 默认为 `true`。
- `isPinned` 仍默认为 `false`，不随启动持久恢复。

触发条件:

```ts
event.fromPhase === 'focus'
    && event.toPhase === 'break'
    && event.triggeredBy === 'timer'
    && useSettingsStore.getState().autoPinOnFocusEnd
```

触发结果:

- 调用 `usePomodoroStore.getState().setPinned(true)`。
- 如果当前已经 pinned，`setPinned(true)` 保持 no-op，不产生反向切换。
- `PomodoroPanel` 观察到 `isPinned === true` 后继续走现有 native 置顶路径。

保持与关闭边界:

- 自动 pin 后，不因休息结束、下一轮开始、番茄钟完成、设置项关闭、设置窗口关闭或今日打卡面板关闭而自动取消。
- 只有用户点击主番茄钟面板的 pin 标签时，才取消当前置顶状态。
- 关闭 `专注结束后自动置顶` 只影响未来的专注结束事件，不会取消当前已经开启的 pin。
- 手动点击 `跳过` 从专注进入休息不触发自动 pin。
- 从休息进入下一轮专注、从休息进入 completed、手动重置都不触发自动 pin。

## 设置 UI

设置项放在 `SettingsPanel.tsx` 的 `PomodoroTab` 中:

- 文案: `专注结束后自动置顶`
- 控件: 现有 `Toggle`
- 位置: `自动开始休息` 下方，`计时结束提示` 上方
- 行为: 切换后立即保存，不走底部 `应用` 按钮

该设置不改变当前倒计时参数，不需要重置番茄钟进度。它是一个即时生效的行为偏好，和全局 tab 中的模块开关一样通过 store action 立即生效。

settings-window 模式下，setter 通过 bridge dispatch 到主窗口。主窗口是该设置的权威状态源，更新后通过 bridge snapshot 回写镜像窗口。

## 状态与持久化

`settings.ts`:

- `SettingsState` 增加 `autoPinOnFocusEnd: boolean`。
- `PersistedSettingsSnapshot` 增加可选 `autoPinOnFocusEnd?: boolean`，用于兼容旧数据。
- 主窗口和 settings-window store 默认值均为 `true`。
- 主窗口 `setAutoPinOnFocusEnd` 更新状态并调用 `savePersistedSettings`。
- settings-window `setAutoPinOnFocusEnd` 只 dispatch，不直接修改本地权威状态。
- `hydrateSettings` 读取缺失字段时回退到 `true`。

`settingsPersistence.ts`:

- `PersistedSettings` 和 v1 payload 增加 `autoPinOnFocusEnd`。
- 读取旧 v1 文件缺失字段时返回 `true`。
- 读取 malformed `autoPinOnFocusEnd` 时视为 malformed settings，保持当前严格校验风格。
- 保存时写入 `autoPinOnFocusEnd`。
- 旧的 `obsoleteAutoPinOnFocusEnd` 兼容断言需要更新: 该字段不再是 obsolete 字段，而是正式设置字段。

`userPreferences.ts` 和云端账户数据:

- `UserPreferencesSnapshot.settings` 增加 `autoPinOnFocusEnd`。
- `defaultUserPreferencesSnapshot()` 默认 `true`。
- `buildUserPreferencesSnapshot()` 保存当前设置值。
- `hydrateUserPreferencesSnapshot()` 通过 `hydrateSettings()` 应用该设置。
- `normalizeUserPreferencesSnapshot()` 对旧快照缺失字段默认 `true`，对 false 保持 false。
- `cloudAccountData` 相关类型、normalize、测试数据同步加入该字段，保证本地归档和云端账户设置一致。

`isPinned` 不持久化。重启后窗口 pin 仍按现有默认行为恢复为未置顶；只有 `autoPinOnFocusEnd` 偏好持久化。

## Bridge 与镜像窗口

`bridge/protocol.ts`:

- `BridgeSnapshot.settings` 增加 `autoPinOnFocusEnd`。
- `DispatchPayload` 的 settings boolean action 增加 `setAutoPinOnFocusEnd`。

`bridge/host.ts`:

- `buildSnapshot()` 包含 `autoPinOnFocusEnd`。
- `applyDispatch()` 路由 `setAutoPinOnFocusEnd` 到主窗口 settings store。
- `settingsSig()` 包含该字段，确保镜像窗口收到更新。

`bridge/client.ts`:

- `applySnapshotToMirrors()` 把 `autoPinOnFocusEnd` 写入 settings-window mirror store。

旧测试中断言 `('autoPinOn' + 'FocusEnd') in snap.settings` 或 store 为 false 的用例应删除或改为断言新字段存在且值正确。

## App 事件流

在 `App.tsx` 的 `usePomodoroStore.subscribe` 回调中，保留现有打卡逻辑，并增加自动 pin 分支。

推荐结构:

1. 读取新 `lastEndEvent`，忽略空事件和重复对象。
2. 如果 `event.fromPhase === 'focus'`，继续执行现有打卡逻辑，仍受 `settings.checkinEnabled` 控制。
3. 如果事件同时满足自然专注结束进入休息，并且 `settings.autoPinOnFocusEnd` 开启，则调用 `setPinned(true)`。
4. 今日打卡面板的 `raiseTodayCheckinWindow()` 继续只受 `checkinEnabled` 和自然结束条件影响。

自动 pin 不应依赖 `checkinEnabled`。用户关闭打卡系统后，专注结束仍应按 `autoPinOnFocusEnd` 设置自动 pin。

## 与结束提示的关系

`PomodoroEndActionLayer.tsx` 继续负责结束提示、视频播放、fallback top popup 和 4 秒短提示。

自动 pin 是独立的持久在线状态:

- `endActionMode === 'playVideo'` 时，专注结束可以播放视频，同时主窗口 pin 自动打开。
- `endActionMode === 'topWindow'` 时，短提示仍按原逻辑显示，主窗口 pin 自动打开后保持。
- 结束提示失败或视频 fallback 不影响 `setPinned(true)` 的状态决策。

## Native 与平台限制

本功能不新增 Rust/Tauri command。

主窗口置顶继续走现有链路:

```text
App focus-end subscription
  -> pomodoro.setPinned(true)
  -> PomodoroPanel observes isPinned
  -> invoke('set_main_window_pinned', { onTop: true })
  -> Rust set_main_window_pinned
  -> platform window helper
```

错误处理沿用现有策略:

- native 置顶失败时，`PomodoroPanel` 记录 console error，不回滚 pin UI。
- settings 保存失败时，沿用 `settingsPersistence` 的 console warn，不阻塞 UI。
- settings window 未打开时，主窗口状态仍可自动 pin。
- Windows/macOS 平台差异由现有 `set_main_window_pinned` 和 `window_helpers` 处理。

## 远端同步

`stateSync.ts` 的 `RemoteState` 不增加 pin 字段。

原因:

- pin 是本机窗口层级状态，不是番茄钟进度状态。
- 自动 pin 设置是个人偏好，不应广播给同房间成员。
- 房间成员只需要继续看到 phase、remainingSeconds、round 和 running 状态。

## 测试计划

Settings store:

- 默认 `autoPinOnFocusEnd` 为 `true`，主窗口和 settings-window store 一致。
- `hydrateSettings` 缺失字段默认 `true`。
- `hydrateSettings` 读取 `false` 时保持 `false`。
- `setAutoPinOnFocusEnd(false)` 更新主窗口状态并持久化完整 settings snapshot。
- settings-window `setAutoPinOnFocusEnd(false)` dispatch 到主窗口，不直接本地突变。

Settings persistence:

- 读取旧 v1 settings 缺失字段时默认 `true`。
- 读取 `autoPinOnFocusEnd: false` 时保持 false。
- malformed `autoPinOnFocusEnd` 返回 null。
- 保存 settings 时包含 `autoPinOnFocusEnd`。
- 移除或更新 obsolete auto-pin 字段断言。

User preferences and cloud data:

- 默认用户偏好 snapshot 包含 `autoPinOnFocusEnd: true`。
- build snapshot 保存当前值。
- normalize 旧 snapshot 缺失字段默认 true，false 保持 false。
- hydrate 应用该字段。
- cloud account data 读写测试样本包含该字段。

Bridge:

- `BridgeSnapshot.settings` 类型样本包含 `autoPinOnFocusEnd`。
- `DispatchPayload` 接受 `setAutoPinOnFocusEnd`。
- host snapshot 输出该字段。
- host dispatch 路由到 settings store。
- `settingsSig` 包含该字段。
- client mirror 应用该字段。
- 删除旧的“不包含 autoPinOnFocusEnd”断言。

Settings UI:

- Pomodoro tab 渲染 `专注结束后自动置顶`。
- 该行位于 `自动开始休息` 与 `计时结束提示` 之间。
- 点击 Toggle 调用 `setAutoPinOnFocusEnd`。
- 该设置不影响底部 Apply dirty 状态。

App integration:

- 设置开启时，专注自然结束进入休息调用 `setPinned(true)`，最终 `isPinned` 为 true。
- 设置关闭时，同样事件不调用 `setPinned(true)`，`isPinned` 保持原值。
- 手动 skip 从专注进入休息不自动 pin。
- 已经 pinned 时自然结束不反向取消。
- `checkinEnabled === false` 时仍可自动 pin，但不写打卡记录、不唤起打卡面板。
- 现有打卡计数和今日打卡面板 raise 行为不回归。

PomodoroPanel:

- 现有 `isPinned -> set_main_window_pinned` 测试继续覆盖 native 同步。
- 如实现未触碰 Rust，不需要新增 Rust 单测。

验证命令:

```bash
cd app && npm test
cd app && npm run build
```

如果实现触碰 `src-tauri/`，再补:

```bash
cd app/src-tauri && cargo check
```

## 验收标准

1. 新用户默认开启 `专注结束后自动置顶`。
2. 番茄钟设置页显示该 Toggle，且用户可以关闭。
3. 专注自然结束进入休息时，主面板 pin 标签自动开启，窗口置顶。
4. 自动开启后，窗口保持置顶，直到用户手动关闭 pin。
5. 关闭设置只影响未来专注结束事件，不取消当前 pin。
6. 手动跳过专注不触发自动 pin。
7. `isPinned` 不持久化，`autoPinOnFocusEnd` 偏好本地和云端持久化。
8. 房间远端状态不包含 pin 或该偏好。
9. 不新增 native command，不改变透明窗口 hit-test 或鼠标穿透策略。

## 后续实现边界

实现阶段应只修改上面列出的前端状态、设置 UI、bridge、偏好持久化和测试文件。

不要修改 `AUI/PUI.pen`、`Server/`、发布配置、Tauri capability、native window command 或无关 UI 结构。若实现时发现 Pencil 源需要更新，应先回到设计/视觉流程另行确认。
