//! macOS 实现：AXIsProcessTrusted（不弹窗）+ AXIsProcessTrustedWithOptions（弹窗）+ 让位 + 打开系统设置。

use std::os::raw::c_void;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    /// `Boolean AXIsProcessTrusted(void)` — 不弹窗，纯查询。返回 1=已授权 / 0=未授权。
    fn AXIsProcessTrusted() -> u8;
    /// `Boolean AXIsProcessTrustedWithOptions(CFDictionaryRef options)` — 当 options 含
    /// `kAXTrustedCheckOptionPrompt = kCFBooleanTrue` 时，未授权情况下系统会弹出 TCC 对话框。
    /// 函数本身**立即返回**，弹窗由 system server 异步显示。
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
}

pub fn is_trusted() -> bool {
    // Safety: 无副作用，无参数；被 framework 标注为线程安全。
    unsafe { AXIsProcessTrusted() != 0 }
}

pub fn open_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn()
        .map_err(|e| format!("open failed: {e}"))?;
    Ok(())
}

use core_foundation::base::TCFType;
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use objc2_app_kit::NSApplication;
use objc2_foundation::MainThreadMarker;

/// 调用 AXIsProcessTrustedWithOptions(prompt: true)。**必须在主线程调用**：
/// 调用方应在 Tauri 命令的 main-thread executor 内或通过 `tauri::async_runtime::spawn_blocking + run_on_main_thread` 触发。
pub fn prompt() {
    // kAXTrustedCheckOptionPrompt 是 framework 导出的字符串常量；用 CFString 字面量绕开链接复杂度。
    let key = CFString::from_static_string("AXTrustedCheckOptionPrompt");
    let value = CFBoolean::true_value();
    let opts: CFDictionary<CFString, CFBoolean> = CFDictionary::from_CFType_pairs(&[(key, value)]);
    // Safety: AXIsProcessTrustedWithOptions 接受 CFDictionaryRef；
    // to_untyped().as_concrete_TypeRef() 返回 CFDictionaryRef（即 *const __CFDictionary），
    // 转为 *const c_void 满足 extern "C" 签名。
    unsafe {
        AXIsProcessTrustedWithOptions(opts.to_untyped().as_concrete_TypeRef() as *const c_void);
    }
}

/// 让 App 失去 key application 状态，使刚弹出的系统对话框能拿到焦点。**必须在主线程**。
pub fn deactivate_app() {
    let mtm = match MainThreadMarker::new() {
        Some(m) => m,
        None => return, // 调用方失误也不 panic
    };
    let app = NSApplication::sharedApplication(mtm);
    // deactivate is main-thread-only; mtm above guarantees that.
    app.deactivate();
}
