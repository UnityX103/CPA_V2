use std::path::Path;
use std::process::Command;

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

pub fn ensure_entry_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub fn configure_child_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

pub fn trigger_kill_all() -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_K,
    };

    fn key_input(
        key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY,
        key_up: bool,
    ) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    dwFlags: if key_up {
                        KEYEVENTF_KEYUP
                    } else {
                        Default::default()
                    },
                    ..Default::default()
                },
            },
        }
    }

    let inputs = [
        key_input(VK_CONTROL, false),
        key_input(VK_K, false),
        key_input(VK_K, true),
        key_input(VK_CONTROL, true),
    ];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err("系统未能发送杀死所有快捷键".to_string());
    }
    Ok(())
}
