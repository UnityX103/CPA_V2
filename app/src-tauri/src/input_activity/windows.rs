use windows::Win32::{
    System::SystemInformation::GetTickCount,
    UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
};

pub(super) fn idle_milliseconds() -> Result<u64, String> {
    let mut input = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if !unsafe { GetLastInputInfo(&mut input) }.as_bool() {
        return Err("无法读取当前登录会话的键鼠活动时间".into());
    }
    // Both values are 32-bit millisecond ticks; subtraction must survive wrap.
    Ok(unsafe { GetTickCount() }.wrapping_sub(input.dwTime) as u64)
}
