# Account Auth Status Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent account creation/login success from leaving the 联机 tab in the incorrect `正在加入房间...` busy overlay.

**Architecture:** Keep the existing `network` Zustand store. Treat WebSocket connection for auth as transport setup; when auth completes without joining a room, reset `network.status` to `idle`. Keep Settings UI overlay scoped to room actions as a defensive display rule.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest/jsdom.

---

## File Structure

- Modify `app/src/domain/network.ts`: reset non-room connection status after auth results.
- Modify `app/src/domain/network.test.ts`: cover `auth_ok` and unexpected auth errors returning to non-busy state.
- Modify `app/src/ui/SettingsPanel.tsx`: keep the room busy overlay gated to logged-in non-account-busy room connection.
- Modify `app/src/ui/SettingsPanel.test.tsx`: cover account creation busy and logged-in idle states.

## Task 1: Reset Network Status After Auth Results

**Files:**
- Modify: `app/src/domain/network.ts`
- Modify: `app/src/domain/network.test.ts`

- [ ] **Step 1: Write failing tests**

In `app/src/domain/network.test.ts`, update the existing `createAccount sends auth_create and stores auth_ok` test by adding this assertion after `expect(useNetworkStore.getState().accountToken).toBe('token-1');`:

```ts
expect(useNetworkStore.getState().status).toBe('idle');
```

Add this test inside `describe('NetworkSystem account auth', () => { ... })`:

```ts
it('returns account actions to guest after unexpected server errors', async () => {
    await useNetworkStore.getState().createAccount('Alice', 'secret');
    await new Promise((r) => setTimeout(r, 5));

    latestSocket()?.onmessage?.({
        data: JSON.stringify({ type: 'error', error: 'INVALID_MESSAGE' }),
    } as MessageEvent);

    expect(useNetworkStore.getState().accountStatus).toBe('guest');
    expect(useNetworkStore.getState().accountError).toBe('INVALID_MESSAGE');
    expect(useNetworkStore.getState().status).toBe('idle');
});
```

- [ ] **Step 2: Run focused network test and verify it fails**

Run:

```bash
cd app && npx vitest run src/domain/network.test.ts
```

Expected: the auth-ok assertion fails because `status` remains `"connecting"`, and the unexpected-error test fails because `accountStatus` remains `"creating"`.

- [ ] **Step 3: Implement auth status reset**

In `app/src/domain/network.ts`, add this helper near `isAccountBusyStatus`:

```ts
function idleStatusWhenNotInRoom(state: NetworkStateShape): ConnectionStatus {
    return state.playerId ? state.status : 'idle';
}
```

In the `auth_ok` handler, include `status` in the `set({ ... })` object:

```ts
status: idleStatusWhenNotInRoom(get()),
```

In the `auth_logged_out` handler, include:

```ts
status: 'idle',
```

In the `INVALID_SESSION` handler, include:

```ts
status: 'idle',
```

Replace the account-error block with:

```ts
if (isAccountErrorCode(error) || isAccountBusyStatus(get().accountStatus)) {
    set({ status: 'idle', accountStatus: 'guest', accountError: error, lastError: error });
    break;
}
```

- [ ] **Step 4: Run focused network test and verify it passes**

Run:

```bash
cd app && npx vitest run src/domain/network.test.ts
```

Expected: all tests in `network.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/network.ts app/src/domain/network.test.ts
git commit -m "fix: reset network status after account auth"
```

## Task 2: Keep Room Busy Overlay Scoped To Room Actions

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Write failing UI tests**

In `app/src/ui/SettingsPanel.test.tsx`, replace the old `renders onlBusyOverlay when status is connecting` test with:

```ts
it('renders onlBusyOverlay when logged in and joining room', () => {
    useNetworkStore.setState({
        status: 'connecting',
        accountStatus: 'loggedIn',
        accountUser: { userId: 'u1', username: 'Alice' },
        accountToken: 'token',
    });
    render(<SettingsPanel />);
    expect(screen.getByText('正在加入房间…')).toBeTruthy();
});
```

Add this test near it:

```ts
it('does not render room busy overlay while creating an account', () => {
    useNetworkStore.setState({
        status: 'connecting',
        accountStatus: 'creating',
    });

    render(<SettingsPanel />);

    expect(screen.queryByText('正在加入房间…')).toBeNull();
});
```

- [ ] **Step 2: Run focused UI test and verify it fails**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: the new account-creation test fails because the overlay is still keyed only by `status === "connecting"`.

- [ ] **Step 3: Implement UI guard**

In `app/src/ui/SettingsPanel.tsx`, replace:

```ts
const connecting = net.status === 'connecting';
```

with:

```ts
const connecting = net.status === 'connecting' && isLoggedIn && !accountBusy;
```

Also update the nearby comment to say:

```ts
// connecting is shown as a full-card overlay (3aoUs onlBusyOverlay) during the initial room join.
```

- [ ] **Step 4: Run focused UI test and verify it passes**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: all tests in `SettingsPanel.test.tsx` pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.test.tsx
git commit -m "fix: scope room busy overlay to room actions"
```

## Task 3: Verification And Dev Server

**Files:**
- Verify only

- [ ] **Step 1: Run related frontend tests**

Run:

```bash
cd app && npx vitest run src/domain/network.test.ts src/ui/SettingsPanel.test.tsx
```

Expected: both files pass.

- [ ] **Step 2: Run build**

Run:

```bash
cd app && npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Start current-branch backend**

If another process owns port `8039`, stop it only when it is not this worktree's `Server` process. Then run:

```bash
cd Server && npm start
```

Expected: server logs `listening on ws://127.0.0.1:8039`.

- [ ] **Step 4: Start frontend dev server**

Run:

```bash
cd app && npm run dev -- --host 127.0.0.1 --port 1421
```

Expected: Vite logs `Local: http://127.0.0.1:1421/`.

- [ ] **Step 5: Start Tauri app against the 1421 dev server**

Run:

```bash
cd app && PATH="/opt/homebrew/Cellar/rustup/1.29.0/bin:$PATH" npm run tauri -- dev --config '{"build":{"beforeDevCommand":"","devUrl":"http://127.0.0.1:1421"}}'
```

Expected: Tauri runs `target/debug/app` and opens the desktop app.

## Self-Review

Spec coverage:

- Auth success returning to non-room idle state is covered by Task 1.
- Unexpected auth error returning inputs to editable state is covered by Task 1.
- Incorrect `正在加入房间...` overlay during account work is covered by Task 2.
- Manual test environment startup is covered by Task 3.

Placeholder scan: no placeholder instructions remain.

Type consistency: `NetworkStateShape`, `ConnectionStatus`, `accountStatus`, `status`, `auth_ok`, and existing UI test helpers match the current codebase.
