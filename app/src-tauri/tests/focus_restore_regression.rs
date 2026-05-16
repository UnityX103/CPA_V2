//! Settings focus-restore E2E regression.
//!
//! 测试机制（非 is_focused 状态轮询）：focus restorer 在 observer 回调内
//! eprintln 一个 marker `[focus_restorer] fired ...`。Commit D 装好 observer
//! 后，test桩 程序性移动主窗口 → NSWindowDidMoveNotification → observer 跑
//! 回调 → marker 出现在 stderr。Commit C 上 observer 未装，marker 永远不出现。
//!
//! 选择 stderr-marker 而非 is_focused() 状态轮询的原因：macOS 不允许 cargo-test
//! 派生的 bg 子进程取前台焦点，is_focused() 在 bg 进程里永远返回 false，
//! 无法做"focus 是否被还回"的状态对比。eprintln 不受 OS 焦点策略影响。

#[cfg(target_os = "macos")]
#[test]
fn focus_restorer_fires_after_main_window_move() {
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

    // Budget: 1.5s setup + 0.2 + 0.5 ≈ 2.2s; doubled for variance.
    thread::sleep(Duration::from_secs(5));

    // Cleanup before assertions so a failing assertion does not leak a zombie.
    let _ = child.kill();
    let _ = child.wait();

    let mut stderr_buf = String::new();
    let _ = stderr.read_to_string(&mut stderr_buf);

    // Sanity: trigger桩 actually ran end-to-end
    assert!(
        stderr_buf.contains("[e2e focus] setup-complete"),
        "trigger桩 did not start. stderr:\n{stderr_buf}"
    );
    assert!(
        stderr_buf.contains("[e2e focus] settings-shown"),
        "trigger桩 did not get past settings.show(). stderr:\n{stderr_buf}"
    );
    assert!(
        stderr_buf.contains("[e2e focus] main-moved"),
        "trigger桩 did not get past main.set_position(). stderr:\n{stderr_buf}"
    );
    assert!(
        stderr_buf.contains("[e2e focus] done"),
        "trigger桩 did not complete (observer wait period was cut short). stderr:\n{stderr_buf}"
    );

    // Load-bearing: the focus restorer fired in response to NSWindowDidMoveNotification.
    // On Commit C (no install_focus_restorer wired), this marker is absent → test FAILS.
    // On Commit D (observer installed), this marker is emitted → test PASSES.
    assert!(
        stderr_buf.contains("[focus_restorer] fired"),
        "focus restorer observer did not fire on main window move — regression net hot. \
         stderr:\n{stderr_buf}"
    );
}

#[cfg(not(target_os = "macos"))]
#[test]
fn focus_restorer_fires_after_main_window_move() {
    // No-op on non-macOS. Windows variant would require similar marker emission from
    // the WM_EXITSIZEMOVE subclass handler, plus SendMessage-based trigger桩 since
    // programmatic SetWindowPos does NOT fire ENTER/EXITSIZEMOVE pair. Listed as
    // follow-up in spec §6.
}
