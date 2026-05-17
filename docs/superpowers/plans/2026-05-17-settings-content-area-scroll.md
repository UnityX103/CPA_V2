# Settings Content Area Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Settings shell fixed-height while only the Pencil `2RdBk / contentArea` equivalent scrolls.

**Architecture:** This is a CSS ownership fix. The settings window root and scale wrapper become fixed, clipped containers; the existing `.settings-content-scroll` remains the only vertical scroll viewport inside `.settings-content`, which maps to Pencil `NCXdZ` containing `2RdBk` plus the Apply overlay.

**Tech Stack:** React, TypeScript, Vitest, CSS text guards, Tauri window shell.

---

## File Structure

- Modify `app/src/ui/SettingsPanel.test.tsx`: add CSS guard coverage for settings-root overflow and the single Settings scroll owner.
- Modify `app/src/styles/global.css`: prevent `.settings-window-root` and `.settings-scale-content` from becoming document-level scroll containers.
- Modify `app/src/ui/SettingsPanel.css`: add the missing `overflow-x: hidden` guard to `.settings-content-scroll` so it is explicitly vertical-only.
- Do not modify `AUI/PUI.pen`: the current Pencil selection already identifies `2RdBk` as the scroll target.
- Do not modify `app/src-tauri/src/lib.rs`: existing settings window creation remains resizable with min bounds.

---

### Task 1: Add CSS Guards For Scroll Ownership

**Files:**
- Modify: `app/src/ui/SettingsPanel.test.tsx`
- Read: `app/src/styles/global.css`
- Read: `app/src/ui/SettingsPanel.css`

- [ ] **Step 1: Add a failing test for fixed shell and content-area scrolling**

In `app/src/ui/SettingsPanel.test.tsx`, inside `describe('SettingsPanel geometry', () => { ... })`, insert this test after `settings modal layer can cover the unscaled window while content scales` and before `ordinary Apply is an overlay and does not reserve tab layout space`:

```ts
    it('keeps root wrappers fixed while only contentArea scrolls vertically', () => {
        const globalCss = readFileSync(path.join(here, '../styles/global.css'), 'utf8');
        const settingsCss = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');

        const windowRoot = cssRule(globalCss, '.settings-window-root');
        const scaleContent = cssRule(globalCss, '.settings-scale-content');
        const panel = cssRule(settingsCss, '.settings-panel');
        const body = cssRule(settingsCss, '.settings-body');
        const content = cssRule(settingsCss, '.settings-content');
        const scroll = cssRule(settingsCss, '.settings-content-scroll');

        expect(cssDecl(windowRoot, 'overflow')).toBe('hidden');
        expect(cssDecl(scaleContent, 'height')).toBe('100%');
        expect(cssDecl(scaleContent, 'overflow')).toBe('hidden');
        expect(cssDecl(panel, 'height')).toBe('100%');
        expect(cssDecl(body, 'overflow')).toBe('hidden');
        expect(cssDecl(content, 'overflow')).toBe('hidden');
        expect(cssDecl(scroll, 'overflow-y')).toBe('auto');
        expect(cssDecl(scroll, 'overflow-x')).toBe('hidden');
        expect(settingsCss.match(/overflow-y:\s*auto\s*;/g)).toHaveLength(1);
    });
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx -t "keeps root wrappers fixed while only contentArea scrolls vertically"
```

Expected result:

```text
FAIL src/ui/SettingsPanel.test.tsx
AssertionError: expected 'auto' to be 'hidden'
```

The exact first assertion may point at `.settings-window-root` or `.settings-scale-content`; either failure is acceptable because the current CSS still lets the outer wrapper scroll or grow.

- [ ] **Step 3: Commit the failing test**

Run:

```bash
git add app/src/ui/SettingsPanel.test.tsx
git commit -m "test: lock settings content-area scroll ownership"
```

Expected result:

```text
[detached HEAD <sha>] test: lock settings content-area scroll ownership
 1 file changed
```

---

### Task 2: Move Scroll Ownership To The Content Area

**Files:**
- Modify: `app/src/styles/global.css`
- Modify: `app/src/ui/SettingsPanel.css`
- Test: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Update settings root wrappers**

In `app/src/styles/global.css`, replace the existing `.settings-window-root` block:

```css
.settings-window-root {
    --app-ui-scale: 1;
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: auto;
    background: transparent;
}
```

with:

```css
.settings-window-root {
    --app-ui-scale: 1;
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: transparent;
}
```

Then replace the existing `.settings-scale-content` block:

```css
.settings-scale-content {
    width: 100%;
    min-height: 100%;
    zoom: var(--app-ui-scale);
}
```

with:

```css
.settings-scale-content {
    width: 100%;
    height: 100%;
    overflow: hidden;
    zoom: var(--app-ui-scale);
}
```

- [ ] **Step 2: Make the content scroll container explicitly vertical-only**

In `app/src/ui/SettingsPanel.css`, replace the existing `.settings-content-scroll` block:

```css
.settings-content-scroll {
    flex: 1;
    min-height: 0;
    width: 100%;
    max-width: 100%;
    overflow-y: auto;
    padding-right: 4px;
    box-sizing: border-box;
}
```

with:

```css
.settings-content-scroll {
    flex: 1;
    min-height: 0;
    width: 100%;
    max-width: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 4px;
    box-sizing: border-box;
}
```

- [ ] **Step 3: Run the targeted test and verify it passes**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx -t "keeps root wrappers fixed while only contentArea scrolls vertically"
```

Expected result:

```text
PASS src/ui/SettingsPanel.test.tsx
```

- [ ] **Step 4: Run the full SettingsPanel test file**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected result:

```text
PASS src/ui/SettingsPanel.test.tsx
```

- [ ] **Step 5: Commit the implementation**

Run:

```bash
git add app/src/styles/global.css app/src/ui/SettingsPanel.css
git commit -m "fix: keep settings scroll inside content area"
```

Expected result:

```text
[detached HEAD <sha>] fix: keep settings scroll inside content area
 2 files changed
```

---

### Task 3: Verify Build And Manual Behavior

**Files:**
- Read: `app/src/styles/global.css`
- Read: `app/src/ui/SettingsPanel.css`
- Read: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Run all frontend tests**

Run:

```bash
cd app && npm test
```

Expected result:

```text
Test Files  10 passed
Tests       64 passed
```

If the total test count has changed on the current branch, require all test files to pass and record the actual count in the final implementation summary.

- [ ] **Step 2: Run the production build**

Run:

```bash
cd app && npm run build
```

Expected result:

```text
✓ built in
```

The TypeScript and Vite build must complete with exit code `0`.

- [ ] **Step 3: Launch the local app for visual verification**

Run:

```bash
./start.sh
```

Expected result:

```text
Server listening on ws://127.0.0.1:8039
```

or the existing startup output that confirms the Server check passed and Tauri dev launched.

- [ ] **Step 4: Manually verify Settings scroll behavior**

In the running app:

1. Open Settings.
2. Switch through Pomodoro, Online, Pet, and Global.
3. On tabs with content taller than the available area, scroll over the right content area.
4. Confirm the title, sidebar tabs, and Apply overlay position do not move.
5. Confirm the outer Settings shell does not produce a window-level scrollbar.

Expected result:

```text
Only the right content area scrolls. The Settings shell, header, sidebar, and Apply overlay stay fixed.
```

- [ ] **Step 5: Commit verification notes only if a checked artifact was added**

Do not commit screenshots or local logs by default. If a deliberate verification artifact is added later, commit it with:

```bash
git add <artifact-path>
git commit -m "test: capture settings content scroll verification"
```

Expected result when no artifact is needed:

```text
No commit for Task 3.
```

---

## Self-Review

- Spec coverage: Task 1 locks root overflow, fixed wrapper height, and single vertical scroll owner. Task 2 implements the CSS-only change. Task 3 verifies tests, build, and live Settings behavior.
- Scope: The plan does not touch Pencil, Rust window creation, bridge protocols, Pomodoro behavior, WebSocket reconnect logic, native hit-testing, or video playback.
- Type and selector consistency: Selectors match existing files: `.settings-window-root`, `.settings-scale-content`, `.settings-panel`, `.settings-body`, `.settings-content`, `.settings-content-scroll`.
- Placeholder scan: No placeholder markers or unspecified test steps remain.
