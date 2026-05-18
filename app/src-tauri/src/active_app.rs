use serde::Serialize;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct ActiveAppInfo {
    pub name: String,
    pub bundle_id: String,
    pub window_title: Option<String>,
    pub icon_data_url: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct AppWindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg(target_os = "macos")]
pub fn current_active_app() -> Option<ActiveAppInfo> {
    use objc2_app_kit::NSWorkspace;
    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    let name = app
        .localizedName()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let bundle_id = app
        .bundleIdentifier()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let window_title = current_active_app_window_title();
    let icon_data_url = current_active_app_icon_data_url();
    Some(ActiveAppInfo {
        name,
        bundle_id,
        window_title,
        icon_data_url,
    })
}

#[cfg(target_os = "macos")]
fn current_active_app_front_window() -> Option<(AppWindowBounds, Option<String>)> {
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::{CFString, CFStringRef};
    use core_graphics::window::{
        copy_window_info, kCGNullWindowID, kCGWindowAlpha, kCGWindowBounds, kCGWindowIsOnscreen,
        kCGWindowLayer, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
        kCGWindowName, kCGWindowOwnerPID,
    };
    use objc2_app_kit::NSWorkspace;

    fn typed_dict(dict: &CFDictionary) -> CFDictionary<CFString, CFType> {
        unsafe { CFDictionary::wrap_under_get_rule(dict.as_concrete_TypeRef()) }
    }

    fn static_key(key: CFStringRef) -> CFString {
        unsafe { CFString::wrap_under_get_rule(key) }
    }

    fn number_for_key(dict: &CFDictionary<CFString, CFType>, key: CFStringRef) -> Option<CFNumber> {
        let key = static_key(key);
        dict.find(&key)?.downcast::<CFNumber>()
    }

    fn named_number(dict: &CFDictionary<CFString, CFType>, key: &'static str) -> Option<f64> {
        let key = CFString::from_static_string(key);
        dict.find(&key)?.downcast::<CFNumber>()?.to_f64()
    }

    fn bounds_for_key(dict: &CFDictionary<CFString, CFType>) -> Option<AppWindowBounds> {
        let bounds = dict
            .find(&static_key(unsafe { kCGWindowBounds }))?
            .downcast::<CFDictionary>()?;
        let bounds = typed_dict(&bounds);
        Some(AppWindowBounds {
            x: named_number(&bounds, "X")?,
            y: named_number(&bounds, "Y")?,
            width: named_number(&bounds, "Width")?,
            height: named_number(&bounds, "Height")?,
        })
    }

    fn string_for_key(dict: &CFDictionary<CFString, CFType>, key: CFStringRef) -> Option<String> {
        let key = static_key(key);
        let s = dict.find(&key)?.downcast::<CFString>()?;
        let s = s.to_string();
        if s.trim().is_empty() {
            None
        } else {
            Some(s)
        }
    }

    let pid = {
        let workspace = NSWorkspace::sharedWorkspace();
        let app = workspace.frontmostApplication()?;
        app.processIdentifier()
    };

    let windows = copy_window_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    )?;

    for item in windows.get_all_values() {
        let item = unsafe { CFType::wrap_under_get_rule(item as CFTypeRef) };
        let Some(dict) = item.downcast::<CFDictionary>() else {
            continue;
        };
        let dict = typed_dict(&dict);
        let Some(owner_pid) =
            number_for_key(&dict, unsafe { kCGWindowOwnerPID }).and_then(|n| n.to_i32())
        else {
            continue;
        };
        if owner_pid != pid {
            continue;
        }
        let layer = number_for_key(&dict, unsafe { kCGWindowLayer })
            .and_then(|n| n.to_i32())
            .unwrap_or(-1);
        let is_onscreen = number_for_key(&dict, unsafe { kCGWindowIsOnscreen })
            .and_then(|n| n.to_i32())
            .unwrap_or(0);
        let alpha = number_for_key(&dict, unsafe { kCGWindowAlpha })
            .and_then(|n| n.to_f64())
            .unwrap_or(1.0);
        if layer != 0 || is_onscreen == 0 || alpha <= 0.0 {
            continue;
        }
        let Some(bounds) = bounds_for_key(&dict) else {
            continue;
        };
        if bounds.width >= 32.0 && bounds.height >= 32.0 {
            let title = string_for_key(&dict, unsafe { kCGWindowName });
            return Some((bounds, title));
        }
    }

    None
}

#[cfg(target_os = "macos")]
pub fn current_active_app_window_bounds() -> Option<AppWindowBounds> {
    current_active_app_front_window().map(|(bounds, _)| bounds)
}

#[cfg(target_os = "macos")]
pub fn current_active_app_window_title() -> Option<String> {
    current_active_app_front_window().and_then(|(_, title)| title)
}

#[cfg(target_os = "macos")]
pub fn current_active_app_icon_data_url() -> Option<String> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use objc2::runtime::AnyObject;
    use objc2::AnyThread;
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey, NSWorkspace,
    };
    use objc2_foundation::{NSDictionary, NSRect};

    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let icon = app.icon()?;
    let cg_image = unsafe {
        let mut proposed_rect = NSRect::new(Default::default(), icon.size());
        icon.CGImageForProposedRect_context_hints(
            &mut proposed_rect,
            None,
            None,
        )
    }?;
    let image_rep = NSBitmapImageRep::initWithCGImage(
        NSBitmapImageRep::alloc(),
        &cg_image,
    );
    let properties = NSDictionary::<NSBitmapImageRepPropertyKey, AnyObject>::new();
    let data = unsafe {
        image_rep.representationUsingType_properties(
            NSBitmapImageFileType::PNG,
            &properties,
        )
    }?;
    let encoded = STANDARD.encode(data.to_vec());
    Some(format!("data:image/png;base64,{encoded}"))
}

#[cfg(not(target_os = "macos"))]
pub fn current_active_app() -> Option<ActiveAppInfo> {
    None
}

#[cfg(not(target_os = "macos"))]
pub fn current_active_app_window_bounds() -> Option<AppWindowBounds> {
    None
}
