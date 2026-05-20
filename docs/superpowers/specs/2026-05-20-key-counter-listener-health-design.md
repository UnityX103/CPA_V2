# key_counter 监听健康检查与自恢复设计

**日期**：2026-05-20
**模块**：`app/src-tauri/src/accessibility/`、`app/src-tauri/src/key_counter.rs`、`app/src/domain/bindingKey.ts`、`app/src/ui/SettingsPanel.tsx`
**关联**：`docs/superpowers/specs/2026-05-16-key-counter-accessibility-permission-design.md`、`docs/superpowers/specs/2026-05-18-input-counter-panel-regression-design.md`

## 背景

当前安装包 `/Applications/桌宠番茄钟.app` 是用户电脑上正在运行的新版本，版本号 `0.1.1`。用户已经在 macOS 授予辅助功能权限，但在设置页绑定按键计数时仍无法监听输入。

现有实现已经有权限闸门：

- `accessibility_status` 通过 `AXIsProcessTrusted` 判断 macOS 辅助功能权限。
- 权限为 true 时，`ListenerHandle::ensure_running` 调用 `key_counter::spawn_listener`。
- `key_counter.rs` 用 `CGEventTap` 监听 `KeyDown`，然后 emit `key-pressed`。
- 前端 `useBindingKeyListener` 收到 `key-pressed` 后完成绑定或累加计数。

问题在于，UI 目前只展示“是否授予权限”，没有展示“listener 是否真的启动成功”。如果 macOS TCC 显示已授权，但 `CGEventTap` 创建失败、listener 线程提前退出、授权对象与当前运行二进制身份不一致，用户看到的仍是“已授权但没反应”。

## 目标

- 把按键监听拆成两个可观察状态：`permissionGranted` 与 `listenerRunning/listenerError`。
- 当权限已授予但 listener 没跑起来时，前端显示明确的故障状态，而不是静默失败。
- 在权限翻转、用户点击重试、应用恢复前台时，能安全重试启动 listener。
- 保持现有 `key-pressed` 事件和 `BindingKeyStore` 的业务语义不变。
- 为当前 macOS 安装包场景提供足够诊断信息，尤其是 bundle identifier、签名 identifier、executable path、最近一次启动错误。

## 非目标

- 不在本次设计里重做按键计数 UI。
- 不把 `key_counter` 改成业务层轮询键盘状态。
- 不引入整窗 `set_ignore_cursor_events` 或改变透明窗口命中测试策略。
- 不在本次设计里直接切换发布签名方案；签名/TCC 身份问题先通过诊断暴露，后续若证实再单独处理。
- 不改变 Windows 的全局键盘 hook 目标；Windows 只保留同一命令面所需的健康状态占位。

## 默认方案

采用“健康检查 + 自恢复 + 诊断信息”的方案。

另外两个备选方案被排除：

- 只让用户重置系统辅助权限：最小，但无法解释已授权仍失败，也不能避免后续复发。
- 直接改发布签名：可能是根因之一，但没有运行时证据前风险较高，而且不能覆盖 listener 线程提前退出等非签名原因。

## 架构

### Rust 侧

新增 `KeyCounterHealth`，由 `accessibility` 模块持有并通过 Tauri command 暴露：

```ts
type KeyCounterHealth = {
  permissionGranted: boolean;
  platform: 'macos' | 'windows' | 'other';
  listenerRunning: boolean;
  lastStartError: string | null;
  lastStartedAtMs: number | null;
  lastStoppedAtMs: number | null;
  bundleIdentifier: string | null;
  executablePath: string | null;
  codeSignIdentifier: string | null;
};
```

命令面：

- `key_counter_health() -> KeyCounterHealth`
- `restart_key_counter_listener() -> KeyCounterHealth`

事件：

- `key-counter-health-changed`：payload 为 `KeyCounterHealth`

`ListenerHandle` 从只保存 `Option<stop>` 扩展为保存 listener 状态：

- `running`：当前是否认为 listener 已启动。
- `last_start_error`：最近一次 `spawn_listener` 返回的错误，或监听线程上报的创建失败。
- `last_started_at` / `last_stopped_at`：用于判断是否刚刚重试过，避免 UI 连点造成抖动。

`key_counter::spawn_listener` 需要把 macOS 线程内部的 `CGEventTap::new` 失败同步反馈给调用方。当前 macOS 实现先返回 `Ok(())`，线程内部失败只 `eprintln!` 后退出；这会让 `ListenerHandle` 误以为 listener 正在运行。默认修复是给 `spawn_listener` 增加安装结果通道，和现有 Windows `install_tx/install_rx` 模式对齐：

1. 创建线程。
2. 线程尝试创建 `CGEventTap` 和 runloop source。
3. 成功后发送 `Ok(())`，失败发送 `Err(message)`。
4. 调用方收到成功才标记 running。

### 前端

`BindingKeyStore` 增加监听健康字段：

- `listenerRunning: boolean | null`
- `listenerError: string | null`
- `listenerDiagnostic: { bundleIdentifier, executablePath, codeSignIdentifier } | null`

`useBindingKeyListener` 启动时同时调用 `accessibility_status` 与 `key_counter_health`，并监听：

- `accessibility-permission-changed`
- `key-counter-health-changed`
- `key-pressed`
- `window.focus`：应用重新获得焦点时刷新一次 health；若 `permissionGranted=true` 且 `listenerRunning=false`，调用 `restart_key_counter_listener` 做一次安全重试。

设置页按键计数区域展示三种状态：

- 未授权：保留现有“需要辅助功能权限才能统计按键” banner。
- 已授权但 listener 未运行：显示“已授予权限，但监听器未启动”，提供“重试监听”和“打开系统设置”。
- 已授权且 listener 运行：不展示额外 banner。

错误详情默认折叠展示，包含最近一次错误与运行身份信息，便于确认 macOS 辅助权限列表里勾选的是不是当前运行对象。

## 数据流

### 启动

```text
setup()
  status = accessibility::current_status()
  if status.granted:
    listener.ensure_running(app)
  emit key-counter-health-changed
  start_watcher()

frontend mount
  invoke accessibility_status -> permissionGranted/platform
  invoke key_counter_health -> listenerRunning/listenerError/diagnostic
  listen health changed -> update store
```

### 权限翻转

```text
watcher detects granted false -> true
  ensure_running()
  emit accessibility-permission-changed
  emit key-counter-health-changed

watcher detects granted true -> false
  stop listener
  emit accessibility-permission-changed
  emit key-counter-health-changed
```

### 用户重试

```text
click 重试监听
  invoke restart_key_counter_listener
  Rust:
    if permission false -> no spawn, return health
    stop old listener if any
    ensure_running
    return health
  frontend updates health
```

### 应用恢复前台

```text
window focus
  invoke key_counter_health
  if permissionGranted && !listenerRunning:
    invoke restart_key_counter_listener
  update frontend health
```

## 错误处理

- `CGEventTap::new` 失败：记录 `lastStartError`，`listenerRunning=false`，emit health changed。
- `create_runloop_source` 失败：同上。
- 重试时已有 listener：先 stop，再启动新的 listener；stop 后允许短暂旧线程自然退出。
- `restart_key_counter_listener` 在未授权时不弹系统权限，只返回 health；申请权限仍走现有 `request_accessibility_permission`。
- 前端 invoke 失败时，保留现有状态并在 banner 上显示“无法读取监听状态”。

## 测试

前端：

- `bindingKey.test.ts`：health 初始值、health event 更新、listener error 不影响 `key-pressed` 处理。
- `SettingsPanel.test.tsx`：未授权 banner、已授权但 listener 未运行 banner、点击“重试监听”调用 `restart_key_counter_listener`。

Rust：

- 为 `ListenerHandle` 增加纯逻辑单测：启动失败会清空 running 并记录错误；stop 后 running false。
- 为 macOS `spawn_listener` 安装结果通道保留平台条件编译，CI 不模拟真实 TCC。

手动验证：

1. 安装包无辅助权限启动：设置页显示未授权 banner。
2. 授权后不重启应用：watcher 自动启动 listener，绑定按键成功。
3. 若 `CGEventTap` 失败：设置页显示 listener error 和诊断信息。
4. 点击“重试监听”：health 刷新，成功后绑定按键。
5. 撤销权限：listener 停止，banner 回到未授权。

## 实施顺序

1. Rust：扩展 `ListenerHandle` 状态和 `KeyCounterHealth`。
2. Rust：让 macOS `spawn_listener` 同步返回安装结果。
3. Rust：新增 `key_counter_health`、`restart_key_counter_listener` 命令和 `key-counter-health-changed` 事件。
4. 前端：扩展 `BindingKeyStore` 与 `useBindingKeyListener`。
5. 前端：设置页按键计数区域增加 listener health banner。
6. 测试：补前端测试与 Rust 逻辑测试。
7. 验证：`cd app && npm test`、`cd app && npm run build`、`cd app/src-tauri && cargo test`，再用安装包或 dev 包做 macOS 手动验证。
