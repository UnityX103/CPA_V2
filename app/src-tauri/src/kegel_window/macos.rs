use objc2::{define_class, msg_send, rc::Retained, runtime::AnyObject, MainThreadOnly};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow};
use objc2_foundation::{MainThreadMarker, NSPoint};
use tauri::WebviewWindow;

define_class!(
    #[unsafe(super = NSView)]
    #[thread_kind = MainThreadOnly]
    #[name = "CPAKegelHitTestView"]
    #[ivars = ()]
    struct KegelHitTestView;
    impl KegelHitTestView {
        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: *mut AnyObject) -> bool { true }
        #[unsafe(method_id(hitTest:))]
        fn hit_test(&self, point: NSPoint) -> Option<Retained<NSView>> {
            let bounds = self.bounds();
            let x = point.x - bounds.origin.x;
            let y = bounds.size.height - (point.y - bounds.origin.y);
            if super::contains(x, y, bounds.size.width, bounds.size.height) {
                unsafe { msg_send![super(self), hitTest: point] }
            } else { None }
        }
    }
);
pub fn install(window: &WebviewWindow) -> Result<(), String> {
    let ptr = window.ns_window().map_err(|e| e.to_string())? as *mut NSWindow;
    let mtm = MainThreadMarker::new().ok_or("kegel hit testing needs the main thread")?;
    let ns_window = unsafe { &*ptr };
    let old = ns_window.contentView().ok_or("no kegel content view")?;
    let this = KegelHitTestView::alloc(mtm).set_ivars(());
    let view: Retained<KegelHitTestView> = unsafe { msg_send![super(this), initWithFrame: old.frame()] };
    old.removeFromSuperview();
    view.addSubview(&old);
    old.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
    ns_window.setContentView(Some(&*view));
    Ok(())
}
