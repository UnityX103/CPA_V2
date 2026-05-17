# 主窗口置顶由 HApJ0 控制 — 修复设计

- **日期**: 2026-05-16
- **作者**: Codex
- **状态**: 用户已批准设计方向，等待书面 spec review
- **范围**: `app/src-tauri/tauri.conf.json`, `app/src-tauri/src/lib.rs`, `app/src/ui/PomodoroPanel.tsx`, 相关前端测试
- **不在范围**: Settings 面板视觉、Pencil 节点重排、Server、active app / key counter 行为

## 1. 问题与目标

当前 CPA_V2 的桌宠窗口会一直置顶。根因有三处：

1. `tauri.conf.json` 的 `main` window 声明了 `alwaysOnTop: true`。
2. `lib.rs::setup` 启动时再次对 `main` 调 `set_always_on_top(true)`。
3. `build_settings_window_hidden` 创建 settings window 时也设置 `.always_on_top(true)`。

与此同时，Pencil 节点 `HApJ0` 对应的 Pomodoro pin button 只切换 `pomodoro.isPinned` UI 状态，并没有成为 native 窗口置顶的唯一来源。

本次目标：

- 启动后没有窗口默认置顶。
- 只有 `HApJ0` 打开时，主番茄窗口置顶。
- `HApJ0` 关闭时，主番茄窗口取消置顶。
- Settings 窗口不受 `HApJ0` 影响，也不默认置顶；它可以被其他 app 覆盖。
- 前端不能再通过通用 command 任意设置当前窗口置顶，只能请求 Rust 控制 `main` window。

## 2. 方案

采用 Rust 侧集中管理的收窄 command。

### 2.1 新增主窗口专用 command

在 `app/src-tauri/src/lib.rs` 中新增：

```rust
#[tauri::command]
fn set_main_window_pinned(app: tauri::AppHandle, on_top: bool) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    main.set_always_on_top(on_top).map_err(|e| e.to_string())
}
```

语义：

- command 内部固定查找 `main`，前端不传 window label。
- `on_top=true` 只置顶主窗口。
- `on_top=false` 只取消主窗口置顶。
- 如果主窗口不存在，返回明确错误并由前端记录。

保留或删除现有 `set_always_on_top(window, on_top)` 取决于实现时是否还有调用方。若无调用方，删除它并从 `invoke_handler` 移除，避免以后再次绕过主窗口边界。

### 2.2 去掉默认置顶来源

改动：

- `app/src-tauri/tauri.conf.json`: 移除 `main` window 的 `"alwaysOnTop": true`，或显式改成 `false`。
- `app/src-tauri/src/lib.rs::setup`: 删除启动时的 `window.set_always_on_top(true)`。
- `build_settings_window_hidden`: 删除 settings window builder 的 `.always_on_top(true)`。

这些改动让窗口层级的初始状态回到系统默认。置顶状态只来自 `set_main_window_pinned(true)`。

### 2.3 前端由 `isPinned` 驱动 native 状态

`PomodoroPanel` 保留现有点击路径：

```tsx
const onTogglePin = () => usePomodoroStore.getState().togglePin();
```

新增一个监听 `state.isPinned` 的 effect：

```tsx
useEffect(() => {
    void invoke('set_main_window_pinned', { onTop: state.isPinned })
        .catch((error) => console.error('[pin] set_main_window_pinned failed', error));
}, [state.isPinned]);
```

注意：

- React/Tauri 的参数名使用 camelCase `onTop`，对应 Rust `on_top`。
- native 调用失败时不回滚 `isPinned`，只记录错误。窗口生命周期或平台 API 失败属于 native 故障，回滚 UI 会造成闪烁和不稳定感。
- settings window 的 pomodoro store stub 继续保持 `togglePin: () => {}`，settings UI 不渲染 `HApJ0`，因此不会触发主窗口置顶。

## 3. 数据流

```text
用户点击 HApJ0
  -> PomodoroPanel.onTogglePin()
  -> usePomodoroStore.togglePin()
  -> isPinned 翻转，按钮视觉更新
  -> PomodoroPanel useEffect 观察到 isPinned
  -> invoke('set_main_window_pinned', { onTop: isPinned })
  -> Rust 查找 main window
  -> main.set_always_on_top(isPinned)
```

反向没有 native 事件同步。当前设计把 `isPinned` 作为前端状态源，native 层只是执行窗口层级副作用。

## 4. 错误处理

- `main window not found`: command 返回 `Err`；前端 console 记录，UI 不回滚。
- `set_always_on_top` 平台失败: command 返回底层错误；前端 console 记录，UI 不回滚。
- settings window 打开或关闭不改变 pin 状态；settings window 也不尝试恢复自己的 always-on-top。

## 5. 测试计划

### 5.1 前端行为测试

在 `PomodoroPanel` 相关测试中 mock `@tauri-apps/api/core` 的 `invoke`：

- 渲染 `PomodoroPanel` 后，点击 `aria-label="置顶"`，断言调用：
  `invoke('set_main_window_pinned', { onTop: true })`
- 再次点击同一按钮，断言调用：
  `invoke('set_main_window_pinned', { onTop: false })`

如果组件挂载时 effect 会用默认 `false` 调一次，可以在断言里明确区分“初始化同步”和“用户点击后的翻转调用”，不要让测试依赖调用序号过脆。

### 5.2 默认置顶回归测试

新增轻量源码/配置守护测试，避免默认置顶回潮：

- 解析 `app/src-tauri/tauri.conf.json`，断言 `main` window 没有 `alwaysOnTop: true`。
- 检查 `app/src-tauri/src/lib.rs` 不再包含 settings builder 的 `.always_on_top(true)`。
- 检查 `setup` 不再包含无条件 `set_always_on_top(true)`。

这些测试不是业务逻辑测试，但正好覆盖本次故障根源。

### 5.3 编译验证

最小验证：

- `cd app && npm test`
- `cd app && npm run build`
- `cd app/src-tauri && cargo check`

若本机 `cargo` 不在 PATH，使用：

```bash
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
```

## 6. 验收标准

1. 冷启动后，主番茄窗口不会压住其他 app。
2. 冷启动后，settings 窗口不会压住其他 app。
3. 点击 `HApJ0` 点亮 pin 后，主番茄窗口置顶。
4. 再次点击 `HApJ0` 取消 pin 后，主番茄窗口可被其他 app 覆盖。
5. 打开 settings 窗口时，settings 窗口不因 `HApJ0` 状态而置顶。
6. 现有透明 hit-test / passthrough 行为不变。

## 7. 明确不做

- 不新增 settings window 的独立 pin 按钮。
- 不把 pin 状态持久化到本地存储。
- 不改变 `HApJ0` 的视觉设计或 Pencil 节点结构。
- 不改变 accessibility 权限申请流程中临时让位的语义；实现时只需确保它不再假定启动默认置顶。
