# Active App Logo And Title Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix foreground app logo rendering and add a persisted setting for showing or hiding foreground window titles.

**Architecture:** Keep native active-app collection in Rust and frontend display policy in React state. Add `showActiveAppWindowTitle` to the existing settings store, persistence, and bridge snapshot so the independent input-counter window mirrors the setting.

**Tech Stack:** React, TypeScript, Zustand, Vitest, Tauri 2 Rust, macOS AppKit.

---

### Task 1: Settings And Bridge State

**Files:**
- Modify: `app/src/domain/settings.ts`
- Modify: `app/src/domain/settingsPersistence.ts`
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Test: `app/src/domain/settings.test.ts`
- Test: `app/src/domain/settingsPersistence.test.ts`
- Test: `app/src/domain/bridge/host.test.ts`
- Test: `app/src/domain/bridge/client.test.ts`
- Test: `app/src/domain/bridge/protocol.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for `showActiveAppWindowTitle` defaulting to true, dispatching from settings-window mode, hydrating from persistence, saving with existing settings, and mirroring through bridge snapshots.

- [ ] **Step 2: Run tests to verify RED**

Run: `cd app && npx vitest run src/domain/settings.test.ts src/domain/settingsPersistence.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/domain/bridge/protocol.test.ts`

Expected: tests fail because the setting is not implemented.

- [ ] **Step 3: Implement state, persistence, and bridge fields**

Add `showActiveAppWindowTitle: boolean`, `setShowActiveAppWindowTitle(enabled: boolean)`, persistence v1-compatible loading with default true, and bridge snapshot/dispatch support.

- [ ] **Step 4: Verify GREEN**

Run: `cd app && npx vitest run src/domain/settings.test.ts src/domain/settingsPersistence.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/domain/bridge/protocol.test.ts`

Expected: selected tests pass.

### Task 2: Panel Display And Settings UI

**Files:**
- Modify: `app/src/ui/InputCounterPanel.tsx`
- Modify: `app/src/ui/InputCounterPanel.test.tsx`
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

Add tests proving the panel shows `window_title` only when `showActiveAppWindowTitle` is true, falls back to app name when disabled, and settings UI exposes the `显示打开的文件名` toggle.

- [ ] **Step 2: Run tests to verify RED**

Run: `cd app && npx vitest run src/ui/InputCounterPanel.test.tsx src/ui/SettingsPanel.test.tsx`

Expected: tests fail because the panel always prefers `window_title` and the UI toggle does not exist.

- [ ] **Step 3: Implement UI behavior**

Use `useSettingsStore((s) => s.showActiveAppWindowTitle)` in `InputCounterPanel`. Add the new toggle under global settings near the key-counter card.

- [ ] **Step 4: Verify GREEN**

Run: `cd app && npx vitest run src/ui/InputCounterPanel.test.tsx src/ui/SettingsPanel.test.tsx`

Expected: selected tests pass.

### Task 3: macOS PNG Icon Conversion

**Files:**
- Modify: `app/src-tauri/src/active_app.rs`
- Modify: `app/src/inputCounterWindowConfig.test.ts`

- [ ] **Step 1: Write failing static test**

Add a test that requires `active_app.rs` to emit `data:image/png;base64` and use PNG bitmap representation rather than `data:image/tiff;base64`.

- [ ] **Step 2: Run test to verify RED**

Run: `cd app && npx vitest run src/inputCounterWindowConfig.test.ts`

Expected: test fails because the source currently uses TIFF representation.

- [ ] **Step 3: Implement PNG conversion**

Update macOS icon conversion to create a bitmap representation and encode PNG data before base64 encoding.

- [ ] **Step 4: Verify GREEN**

Run: `cd app && npx vitest run src/inputCounterWindowConfig.test.ts`

Expected: selected test passes.

### Task 4: Full Verification

- [ ] **Step 1: Run focused tests**

Run: `cd app && npx vitest run src/domain/settings.test.ts src/domain/settingsPersistence.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/domain/bridge/protocol.test.ts src/ui/InputCounterPanel.test.tsx src/ui/SettingsPanel.test.tsx src/inputCounterWindowConfig.test.ts`

Expected: selected tests pass.

- [ ] **Step 2: Run full verification**

Run: `cd app && npm test && npm run build && cd src-tauri && PATH="/Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo check`

Expected: Vitest, build, and Rust checks exit 0.

- [ ] **Step 3: Runtime smoke check**

Use `./start.sh`, open settings, verify the new title-display toggle appears, and check the input-counter label behavior with the setting on/off if Accessibility permission allows binding a key.
