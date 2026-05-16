# 设置窗口点击立崩 (macOS) — 修复设计

- **日期**: 2026-05-16
- **作者**: Claude (Opus 4.7)
- **状态**: 待 review
- **相关提交**: `307c840` (引入回归)
- **范围**: `app/src-tauri/src/lib.rs`, `app/src-tauri/src/passthrough/{mod,macos,windows}.rs`
- **不在范围**: 前端 React 组件、Server、Pencil 设计、跨平台 Windows 实机回归（无环境）

## 1. 故障与根因

### 1.1 用户可见症状

点击主窗口齿轮按钮 (`PomodoroPanel.tsx:76` 触发 `invoke('open_settings_window')`)，进程在 100ms 内 `EXC_BREAKPOINT` 终止。Tauri dev 父进程退出码不一定非零（child SIGTRAP 不一定向父冒泡），表象上是"窗口闪了一下都不闪就没了"。

### 1.2 崩溃报告关键栈

来自 `~/Library/Logs/DiagnosticReports/app-2026-05-16-100541.ips`：

```
exception: EXC_BREAKPOINT / SIGTRAP (0x1, 0x1afd404e4 ∈ WebKit)
triggered thread: tokio-rt-worker

  WebKit  -[WKWindowVisibilityObserver startObserving:]
  WebKit  WebViewImpl::viewWillMoveToWindow(NSWindow*)
  AppKit  -[NSView _setWindow:]
  AppKit  -[NSView removeFromSuperview]
  app     passthrough::macos::install_first_mouse_only_impl
  app     passthrough::install_first_mouse_only
  app     open_settings_window::{{closure}}
  tauri   ipc::command::ResultFutureTag::future
  tokio   runtime::task::core::Core::poll
```

### 1.3 根因

`open_settings_window` 是 `#[tauri::command] async fn` — Tauri 把它派发到 `tauri::async_runtime`（tokio）worker 线程。函数体内调用 `passthrough::install_first_mouse_only(&w)`，后者在 macOS 上：

```rust
let mtm = unsafe { MainThreadMarker::new_unchecked() };   // 谎称主线程
let ns_window: &NSWindow = unsafe { &*ns_window_ptr };
…
old_content.removeFromSuperview();
ns_window.setContentView(Some(&*view));
```

WKWebView 内部的 `WKWindowVisibilityObserver` 注册了 KVO，在 `removeFromSuperview` 触发 `viewWillMoveToWindow` 链时被调用——WebKit 在该路径上做了"必须主线程"的运行期断言（debug 工具链下表现为 `__builtin_trap()`，即 `EXC_BREAKPOINT`）。从 tokio worker 调用违反前提 → SIGTRAP。

对照：主窗口的同类 hook (`passthrough::install`) 在 `lib.rs::setup` 闭包内调用，setup 跑在主线程上下文，故主窗口路径不触雷。

## 2. 修复方案

**核心思路**：所有直接调 AppKit/objc2 的代码必须在主线程；将设置窗口的"构建 + 装 first-mouse hook"挪到 `setup()`（与主窗口同模式），点击仅做 Tauri-marshaled 的 `set_position` / `show` / `set_focus`。

### 2.1 主线程主权边界

| 阶段 | 线程 | 行为 |
|---|---|---|
| `setup(&mut App)` | main | 建主窗口 → 装 passthrough hook；**新增**：建 hidden settings window → 装 first-mouse hook |
| `invoke('open_settings_window')` | tokio worker | `get_webview_window("settings")` → `set_position` → `show` → `set_focus` —— 零直接 AppKit 调用 |
| `invoke('close_settings_window')` | tokio worker | `w.hide()`（Tauri-marshaled，原状） |

### 2.2 `app/src-tauri/src/lib.rs` 改动

1. **抽函数**：
   ```rust
   fn build_settings_window_hidden(app: &tauri::AppHandle)
       -> Result<tauri::WebviewWindow, tauri::Error>
   ```
   把现 `open_settings_window` 里的 `WebviewWindowBuilder::new(...).build()` 整段 + `passthrough::install_first_mouse_only(&w)` 搬入。返回 hidden window。

2. **抽 command 实现**：
   ```rust
   pub(crate) async fn open_settings_window_impl(app: tauri::AppHandle)
       -> Result<(), String>
   ```
   函数体：
   ```rust
   let w = app.get_webview_window("settings")
       .ok_or_else(|| "settings window not built — setup() probably failed; check stderr".to_string())?;
   if let Ok(pos) = settings_center_position(&app) { let _ = w.set_position(pos); }
   w.show().map_err(|e| e.to_string())?;
   w.set_focus().map_err(|e| e.to_string())?;
   Ok(())
   ```

3. **薄壳 command**：
   ```rust
   #[tauri::command]
   async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
       open_settings_window_impl(app).await
   }
   ```

4. **setup 内调用**：
   ```rust
   if let Err(e) = build_settings_window_hidden(app.handle()) {
       eprintln!("[setup] build_settings_window_hidden failed: {e}");
       // 不阻断启动；点齿轮时 open_settings_window_impl 会返回明确 Err
   }
   ```
   失败仅打 stderr，与 `passthrough::install` 当前策略一致。

5. **E2E 触发桩**（gated，详见 §3.2）：
   ```rust
   if std::env::var("CPA_E2E_TRIGGER_SETTINGS").is_ok() {
       let handle = app.handle().clone();
       tauri::async_runtime::spawn(async move {
           // 复现"在 tokio worker 上直接调 install_first_mouse_only"这条出问题的路径。
           // 故意不走 open_settings_window_impl —— 那条路在 fix 后已绕开 AppKit；
           // 我们要测试的是"若未来有人再误把 AppKit 调用拿到非主线程"的失效模式：
           //   pre-fix（new_unchecked）→ WebKit BREAKPOINT → 整个进程 SIGTRAP
           //   post-fix（new().expect）→ 任务 panic → tokio 截获 → 进程存活
           let url = tauri::WebviewUrl::App("index.html?window=settings-e2e".into());
           if let Ok(w) = tauri::WebviewWindowBuilder::new(&handle, "settings-e2e", url)
               .visible(false)
               .build()
           {
               passthrough::install_first_mouse_only(&w);
           }
       });
   }
   ```
   该分支仅在环境变量 `CPA_E2E_TRIGGER_SETTINGS` 被设置时进入；集成测试用它复现 pre-fix 崩溃路径，生产场景下用户不会设置该变量。

### 2.3 `app/src-tauri/src/passthrough/{macos,windows}.rs` 改动

**macOS** (`install_impl` 和 `install_first_mouse_only_impl` 两处)：

```rust
// 旧
let mtm = unsafe { MainThreadMarker::new_unchecked() };
// 新
let mtm = MainThreadMarker::new()
    .expect("passthrough macos install_* must run on main thread");
```

未来若有人再把 AppKit 调用绕回非主线程，会拿到清晰 panic（带 expect 消息），而非 WebKit 内部 SIGTRAP，便于定位。

**Windows** (`install_first_mouse_only_impl`)：无结构性问题（`SetWindowSubclass` 单调用、无 contentView 替换），保持现状。

### 2.4 不改动

- `passthrough::compute_centered_origin` 及其 4 条单元测试
- `passthrough/stub.rs`
- `app/src/**` 前端
- `Server/**`
- `app/src-tauri/capabilities/default.json`（设置窗口仅依赖 `core:default` + `core:window:default` + `core:window:allow-start-dragging` + `core:event:default`，已覆盖；CSP 不动）
- 与多显示器居中相关的逻辑（`settings_center_position` 公式不变）

## 3. 测试方案

### 3.1 Rust 单元测试 (`cargo test -p app_lib`)

| 测试 | 位置 | 说明 |
|---|---|---|
| 既有 4 条 `compute_centered_origin_*` | `passthrough/mod.rs#tests` | 保持原状 |
| **新增** `main_thread_marker_returns_none_off_thread` (`cfg(target_os="macos")`) | `passthrough/mod.rs#tests` | 在 `std::thread::spawn` 闭包里 `assert!(MainThreadMarker::new().is_none())`，验证 §2.3 防御 expect 在真实多线程下会触发 |

### 3.2 E2E 崩溃回归测试 (`cargo test -p app --test settings_crash_regression`)

**新文件**：`app/src-tauri/tests/settings_crash_regression.rs`

- `#[cfg(target_os = "macos")]` 限定（其他平台测试函数体为空，自动 pass）
- 测试假设 §2.2 步骤 5 的 trigger 桩已落地；测试通过环境变量打开桩
- 流程：
  1. 记录 `~/Library/Logs/DiagnosticReports/` 中现有 `app-*.ips` 文件名集合（用集合差，避开 mtime/ctime 跨文件系统语义）
  2. `Command::new(env!("CARGO_BIN_EXE_app")).env("CPA_E2E_TRIGGER_SETTINGS", "1").spawn()`
  3. `thread::sleep(Duration::from_secs(5))` —— 留足时间让 tokio worker 跑完触发桩，并让 WKWebView 完成 `viewWillMoveToWindow` 链
  4. 断言 `child.try_wait()?.is_none()`（进程仍存活，未 SIGTRAP）
  5. 扫描 DiagnosticReports：若新增 `app-*.ips`（与步骤 1 集合作差）→ fail（打印文件路径）
  6. `child.kill()` + `child.wait()`；若 wait 状态码反映 SIGSEGV/SIGTRAP → fail
- 该集成测试**默认随 `cargo test` 跑**。因为它会真起一个 Tauri 进程并短暂弹出窗口（`settings-e2e` label，invisible 但有窗口对象），开发者本地频繁跑 `cargo test` 会有短暂副作用——可接受成本

### 3.3 测试本身的可信度自证（双 commit 结构）

实施时把改动拆为两个连续 commit，每个 commit 的状态都明确可测：

- **Commit A — "Add trigger桩 + E2E regression test"**
  - `lib.rs::setup` 末尾加 §2.2 步骤 5 的 trigger 桩（含 `WebviewWindowBuilder` 自包含逻辑）
  - 新增 `app/src-tauri/tests/settings_crash_regression.rs`
  - **不动** `open_settings_window`、不动 `passthrough/{macos,windows}.rs`、不动 `setup` 内的 build_settings_window_hidden 调用
  - 此 commit 单独 build/run 时 `cargo test --test settings_crash_regression` 预期 **FAIL**（DiagnosticReports +1 份新 `app-*.ips`）

- **Commit B — "Move settings window construction to setup() + defensive MainThreadMarker check"**
  - `lib.rs`: 抽 `build_settings_window_hidden` + `open_settings_window_impl`、setup 调用 build、薄壳 command
  - `passthrough/{macos,windows}.rs`: `new_unchecked()` → `new().expect("…")`
  - 此 commit 上 `cargo test --test settings_crash_regression` 预期 **PASS**

**自证脚本**（开发期本地跑一次确认，结果记入 commit B message）：

```bash
git checkout <commit-A-hash>
cd app/src-tauri && cargo test --test settings_crash_regression   # 预期 FAIL
git checkout <commit-B-hash>
cargo test --test settings_crash_regression                       # 预期 PASS
```

本仓库无 every-commit-green 约束，commit A 的一过性红可接受；价值在于"测试自身真能抓到 pre-fix 崩溃"获得 commit 级别的可重现证据。

### 3.4 前端 vitest

不增不减。`SettingsPanel.test.tsx`、`network.test.ts`、`settings.test.ts` 维持原状——前端测试覆盖 React 渲染与 invoke mock，与本次 Rust 崩溃路径正交。

### 3.5 显式不做

- 不写 UI 坐标 click（`cliclick` / `osascript`）—— 脆弱
- 不写 WebDriver e2e —— 项目尚未配 tauri-driver，成本不匹配
- 不写 `tauri::test::mock_builder` 集成 —— mock builder 不构造真 NSWindow，无法 exercise WebKit 主线程断言路径
- 不为 `open_settings_window` 的"window 不存在"错误分支单独加测试（覆盖率低于成本）

## 4. 工作流（自动执行）

1. ~~写 spec~~（本文档）
2. **等用户 review spec**（唯一非自动节点 —— brainstorming skill 硬性要求）
3. `writing-plans` skill 生成实现计划，commit
4. **Commit A**：按 §2.2 步骤 5 加 trigger 桩 + 按 §3.1 加 `main_thread_marker_returns_none_off_thread` 单测 + 按 §3.2 加 `settings_crash_regression.rs` 集成测试。**生产路径未动**，`open_settings_window` / `passthrough` 保持原状
5. 跑 `cargo test --test settings_crash_regression` → 预期 **FAIL** → 记录失败 stderr + DiagnosticReports 新文件路径（写入 commit A message 附录）
6. **Commit B**：按 §2.2 步骤 1-4 + §2.3 实施真正的修复（抽函数、setup 内 build、passthrough 防御 expect）
7. 跑 `cargo test -p app_lib`（含 §3.1 单测） + `cargo test --test settings_crash_regression`（§3.2 集成测试） + `npm test`（在 `app/`，前端 vitest）→ 全绿；任一 fail 则停下不做 commit B
8. commit B message 含自证记录：`Validated against parent: <commit-A-hash> failed regression test with crash report <path>; this commit passes.`
9. 调 `/codex:adversarial-review --background`，等通知
10. 解析审查反馈：high 必修，medium 默认修，low 列入终态报告不一定动手；每条 fix 单独 commit
11. 再跑一遍完整测试套件
12. 终态汇报：commits 列表、测试结果、审查处置详情
13. **不**合并、**不**开 PR、**不** push remote（除非用户后续要求）

## 5. 异常处理

- 任一步骤失败 → 停下汇报、等指示；不靠 `--no-verify` / `reset --hard` 等 destructive shortcut
- `/codex:adversarial-review --background` 返回 "no significant findings" → 跳到步骤 12
- 步骤 5（commit A 上跑 regression test）竟 PASS → 说明 E2E 触发桩没真复现旧崩溃 → 停下汇报，重新设计触发桩
- 步骤 7（commit B 上 regression test）fail → 说明修复未生效或测试断言过严 → 停下汇报，回到 §2 调整设计而不是放宽测试

## 6. Follow-ups（不在本任务内）

- Windows 实机回归：本仓库当前仅 macOS 开发环境。spec §2.3 已统一把 macOS 防御 expect 加上，Windows 端 `SetWindowSubclass` 调用线程未做硬约束（修复 setup() 迁移已让其在 main 线程发生，但缺测试网）。需 Windows 开发者复测后补充。
- `tauri::async_runtime::spawn` 在生产代码里的其他使用点（grep `async fn` 在 `lib.rs` 与 `passthrough/` 之外暂无）——本次只 audit 范围内代码；后续如有新 async cmd 触碰 AppKit/HWND，应自检是否需走相同改造。
