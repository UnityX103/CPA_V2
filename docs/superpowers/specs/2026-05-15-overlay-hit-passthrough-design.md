# Overlay Hit-Test Passthrough Design

**Date:** 2026-05-15
**Status:** Draft, awaiting user review
**Scope:** `app/src-tauri/` + a thin frontend hook
**Platforms:** macOS + Windows (parity required, per `[[project-cross-platform]]`)

## 1. Problem

CPA_V2 主窗口在 `tauri.conf.json` 里被声明为 1100×680、`transparent: true`、`alwaysOnTop: true`、`decorations: false`。`set_ignore_cursor_events` 这条 Tauri command 虽然定义在 `lib.rs:10-12`，但前端代码里**从未调用过**。结果：一块 1100×680 的透明矩形永久压在所有窗口之上吞掉鼠标事件，导致用户在窗口覆盖区域内对其他 app 做的任何拖动（拖窗、拖选、文件拖放）全部被截断。

## 2. Goal

> 用户的鼠标光标在主窗口范围内移动时，**只有当光标落在可见 UI（番茄钟面板 / 远程花名册 / 未来的宠物精灵 / 设置面板）的实际像素区域时，事件才被本 app 接收；落在透明区域的任何拖动 / 点击 / 滚轮都原样透传给底下的 app。**

非目标：
- 不解决 macOS 辅助功能权限引导（`key_counter.rs` 既有逻辑保持）。
- 不解决 `tauri.conf.json` 把窗口建为 1100×680 是否合理（后续若决定改为多窗口拆分另立项）。
- 不修复 `key_counter` / `active_app` 的 Windows 实装（独立的 tech-debt 项）。
- MVP 仅覆盖**当前存在**的两个面板（PomodoroPanel、RemoteRoster）。未来的宠物精灵组件只需要在其顶层 ref 上挂同一个 `useHitRegion` 就能接入，不需要改 Rust 端 —— 本设计是「为加入做好准备」，但宠物本身不在本 PR 范围。

## 3. Constraints

- **跨平台对等。** macOS + Windows 必须同步交付；Linux 暂不在目标列表，但模块结构要让未来加 X11/Wayland 时不需要重写共享层。
- **不能用 `set_ignore_cursor_events`（macOS）或 `WS_EX_TRANSPARENT`（Windows）做整窗切换。** 这两个 API 都是窗口级开关，与 60Hz 光标轮询配合时会和鼠标移动产生竞态，已经在 CLAUDE.md「Non-obvious rules」里被显式禁止。
- **不动 Tauri capabilities。** `default.json` 只允许 `core:default`、`core:window:default`、`core:window:allow-start-dragging`、`core:event:default`；新增的命令照旧通过 `#[tauri::command]` 暴露，前端通过 `invoke` 调。
- **窗口拖动手势必须仍然工作。** PomodoroPanel 上的 `data-tauri-drag-region` 元素自然落在「UI 命中」范畴内，hitTest 命中即可走原有路径。
- **macOSPrivateApi 已开启** (`tauri.conf.json:34`)，可以直接动 `NSWindow.contentView`；Windows 上 SetWindowSubclass 不需要任何特权。
- **设置窗口**（独立 WebviewWindow，`lib.rs:32-44` 创建）目前也是透明无装饰的，但其内容铺满窗口、用户专注交互，无需 passthrough；本方案**不**改设置窗口。

## 4. Approach

采用「**原生 hit-test 重写**」：让操作系统在每次鼠标事件命中查询时，由我们的代码决定该点是属于本窗口还是穿透。

| 平台 | 机制 | 位置 |
|------|------|------|
| macOS | 子类化 `NSView`，重写 `hitTest:` 返回 `nil` 表示穿透 | 替换 `NSWindow.contentView` 为我们的子类视图，原 WKWebView 容器作为它的 subview |
| Windows | `SetWindowSubclass` 注入自定义 WndProc，处理 `WM_NCHITTEST` 返回 `HTTRANSPARENT` 表示穿透 | 顶层 HWND 上挂 subclass，WebView2 child HWND 不动 |

两侧共用：
- 同一份 `HitRegionStore`（Rust 端 `Mutex<HashMap<String, Rect>>`），记录所有「UI 命中区」的 window-local 矩形（CSS pixel）。
- 同一对 Tauri command：`register_hit_region(id, rect)` / `unregister_hit_region(id)`。
- 同一个前端 hook：`useHitRegion(ref, id)`，在挂载与每次布局变化时上报，卸载时清理。

为何不用更简单的方案？以下三条都评估过但被淘汰：

- **「Rust 60Hz 光标轮询 + `set_ignore_cursor_events` 切换」**：稳态 IPC 为零、实现最简，但整窗开关的竞态在快速拖动时偶现。CLAUDE.md 已明文禁止此路径。
- **「把窗口缩到 UI 包围盒，去掉 1100×680 大透明区」**：完全消除问题，但限制了未来宠物精灵在桌面自由移动的能力。
- **「读 WKWebView / WebView2 像素 alpha 做 per-pixel 命中」**：精度最高、无需前端注册区域；但读硬件加速 layer 的内容跨平台都难，且对 60fps 渲染有性能压力。

## 5. Architecture

```
app/src-tauri/src/
  passthrough/
    mod.rs               # 平台中立：HitRegionStore + register/unregister command
    macos.rs             # CPAPassthroughView (NSView subclass), install()
    windows.rs           # WndProc subclass, install()
    stub.rs              # 其他平台空实现，保证编译通过
  lib.rs                 # setup() 内调用 passthrough::install(&main_window, store)

app/src/
  domain/
    passthrough.ts       # useHitRegion(ref, id) 钩子 + 一个进程级 id 生成器
  ui/
    PomodoroPanel.tsx    # 顶层 div 挂 useHitRegion
    RemoteRoster.tsx     # 同上
    (未来) Pet.tsx        # 同上
```

### 5.1 Store

```rust
// passthrough/mod.rs
pub struct HitRegionStore {
    inner: Arc<Mutex<HashMap<String, Rect>>>,
}

#[derive(Clone, Copy, Debug)]
pub struct Rect { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

impl HitRegionStore {
    pub fn new() -> Self { ... }
    pub fn upsert(&self, id: String, rect: Rect) { ... }
    pub fn remove(&self, id: &str) { ... }
    pub fn hit_test(&self, x: f64, y: f64) -> bool { ... }
}
```

`Rect` 采用 window-local CSS pixel 坐标，原点左上角（与 `DOMRect` 一致）。平台层负责把 OS 事件坐标转到同样的坐标系再调 `hit_test`。

### 5.2 Tauri commands

```rust
#[tauri::command]
fn register_hit_region(state: State<HitRegionStore>, id: String, rect: Rect) {
    state.upsert(id, rect);
}

#[tauri::command]
fn unregister_hit_region(state: State<HitRegionStore>, id: String) {
    state.remove(&id);
}
```

注册在 `tauri::Builder::default().manage(HitRegionStore::new())` 之后；`invoke_handler` 把这两条加进现有列表。

### 5.3 macOS 实装

`passthrough/macos.rs`，依赖 `objc2`、`objc2-foundation`、`objc2-app-kit`（取代老的 `objc` crate）。

```rust
pub fn install(window: &WebviewWindow, store: Arc<HitRegionStore>) {
    // 1. 拿 NSWindow
    let ns_window: id = window.ns_window().expect("macos") as id;

    // 2. 动态注册一次类（用 OnceLock 保证全进程仅一次）
    let cls = ensure_class_registered();

    // 3. 实例化 CPAPassthroughView，写入 store 指针
    let view: id = unsafe { msg_send![cls, alloc] };
    let view: id = unsafe { msg_send![view, init] };
    unsafe { (*view).set_ivar("rust_store", Arc::into_raw(store) as *const c_void); }

    // 4. 把原 contentView 取下、装进我们的 view
    let old_content: id = unsafe { msg_send![ns_window, contentView] };
    let frame: NSRect = unsafe { msg_send![old_content, frame] };
    unsafe {
        let _: () = msg_send![view, setFrame: frame];
        let _: () = msg_send![view, addSubview: old_content];
        let _: () = msg_send![old_content, setAutoresizingMask:
            NSViewWidthSizable | NSViewHeightSizable];
        let _: () = msg_send![ns_window, setContentView: view];
    }
}

extern "C" fn hit_test(this: &Object, _: Sel, point: NSPoint) -> id {
    let store = unsafe {
        let ptr = *this.get_ivar::<*const c_void>("rust_store");
        &*(ptr as *const HitRegionStore)
    };
    // NSPoint 在 super-view 坐标系；contentView 的 super 是 frameView。
    // 我们装在 contentView 这层，super 是 NSWindow 的 frameView，点是 window-local 但 Y 翻转。
    let nsview: id = this as *const _ as id;
    let bounds: NSRect = unsafe { msg_send![nsview, bounds] };
    let x = point.x;
    let y = bounds.size.height - point.y; // AppKit 左下原点 → 左上原点
    if store.hit_test(x, y) {
        // 命中：把 hitTest 委托给原 contentView (WKWebView 容器)
        let sub: id = unsafe {
            let subs: id = msg_send![nsview, subviews];
            msg_send![subs, firstObject]
        };
        unsafe { msg_send![sub, hitTest: point] }
    } else {
        nil
    }
}
```

关键属性：
- `ignoresMouseEvents` 维持默认 `NO`。透传完全由 `hitTest:` 返回值决定。
- AppKit 在每次鼠标事件查询时调一次 `hitTest:`，无轮询、无定时器。
- **实装使用 `objc2::declare_class!` 宏**而非手写 `objc_allocateClassPair` + `class_addMethod`；上面伪代码用 `msg_send!` 只是为了示意调用关系。`declare_class!` 提供 ivar 类型安全、生命周期保证、自动 retain/release。

### 5.4 Windows 实装

`passthrough/windows.rs`，依赖 `windows` crate（Microsoft 官方）。

```rust
pub fn install(window: &WebviewWindow, store: Arc<HitRegionStore>) {
    let hwnd = HWND(window.hwnd().expect("windows").0 as _);
    // 把 store 句柄塞进 subclass data
    let data = Box::into_raw(Box::new(store));
    unsafe {
        SetWindowSubclass(
            hwnd,
            Some(subclass_proc),
            SUBCLASS_ID,
            data as usize,
        );
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM,
    _id: usize, ref_data: usize,
) -> LRESULT {
    if msg == WM_NCHITTEST {
        let store = &*(ref_data as *const HitRegionStore);
        // lparam 的低/高位是 screen coords
        let screen_x = (lparam.0 as i32) & 0xFFFF;
        let screen_y = ((lparam.0 as i32) >> 16) & 0xFFFF;
        let mut pt = POINT { x: screen_x, y: screen_y };
        ScreenToClient(hwnd, &mut pt);
        // 转 DPI-aware CSS pixels（Tauri 默认 logical = physical / scale）
        let scale = get_dpi_scale(hwnd);
        let x = pt.x as f64 / scale;
        let y = pt.y as f64 / scale;
        if store.hit_test(x, y) {
            // 落到 UI 上：让 Windows 正常路由（WebView2 子窗口接管）
            return LRESULT(HTCLIENT as isize);
        } else {
            return LRESULT(HTTRANSPARENT as isize);
        }
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}
```

关键属性：
- 不动 `WS_EX_TRANSPARENT` / `WS_EX_LAYERED`。透明本身由 `WS_EX_LAYERED + per-pixel alpha`（Tauri 默认设了）保持；命中决策只看 `WM_NCHITTEST` 返回值。
- `HTTRANSPARENT` 是 Windows 标准做法：返回该值时 OS 视该窗口在此点为不存在，事件传到 z-order 下一个窗口。
- 卸载时配对调用 `RemoveWindowSubclass` 并 `Box::from_raw` 回收 store 句柄。挂在 `RunEvent::ExitRequested|Exit` 的清理路径上。

### 5.5 前端

`app/src/domain/passthrough.ts`：

```ts
let counter = 0;
const newId = (prefix: string) => `${prefix}-${++counter}`;

export function useHitRegion(
    ref: React.RefObject<HTMLElement | null>,
    label: string,
) {
    const idRef = useRef<string>();
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const id = newId(label);
        idRef.current = id;

        const report = () => {
            const r = el.getBoundingClientRect();
            invoke('register_hit_region', {
                id,
                rect: { x: r.left, y: r.top, w: r.width, h: r.height },
            });
        };

        report();
        const ro = new ResizeObserver(report);
        ro.observe(el);
        // 位置变化（拖窗、设置面板浮动）也要重报
        const mo = new MutationObserver(report);
        mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
        window.addEventListener('resize', report);

        return () => {
            ro.disconnect();
            mo.disconnect();
            window.removeEventListener('resize', report);
            invoke('unregister_hit_region', { id });
        };
    }, [ref, label]);
}
```

接入点（侵入只在顶层 div）：
- `PomodoroPanel.tsx`: `useHitRegion(rootRef, 'pomodoro-panel')`
- `RemoteRoster.tsx`: `useHitRegion(rootRef, 'remote-roster')`

## 6. Edge cases & failure modes

| 场景 | 行为 |
|------|------|
| 应用刚启动、前端还没注册任何 rect | Store 空 → `hit_test` 一律返回 false → **整窗透明可穿透**。这是 OK 的初始状态：透明像素本来也没什么可点的。 |
| 主窗口被用户拖动（OS 级窗口拖动） | `hitTest:` / `WM_NCHITTEST` 仍按 rect 集判定；拖动手势从 `data-tauri-drag-region` 元素发起，那些元素位于 panel rect 内，命中正常。 |
| DPR 变化（macOS 切换外接屏 / Windows DPI 改变） | `ResizeObserver` 在视口/布局变化时会重新触发；Windows 侧每次 `WM_NCHITTEST` 现取 `GetDpiForWindow` 而非缓存。 |
| 前端 panic 没卸载 hook | Rust 端永久持有该 rect → 该区域永远命中本窗口。视觉上看不到 UI 但点击会卡。缓解：(1) 同 id 的 `register_hit_region` 会 upsert 覆盖，新一次挂载会替换；(2) 监听 `WindowEvent::Destroyed` 与 webview 的 `tauri::WebviewEvent` 重载信号，重置整张 store 表（在 `lib.rs::run()` 的 `app.run()` 闭包里 match）。 |
| macOS `ns_window()` 返回 None（理论上不会，但兜底） | 跳过 install，写一行 `eprintln!`；窗口退化为「无 passthrough」状态，与今天一致。 |
| Windows `SetWindowSubclass` 失败 | 同上，记录后跳过。Tauri 现有 IPC 不受影响。 |
| 设置窗口 (`settings`) | 不安装 passthrough，保持现行行为。窗口铺满 UI，无穿透需求。 |
| 多显示器 | macOS：`NSWindow.contentView.hitTest:` 收到的 point 始终是 window-local。Windows：`ScreenToClient` 已经做了到 client area 的转换。两侧都不受多显示器影响。 |
| 拖入文件到本 app | 落到 panel rect 内被正常接收（macOS drag-and-drop / Windows OLE drop 走 WebView 标准路径）；落到透明区由下层 app 接收，不被截断。 |

## 7. Testing

平台原生代码很难在 vitest 里直接测，按层划分：

**纯 Rust 单测**（`passthrough/mod.rs`，无平台依赖）：
- `HitRegionStore::hit_test`：空集合 / 单矩形命中-未命中 / 多矩形覆盖 / 矩形 upsert 同 id / remove 后再查。

**前端单测**（`app/src/domain/passthrough.test.ts`，vitest + jsdom）：
- mock `invoke`：`useHitRegion` 挂载触发一次 `register_hit_region`；ResizeObserver 触发重报；卸载触发 `unregister_hit_region`。
- 验证 id 唯一性（多个 hook 实例不冲突）。

**手测 checklist**（macOS + Windows 各一遍）：
1. 启动 app，把窗口移到 Finder/资源管理器 之上 → 在透明区域拖文件、拖选 → 不受影响。
2. 把光标移到 PomodoroPanel 上 → 按钮、拖动手柄、滚轮全部正常。
3. 在 PomodoroPanel 上按下并拖出到透明区 → OS 级窗口拖动正常完成。
4. 触发 `RemoteRoster` 出现 → 该区域立即变为命中区，其他 app 的拖动到这块会被本窗口接管。
5. `cmd-tab` / `alt-tab` 切走再回来 → passthrough 行为不变。
6. 4K 屏 + DPR 2x → 命中边界与可视边界一致（无 1-2px 偏差）。
7. 系统设置缩放从 100% 改到 150%（Windows）/ 切换外接屏（macOS）→ 重新热加载后命中边界仍对齐。

## 8. Out of scope (follow-ups)

- 把 `key_counter.rs` 的 Windows 版本（`SetWindowsHookEx(WH_KEYBOARD_LL, ...)`) 实装。
- 把 `active_app.rs` 的 Windows 版本（`GetForegroundWindow` + `QueryFullProcessImageName`）实装。
- 评估把主窗口从 1100×680 拆成多个尺寸贴合 UI 的小窗口，作为长期更稳定方案（与本方案并不冲突）。
- 鼠标移到 UI 区域时的指针提示（cursor 在 hitTest 阶段不会变，是 OS 行为；这一点也无需我们处理）。
