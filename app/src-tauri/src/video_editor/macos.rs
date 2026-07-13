#![allow(dead_code)]

use super::{runtime_target_for, ExecutableKind, RuntimeTarget};
use std::path::{Path, PathBuf};

fn runtime_roots(manifest_dir: &Path) -> Vec<PathBuf> {
    let executable = std::env::current_exe().ok();
    runtime_roots_for(manifest_dir, executable.as_deref(), cfg!(debug_assertions))
}

pub(super) fn runtime_roots_for(
    manifest_dir: &Path,
    executable: Option<&Path>,
    include_development_root: bool,
) -> Vec<PathBuf> {
    let runtime_target = runtime_target();
    let mut roots = Vec::new();
    if let Some(executable_dir) = executable.and_then(Path::parent) {
        roots.push(
            executable_dir
                .join("../Resources/video-runtime")
                .join(runtime_target.directory_name),
        );
    }
    if include_development_root {
        roots.push(
            manifest_dir
                .join("video-runtime")
                .join(runtime_target.directory_name),
        );
    }
    roots
}

fn runtime_executable(root: &Path, kind: ExecutableKind) -> PathBuf {
    match kind {
        ExecutableKind::Ffmpeg | ExecutableKind::Ffprobe => {
            root.join("bin").join(kind.program_name())
        }
        ExecutableKind::BackgroundRemover => {
            root.join("backgroundremover").join(kind.program_name())
        }
    }
}

pub(super) fn executable_candidates(kind: ExecutableKind, manifest_dir: &Path) -> Vec<PathBuf> {
    let name = kind.program_name();
    // Prefer the bundled runtime for the compiled architecture. The
    // platform-neutral resolver still puts an explicit CPA_* override first.
    let mut candidates = runtime_roots(manifest_dir)
        .into_iter()
        .map(|root| runtime_executable(&root, kind))
        .collect::<Vec<_>>();
    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from(format!("/usr/local/bin/{name}")));
    }
    candidates
}

pub(super) fn u2netp_model_candidates(manifest_dir: &Path, home: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = runtime_roots(manifest_dir)
        .into_iter()
        .map(|root| root.join("models/u2netp.pth"))
        .collect::<Vec<_>>();
    if cfg!(debug_assertions) {
        candidates.push(
            manifest_dir.join("../tmp/video-matting-lab/tools/BackgroundRemover/models/u2netp.pth"),
        );
        if let Some(home) = home {
            candidates.push(home.join(".u2net").join("u2netp.pth"));
        }
    }
    candidates
}

pub(super) fn runtime_root_for_path(path: &Path, manifest_dir: &Path) -> Option<PathBuf> {
    runtime_roots(manifest_dir)
        .into_iter()
        .find(|root| path.starts_with(root))
}

pub(super) fn runtime_target() -> RuntimeTarget {
    runtime_target_for("macos", std::env::consts::ARCH)
        .expect("CPA video editing supports macOS x86_64 and ARM64")
}
