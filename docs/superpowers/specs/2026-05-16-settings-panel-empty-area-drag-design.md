# 设置面板空白区域拖拽 — 修复设计

- **日期**: 2026-05-16
- **作者**: Codex
- **状态**: 设计已获用户确认，等待用户 review 书面 spec
- **范围**: `app/src/ui/SettingsPanel.tsx`, `app/src/ui/SettingsPanel.test.tsx`
- **不在范围**: Tauri 原生窗口构建、passthrough 原生 hook、主 Pomodoro 面板拖拽、设置面板视觉重排

## 1. 问题

当前设置窗口只有 `.settings-head` 的 `onPointerDown` 会调用 `getCurrentWindow().startDragging()`。用户在设置面板的空白区域、内容 padding、卡片间隙或非控件背景上按住拖动时，不会触发原生窗口拖拽。

期望行为：设置面板内所有非交互控件的空白区域都能拖动窗口；按钮、输入框、下拉、滚动区域等交互元素保持原行为。

## 2. 方案选择

采用面板级 pointer down 捕获方案：

1. 在 `SettingsPanel` 根节点增加统一的 pointer down 处理。
2. 只处理左键 pointer down。
3. 如果事件目标位于交互元素内，则放行。
4. 如果事件目标是非交互空白区域或普通展示容器，则调用 `getCurrentWindow().startDragging()`。

不采用大面积 CSS `-webkit-app-region: drag`，因为设置面板内部控件多，靠 CSS 标记 `no-drag` 更容易漏掉输入、按钮或后续新增控件。

不采用分散容器绑定，因为规则会散落在多个布局节点上，后续设置页结构变化时容易再次出现局部空白不能拖的问题。

## 3. 交互边界

应当触发拖拽：

- 设置面板根背景。
- 标题栏非按钮区域。
- `.settings-body`、`.settings-content` 的 padding 空白。
- 卡片背景和卡片之间的空白，只要目标不是控件。

不应触发拖拽：

- `button`
- `input`
- `select`
- `textarea`
- `a`
- 带 `role="button"` 的元素
- 带显式 no-drag 标记的元素
- 其他未来加入 `data-no-window-drag` 的交互区域

滚动内容区域里的普通空白可以作为拖拽起点；但一旦目标是实际交互控件，不能抢事件。

## 4. 组件设计

`SettingsPanel.tsx` 增加一个小的本地 helper，例如 `isInteractiveDragTarget(target: EventTarget | null): boolean`。

helper 只负责 DOM 目标判断，不触碰 store、不发 invoke、不依赖 Tauri。这样测试可以稳定覆盖判断逻辑，后续如果增加新的控件类型，也只需要扩展这个 helper。

`SettingsPanel` 根节点绑定 `onPointerDown={onPanelPointerDown}`。标题栏可复用同一个处理函数，或者保留标题栏入口但委托到同一套 helper，避免标题栏和内容区出现两套规则。

## 5. 数据流

1. 用户在设置面板中 pointer down。
2. React handler 检查是否左键。
3. React handler 检查目标是否在交互元素或 no-drag 标记内。
4. 非交互目标调用 `getCurrentWindow().startDragging()`。
5. Tauri 接管原生窗口拖拽。

该流程不改变设置 store、不改变桥接协议，也不需要新增 Rust command。

## 6. 错误处理

`startDragging()` 在非 Tauri 或测试环境可能 reject。保持现有行为：catch 后吞掉错误，不向 UI 暴露。

如果 `event.target` 不是 `HTMLElement`，保守放行不拖拽，避免在异常事件目标上误判。

## 7. 测试

更新 `app/src/ui/SettingsPanel.test.tsx`：

- 保留现有标题栏 pointer down 触发拖拽测试。
- 保留关闭按钮 pointer down 不触发拖拽测试。
- 新增内容空白区域 pointer down 触发拖拽测试。
- 新增输入/按钮等交互目标不触发拖拽测试，至少覆盖设置页中已有的真实控件。

建议运行：

```bash
cd app
npm test -- SettingsPanel.test.tsx
```

如测试脚本不支持按文件筛选，则运行仓库已有前端测试命令。

## 8. 自检

- 没有引入新窗口生命周期或 passthrough 原生逻辑。
- 没有扩大到主 Pomodoro 面板行为。
- 规则明确区分可拖拽空白与不可拖拽交互控件。
- 测试直接覆盖用户反馈的空白区域不能拖拽问题。
