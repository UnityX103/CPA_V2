# key_counter 辅助功能权限闸门设计

**日期**：2026-05-16
**模块**：`app/src-tauri/src/key_counter.rs` + 新增 `accessibility/`、`app/src/domain/bindingKey.ts`、`app/src/ui/InputCounterPanel`
**关联**：`docs/superpowers/specs/2026-05-15-cpa-tauri-rewrite-design.md`、`docs/superpowers/specs/2026-05-15-adversarial-review.md`

## 背景与问题

`app/src-tauri/src/lib.rs:154` 在 `setup()` 阶段无条件 spawn `key_counter::spawn_listener`。在 macOS 上 `CGEventTap::new(HID, ListenOnly, [KeyDown])` **未授予辅助功能权限时直接返回 `Err`**（`key_counter.rs:43-47`），线程打印 stderr 后退出。

由此衍生三个用户可见的故障：

1. 启动后按键计数永久不工作，前端没有任何提示，只有终端里一行 `CGEventTap 创建失败：可能未授予辅助功能权限`。
2. macOS 偶发自动弹出的 TCC 权限对话框被透明置顶 overlay 遮挡 + 焦点反复被 App 抢回，**用户既看不清也点不中**。
3. 即便用户手动到系统设置授予权限，App 也不会自动重启 listener —— 必须重启进程。

`key_counter.rs:9-10` 注释（"权限缺失时仍 Ok 但事件不送达"）描述的是旧版 `core-graphics` crate 的行为，与现实不符 —— 注释过时。

## 目标

- 启动时显式检测辅助功能权限；权限缺失不 spawn listener，避免无效线程与误导性日志。
- 把权限缺失暴露为前端可见的非阻塞 banner，提供"申请权限"与"打开系统设置"两条路径。
- "申请权限"按钮主动触发 macOS 系统 prompt，并在 prompt 出现前临时让位（取消 always-on-top + 主动 deactivate），保证用户能聚焦并点中对话框。
- 1Hz 轮询权限状态；用户在系统设置侧手动授权或撤销时，App 自动 spawn / stop listener，无需重启。
- Windows 平台：`accessibility::status` 永远返回 `granted:true`（低层键盘 hook 不需要 TCC 类权限），命令面与 macOS 对称。

## 非目标

- **不**在本 spec 内补 Windows 的 `key_counter` 实现 —— 那是 CLAUDE.md 里已知的 tech debt，单独立 spec。
- **不**修复 dev 模式重签名导致 bundleId 漂移 / TCC 条目失效问题 —— 用 banner 文案告知用户即可。
- **不**做 Accessibility 权限以外的 TCC 权限（屏幕录制、麦克风等）。

## 架构

新增 `accessibility/` 模块，与 `passthrough/` 同构（`mod.rs` 平台分派 + `macos.rs` / `windows.rs` / `stub.rs`）。

```
app/src-tauri/src/
├── accessibility/
│   ├── mod.rs         ← Tauri command 表面 + 状态轮询线程 + listener 启停协调
│   ├── macos.rs       ← AXIsProcessTrusted / AXIsProcessTrustedWithOptions / 让位逻辑
│   ├── windows.rs     ← granted 永真；open_settings 跳到 ms-settings:privacy
│   └── stub.rs        ← 其它平台 noop
├── key_counter.rs     ← 接口不变；由 accessibility 模块按需 spawn / stop
├── lib.rs             ← setup 改为：注册命令 + 启 accessibility 轮询；不再直接 spawn key_counter
└── ...
```

**对外契约**：

| 名称 | 类型 | 说明 |
|---|---|---|
| `accessibility_status` | `#[command] -> AccessibilityStatus` | 同步查询，`{ granted: bool, platform: "macos"\|"windows"\|"other" }` |
| `request_accessibility_permission` | `#[command] async -> Result<(), String>` | macOS：让位 → `AXIsProcessTrustedWithOptions(prompt:true)`；其它平台：返回 `Ok(())` |
| `open_accessibility_settings` | `#[command] -> Result<(), String>` | macOS：opener 打开 `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`；Windows：`ms-settings:privacy-accessibility` |
| `key_counter_listening` | `#[command] -> bool` | listener 线程是否在跑（前端 sanity check） |
| `accessibility-permission-changed` | event | payload `{ granted: bool }`，状态翻转时 emit |

## 数据流

### 启动

```
setup():
  status = accessibility::current_status()         // 同步、无 prompt
  if status.granted:
      key_counter::spawn_listener(stop_kc, …)
      kc_running.store(true)
  // 不论 granted 与否：
  spawn accessibility 轮询线程(stop_acc):
      last = status.granted
      loop:
          sleep_with_stop(1s, stop_acc)            // 10×100ms
          now = current_status().granted
          if now != last:
              emit("accessibility-permission-changed", { granted: now })
              if now && !kc_running:
                  key_counter::spawn_listener(stop_kc_new, …)
                  kc_running = true
              if !now && kc_running:
                  stop_kc.store(true)              // listener 自然退出
                  kc_running = false
              last = now
```

### "申请权限"按钮

```
frontend.click → invoke('request_accessibility_permission')
rust:
  yield_focus():
      window("main").set_always_on_top(false)
      NSApp.deactivate()
  AXIsProcessTrustedWithOptions(prompt: true)     // 系统在此处弹 TCC 对话框
  // 不阻塞：函数直接返回。让位状态由后续的 30s 计时或 granted 翻转回收
  spawn restore_task:
      select first:
        sleep(30s)
        accessibility-permission-changed event
      window("main").set_always_on_top(true)
```

### 前端 (`bindingKey.ts` / `useBindingKeyListener`)

```
init: invoke('accessibility_status') → store.set({ permissionGranted, platform })
listen('accessibility-permission-changed') → store.set({ permissionGranted })
listen('key-pressed') → 既有逻辑不变（线程没起来时事件天然不会来）
```

`InputCounterPanel` 顶部 banner：

```tsx
{!permissionGranted && (
  <div className="permission-banner" role="status">
    <span>需要辅助功能权限才能统计按键</span>
    <button onClick={requestPermission}>申请权限</button>
    <button onClick={openSettings}>打开系统设置</button>
  </div>
)}
```

`permissionGranted=true` 时整行不渲染。样式用 `tokens.css` 已有的 warning token；不引入新组件库。

## 关键决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | 启动只用 `AXIsProcessTrusted`（不弹窗） | 避免每次冷启动骚扰；prompt 由用户点 banner 触发 |
| 2 | 轮询频率 1Hz | 与 `active_app` 一致；`AtomicBool + 10×100ms` 模式复用，关停最迟 100ms 内观察到 |
| 3 | "让位" = `set_always_on_top(false) + NSApp.deactivate()` | 解决用户报告的"点不中、聚不到"系统弹窗 —— 把 floating-level overlay 降到普通层并主动放弃 key application 状态，让 TCC 对话框成为 key window |
| 4 | 让位恢复时机：30s 倒计时 或 granted=true 事件，先到先恢复 | 30s 给用户留 Touch ID / 输密码的时间；granted 翻转代表用户已操作完毕 |
| 5 | listener 启停由 accessibility 轮询线程协调，**不**让 key_counter 自己轮询权限 | 单一职责：key_counter 只管 tap，权限状态机集中在 accessibility |
| 6 | `key_counter::spawn_listener` 接口签名不变 | 现有调用方零侵入；新增的是"什么时候调用"由谁决定 |
| 7 | 用 `Arc<Mutex<Option<Arc<AtomicBool>>>>` 维护当前 listener 的 stop 句柄 | 启停时换句柄 —— 老线程持有老 Arc，置为 true 后自然退出；新线程拿新 Arc |
| 8 | Windows `accessibility::status.granted` 永真 | LL keyboard hook 不需要 TCC；`open_accessibility_settings` 仍提供以保持命令面对称 |
| 9 | 注释更新：删除 `key_counter.rs:9-10` 的"仍 Ok 不送达"陈述 | 与实际行为不符，会误导后续维护者 |

## 错误处理

- `AXIsProcessTrusted` / `AXIsProcessTrustedWithOptions` 不会抛错（返回 `Boolean`）。
- `set_always_on_top(false)` 返回 `Err` → log warning，继续调 prompt（让位失败比 prompt 不弹更可接受）。
- `tauri-plugin-opener` 打开 `x-apple.systempreferences:` URL 失败 → 命令返回 `Err(string)`，前端 toast；不致命。
- 轮询线程在 `RunEvent::ExitRequested|Exit` 时由 `stop_acc.store(true)` 退出，复用 `lib.rs:173-181` 现有 hook。
- listener 线程在权限被撤销时通过 `stop_kc.store(true)` 退出；CGEventTap 在 `tap` drop 时自动从 RunLoop 摘除，不漏 source。

## 跨平台对称

| 平台 | `current_status` | `request_permission` | `open_settings` | listener |
|---|---|---|---|---|
| macOS | `AXIsProcessTrusted` | 让位 + `AXIsProcessTrustedWithOptions(prompt:true)` | `x-apple.systempreferences:…?Privacy_Accessibility` | 现有 CGEventTap |
| Windows | 恒 `true` | `Ok(())` | `ms-settings:privacy-accessibility` | 已知 tech debt：现状是 `_no-op`，本 spec 不覆盖 |
| 其它 | 恒 `true` | `Ok(())` | `Ok(())` | `_no-op` |

## 测试

**前端**（`app/src/domain/bindingKey.test.ts` 扩展）：

1. `granted=false` 初始 → banner 渲染、按键事件被丢弃（incrementByKeyCode 不触发）。
2. `accessibility-permission-changed { granted:true }` → banner 消失。
3. `granted=true → false` → banner 重新渲染；后续 `key-pressed` 事件来了也不计数（listener 已停，但 mock 防回归）。

**Rust 侧**：不写单测（`AX*` API 在 CI 上无法稳定模拟）；在 `app/src-tauri/src/accessibility/macos.rs` 顶端写一段 `# 手动验证步骤` 注释（启动 → 撤销权限 → 看 banner 出现 → 点"申请权限"看让位是否生效 → 重新授权看 banner 消失且 listener 自动起）。

## 已知限制

- **dev 模式 bundleId 漂移**：`tauri dev` 下 bundleId 与正式包不同，TCC 条目独立；用户可能要在 dev / release 各授权一次。banner 文案不特殊处理。
- **首次让位与 prompt 之间的竞态**：理论上 `set_always_on_top(false)` 还没返回时 prompt 就弹了 —— 实测 macOS prompt 是同步的，且发生在主线程顺序之后；标注为"如复现再优化"。
- **被遮挡的不是 prompt 而是设置面板**：用户在 `打开系统设置` 路径下进入 Settings.app 时，置顶 overlay 仍可能视觉遮挡 —— 本 spec 不在 `open_accessibility_settings` 路径上让位（用户本来就要切换到 Settings.app，自然失焦）；如果实测仍有问题再加。

## 实施顺序

1. 新增 `accessibility/` 模块与 4 个命令；`lib.rs` 注册命令、启轮询线程、移除直接 `spawn_listener` 调用；listener 启停封装到 accessibility 模块内部。
2. 删除 `key_counter.rs:9-10` 的过时注释；调整为"权限不足时返回 Err，由调用方决定何时重试"。
3. `bindingKey.ts` 增加 `permissionGranted` / `platform` 字段及对应 actions；`useBindingKeyListener` 增加 `accessibility-permission-changed` 订阅。
4. `InputCounterPanel`（或对应组件）顶部加 banner；`tokens.css` 已有 warning 配色，不新增。
5. `bindingKey.test.ts` 增加 3 项测试。
6. 跑 `cd app && npm test` + `npm run tauri dev` 手动验证四个状态翻转（启动有/无权限、运行中授予/撤销、点"申请权限"是否让位）。
