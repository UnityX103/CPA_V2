//! macOS 实现：AXIsProcessTrusted（不弹窗）+ AXIsProcessTrustedWithOptions（弹窗）+ 让位 + 打开系统设置。
//! 真正的 AX 调用在后续 task 接上，这一步只占位返回 false 让 watcher / 前端流程可以先打通。

pub fn is_trusted() -> bool {
    false // TASK 3 will replace with real AXIsProcessTrusted call
}
