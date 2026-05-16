# Settings Focus Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After main window drag/resize completes (`NSWindowDidMoveNotification` on macOS / `WM_EXITSIZEMOVE` on Windows), automatically restore key/focus to the settings window if it is visible — eliminating the "dead settings panel after Pomodoro drag" interaction failure.

**Architecture:** Native event observer attached to the main window at setup time. macOS uses `NSNotificationCenter.addObserverForName:object:queue:usingBlock:` filtered to the main NSWindow. Windows uses a second `SetWindowSubclass` (distinct `SUBCLASS_ID` from the existing hit-test subclass) on the main HWND. Both call `settings.set_focus()` if the settings webview is visible. Death-loop avoided by choosing Move/EXITSIZEMOVE semantics (only fires after user-driven drag/resize, NOT on plain becomeKey from a button click).

**Tech Stack:** Rust, Tauri 2, objc2 0.6 + objc2-foundation 0.3 + block2 0.6, windows-rs (Win32 controls).

**Spec:** `docs/superpowers/specs/2026-05-16-settings-focus-restore-design.md`

**Worktree / branch:** `.claude/worktrees/fix-settings-crash/` on `worktree-fix-settings-crash`. HEAD at task start: `10060ca` (spec commit). Two new commits will be added; previous 8 commits include the settings-window crash fix (already passes its own regression test).

**Environment notes:**
- `cargo` not on default PATH: `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"`
- Kill stale procs before any cargo run/test: `pgrep -fl 'target/debug/app' && pkill -f 'target/debug/app'`
- Test runners: `cargo test --lib` / `cargo test --test settings_crash_regression` / `cargo test --test focus_restore_regression` (all from `app/src-tauri/`) + `npm test` (from `app/`)
- Package name `app`; lib `app_lib`. Use `cargo test -p app --lib` if needed for disambiguation, otherwise `cargo test --lib` from `app/src-tauri/` works.

---

## File Structure

| File | Touch type | Responsibility |
|---|---|---|
| `app/src-tauri/Cargo.toml` | modify | Add `block2 = "0.6"` direct dep; add `NSNotification` feature to `objc2-foundation`. |
| `app/src-tauri/src/lib.rs` | modify | (Commit C) Append second trigger 桩 gated by `CPA_E2E_TRIGGER_FOCUS_RESTORE`. (Commit D) Call `passthrough::install_focus_restorer` from `setup()` after `build_settings_window_hidden`. |
| `app/src-tauri/tests/focus_restore_regression.rs` | **create** | New integration test parsing stderr markers from the trigger 桩. macOS-only. |
| `app/src-tauri/src/passthrough/mod.rs` | modify | Add `pub fn install_focus_restorer(main_window, app)` dispatcher. |
| `app/src-tauri/src/passthrough/macos.rs` | modify | Add `install_focus_restorer_impl` — NSNotificationCenter observer for `NSWindowDidMoveNotification` on the main NSWindow; calls `settings.set_focus()` if visible. |
| `app/src-tauri/src/passthrough/windows.rs` | modify | Add `install_focus_restorer_impl` — second `SetWindowSubclass` with new `SUBCLASS_ID` handling `WM_EXITSIZEMOVE` on main HWND. |
| `app/src-tauri/src/passthrough/stub.rs` | modify | Add no-op `install_focus_restorer_impl` for non-macOS/Windows targets. |

---

## Phase 1 — Commit C: Regression Net (test FAILS)

### Task C1: Add focus-restore E2E trigger 桩 to `setup()`

**Files:** Modify `app/src-tauri/src/lib.rs` — insert after the existing `CPA_E2E_TRIGGER_SETTINGS` 桩, before the closing `Ok(())` of the setup closure.

- [ ] **Step 1: Locate the existing trigger 桩**

```bash
grep -n 'CPA_E2E_TRIGGER_SETTINGS' app/src-tauri/src/lib.rs
```

Expected: shows the existing crash-regression 桩starting around lib.rs:185 within the setup closure.

- [ ] **Step 2: Insert the focus-restore 桩**

Insert the following block IMMEDIATELY AFTER the closing `}` of the existing `if std::env::var("CPA_E2E_TRIGGER_SETTINGS").is_ok() { ... }` block, before `Ok(())`:

```rust
            // Focus-restore E2E 触发桩：仅在集成测试通过 CPA_E2E_TRIGGER_FOCUS_RESTORE=1
            // 启动二进制时进入。模拟"settings 取得 key → main 抢 key → main 移动"序列，
            // 通过 stderr marker 让 tests/focus_restore_regression.rs 验证 focus restorer
            // 是否在 NSWindowDidMoveNotification 后把 key 还给 settings。
            if std::env::var("CPA_E2E_TRIGGER_FOCUS_RESTORE").is_ok() {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // setup() 内的 webview 注册有少量延迟；等稳定
                    std::thread::sleep(Duration::from_millis(1500));
                    eprintln!("[e2e focus] setup-complete");

                    let Some(main) = handle.get_webview_window("main") else {
                        eprintln!("[e2e focus] main window not found; aborting");
                        return;
                    };
                    let Some(settings) = handle.get_webview_window("settings") else {
                        eprintln!("[e2e focus] settings window not found; aborting");
                        return;
                    };

                    // Step 1: 让 settings 取得 key（模拟用户点齿轮）
                    let _ = settings.show();
                    let _ = settings.set_focus();
                    std::thread::sleep(Duration::from_millis(200));
                    eprintln!(
                        "[e2e focus] settings-focused-initial: {}",
                        settings.is_focused().unwrap_or(false)
                    );

                    // Step 2: main 抢 key（模拟用户在 Pomodoro 区域 mouseDown）
                    let _ = main.set_focus();
                    std::thread::sleep(Duration::from_millis(200));
                    eprintln!(
                        "[e2e focus] settings-focused-after-steal: {}",
                        settings.is_focused().unwrap_or(false)
                    );

                    // Step 3: main 被"移动"——程序触发 NSWindowDidMoveNotification
                    if let Ok(pos) = main.outer_position() {
                        let _ = main.set_position(PhysicalPosition::new(pos.x + 1, pos.y));
                    }
                    std::thread::sleep(Duration::from_millis(300));

                    // Step 4: LOAD-BEARING — 是否还焦到 settings
                    eprintln!(
                        "[e2e focus] settings-focused-after-move: {}",
                        settings.is_focused().unwrap_or(false)
                    );
                });
            }
```

`PhysicalPosition` and `Duration` are already in scope in lib.rs (existing imports). No new `use` lines needed.

- [ ] **Step 3: Build and verify compile**

```bash
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
cd app/src-tauri && cargo build 2>&1 | tail -10
```

Expected: clean compile (may take ~30s on cold cache). No new warnings.

- [ ] **Step 4: Manual sanity reproduction (informational, not committed)**

Verify the 桩 actually exercises the failing path before writing the test:

```bash
cd app/src-tauri && pgrep -fl 'target/debug/app' && pkill -f 'target/debug/app'; sleep 1
CPA_E2E_TRIGGER_FOCUS_RESTORE=1 target/debug/app 2>&1 | head -20 &
APP_PID=$!
sleep 5
kill $APP_PID 2>/dev/null; wait $APP_PID 2>/dev/null
```

Expected stderr includes:
- `[e2e focus] setup-complete`
- `[e2e focus] settings-focused-initial: true`
- `[e2e focus] settings-focused-after-steal: false`
- `[e2e focus] settings-focused-after-move: false`  ← **THIS IS THE FAIL STATE**

If `after-move` shows `true` on Commit C, it means the regression doesn't reproduce — STOP and report as BLOCKED before writing the test.

If `initial: false` or `after-steal: true`: macOS focus semantics on this machine differ from expectations — STOP and report.

(Do not commit yet. 桩 lives in working tree; commit happens after C2.)

---

### Task C2: Write integration test + Commit C

**Files:** Create `app/src-tauri/tests/focus_restore_regression.rs`

- [ ] **Step 1: Create the integration test file**

Write `app/src-tauri/tests/focus_restore_regression.rs` with exactly:

```rust
//! Settings panel focus-restore E2E regression.
//!
//! Pre-fix on macOS: NSWindow's performWindowDragWithEvent: leaves main as
//! keyWindow on exit; settings loses key; settings.set_focus() is never
//! re-asserted by anything → drag/interaction in settings becomes 部分死.
//!
//! Post-fix: passthrough::install_focus_restorer registers an
//! NSWindowDidMoveNotification observer on main's NSWindow; on fire, if
//! settings is visible, settings.set_focus() — restoring key.
//!
//! Test trigger 桩 (in lib.rs::setup, gated by CPA_E2E_TRIGGER_FOCUS_RESTORE=1):
//! programmatically forces "settings has key → main steals key → main moves"
//! and prints settings.is_focused() at each step to stderr. This test
//! captures stderr and asserts the load-bearing marker after the move.

#[cfg(target_os = "macos")]
#[test]
fn settings_focus_is_restored_after_main_window_move() {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::Duration;

    let mut child = Command::new(env!("CARGO_BIN_EXE_app"))
        .env("CPA_E2E_TRIGGER_FOCUS_RESTORE", "1")
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn target/debug/app");

    let mut stderr = child.stderr.take().expect("stderr piped");

    // 5s budget: setup 1.5s + 0.2 + 0.2 + 0.3 ≈ 2.2s; doubled for variance.
    thread::sleep(Duration::from_secs(5));

    // Cleanup before assertions so a failing assertion does not leak a zombie.
    let _ = child.kill();
    let _ = child.wait();

    let mut stderr_buf = String::new();
    let _ = stderr.read_to_string(&mut stderr_buf);

    assert!(
        stderr_buf.contains("[e2e focus] setup-complete"),
        "trigger桩 did not run (setup-complete marker missing). stderr:\n{stderr_buf}"
    );
    assert!(
        stderr_buf.contains("settings-focused-initial: true"),
        "settings did not take focus on initial set_focus — base test assumption broken. \
         stderr:\n{stderr_buf}"
    );
    assert!(
        stderr_buf.contains("settings-focused-after-steal: false"),
        "main.set_focus() did not steal key from settings — base test assumption broken. \
         stderr:\n{stderr_buf}"
    );
    assert!(
        stderr_buf.contains("settings-focused-after-move: true"),
        "focus restorer did not refocus settings after main move — regression hot. \
         stderr:\n{stderr_buf}"
    );
}

#[cfg(not(target_os = "macos"))]
#[test]
fn settings_focus_is_restored_after_main_window_move() {
    // No-op on non-macOS. Windows variant requires SendMessage-based WM_EXITSIZEMOVE
    // injection (programmatic SetWindowPos does NOT fire ENTER/EXITSIZEMOVE pair).
    // Listed as follow-up in spec §6.
}
```

- [ ] **Step 2: Run the integration test — EXPECT FAIL**

```bash
cd app/src-tauri && cargo test --test focus_restore_regression 2>&1 | tail -40
```

Expected: test FAILS with assertion message
```
focus restorer did not refocus settings after main move — regression hot.
stderr: [e2e focus] setup-complete
        [e2e focus] settings-focused-initial: true
        [e2e focus] settings-focused-after-steal: false
        [e2e focus] settings-focused-after-move: false
```

If any of the prior sanity assertions fails instead (initial: false, after-steal: true, or setup-complete missing) → STOP and report. The base assumption is wrong and writing more code on top is risky.

If the test PASSES (after-move: true) on Commit C without any focus restorer code → STOP and report. The bug doesn't reproduce; the regression net is cold.

- [ ] **Step 3: Capture the failure record**

```bash
cd app/src-tauri && cargo test --test focus_restore_regression 2>&1 | tail -30 > /tmp/focus-restore-fail.txt
cat /tmp/focus-restore-fail.txt
```

This goes into Commit C's message.

- [ ] **Step 4: Commit C**

```bash
cd "$(git rev-parse --show-toplevel)"
git add app/src-tauri/src/lib.rs app/src-tauri/tests/focus_restore_regression.rs
git commit -m "$(cat <<'EOF'
test: add settings focus-restore regression test + trigger桩 (FAILS pre-fix)

Reproduces the "dead settings panel after Pomodoro drag" interaction
failure deterministically. Adds a second env-var-gated trigger桩
(CPA_E2E_TRIGGER_FOCUS_RESTORE) in lib.rs::setup that programmatically
forces "settings takes key → main steals key → main moves" and prints
settings.is_focused() at each step via stderr markers.

New integration test tests/focus_restore_regression.rs spawns the
binary with Stdio::piped() stderr, waits 5s, kills cleanly, and
asserts: setup-complete marker present, settings-focused-initial=true,
settings-focused-after-steal=false, settings-focused-after-move=true.

On this commit (no focus restorer yet), the last assertion FAILS:
no observer is registered for NSWindowDidMoveNotification, so settings
stays unfocused after main moves. Commit D will install the observer
and the same test PASSES.

  --- captured failure ---
  <paste contents of /tmp/focus-restore-fail.txt here, ~10 lines >

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Replace `<paste contents …>` with actual contents (first ~10 lines).

- [ ] **Step 5: Record Commit C hash**

```bash
git log -1 --format=%H
```

Save the hash; reference it in Commit D's message as `<commit-C-hash>`.

---

## Phase 2 — Commit D: The Fix (test PASSES)

This is a single commit bundling all source changes. The work is decomposed into ordered steps inside the same task; commit happens at the end.

### Task D1: Implement `install_focus_restorer` + wire from setup

**Files:**
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/src/passthrough/stub.rs`
- Modify: `app/src-tauri/src/passthrough/macos.rs`
- Modify: `app/src-tauri/src/passthrough/windows.rs`
- Modify: `app/src-tauri/src/passthrough/mod.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Update `app/src-tauri/Cargo.toml`**

Find the line:
```toml
objc2-foundation = { version = "0.3", features = ["NSString", "NSURL", "NSRunLoop"] }
```

Replace with:
```toml
objc2-foundation = { version = "0.3", features = ["NSString", "NSURL", "NSRunLoop", "NSNotification"] }
```

Find the `[target.'cfg(target_os = "macos")'.dependencies]` section. Inside it (alongside `objc2`, `objc2-foundation`, `objc2-app-kit`), add:
```toml
block2 = "0.6"
```

(`block2` is already a transitive dep at version 0.6.2 via objc2; we promote it to a direct dep so `use block2::RcBlock` resolves.)

- [ ] **Step 2: Add stub for non-macOS/Windows targets**

Open `app/src-tauri/src/passthrough/stub.rs`. Read it to see current contents (will already have stubs for `install_impl` / `uninstall_impl` / `install_first_mouse_only_impl`).

Append:

```rust
pub fn install_focus_restorer_impl(_w: &WebviewWindow, _app: tauri::AppHandle) {}
```

- [ ] **Step 3: Add macOS implementation in `app/src-tauri/src/passthrough/macos.rs`**

First, expand the existing import block at the top of `macos.rs`. Find:
```rust
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect};
```
Add `NSNotificationCenter`, `NSNotification`, and `NSString` to it:
```rust
use objc2_foundation::{MainThreadMarker, NSNotification, NSNotificationCenter, NSPoint, NSRect, NSString};
```

Add (near the other `use` statements):
```rust
use block2::RcBlock;
use std::ptr::NonNull;
```

Append at the end of the file:

```rust
/// 监听主窗口 NSWindowDidMoveNotification —— 用户拖/resize 结束时触发，程序
/// 触发 set_position 时也触发。回调里若 settings 可见 → set_focus 把 key 还回去。
/// 死循环规避：不监听 BecomeKey，所以主窗口被普通 click 不会触发还焦。
pub fn install_focus_restorer_impl(main_window: &WebviewWindow, app: tauri::AppHandle) {
    let _mtm = MainThreadMarker::new()
        .expect("install_focus_restorer_impl must run on main thread");

    let ns_window_ptr = match main_window.ns_window() {
        Ok(p) => p as *mut NSWindow,
        Err(e) => {
            eprintln!("[focus_restorer/macos] main ns_window err: {e}; skip");
            return;
        }
    };
    let ns_window: &NSWindow = unsafe { &*ns_window_ptr };

    let center = unsafe { NSNotificationCenter::defaultCenter() };
    let name = NSString::from_str("NSWindowDidMoveNotification");

    let app_for_block = app.clone();
    let block = RcBlock::new(move |_notif: NonNull<NSNotification>| {
        if let Some(settings) = app_for_block.get_webview_window("settings") {
            if settings.is_visible().unwrap_or(false) {
                let _ = settings.set_focus();
            }
        }
    });

    // observer 引用 leak（同既存 passthrough Arc-leak 策略）；进程退出时回收。
    let _observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(&name),
            Some(ns_window.as_ref()),  // 限定只听主窗口的 DidMove
            None,                       // queue=nil → block 在 posted thread (main) 跑
            &block,
        )
    };
    // 故意泄漏 block 引用：RcBlock 是引用计数；NSNotificationCenter 在 addObserver
    // 内部 retain 我们的 block；当我们 drop RcBlock，runtime 仍持有 ref → block 存活。
    // _observer 同样 leak。
    std::mem::forget(_observer);
}
```

**Note**: if `Some(ns_window.as_ref())` does not type-check (compiler error about expected `&AnyObject` or similar), try in this order:
1. `Some(&**ns_window)` — coerces through Deref chain
2. `Some(ns_window)` — direct, may work if generated bindings accept `&NSWindow` directly  
3. `None` — observe all windows' DidMove. Settings's own DidMove fires too, but `settings.set_focus()` is idempotent. Acceptable fallback.

Document whichever variant compiles. Do NOT change the closure body.

- [ ] **Step 4: Add Windows implementation in `app/src-tauri/src/passthrough/windows.rs`**

First, expand imports at the top. Find:
```rust
use windows::Win32::UI::WindowsAndMessaging::{
    HTCLIENT, HTTRANSPARENT, MA_ACTIVATE, WM_MOUSEACTIVATE, WM_NCHITTEST,
};
```
Add `WM_EXITSIZEMOVE`:
```rust
use windows::Win32::UI::WindowsAndMessaging::{
    HTCLIENT, HTTRANSPARENT, MA_ACTIVATE, WM_EXITSIZEMOVE, WM_MOUSEACTIVATE, WM_NCHITTEST,
};
```

Append at the end of the file:

```rust
const FOCUS_RESTORE_SUBCLASS_ID: usize = 0xCA0_FA12; // distinct from hit-test SUBCLASS_ID

unsafe extern "system" fn focus_restore_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id_subclass: usize,
    ref_data: usize,
) -> LRESULT {
    if msg == WM_EXITSIZEMOVE {
        // ref_data 是 leaked Box<AppHandle> 的指针，进程退出前一直有效
        let app = unsafe { &*(ref_data as *const tauri::AppHandle) };
        if let Some(settings) = app.get_webview_window("settings") {
            if settings.is_visible().unwrap_or(false) {
                let _ = settings.set_focus();
            }
        }
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// 在主窗口装第二个 subclass（与既存 hit-test subclass 用不同的 SUBCLASS_ID 共存）。
/// WM_EXITSIZEMOVE 仅在 user 结束拖/resize 后触发 —— 不监听 BecomeKey 等价物，
/// 主窗口被普通 click 不会触发还焦。
pub fn install_focus_restorer_impl(main_window: &WebviewWindow, app: tauri::AppHandle) {
    let hwnd = match main_window.hwnd() {
        Ok(h) => HWND(h.0 as *mut _),
        Err(e) => {
            eprintln!("[focus_restorer/windows] hwnd err: {e}; skip");
            return;
        }
    };
    // Box-leak AppHandle, 同既存 Arc-leak 策略；进程退出回收
    let app_ptr = Box::into_raw(Box::new(app)) as usize;
    let ok = unsafe {
        SetWindowSubclass(
            hwnd,
            Some(focus_restore_subclass_proc),
            FOCUS_RESTORE_SUBCLASS_ID,
            app_ptr,
        )
    }
    .as_bool();
    if !ok {
        eprintln!("[focus_restorer/windows] SetWindowSubclass failed");
    }
}
```

- [ ] **Step 5: Add dispatcher in `app/src-tauri/src/passthrough/mod.rs`**

Append (alongside the existing `pub fn install`, `pub fn uninstall`, `pub fn install_first_mouse_only`):

```rust
/// 在主窗口上安装"用户拖/resize 结束后把 key 还给 settings 的"原生监听。
/// macOS: NSWindowDidMoveNotification observer。Windows: WM_EXITSIZEMOVE subclass。
/// Stub: no-op。同 install() 当前策略：失败仅打日志，不阻断启动。
pub fn install_focus_restorer(main_window: &WebviewWindow, app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    macos::install_focus_restorer_impl(main_window, app);
    #[cfg(target_os = "windows")]
    windows::install_focus_restorer_impl(main_window, app);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    stub::install_focus_restorer_impl(main_window, app);
}
```

- [ ] **Step 6: Wire the call from `setup()` in `app/src-tauri/src/lib.rs`**

Locate the block that calls `build_settings_window_hidden`:
```rust
if let Err(e) = build_settings_window_hidden(app.handle()) {
    eprintln!("[setup] build_settings_window_hidden failed: {e}");
}
```

Insert IMMEDIATELY AFTER this `if let Err` block:

```rust
            // Focus restorer: 主窗口拖/resize 末尾把 key 还回 settings (若可见)。
            // 配合 build_settings_window_hidden 一起完成 settings 窗口的 lifecycle 闭环。
            if let Some(window) = app.get_webview_window("main") {
                passthrough::install_focus_restorer(&window, app.handle().clone());
            }
```

- [ ] **Step 7: Build**

```bash
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
pgrep -fl 'target/debug/app' && pkill -f 'target/debug/app'; sleep 1
cd app/src-tauri && cargo build 2>&1 | tail -15
```

Expected: clean compile.

If you hit `Some(ns_window.as_ref())` type-mismatch in macos.rs: try the alternatives noted in Step 3 (in order: `&**ns_window`, then `ns_window`, then `None`). Document the chosen variant inline as a brief comment.

- [ ] **Step 8: Run all test suites**

```bash
cd app/src-tauri && cargo test --lib 2>&1 | tail -15
cd app/src-tauri && cargo test --test settings_crash_regression 2>&1 | tail -15
cd app/src-tauri && cargo test --test focus_restore_regression 2>&1 | tail -25
cd app && npm test 2>&1 | tail -10
```

Expected:
- `cargo test --lib`: 11 passed (4 centered_origin + 6 HitRegionStore + 1 main_thread_marker)
- `cargo test --test settings_crash_regression`: 1 passed (the previous fix still works)
- `cargo test --test focus_restore_regression`: 1 passed — **THIS IS THE NEW SIGNAL**
- `cd app && npm test`: 48 passed (unchanged frontend)

If `focus_restore_regression` FAILS at this step, STOP. Do not commit. Check the stderr in the output; look at `settings-focused-after-move`. If it's still `false`, the observer isn't firing — re-read Steps 3-6.

- [ ] **Step 9: Self-validation (the load-bearing check)**

Confirm the regression net actually catches the bug by checkout-A-then-D:

```bash
cd "$(git rev-parse --show-toplevel)"
COMMIT_D_STAGED=$(git stash push -m "wip-D" --keep-index 2>&1; git rev-parse HEAD)
# We're now at Commit C with our D-changes stashed. The test should FAIL.
cd app/src-tauri && cargo test --test focus_restore_regression 2>&1 | tail -15 > /tmp/focus-restore-validation-fail.txt
cat /tmp/focus-restore-validation-fail.txt
# Restore D changes
cd "$(git rev-parse --show-toplevel)"
git stash pop
# Now the test should PASS.
cd app/src-tauri && cargo test --test focus_restore_regression 2>&1 | tail -15 > /tmp/focus-restore-validation-pass.txt
cat /tmp/focus-restore-validation-pass.txt
```

Expected:
- `/tmp/focus-restore-validation-fail.txt` shows test FAILED with `settings-focused-after-move: false`
- `/tmp/focus-restore-validation-pass.txt` shows test PASSED

If both runs show the same result (both PASS or both FAIL), the self-validation didn't work — `git stash` might not have stashed what you expected, or your changes aren't in fact load-bearing. Investigate before committing.

(If `git stash` complains about untracked files like the new test, the test was already committed as part of Commit C. Only your Step 1-6 changes should be in the working tree. If untracked Cargo.lock entries cause issues, just `git stash -- app/src-tauri/Cargo.toml app/src-tauri/src` explicitly.)

- [ ] **Step 10: Commit D**

Use `<commit-C-hash>` recorded from Task C2 Step 5:

```bash
cd "$(git rev-parse --show-toplevel)"
git add app/src-tauri/Cargo.toml \
        app/src-tauri/src/passthrough/stub.rs \
        app/src-tauri/src/passthrough/macos.rs \
        app/src-tauri/src/passthrough/windows.rs \
        app/src-tauri/src/passthrough/mod.rs \
        app/src-tauri/src/lib.rs
git status   # verify only those 6 files staged
git commit -m "$(cat <<'EOF'
fix(macos): restore settings focus after main window drag/resize

User-reported: after settings is open, dragging the Pomodoro panel
makes the settings panel uninteractive (drag handle dead, button
clicks flaky). Root cause: Tauri's startDragging() on macOS routes
to NSWindow.performWindowDragWithEvent: which leaves main as
keyWindow on exit; settings loses key; getCurrentWindow().
startDragging() in the settings webview can't enter
performWindowDragWithEvent: without key — drag-region dead.

Fix: passthrough::install_focus_restorer attaches an
NSWindowDidMoveNotification observer to the main NSWindow at setup
time. On fire, if settings is visible, settings.set_focus() —
restoring key. Windows mirror: WM_EXITSIZEMOVE subclass on main HWND.

Death-loop avoided by event-semantics: Move/EXITSIZEMOVE only fires
after user-driven drag/resize, NOT after a plain becomeKey from
clicking a main-window button. Pomodoro's play/pause/skip/pin
buttons keep working normally.

Test: tests/focus_restore_regression.rs (added in commit
<commit-C-hash>) now PASSES — validated against parent commit
<commit-C-hash> which FAILED with settings-focused-after-move: false.

Dependencies: objc2-foundation gains the "NSNotification" feature;
block2 promoted from transitive to direct dep (was already at 0.6.2
via objc2 chain).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Replace `<commit-C-hash>` (2 occurrences) with the hash recorded earlier.

- [ ] **Step 11: Verify final log**

```bash
git log --oneline -5
```

Expected:
```
<hash-D> fix(macos): restore settings focus after main window drag/resize
<hash-C> test: add settings focus-restore regression test + trigger桩 (FAILS pre-fix)
10060ca docs: spec for settings-focus-restore (follow-up to crash fix)
5f98aca test(macos): assert trigger桩 reached install_first_mouse_only via stderr marker
1c5ca9d fix(macos): intercept settings window close to keep handle alive
```

---

## Spec coverage check (self-review)

| Spec section | Plan task |
|---|---|
| §1 故障与根因 | Plan header + Task C1 step 2 comment block |
| §2.1 新增模块 + 分发 | Task D1 Step 5 |
| §2.2 macOS impl (NSNotificationCenter observer) | Task D1 Step 3 |
| §2.3 Windows impl (WM_EXITSIZEMOVE subclass) | Task D1 Step 4 |
| §2.4 Stub | Task D1 Step 2 |
| §2.5 setup wiring | Task D1 Step 6 |
| §2.6 不动既有逻辑 | Implicit; no other files touched |
| §3.1 既有单测保持 | Implicit; cargo test --lib still 11/11 (D1 Step 8) |
| §3.2 新增 E2E 集成测试 | Task C1 + C2 |
| §3.3 双 commit 自证 | Task C2 (FAIL on C) + Task D1 Step 9 (PASS on D) |
| §3.4 前端 vitest 不动 | Implicit; D1 Step 8 verifies 48/48 unchanged |
| §3.5 显式不做 | Aligns with what the plan doesn't include |
| §4 工作流 | The Phase 1 / Phase 2 structure here; Phase 3 (adversarial-review) is controller-managed |
| §5 异常处理 | Embedded as "STOP and report" notes in each step |
| §6 Follow-ups | Plan header environment notes; Windows test as follow-up; merging to main remains user-controlled |

All sections accounted for. Phase 3 (adversarial review + final code review + report) is handled by the controller agent post-plan (same pattern as the crash fix's adversarial review phase) and does not appear as plan tasks.
