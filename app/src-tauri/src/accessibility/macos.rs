//! macOS 实现：AXIsProcessTrusted（不弹窗）+ AXIsProcessTrustedWithOptions（弹窗）+ 让位 + 打开系统设置。

use std::os::raw::c_void;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    /// `Boolean AXIsProcessTrusted(void)` — 不弹窗，纯查询。返回 1=已授权 / 0=未授权。
    fn AXIsProcessTrusted() -> u8;
    /// `Boolean AXIsProcessTrustedWithOptions(CFDictionaryRef options)` — 当 options 含
    /// `kAXTrustedCheckOptionPrompt = kCFBooleanTrue` 时，未授权情况下系统会弹出 TCC 对话框。
    /// 函数本身**立即返回**，弹窗由 system server 异步显示。
    #[allow(dead_code)]
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
}

pub fn is_trusted() -> bool {
    // Safety: 无副作用，无参数；被 framework 标注为线程安全。
    unsafe { AXIsProcessTrusted() != 0 }
}
