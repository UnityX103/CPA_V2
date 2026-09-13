#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
}
pub fn pressed() -> bool {
    unsafe { CGEventSourceButtonState(1, 0) }
}
