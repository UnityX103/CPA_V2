use super::spawn_child;
use std::fs;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{
    OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
};

fn fixture_command(role: &str, root: &Path) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    let module = module_path!().split_once("::").unwrap().1;
    command
        .args([
            "--exact",
            &format!("{module}::process_fixture"),
            "--ignored",
        ])
        .env("CPA_PROCESS_TEST_ROLE", role)
        .env("CPA_PROCESS_TEST_ROOT", root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn wait_until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !condition() {
        assert!(Instant::now() < deadline, "process fixture timed out");
        std::thread::sleep(Duration::from_millis(20));
    }
}

// Uses real OS processes, including a grandchild, so terminating only the direct
// child cannot make these tests pass. Every fixture has a bounded lifetime.
#[test]
#[ignore]
fn process_fixture() {
    let role = std::env::var("CPA_PROCESS_TEST_ROLE").unwrap();
    let root = PathBuf::from(std::env::var_os("CPA_PROCESS_TEST_ROOT").unwrap());
    if role == "leaf" {
        std::thread::sleep(Duration::from_secs(20));
    } else if role == "worker" {
        let mut leaf = fixture_command("leaf", &root).spawn().unwrap();
        fs::write(
            root.join("pids"),
            format!("{} {}", std::process::id(), leaf.id()),
        )
        .unwrap();
        let _ = leaf.wait();
    } else {
        let mut child = spawn_child(&mut fixture_command("worker", &root)).unwrap();
        wait_until(|| root.join("pids").exists());
        fs::write(root.join("ready"), "ready").unwrap();
        wait_until(|| root.join("stop").exists());
        if role == "stop" || role == "root-exited" {
            child.try_wait().unwrap();
            child.kill().unwrap();
            child.wait().unwrap();
        }
        drop(child);
    }
}

struct ProcessProbe(OwnedHandle);

impl ProcessProbe {
    fn new(pid: u32) -> Self {
        let handle =
            unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_TERMINATE, false, pid).unwrap() };
        Self(unsafe { OwnedHandle::from_raw_handle(handle.0) })
    }

    fn exited(&self, timeout_ms: u32) -> bool {
        unsafe { WaitForSingleObject(HANDLE(self.0.as_raw_handle()), timeout_ms) == WAIT_OBJECT_0 }
    }
}

impl Drop for ProcessProbe {
    fn drop(&mut self) {
        // Cleanup also runs on assertion failure, targeting only fixture handles.
        unsafe {
            let _ = TerminateProcess(HANDLE(self.0.as_raw_handle()), 1);
        }
    }
}

fn assert_tree_stops(mode: &str) {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("cpa-pet-process-{}-{stamp}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    let mut owner = fixture_command(mode, &root).spawn().unwrap();
    let _owner_cleanup = ProcessProbe::new(owner.id());
    let unrelated = fixture_command("leaf", &root).spawn().unwrap();
    let unrelated = ProcessProbe::new(unrelated.id());
    wait_until(|| root.join("ready").exists());
    let probes: Vec<_> = fs::read_to_string(root.join("pids"))
        .unwrap()
        .split_whitespace()
        .map(|pid| ProcessProbe::new(pid.parse().unwrap()))
        .collect();
    assert_eq!(probes.len(), 2);
    assert!(
        probes.iter().all(|probe| !probe.exited(0)),
        "fixtures must start alive"
    );
    if mode == "abort" {
        owner.kill().unwrap(); // No Drop or application exit callbacks can run.
    } else {
        if mode == "root-exited" {
            unsafe { TerminateProcess(HANDLE(probes[0].0.as_raw_handle()), 1) }.unwrap();
            assert!(probes[0].exited(3000));
            assert!(
                !probes[1].exited(0),
                "grandchild must outlive the root for this case"
            );
        }
        fs::write(root.join("stop"), "stop").unwrap();
    }
    let status = owner.wait().unwrap();
    let exited: Vec<_> = probes.iter().map(|probe| probe.exited(3000)).collect();
    fs::remove_dir_all(&root).unwrap();
    if mode != "abort" {
        assert!(status.success(), "owner failed: {status}");
    }
    assert!(
        exited.iter().all(|exited| *exited),
        "{mode}: pet processes survived host shutdown (child, grandchild): {exited:?}"
    );
    assert!(
        !unrelated.exited(0),
        "unrelated processes must remain alive"
    );
}

#[test]
fn stopping_module_terminates_entire_process_tree() {
    assert_tree_stops("stop");
}

#[test]
fn dropping_module_terminates_entire_process_tree() {
    assert_tree_stops("drop");
}

#[test]
fn host_termination_terminates_entire_process_tree() {
    assert_tree_stops("abort");
}

#[test]
fn stopping_after_root_exit_still_terminates_descendants() {
    assert_tree_stops("root-exited");
}
