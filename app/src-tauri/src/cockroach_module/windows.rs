use std::io;
use std::mem::size_of;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, ExitStatus};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::{
    OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
};

pub fn runtime_target() -> &'static str {
    #[cfg(target_arch = "x86_64")]
    {
        "windows-x86_64"
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        "unsupported"
    }
}

pub fn restore_archive_permissions(_path: &Path, _mode: Option<u32>) -> Result<(), String> {
    Ok(())
}

pub fn restore_archive_symlink(_target: &Path, _output: &Path) -> Result<(), String> {
    Err("Windows 蟑螂组件不允许符号链接".to_string())
}

pub fn ensure_entry_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

// The host owns the only job handle. Windows closes it even if CPA crashes or
// is terminated, and kills Electron plus all of its descendant processes.
pub struct ModuleChild {
    child: Child,
    job: OwnedHandle,
}

impl ModuleChild {
    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }

    pub fn kill(&mut self) -> io::Result<()> {
        unsafe { TerminateJobObject(HANDLE(self.job.as_raw_handle()), 1) }.map_err(io::Error::from)
    }

    pub fn wait(&mut self) -> io::Result<ExitStatus> {
        // Waiting only for Electron's main process can report success while
        // renderer windows still exist. Confirm the entire job is empty.
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            unsafe {
                QueryInformationJobObject(
                    HANDLE(self.job.as_raw_handle()),
                    JobObjectBasicAccountingInformation,
                    &mut info as *mut _ as *mut _,
                    size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    None,
                )
            }
            .map_err(io::Error::from)?;
            if info.ActiveProcesses == 0 {
                return self.child.wait();
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "宠物进程树未能退出",
                ));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

pub fn spawn_child(command: &mut Command) -> io::Result<ModuleChild> {
    // No name or inheritable security attributes: descendants must never hold
    // this handle open after the host exits.
    let handle = unsafe { CreateJobObjectW(None, None) }.map_err(io::Error::from)?;
    let job = unsafe { OwnedHandle::from_raw_handle(handle.0) };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    unsafe {
        SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    }
    .map_err(io::Error::from)?;

    // Attach before Electron can execute or spawn renderers. Assigning an
    // already running process leaves a race where descendants escape the job.
    command.creation_flags((CREATE_NO_WINDOW | CREATE_SUSPENDED).0);
    let mut child = command.spawn()?;
    let attach = unsafe { AssignProcessToJobObject(handle, HANDLE(child.as_raw_handle())) }
        .map_err(io::Error::from)
        .and_then(|()| resume_child(&child));
    if let Err(error) = attach {
        // Never continue with an unowned runtime (or leave a suspended child).
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    Ok(ModuleChild { child, job })
}

fn resume_child(child: &Child) -> io::Result<()> {
    // Stable Rust does not expose Child's primary thread handle. Since this
    // process has never run, its only thread is the suspended primary thread.
    let snapshot =
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) }.map_err(io::Error::from)?;
    let _snapshot = unsafe { OwnedHandle::from_raw_handle(snapshot.0) };
    let mut entry = THREADENTRY32 {
        dwSize: size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    unsafe { Thread32First(snapshot, &mut entry) }.map_err(io::Error::from)?;
    loop {
        if entry.th32OwnerProcessID == child.id() {
            let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID) }
                .map_err(io::Error::from)?;
            let _thread = unsafe { OwnedHandle::from_raw_handle(thread.0) };
            if unsafe { ResumeThread(thread) } == u32::MAX {
                return Err(io::Error::last_os_error());
            }
            return Ok(());
        }
        unsafe { Thread32Next(snapshot, &mut entry) }.map_err(io::Error::from)?;
    }
}

#[cfg(test)]
#[path = "windows_process_tests.rs"]
mod tests;
