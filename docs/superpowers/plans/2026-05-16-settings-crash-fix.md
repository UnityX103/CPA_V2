# Settings-Window-Click Crash Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the macOS process from crashing (`EXC_BREAKPOINT` in WebKit's main-thread assertion) when the user clicks the gear icon, by moving all AppKit/WKWebView mutations off the tokio worker thread into setup() main-thread context.

**Architecture:** Two-commit structure. Commit A introduces an env-var-gated "trigger 桩" in `setup()` plus an integration test — the test fails on commit A (crash reproduced from a tokio worker), proving the regression net actually catches the bug. Commit B extracts `build_settings_window_hidden` + `open_settings_window_impl`, calls the builder from `setup()`, and replaces `MainThreadMarker::new_unchecked()` with `new().expect("…")` for defense in depth — the test passes on commit B.

**Tech Stack:** Rust, Tauri 2, objc2 (NSView/NSWindow/MainThreadMarker), tokio (async commands), `cargo test` integration tests.

**Spec:** `docs/superpowers/specs/2026-05-16-settings-crash-fix-design.md`

**Worktree:** `.claude/worktrees/fix-settings-crash/` on branch `worktree-fix-settings-crash`. All `git`/`cargo`/`npm` commands run from this worktree.

---

## File Structure

| File | Touch type | Responsibility |
|---|---|---|
| `app/src-tauri/src/lib.rs` | modify | Tauri builder, setup, command handlers. Adds: trigger 桩 (gated), `build_settings_window_hidden`, `open_settings_window_impl`; shrinks `open_settings_window` to a thin shell. |
| `app/src-tauri/src/passthrough/macos.rs` | modify | Replace 2× `MainThreadMarker::new_unchecked()` with `new().expect("…")`. |
| `app/src-tauri/src/passthrough/mod.rs` | modify | Add `main_thread_marker_returns_none_off_thread` unit test (`#[cfg(target_os = "macos")]`). |
| `app/src-tauri/tests/settings_crash_regression.rs` | **create** | New integration test: spawns the binary with the env var, asserts process survives 5 s + no new crash report. |
| `app/src-tauri/src/passthrough/windows.rs` | — | Not modified (spec §2.3: structurally fine). |
| `app/src/**`, `Server/**`, `docs/**` | — | Not modified. |

---

## Phase 1 — Commit A: Regression Net (test FAILS pre-fix)

### Task A1: Add E2E trigger 桩 to `setup()`

**Files:**
- Modify: `app/src-tauri/src/lib.rs` (insert at end of `.setup` closure, before `Ok(())`)

- [ ] **Step 1: Open lib.rs and locate the end of the setup closure**

`app/src-tauri/src/lib.rs` line 157 currently looks like:

```rust
            key_counter::spawn_listener(key_counter_stop_for_setup.clone(), move |keycode| {
                let _ = key_handle.emit("key-pressed", keycode);
            });

            Ok(())
        })
```

We will insert the trigger 桩 between the `key_counter::spawn_listener(...)` block and `Ok(())`.

- [ ] **Step 2: Insert the trigger 桩**

In `app/src-tauri/src/lib.rs`, after the `key_counter::spawn_listener(...)` block and before `Ok(())`, insert:

```rust
            // E2E 触发桩：仅在集成测试通过 CPA_E2E_TRIGGER_SETTINGS=1 启动二进制时进入。
            // 复现"在 tokio worker 上直接调 install_first_mouse_only"这条 pre-fix 崩溃路径。
            // 故意不依赖 open_settings_window_impl —— 那条路在 Commit B 后已绕开 AppKit；
            // 此桩测的是"若未来有人再误把 AppKit 调用拿到非主线程"的失效模式：
            //   pre-fix (new_unchecked)  → WebKit BREAKPOINT → 整个进程 SIGTRAP
            //   post-fix (new().expect) → tokio 任务 panic 被截获 → 进程存活
            if std::env::var("CPA_E2E_TRIGGER_SETTINGS").is_ok() {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let url = WebviewUrl::App("index.html?window=settings-e2e".into());
                    if let Ok(w) = WebviewWindowBuilder::new(&handle, "settings-e2e", url)
                        .visible(false)
                        .build()
                    {
                        passthrough::install_first_mouse_only(&w);
                    }
                });
            }
```

- [ ] **Step 3: Build to verify it compiles**

Run from worktree root:

```bash
cd app/src-tauri && cargo build 2>&1 | tail -20
```

Expected: build succeeds (may take ~30 s on cold cache). No new warnings other than possibly "unused" warnings if any helper was unused; should be none here.

- [ ] **Step 4: Manual sanity reproduction (informational, not committed)**

Verify the 桩 reproduces the crash from CLI before writing the test:

```bash
cd app/src-tauri && CPA_E2E_TRIGGER_SETTINGS=1 target/debug/app &
APP_PID=$!
sleep 4
if kill -0 $APP_PID 2>/dev/null; then
    echo "STILL ALIVE — 桩 did not reproduce crash; investigate before continuing"
    kill $APP_PID
else
    echo "DEAD as expected — 桩 reproduces crash; proceed to A2"
fi
```

Expected output: `DEAD as expected …`. If `STILL ALIVE`, **stop and investigate** — the 桩 is not triggering the bad path; report to user.

Also verify a new crash report dropped:

```bash
ls -lt ~/Library/Logs/DiagnosticReports/ | grep "^-.*app-" | head -1
```

Expected: an `app-2026-05-16-*.ips` with mtime in the last minute.

(Do **not** commit yet. Trigger 桩 lives in working tree; commit happens after A2.)

---

### Task A2: Write integration regression test + Commit A

**Files:**
- Create: `app/src-tauri/tests/settings_crash_regression.rs`

- [ ] **Step 1: Verify the `tests/` directory does not yet exist; create it**

```bash
ls app/src-tauri/tests 2>/dev/null || mkdir app/src-tauri/tests
```

Cargo auto-discovers any `.rs` file under `tests/` as a separate integration test binary; no Cargo.toml change required.

- [ ] **Step 2: Write the integration test**

Create `app/src-tauri/tests/settings_crash_regression.rs` with this exact content:

```rust
//! E2E regression: verify the macOS process does not SIGTRAP when the
//! "install_first_mouse_only after build" path is exercised from a tokio
//! worker thread. Requires the trigger 桩 in lib.rs::setup gated by
//! CPA_E2E_TRIGGER_SETTINGS.
//!
//! Pre-fix: 桩 reaches WebKit's main-thread assertion → entire process
//! SIGTRAPs → child.try_wait() returns Some(status) → test FAILS.
//!
//! Post-fix: passthrough::install_first_mouse_only_impl uses
//! MainThreadMarker::new().expect(...), which panics from non-main
//! thread; tokio catches the panic; process stays alive → test PASSES.

#[cfg(target_os = "macos")]
#[test]
fn settings_window_e2e_path_does_not_sigtrap() {
    use std::collections::HashSet;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::thread;
    use std::time::Duration;

    fn list_app_ips_files(dir: &PathBuf) -> HashSet<String> {
        if !dir.exists() {
            return HashSet::new();
        }
        fs::read_dir(dir)
            .ok()
            .into_iter()
            .flat_map(|rd| rd.filter_map(|e| e.ok()))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("app-") && n.ends_with(".ips"))
            .collect()
    }

    let home = std::env::var("HOME").expect("HOME env var must be set");
    let dr = PathBuf::from(home).join("Library/Logs/DiagnosticReports");
    let pre: HashSet<String> = list_app_ips_files(&dr);

    let mut child = Command::new(env!("CARGO_BIN_EXE_app"))
        .env("CPA_E2E_TRIGGER_SETTINGS", "1")
        .spawn()
        .expect("spawn target/debug/app");

    // 5s is the empirically-derived budget: tokio worker spawn + WebViewBuilder::build
    // + install_first_mouse_only + WKWebView KVO chain typically completes in <2s on
    // M-series Macs; we double it to absorb CI/cold-cache variance.
    thread::sleep(Duration::from_secs(5));

    let alive = match child.try_wait() {
        Ok(None) => true,
        Ok(Some(status)) => {
            eprintln!("[regression] child exited prematurely: {status:?}");
            false
        }
        Err(e) => panic!("try_wait failed: {e}"),
    };

    let post: HashSet<String> = list_app_ips_files(&dr);
    let new_reports: Vec<&String> = post.difference(&pre).collect();

    // Cleanup before assertions so a failing assert still leaves no zombie.
    let _ = child.kill();
    let _ = child.wait();

    assert!(
        alive,
        "binary exited within 5s of CPA_E2E_TRIGGER_SETTINGS=1 startup; \
         crash-regression path is hot. Check ~/Library/Logs/DiagnosticReports/."
    );
    assert!(
        new_reports.is_empty(),
        "new crash reports appeared during test: {new_reports:?}"
    );
}

#[cfg(not(target_os = "macos"))]
#[test]
fn settings_window_e2e_path_does_not_sigtrap() {
    // The macOS-specific WebKit main-thread assertion path does not exist on other
    // platforms. Test is a no-op there; kept as a single shared symbol so future
    // Windows/Linux equivalents can be added without renaming.
}
```

- [ ] **Step 3: Run the integration test — EXPECT FAIL**

```bash
cd app/src-tauri && cargo test --test settings_crash_regression 2>&1 | tail -40
```

Expected: test **fails** with one of:
- "binary exited within 5s of CPA_E2E_TRIGGER_SETTINGS=1 startup …" (most likely)
- "new crash reports appeared during test: …" (if the binary held a window long enough for the OS to write the report before our `child.kill()`)

Either is a passing pre-fix state. If the test **passes** here, the 桩 is not exercising the crash path — STOP and investigate Task A1 step 4 was incomplete.

- [ ] **Step 4: Capture the failure record**

Save the test output for the commit message:

```bash
cd app/src-tauri && cargo test --test settings_crash_regression 2>&1 | tail -20 > /tmp/regression-fail-output.txt
echo "---DR files added---" >> /tmp/regression-fail-output.txt
ls -lt ~/Library/Logs/DiagnosticReports/ | grep "^-.*app-" | head -3 >> /tmp/regression-fail-output.txt
cat /tmp/regression-fail-output.txt
```

This output goes into the Commit A message.

- [ ] **Step 5: Commit A**

```bash
cd "$(git rev-parse --show-toplevel)"
git add app/src-tauri/src/lib.rs app/src-tauri/tests/settings_crash_regression.rs
git commit -m "$(cat <<'EOF'
test: add settings-window crash regression test + trigger桩 (FAILS pre-fix)

Reproduces the EXC_BREAKPOINT from commit 307c840 deterministically:
lib.rs::setup now spawns (gated by CPA_E2E_TRIGGER_SETTINGS=1) a tokio
task that builds a hidden 'settings-e2e' webview and calls
passthrough::install_first_mouse_only — the exact pre-fix path that
swaps NSView contentView off the main thread, triggering WebKit's main-
thread assertion in WKWindowVisibilityObserver.

New integration test app/src-tauri/tests/settings_crash_regression.rs
spawns target/debug/app with the env var, waits 5s, and asserts the
process is still alive + no new ~/Library/Logs/DiagnosticReports/app-
*.ips file appeared. On macOS pre-fix, this test FAILS (process dies
via SIGTRAP). Commit B will make it PASS.

Validation: cargo test --test settings_crash_regression on this commit
fails with the binary exiting prematurely (see captured output below).

  --- captured failure ---
  <paste contents of /tmp/regression-fail-output.txt here, trimmed to ~15 lines>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Replace `<paste contents …>` with the actual head of `/tmp/regression-fail-output.txt` (first ~15 lines, including the assertion message).

- [ ] **Step 6: Record commit A hash**

```bash
git log -1 --format=%H
```

Save this hash in scratch memory; it goes into Commit B's message.

---

## Phase 2 — Commit B: The Fix (test PASSES)

### Task B1: Add `build_settings_window_hidden` helper + call from `setup()`

**Files:**
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the helper function**

In `app/src-tauri/src/lib.rs`, immediately after `settings_center_position(...)` (which ends at line ~51 in the original; offsets shifted by trigger 桩 added in A1 — locate by function name), insert:

```rust
/// 在 setup() 内同步构建（隐藏的）设置窗口并装好 first-mouse hook。
/// 调用者必须在主线程（典型上下文：`setup` 闭包内）。失败仅 eprintln，
/// 让主流程能继续；用户点齿轮时 open_settings_window_impl 会返回明确 Err。
fn build_settings_window_hidden(
    app: &tauri::AppHandle,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    let url = WebviewUrl::App("index.html?window=settings".into());
    let w = WebviewWindowBuilder::new(app, "settings", url)
        .title("设置")
        .inner_size(SETTINGS_W, SETTINGS_H)
        .resizable(false)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .shadow(false)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    passthrough::install_first_mouse_only(&w);
    Ok(w)
}
```

- [ ] **Step 2: Call the helper from setup**

In `app/src-tauri/src/lib.rs`, inside the `.setup(move |app| { … })` closure, immediately after the `passthrough::install(&window, …);` line (around line 122 originally; locate by string `passthrough::install(`), insert:

```rust
            // 在主线程构建隐藏的设置窗口 + 装 first-mouse hook。点齿轮时只做
            // 重定位 + show + focus（Tauri-marshaled，线程安全）。失败仅打日志。
            if let Err(e) = build_settings_window_hidden(app.handle()) {
                eprintln!("[setup] build_settings_window_hidden failed: {e}");
            }
```

- [ ] **Step 3: Build**

```bash
cd app/src-tauri && cargo build 2>&1 | tail -10
```

Expected: compiles successfully. Old `open_settings_window` body still builds the window inline on first click — that's intentional; we will replace it in Task B2.

---

### Task B2: Refactor `open_settings_window` to `_impl` + thin shell

**Files:**
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Replace `open_settings_window` body**

In `app/src-tauri/src/lib.rs`, locate the existing function:

```rust
#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        // …old reuse-or-build logic…
    }
    // …builder + install_first_mouse_only + show + focus…
}
```

Replace the ENTIRE function (from `#[tauri::command]` line through the matching closing `}`) with:

```rust
pub(crate) async fn open_settings_window_impl(
    app: tauri::AppHandle,
) -> Result<(), String> {
    let w = app
        .get_webview_window("settings")
        .ok_or_else(|| "settings window not built — setup() probably failed; check stderr".to_string())?;
    if let Ok(pos) = settings_center_position(&app) {
        let _ = w.set_position(pos);
    }
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    open_settings_window_impl(app).await
}
```

The trigger 桩 from Task A1 still creates its own `"settings-e2e"` window — it does **not** depend on `open_settings_window_impl`. Leave the trigger 桩 unchanged.

- [ ] **Step 2: Build**

```bash
cd app/src-tauri && cargo build 2>&1 | tail -10
```

Expected: compiles successfully. `open_settings_window` is now 3 lines, no AppKit calls in its hot path.

---

### Task B3: Defensive `MainThreadMarker::new().expect()` in `passthrough/macos.rs`

**Files:**
- Modify: `app/src-tauri/src/passthrough/macos.rs`

- [ ] **Step 1: Find both `new_unchecked` call sites**

```bash
grep -n 'MainThreadMarker::new_unchecked' app/src-tauri/src/passthrough/macos.rs
```

Expected output: two matches (one in `install_impl`, one in `install_first_mouse_only_impl`).

- [ ] **Step 2: Replace both call sites**

In `app/src-tauri/src/passthrough/macos.rs`, replace both occurrences of:

```rust
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
```

with:

```rust
    let mtm = MainThreadMarker::new()
        .expect("passthrough macos install_* must run on main thread");
```

(Use Edit with `replace_all: true` for safety, or two targeted Edits since the surrounding context differs slightly between the two sites.)

- [ ] **Step 3: Build**

```bash
cd app/src-tauri && cargo build 2>&1 | tail -10
```

Expected: compiles. No more `unsafe { … new_unchecked() }`.

---

### Task B4: Add the unit test `main_thread_marker_returns_none_off_thread`

**Files:**
- Modify: `app/src-tauri/src/passthrough/mod.rs` (inside the existing `#[cfg(test)] mod tests` block)

- [ ] **Step 1: Locate the tests module**

```bash
grep -n '^mod tests' app/src-tauri/src/passthrough/mod.rs
# OR
grep -n '#\[cfg(test)\]' app/src-tauri/src/passthrough/mod.rs
```

Expected: shows the `#[cfg(test)] mod tests { … }` block start.

- [ ] **Step 2: Append the new test inside the tests module**

At the end of `mod tests { … }` (before its closing `}`), insert:

```rust
    #[cfg(target_os = "macos")]
    #[test]
    fn main_thread_marker_returns_none_off_thread() {
        use objc2_foundation::MainThreadMarker;
        // cargo test 的测试线程并非 AppKit 主线程；objc2 应返回 None,
        // 这是 install_*_impl 里 `.expect("…")` 防御能在真实多线程下触发的前提。
        let from_test_thread = MainThreadMarker::new();
        assert!(
            from_test_thread.is_none(),
            "cargo test thread should not register as AppKit main thread"
        );

        // 进一步：显式 spawn 一个线程，确认 spawn 出的线程亦非主线程。
        let handle = std::thread::spawn(|| MainThreadMarker::new().is_none());
        assert!(
            handle.join().expect("thread joined"),
            "spawned thread must not see itself as main thread"
        );
    }
```

- [ ] **Step 3: Verify objc2 is importable in tests**

```bash
grep -n 'objc2' app/src-tauri/Cargo.toml
```

If `objc2` is not listed under `[dependencies]` or `[dev-dependencies]`, check whether `passthrough/macos.rs` already imports it (it does — that's where `MainThreadMarker::new_unchecked()` lives, see `use objc2::…`). On macOS the dep is pulled transitively via the same chain `passthrough/macos.rs` uses; should be available without Cargo.toml change. If the test fails to compile with `unresolved import objc2`, add to `app/src-tauri/Cargo.toml`:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
objc2 = "0.6"
```

(Pin to whatever version `passthrough/macos.rs` is using; check `cargo tree | grep objc2`.)

- [ ] **Step 4: Run the unit test**

```bash
cd app/src-tauri && cargo test --lib main_thread_marker_returns_none_off_thread 2>&1 | tail -15
```

Expected: 1 passed.

---

### Task B5: Run full test suite

- [ ] **Step 1: Run the lib unit tests**

```bash
cd app/src-tauri && cargo test --lib 2>&1 | tail -20
```

Expected: all pass, including 4 `compute_centered_origin_*` (unchanged) + new `main_thread_marker_returns_none_off_thread`.

- [ ] **Step 2: Run the integration regression test — EXPECT PASS**

```bash
cd app/src-tauri && cargo test --test settings_crash_regression 2>&1 | tail -20
```

Expected: `test settings_window_e2e_path_does_not_sigtrap ... ok` — 1 passed.

If FAIL: do **not** proceed. Re-read the assertion message, re-read Tasks B1–B3, and check whether `open_settings_window_impl` or `build_settings_window_hidden` is being called off-main-thread by something we missed. Report to user; do not relax assertions.

- [ ] **Step 3: Run frontend vitest**

```bash
cd app && npm test 2>&1 | tail -20
```

Expected: all existing tests pass; no changes were made to frontend.

- [ ] **Step 4: Capture test pass record**

```bash
cd app/src-tauri && (cargo test --lib 2>&1; echo '---'; cargo test --test settings_crash_regression 2>&1; echo '---'; cd ../../app && npm test 2>&1) | tail -60 > /tmp/regression-pass-output.txt
echo --- saved ---
wc -l /tmp/regression-pass-output.txt
```

---

### Task B6: Commit B

- [ ] **Step 1: Stage changed files**

```bash
cd "$(git rev-parse --show-toplevel)"
git add app/src-tauri/src/lib.rs app/src-tauri/src/passthrough/macos.rs app/src-tauri/src/passthrough/mod.rs
git status
```

Expected: 3 files staged, no untracked.

- [ ] **Step 2: Commit**

Use `<commit-A-hash>` from Task A2 Step 6:

```bash
git commit -m "$(cat <<'EOF'
fix(macos): build settings window in setup(), keep AppKit calls on main

Root cause (see spec §1.3 + commit 307c840 regression): open_settings_
window was #[tauri::command] async, running on a tokio worker; its body
called passthrough::install_first_mouse_only which swapped the NSView
contentView via objc2's MainThreadMarker::new_unchecked(). WKWindow
VisibilityObserver hit a main-thread assertion in WebKit during the
viewWillMoveToWindow chain → EXC_BREAKPOINT (SIGTRAP), entire process
died on first click.

Fix (3 changes in lib.rs + 1 in passthrough/macos.rs):

1. Add build_settings_window_hidden(app: &AppHandle) -> Result<...,
   tauri::Error> — moves WebviewWindowBuilder + install_first_mouse_
   only into a helper called from setup() (guaranteed main thread).

2. Call build_settings_window_hidden(...) from setup() right after
   passthrough::install on the main window. Failure only eprintln's;
   open_settings_window_impl returns a clear Err if the window is
   absent.

3. Refactor open_settings_window into a thin shell over
   open_settings_window_impl. _impl now only does
   get_webview_window → set_position → show → set_focus — all Tauri-
   marshaled, no direct AppKit/WKWebView mutation.

4. passthrough/macos.rs: MainThreadMarker::new_unchecked() →
   new().expect("...") in both install_impl and install_first_mouse_
   only_impl. Future regressions that put AppKit calls back on tokio
   workers will get a clean panic with a clear message instead of
   WebKit's SIGTRAP.

Test:
- passthrough/mod.rs adds main_thread_marker_returns_none_off_thread
  (#[cfg(target_os = "macos")]).
- Integration test settings_crash_regression now PASSES (vs. parent
  commit <commit-A-hash> where it FAILED).

Validated against parent commit <commit-A-hash>:
  git checkout <commit-A-hash> && cargo test --test settings_crash_regression
  → FAILED (binary SIGTRAPs from 桩-spawned tokio task)
  git checkout HEAD && cargo test --test settings_crash_regression
  → PASSED (no SIGTRAP; tokio catches the .expect() panic from worker thread)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Replace `<commit-A-hash>` (3 occurrences) with the hash from Task A2 Step 6.

- [ ] **Step 3: Verify commit log**

```bash
git log --oneline -3
```

Expected:
```
<hash-B> fix(macos): build settings window in setup(), keep AppKit calls on main
<hash-A> test: add settings-window crash regression test + trigger桩 (FAILS pre-fix)
b949305 docs: spec for settings-window-click crash fix on macOS
```

---

## Phase 3 — Adversarial Review

### Task C1: Invoke `/codex:adversarial-review --background`

- [ ] **Step 1: Verify branch state is clean**

```bash
git status
```

Expected: "nothing to commit, working tree clean".

- [ ] **Step 2: Invoke the slash command**

Type the slash command verbatim in chat (or invoke via Skill tool with skill = `codex:adversarial-review` and args = `--background`):

```
/codex:adversarial-review --background
```

Note the returned task ID (or background process indicator). The command runs Codex in the background; you will be notified when it completes.

- [ ] **Step 3: Continue with other reachable work or wait for notification**

Per the harness rules (do not poll with sleep), simply wait for the completion notification. The review typically takes 5–15 minutes. When the notification arrives, proceed to C2.

---

### Task C2: Apply adversarial-review findings

- [ ] **Step 1: Read the review output**

The adversarial-review slash command writes its output to a file (path returned in the completion notification, typically under a worktree-local path or via the codex result-handling helper). Read it.

- [ ] **Step 2: Triage by priority**

Sort findings into:
- **High** — must fix (correctness bug, security issue, breaks the stated fix)
- **Medium** — fix by default unless there's a concrete reason not to
- **Low** — note in final report; only fix if cheap and clearly correct

If the review returns "no significant findings" → skip to Task C3.

- [ ] **Step 3: For each finding (in High → Medium order), apply a separate commit**

For each finding:

```bash
# 1. Edit the relevant file(s) per the finding's guidance
# 2. Run the relevant test subset
cd app/src-tauri && cargo test --lib 2>&1 | tail -10
cd app/src-tauri && cargo test --test settings_crash_regression 2>&1 | tail -10
# 3. If all green, commit
cd "$(git rev-parse --show-toplevel)"
git add <changed files>
git commit -m "fix: <short description from adversarial-review>

Address adversarial-review finding (priority: <High|Medium>):
<paste finding summary in 2-3 lines>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If a finding requires touching the design fundamentally (e.g., reverts a core decision in spec §2) — **stop and ask user**, do not silently re-architect.

- [ ] **Step 4: After all High/Medium addressed, run the full suite once more**

```bash
cd app/src-tauri && cargo test 2>&1 | tail -20
cd app && npm test 2>&1 | tail -20
```

Expected: all green.

---

### Task C3: Final status report

- [ ] **Step 1: Generate report**

Construct a final-message report containing:

1. **Commits on branch** — `git log --oneline main..HEAD` (in worktree)
2. **Test results** — copy the tail of `/tmp/regression-pass-output.txt` plus any post-review test runs
3. **Adversarial-review disposition** — table:
   - Finding ID | Priority | Action taken (fixed in commit X / deferred with reason / N/A)
4. **Open items / known follow-ups** — restate spec §6 (Windows实机回归 untouched in this work)
5. **Confirm "not merged, not pushed, no PR opened" status** (per spec §4 step 13)

- [ ] **Step 2: Send report to user**

The implementation is complete. Do **not** open a PR, do **not** push to remote, do **not** merge to main — those are user-driven actions per spec §4 step 13.

---

## Spec coverage check (self-review)

| Spec section | Plan task |
|---|---|
| §1 Root cause | Documented in plan header + Task A1 step 2 commentary |
| §2.1 Thread boundary table | Implemented across Tasks B1–B3 (build moves to setup; click does no AppKit) |
| §2.2 step 1 抽 build_settings_window_hidden | Task B1 step 1 |
| §2.2 step 2 抽 open_settings_window_impl | Task B2 step 1 |
| §2.2 step 3 薄壳 command | Task B2 step 1 |
| §2.2 step 4 setup 调 build | Task B1 step 2 |
| §2.2 step 5 trigger 桩 | Task A1 step 2 |
| §2.3 passthrough/macos.rs expect | Task B3 |
| §2.3 passthrough/windows.rs 不动 | Not in plan (intentional) |
| §3.1 Rust unit test | Task B4 |
| §3.2 E2E integration test | Task A2 |
| §3.3 双 commit 自证 | Tasks A2 + B6 (commit message embeds validation hashes) |
| §3.4 前端 vitest 不动 | Task B5 step 3 (run only) |
| §4 工作流自动执行 | Phases 1–3 in this plan |
| §5 异常处理 | Embedded in each "EXPECT FAIL/PASS" + "STOP and investigate" notes |
| §6 Windows follow-up | Task C3 step 1 final report mentions |

All sections accounted for.
