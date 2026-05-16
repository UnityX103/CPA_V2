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
