# 设置窗口在主窗口拖拽后失活 — 修复设计

- **日期**: 2026-05-16
- **作者**: Claude (Opus 4.7)
- **状态**: 用户已 blanket-approved（"后续都按照你的推荐来"）
- **前置**: 同分支上的 settings-window 崩溃修复（commits `b949305..5f98aca`），尚未合 main
- **范围**: `app/src-tauri/src/passthrough/{mod,macos,windows,stub}.rs`, `app/src-tauri/src/lib.rs`, 新增 `app/src-tauri/tests/focus_restore_regression.rs`
- **不在范围**: 前端 React、Server、Pencil、Windows 端实机验证（无机器）

## 1. 故障与根因

### 1.1 复现路径

1. 打开 app（主桌宠 + Pomodoro 浮层可见）
2. 点齿轮 → 设置窗口出现并取得 key
3. 拖拽 Pomodoro 面板标题栏（主窗口区域）
4. 拖完松开

设置窗口"假死"：标题栏不能拖、面板里点击行为不一致（某些 button 偶尔仍响应，但拖拽 handler 完全不工作）。**Cmd-Tab 切焦点或重新点齿轮 → 恢复正常。**

### 1.2 根因

`PomodoroPanel.tsx:63` 在 onPointerDown 调 `getCurrentWindow().startDragging()`。macOS 上 Tauri 将其桥接到 `NSWindow.performWindowDragWithEvent:`：

- 主 NSWindow 抢 keyWindow 状态、进入嵌套事件循环
- 拖拽末尾退出循环时，**主窗口仍是 key、设置窗口失 key**
- 设置窗口虽然装了 `CPAFirstMouseView`（`acceptsFirstMouse:` 返回 YES），部分点击事件能命中 contentView → WKWebView → button onClick 仍触发；**但** `getCurrentWindow().startDragging()` 在非 key 状态下 Tauri 的 native 桥要么 reject、要么不进入 `performWindowDragWithEvent:`，所以**标题栏拖拽完全失效**
- 用户感知是"假死"

恢复条件 = 让设置窗口重新拿到 key（用户 Cmd-Tab / 点齿轮再调用 `set_focus()`）。

## 2. 修复方案

**核心思路**：在主窗口被"用户拖拽末尾"或"被 resize 末尾"后，自动把 key 还回 settings——前提是 settings 可见。

**关键的语义对齐**：用 macOS 的 `NSWindowDidMoveNotification` / Windows 的 `WM_EXITSIZEMOVE`——这两个事件**只在用户结束拖动/resize 后**触发，而**主窗口被单纯点击（becomeKey 但未移动）不触发**。从而绕开"主窗口按钮一点就被还焦"的死循环。

### 2.1 新增模块 `passthrough::install_focus_restorer`

```rust
// passthrough/mod.rs
pub fn install_focus_restorer(main_window: &WebviewWindow, app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    macos::install_focus_restorer_impl(main_window, app);
    #[cfg(target_os = "windows")]
    windows::install_focus_restorer_impl(main_window, app);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    stub::install_focus_restorer_impl(main_window, app);
}
```

### 2.2 macOS 实现 (`passthrough/macos.rs`)

```rust
pub fn install_focus_restorer_impl(main_window: &WebviewWindow, app: tauri::AppHandle) {
    let mtm = MainThreadMarker::new()
        .expect("install_focus_restorer_impl must run on main thread");

    let ns_window_ptr = match main_window.ns_window() {
        Ok(p) => p as *mut NSWindow,
        Err(e) => {
            eprintln!("[focus_restorer/macos] main ns_window err: {e}; skip");
            return;
        }
    };
    let ns_window: &NSWindow = unsafe { &*ns_window_ptr };

    use block2::RcBlock;
    use objc2_foundation::{NSNotificationCenter, NSString};

    let center = unsafe { NSNotificationCenter::defaultCenter() };
    let name = NSString::from_str("NSWindowDidMoveNotification");

    // block 捕获 app handle clone；在 main thread 触发（窗口通知默认 main-thread post）
    let app_for_block = app.clone();
    let block = RcBlock::new(move |_notif: NonNull<NSNotification>| {
        if let Some(settings) = app_for_block.get_webview_window("settings") {
            if let Ok(true) = settings.is_visible() {
                let _ = settings.set_focus();
            }
        }
    });

    // observer 引用 leak（与现存 passthrough Arc-leak 同策略）；进程退出回收
    let _ = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(&name),
            Some(ns_window.as_ref()),  // 限定只听这一个窗口
            None,                       // queue=nil → posted thread (main)
            &block,
        )
    };
}
```

`MainThreadMarker::new().expect()` 与既有 install_* 同模式，防御性 panic。

### 2.3 Windows 实现 (`passthrough/windows.rs`)

主窗口已经被 `passthrough::install` 装过一次 `SetWindowSubclass`（SUBCLASS_ID = `0xCA0_FA11`）。**用不同的 SUBCLASS_ID** 装第二个 subclass，独立处理 `WM_EXITSIZEMOVE`：

```rust
const FOCUS_RESTORE_SUBCLASS_ID: usize = 0xCA0_FA12;

unsafe extern "system" fn focus_restore_subclass_proc(
    hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM,
    _id: usize, ref_data: usize,
) -> LRESULT {
    if msg == WM_EXITSIZEMOVE {
        let app = unsafe { &*(ref_data as *const tauri::AppHandle) };
        if let Some(settings) = app.get_webview_window("settings") {
            if let Ok(true) = settings.is_visible() {
                let _ = settings.set_focus();
            }
        }
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

pub fn install_focus_restorer_impl(main_window: &WebviewWindow, app: tauri::AppHandle) {
    let hwnd = match main_window.hwnd() {
        Ok(h) => HWND(h.0 as *mut _),
        Err(e) => {
            eprintln!("[focus_restorer/windows] hwnd err: {e}; skip");
            return;
        }
    };
    // Box leak — process-wide
    let app_ptr = Box::into_raw(Box::new(app)) as usize;
    let ok = unsafe {
        SetWindowSubclass(hwnd, Some(focus_restore_subclass_proc),
                          FOCUS_RESTORE_SUBCLASS_ID, app_ptr)
    }.as_bool();
    if !ok {
        eprintln!("[focus_restorer/windows] SetWindowSubclass failed");
    }
}
```

### 2.4 Stub (`passthrough/stub.rs`)

```rust
pub fn install_focus_restorer_impl(_w: &WebviewWindow, _app: tauri::AppHandle) {}
```

### 2.5 `lib.rs::setup` 接线

在 `setup` 闭包内，紧接 `build_settings_window_hidden(app.handle())` 调用之后：

```rust
if let Some(window) = app.get_webview_window("main") {
    passthrough::install_focus_restorer(&window, app.handle().clone());
}
```

### 2.6 不动

- `passthrough::install` / `passthrough::install_first_mouse_only`（既有 hit-test + first-mouse subclass）
- `build_settings_window_hidden` 的 `on_window_event` CloseRequested 拦截
- 前端 / Server / Pencil / capabilities / CSP

## 3. 测试方案

### 3.1 既有单测保持不动

- 4 条 `compute_centered_origin_*`
- `main_thread_marker_returns_none_off_thread`
- 6 条 `HitRegionStore` 测试

不为本次新增单测（pure objc2 / Win32 wiring，难以 mock）。

### 3.2 新增 E2E 集成测试

**新文件**：`app/src-tauri/tests/focus_restore_regression.rs`

**生产代码改动（gated）**：`lib.rs::setup` 末尾增加第二个 trigger 桩，由 `CPA_E2E_TRIGGER_FOCUS_RESTORE=1` 启用。与既存 `CPA_E2E_TRIGGER_SETTINGS` 桩相互独立。

桩逻辑：
1. `sleep 1500ms` 等 setup 完成
1.5. `eprintln!("[e2e focus] setup-complete")` —— 测试侧据此确认桩已 entered
2. 取主窗口和设置窗口（缺一个则 return）
3. `settings.show()` + `settings.set_focus()` + `sleep 200ms`
4. `eprintln!("[e2e focus] settings-focused-initial: {}", settings.is_focused().unwrap_or(false))` — 预期 true
5. `main.set_focus()` + `sleep 200ms`
6. `eprintln!("[e2e focus] settings-focused-after-steal: {}", settings.is_focused().unwrap_or(false))` — 预期 false（main 抢走 key）
7. `main.set_position(curr_pos + 1px)` —— 触发 `NSWindowDidMoveNotification` / Windows 上 set_position 不触发 EXITSIZEMOVE，所以 Windows 上桩需要 `SendMessage(hwnd, WM_EXITSIZEMOVE, 0, 0)`（platform-specific 实现）
8. `sleep 300ms`（让 observer/subclass 跑完）
9. **`eprintln!("[e2e focus] settings-focused-after-move: {}", settings.is_focused().unwrap_or(false))` — load-bearing**

注：步骤 7 在 macOS 上用 `set_position` 即可（Apple 文档：`NSWindowDidMoveNotification` "is posted whenever an NSWindow object is moved"，含程序触发）。Windows 必须用 SendMessage 显式投递 WM_EXITSIZEMOVE（程序 SetWindowPos 不触发 EXIT/ENTER SIZEMOVE 对）；本次集成测试 `#[cfg(target_os = "macos")]` 限定，Windows 集成测试列为 follow-up。

**集成测试**（`tests/focus_restore_regression.rs`）：
- `Command::new(env!("CARGO_BIN_EXE_app")).env("CPA_E2E_TRIGGER_FOCUS_RESTORE", "1").stderr(Stdio::piped()).spawn()`
- sleep 5s
- `child.kill()` + `child.wait()`
- 读 stderr 全文，依次断言：
  1. 包含 `[e2e focus] setup-complete`（桩 entered）
  2. 包含 `settings-focused-initial: true`（基础 set_focus 正常）
  3. 包含 `settings-focused-after-steal: false`（main.set_focus 真的抢走 key）
  4. **包含 `settings-focused-after-move: true`**（focus restorer 触发并还焦）

前 3 sanity 任一失败 → 测试假设不成立，停下汇报；第 4 失败 → focus restorer 缺位或被误触发屏蔽。

### 3.3 双 commit 自证

| Commit | 内容 | `cargo test --test focus_restore_regression` |
|---|---|---|
| **C** | 加 trigger 桩（在 lib.rs setup 末尾）+ 集成测试新文件。`passthrough/` 完全不动；setup 不调 `install_focus_restorer` | **FAIL**（前 3 sanity 通过；第 4 marker 为 `false`） |
| **D** | 加 `passthrough::install_focus_restorer` macOS + Windows + mod 分发 + stub + setup wiring | **PASS** |

自证脚本（记入 Commit D message）：
```bash
git checkout <C-hash> && cd app/src-tauri && cargo test --test focus_restore_regression  # FAIL
git checkout <D-hash> && cargo test --test focus_restore_regression                       # PASS
```

### 3.4 前端 vitest

不增不减；本修复零前端代码改动。

### 3.5 显式不做

- 不模拟真实鼠标拖（cliclick / AppleScript UI 注入太脆弱）
- 不验证 Windows 平台行为（无机器）
- 不写"focus restorer 不会在主窗口 click 时误触发"的负样本测试——`set_focus` 不触发 DidMove，已经由 macOS API 语义保证；测试这个等于测试操作系统

## 4. 工作流（自动执行，不再请示用户）

继承上一轮 user blanket-approval。

1. ~~写 spec~~（本文档）
2. ~~user reviews spec~~（用户已明示"不用再问"）
3. `writing-plans` skill → 实现 plan，commit
4. subagent-driven-development 执行：
   a. Commit C（trigger 桩 + 集成测试）实现 → spec 审 → quality 审
   b. Commit D（focus restorer 实现 + wiring）实现 → spec 审 → quality 审
5. 跑全套测试（lib + 既有 + 新集成 + vitest）
6. `/codex:adversarial-review --background --base main`
7. 解析 findings：high 必修，medium 默认修，low 列报告
8. 终态 code review（整支分支 vs main）
9. 终态汇报：commits 列表 + 测试结果 + adversarial disposition + follow-ups
10. **不**合并、**不** PR、**不** push（与上一轮同策略；用户后续再决定合并时机）

## 5. 异常处理

- 任一步骤失败 → 停下汇报；不靠 destructive shortcut
- 步骤 4a（Commit C 自证测试不 FAIL）→ trigger 桩没真到达失活路径，停下重新设计桩
- 步骤 4b（Commit D 集成测试不 PASS）→ focus restorer 没生效，回到 §2 调整不放宽测试
- adversarial-review 返回 "no significant findings" → 跳到 8

## 6. Follow-ups（不在本任务）

- Windows 端实机回归（无机器；Windows 集成测试 桩 + assertion 都已在 spec 里设计但仅 macOS 跑）
- 若发现 focus restorer 在某些边角场景（例如设置窗口正在动画 hide 时被还焦）有视觉副作用，再补一条 commit
- 上一轮 settings-window-crash 修复 + 本次 focus restorer 两条 follow-up 一起合 main（由用户决定时机）
