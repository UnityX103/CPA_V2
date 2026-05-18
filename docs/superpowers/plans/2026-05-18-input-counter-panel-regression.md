# Input Counter Panel Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix input-counter toggle performance, binding capture, and independent panel visibility regressions.

**Architecture:** Keep the main window as the authoritative store and mirror state into secondary windows. Make native input-counter visibility depend on enabled captured entries, and reduce high-frequency bridge payloads by omitting active-app icon data from count-only snapshots.

**Tech Stack:** React, TypeScript, Zustand, Vitest, Tauri 2 Rust commands.

---

### Task 1: Visibility Gate And Panel Rendering

**Files:**
- Modify: `app/src/domain/bindingKey.ts`
- Modify: `app/src/domain/inputCounterWindow.ts`
- Modify: `app/src/ui/InputCounterPanel.tsx`
- Test: `app/src/domain/inputCounterWindow.test.ts`
- Test: `app/src/ui/InputCounterPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

Add tests proving that the native input-counter window stays hidden when `panelEnabled=true` but no enabled entry has `keyCode >= 0`, shows after a bound enabled key appears, and hides when that entry is disabled or removed. Update component tests so the panel returns `null` when there is no visible bound key.

- [ ] **Step 2: Run tests to verify RED**

Run: `cd app && npx vitest run src/domain/inputCounterWindow.test.ts src/ui/InputCounterPanel.test.tsx`

Expected: tests fail because the hook currently shows on `panelEnabled` alone and the component currently renders the focused-app-only panel.

- [ ] **Step 3: Implement visibility helper**

Export `isVisibleBindingEntry(entry)` and `hasVisibleInputCounterEntries(entries)` from `bindingKey.ts`, using `entry.enabled && entry.keyCode >= 0`.

- [ ] **Step 4: Apply visibility helper**

Update `useInputCounterWindowController` to subscribe to `panelEnabled` and visible-entry count, then invoke `show_input_counter_window` only when both conditions are true. Update `InputCounterPanel` to return `null` when either `panelEnabled` is false or visible-entry count is zero.

- [ ] **Step 5: Verify GREEN**

Run: `cd app && npx vitest run src/domain/inputCounterWindow.test.ts src/ui/InputCounterPanel.test.tsx`

Expected: all selected tests pass.

### Task 2: Bridge Payload And Binding Dispatch

**Files:**
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Test: `app/src/domain/bridge/host.test.ts`
- Test: `app/src/domain/bridge/client.test.ts`
- Test: `app/src/domain/bridge/protocol.test.ts`
- Test: `app/src/domain/bindingKey.test.ts`

- [ ] **Step 1: Write failing tests**

Add host/client tests proving binding-key count snapshots do not include `activeApp.icon_data_url`, while initial or active-app-change snapshots can still include it. Add dispatch tests confirming `addEntry`, `beginCapture`, and `setPanelEnabled` route to the authoritative main store.

- [ ] **Step 2: Run tests to verify RED**

Run: `cd app && npx vitest run src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/domain/bridge/protocol.test.ts src/domain/bindingKey.test.ts`

Expected: tests fail because snapshots currently always clone `icon_data_url` into every bridge payload.

- [ ] **Step 3: Implement lightweight snapshot mode**

Add a `buildSnapshot({ includeActiveAppIcon?: boolean } = {})` option. When false, clone `activeApp` without `icon_data_url`; when true, include it. Use `includeActiveAppIcon=true` for explicit state requests and active-app-change sends, and false for binding-key count updates.

- [ ] **Step 4: Preserve dispatch routing**

Keep settings-window actions as dispatch-only, and ensure `applyDispatch` still routes `addEntry`, `beginCapture`, and `setPanelEnabled` to the main store.

- [ ] **Step 5: Verify GREEN**

Run: `cd app && npx vitest run src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/domain/bridge/protocol.test.ts src/domain/bindingKey.test.ts`

Expected: all selected tests pass.

### Task 3: Integration Verification

**Files:**
- Verify only: no planned production edits unless earlier tasks reveal a compile-only integration issue.

- [ ] **Step 1: Run focused test set**

Run: `cd app && npx vitest run src/domain/inputCounterWindow.test.ts src/ui/InputCounterPanel.test.tsx src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/domain/bindingKey.test.ts`

Expected: selected tests pass.

- [ ] **Step 2: Run full verification**

Run: `cd app && npm test && npm run build && cd src-tauri && PATH="/Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo check`

Expected: Vitest, TypeScript/Vite build, and Rust `cargo check` all exit 0.

- [ ] **Step 3: Runtime smoke check**

If the app can launch locally, use `./start.sh`, open settings, toggle key counter, add a binding, press a captured key, and confirm the input-counter window shows only after the binding exists and updates count without visible lag.
