# Account Login Room Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix account login/create reliability, restore saved sessions on startup, hide room controls until login, and update the Pencil online-panel design source.

**Architecture:** Keep auth inside the existing `network` Zustand store and WebSocket protocol. The main window restores account sessions, the Settings mirror dispatches account actions through the bridge, and room controls render only after the mirrored account state is logged in. Pencil remains the visual source of truth for the online tab.

**Tech Stack:** Tauri 2, React 19, TypeScript, Zustand, Vitest/jsdom, Node.js `node:test`, `ws`, Pencil MCP.

---

## File Structure

- Modify `app/src/App.tsx`: call `restoreAccountSession()` once in the authoritative main window.
- Modify `app/src/App.test.tsx`: mock `useNetworkStore` and verify startup session restore.
- Modify `app/src/domain/network.ts`: make account errors retryable and keep `AUTH_REQUIRED` room guards.
- Modify `app/src/domain/network.test.ts`: add regression coverage for account error status recovery.
- Modify `app/src/ui/SettingsPanel.tsx`: hide room/history cards while logged out and translate account errors.
- Modify `app/src/ui/SettingsPanel.test.tsx`: update logged-out expectations and add translated error coverage.
- Modify `Server/src/protocol.js`: return stable `INVALID_ACCOUNT_INPUT` for invalid auth credentials.
- Modify `Server/test/protocol.test.js`: cover invalid auth input code.
- Modify `AUI/PUI.pen`: add account card and logged-out/logged-in online variants through Pencil MCP.

## Task 1: Account Error Recovery In Network Store

**Files:**
- Modify: `app/src/domain/network.ts`
- Modify: `app/src/domain/network.test.ts`

- [ ] **Step 1: Write the failing domain test**

Add this test inside `describe('NetworkSystem account auth', () => { ... })` in `app/src/domain/network.test.ts`:

```ts
it('returns account actions to a retryable guest state after account errors', async () => {
    await useNetworkStore.getState().createAccount('Alice', 'secret');
    await new Promise((r) => setTimeout(r, 5));

    latestSocket()?.onmessage?.({
        data: JSON.stringify({ type: 'error', error: 'USERNAME_TAKEN' }),
    } as MessageEvent);

    expect(useNetworkStore.getState().accountStatus).toBe('guest');
    expect(useNetworkStore.getState().accountError).toBe('USERNAME_TAKEN');

    await useNetworkStore.getState().login('Alice', 'wrong');
    await new Promise((r) => setTimeout(r, 5));

    latestSocket()?.onmessage?.({
        data: JSON.stringify({ type: 'error', error: 'INVALID_CREDENTIALS' }),
    } as MessageEvent);

    expect(useNetworkStore.getState().accountStatus).toBe('guest');
    expect(useNetworkStore.getState().accountError).toBe('INVALID_CREDENTIALS');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd app && npx vitest run src/domain/network.test.ts
```

Expected: the new test fails because `accountStatus` is currently set to `"error"` for account errors.

- [ ] **Step 3: Implement retryable account errors**

In `app/src/domain/network.ts`, add helpers near `normalizeAccountUser`:

```ts
function isAccountErrorCode(error: string): boolean {
    return error === 'USERNAME_TAKEN'
        || error === 'INVALID_CREDENTIALS'
        || error === 'INVALID_ACCOUNT_INPUT'
        || error === 'AUTH_REQUIRED';
}

function isAccountBusyStatus(status: AccountStatus): boolean {
    return status === 'checking' || status === 'creating' || status === 'loggingIn';
}
```

Then replace the account-error block in `handleMessage` with:

```ts
if (isAccountErrorCode(error)) {
    set({ accountStatus: 'guest', accountError: error, lastError: error });
    break;
}
```

Finally replace `socket.onerror` in `ensureSocket` with:

```ts
socket.onerror = () => {
    if (generation !== internal.generation) return;
    const next: Partial<NetworkStateShape> = { status: 'error', lastError: 'CONNECTION_ERROR' };
    if (isAccountBusyStatus(get().accountStatus)) {
        next.accountStatus = 'guest';
        next.accountError = 'CONNECTION_ERROR';
    }
    set(next);
};
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd app && npx vitest run src/domain/network.test.ts
```

Expected: all tests in `network.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/network.ts app/src/domain/network.test.ts
git commit -m "fix: keep account auth retryable"
```

## Task 2: Restore Account Session On Main Window Startup

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/App.test.tsx`

- [ ] **Step 1: Write the failing app lifecycle test**

In the hoisted mock object at the top of `app/src/App.test.tsx`, add `restoreAccountSession: vi.fn(() => Promise.resolve())`. Return it from the hoisted object.

Add this mock before importing `App`:

```ts
vi.mock('./domain/network', () => ({
    useNetworkStore: {
        getState: vi.fn(() => ({
            restoreAccountSession,
        })),
    },
}));
```

In `beforeEach`, add:

```ts
restoreAccountSession.mockClear();
restoreAccountSession.mockResolvedValue(undefined);
```

Add this test in `describe('main App window composition', () => { ... })`:

```ts
it('restores persisted account session on startup', async () => {
    render(<App />);

    await waitFor(() => expect(restoreAccountSession).toHaveBeenCalledTimes(1));
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd app && npx vitest run src/App.test.tsx
```

Expected: the new test fails because `App.tsx` does not call `restoreAccountSession()`.

- [ ] **Step 3: Implement startup restore**

In `app/src/App.tsx`, add:

```ts
import { useNetworkStore } from './domain/network';
```

Add this effect after the existing `useScaledWindowSize(...)` call:

```ts
useEffect(() => {
    void useNetworkStore.getState().restoreAccountSession();
}, []);
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd app && npx vitest run src/App.test.tsx
```

Expected: all tests in `App.test.tsx` pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/App.tsx app/src/App.test.tsx
git commit -m "fix: restore account session on startup"
```

## Task 3: Gate Room UI Behind Logged-In Account

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Update the failing UI tests**

In `app/src/ui/SettingsPanel.test.tsx`, replace the logged-out online-tab test with:

```ts
it('renders account login controls while logged out and hides room controls', () => {
    render(<SettingsPanel />);

    expect(screen.getByLabelText('账号')).toBeTruthy();
    expect(screen.getByLabelText('密码')).toBeTruthy();
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建账号' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '创建房间' })).toBeNull();
    expect(screen.queryByRole('button', { name: '加入房间' })).toBeNull();
    expect(screen.queryByText('历史房间')).toBeNull();
    expect(screen.queryByPlaceholderText('ROOM-001')).toBeNull();
});
```

Add this test near the account UI tests:

```ts
it('renders account errors as Chinese copy', () => {
    useNetworkStore.setState({
        accountStatus: 'guest',
        accountError: 'INVALID_CREDENTIALS',
    });

    render(<SettingsPanel />);

    expect(screen.getByText('用户名或密码错误')).toBeTruthy();
    expect(screen.queryByText('INVALID_CREDENTIALS')).toBeNull();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: the logged-out test fails because the room card still renders, and the error-copy test fails because raw error codes render.

- [ ] **Step 3: Implement error copy and UI gate**

In `app/src/ui/SettingsPanel.tsx`, add this helper above `OnlineTab`:

```ts
function accountErrorText(error: string): string {
    switch (error) {
        case 'USERNAME_TAKEN':
            return '用户名已存在';
        case 'INVALID_CREDENTIALS':
            return '用户名或密码错误';
        case 'INVALID_ACCOUNT_INPUT':
            return '账号或密码格式不正确';
        case 'INVALID_SESSION':
            return '登录已失效，请重新登录';
        case 'AUTH_REQUIRED':
            return '请先登录账号';
        case 'CONNECTION_ERROR':
            return '无法连接服务器';
        default:
            return '操作失败，请稍后重试';
    }
}
```

Inside `OnlineTab`, add after the `accountBusy` constant:

```ts
const accountError = net.accountError ? accountErrorText(net.accountError) : null;
```

Replace the raw account error render with:

```tsx
{accountError && <div className="error-text">{accountError}</div>}
```

Change the not-joined room block condition from:

```tsx
{!isJoined && (
```

to:

```tsx
{isLoggedIn && !isJoined && (
```

Remove this logged-out hint line from the join card:

```tsx
{!isLoggedIn && <div className="online-auth-hint">登录后可创建或加入联机房间</div>}
```

Keep the button `disabled` guards in place as a domain-aligned safety belt.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: all tests in `SettingsPanel.test.tsx` pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.test.tsx
git commit -m "fix: hide room controls until account login"
```

## Task 4: Stabilize Server Auth Input Error Code

**Files:**
- Modify: `Server/src/protocol.js`
- Modify: `Server/test/protocol.test.js`

- [ ] **Step 1: Write the failing protocol tests**

Add these tests to `Server/test/protocol.test.js` near the existing auth protocol tests:

```js
test('parseClientMessage returns INVALID_ACCOUNT_INPUT for invalid auth_create credentials', () =>
{
    assert.throws(
        () => parseClientMessage(JSON.stringify({
            v: PROTOCOL_VERSION,
            type: 'auth_create',
            username: '',
            password: 'secret'
        })),
        (error) => error instanceof ProtocolError && error.code === 'INVALID_ACCOUNT_INPUT'
    );
});

test('parseClientMessage returns INVALID_ACCOUNT_INPUT for invalid auth_login credentials', () =>
{
    assert.throws(
        () => parseClientMessage(JSON.stringify({
            v: PROTOCOL_VERSION,
            type: 'auth_login',
            username: 'Alice',
            password: ''
        })),
        (error) => error instanceof ProtocolError && error.code === 'INVALID_ACCOUNT_INPUT'
    );
});
```

- [ ] **Step 2: Run the focused server test and verify it fails**

Run:

```bash
cd Server && node --test test/protocol.test.js
```

Expected: the new tests fail because invalid auth credentials currently throw `INVALID_MESSAGE`.

- [ ] **Step 3: Implement stable auth input code**

In `Server/src/protocol.js`, replace this throw inside `normalizeAccountCredentials`:

```js
throw new ProtocolError('INVALID_MESSAGE', '账号或密码格式不正确');
```

with:

```js
throw new ProtocolError('INVALID_ACCOUNT_INPUT', '账号或密码格式不正确');
```

- [ ] **Step 4: Run the focused server test and verify it passes**

Run:

```bash
cd Server && node --test test/protocol.test.js
```

Expected: all protocol tests pass.

- [ ] **Step 5: Commit**

```bash
git add Server/src/protocol.js Server/test/protocol.test.js
git commit -m "fix(server): stabilize account input errors"
```

## Task 5: Update Pencil Online Panel Source

**Files:**
- Modify: `AUI/PUI.pen` through Pencil MCP only

- [ ] **Step 1: Read current Pencil online nodes**

Use Pencil MCP:

```json
{
  "filePath": "/Users/xpy/.codex/worktrees/9e89/CPA_V2/AUI/PUI.pen",
  "nodeIds": ["8Le5R", "7ffrm", "8QiHS", "brmHc", "Za5wE", "RPLJq"],
  "readDepth": 3,
  "resolveInstances": false
}
```

Expected: `8Le5R` contains `onlAutoRow`, `onlJoinCard`, `onlRoomCard`, `onlHistCard`, and `onlBusyOverlay`; it does not contain `onlAccountCard`.

- [ ] **Step 2: Add account cards to the reusable online panel**

Use `batch_design` with this script:

```js
U("8Le5R",{placeholder:true})
acct=I("8Le5R",{type:"frame",name:"onlAccountCard",layout:"vertical",gap:12,padding:16,cornerRadius:16,fill:"#F6F7F8",width:"fill_container"})
I(acct,{type:"text",name:"onlAccountTitle",content:"账号",fill:"#1A1A1A",fontFamily:"MaokenAssortedSans",fontSize:14,fontWeight:"700"})
row1=I(acct,{type:"frame",name:"onlAccountNameRow",layout:"vertical",gap:6,width:"fill_container"})
I(row1,{type:"text",name:"onlAccountNameLabel",content:"账号",fill:"#6B7280",fontFamily:"MaokenAssortedSans",fontSize:12,fontWeight:"600"})
I(row1,{type:"ref",name:"onlAccountNameInput",ref:"brmHc",width:"fill_container",descendants:{nYjoR:{content:"用户名"}}})
row2=I(acct,{type:"frame",name:"onlAccountPasswordRow",layout:"vertical",gap:6,width:"fill_container"})
I(row2,{type:"text",name:"onlAccountPasswordLabel",content:"密码",fill:"#6B7280",fontFamily:"MaokenAssortedSans",fontSize:12,fontWeight:"600"})
I(row2,{type:"ref",name:"onlAccountPasswordInput",ref:"brmHc",width:"fill_container",descendants:{nYjoR:{content:"密码"}}})
actions=I(acct,{type:"frame",name:"onlAccountActions",layout:"horizontal",gap:8,width:"fill_container"})
I(actions,{type:"ref",name:"onlCreateAccountBtn",ref:"RPLJq",width:"fill_container",descendants:{zgOkx:{content:"创建账号"}}})
I(actions,{type:"ref",name:"onlLoginBtn",ref:"Za5wE",width:"fill_container",descendants:{oNDTH:{content:"登录"}}})
summary=I("8Le5R",{type:"frame",name:"onlAccountSummaryCard",layout:"horizontal",alignItems:"center",justifyContent:"space_between",padding:16,cornerRadius:16,fill:"#F6F7F8",width:"fill_container",enabled:false})
I(summary,{type:"text",name:"onlAccountSummaryName",content:"Alice",fill:"#1A1A1A",fontFamily:"MaokenAssortedSans",fontSize:14,fontWeight:"700"})
I(summary,{type:"ref",name:"onlLogoutBtn",ref:"RPLJq",width:"fit_content",descendants:{zgOkx:{content:"退出登录"}}})
M(acct,"8Le5R",0)
M(summary,"8Le5R",1)
U("8Le5R",{placeholder:false})
```

Expected: the reusable online panel starts with logged-out account form, then disabled logged-in summary, then auto-connect.

- [ ] **Step 3: Add logged-out and logged-in variants**

Use `batch_design` with this script:

```js
loggedOut=C("8Le5R",document,{name:"onlPanel/logged-out",positionDirection:"bottom",positionPadding:100,descendants:{ArRDI:{enabled:false},EK2CF:{enabled:false},E3S4e:{enabled:false},onlAccountSummaryCard:{enabled:false}}})
U("7ffrm",{descendants:{onlAccountCard:{enabled:false},onlAccountSummaryCard:{enabled:true},EK2CF:{enabled:false}}})
U("8QiHS",{descendants:{onlAccountCard:{enabled:false},onlAccountSummaryCard:{enabled:true},ArRDI:{enabled:false},E3S4e:{enabled:false}}})
```

If descendant-name matching reports ambiguity, run `batch_get` on `8Le5R` and rerun the update using the concrete generated IDs for `onlAccountCard` and `onlAccountSummaryCard`.

- [ ] **Step 4: Verify Pencil layout**

Use Pencil MCP:

```json
{
  "filePath": "/Users/xpy/.codex/worktrees/9e89/CPA_V2/AUI/PUI.pen",
  "nodeIds": ["8Le5R", "7ffrm", "8QiHS"],
  "readDepth": 2,
  "resolveInstances": false
}
```

Then take screenshots:

```json
{
  "filePath": "/Users/xpy/.codex/worktrees/9e89/CPA_V2/AUI/PUI.pen",
  "nodeId": "8Le5R"
}
```

Expected: `8Le5R` contains account form nodes; `onlPanel/logged-out` exists; not-joined and joined variants use the account summary rather than the login form.

- [ ] **Step 5: Commit**

```bash
git add AUI/PUI.pen
git commit -m "design: add online account gate variants"
```

## Task 6: Full Verification

**Files:**
- Verify only

- [ ] **Step 1: Run frontend tests**

Run:

```bash
cd app && npm test
```

Expected: Vitest exits with code 0.

- [ ] **Step 2: Run server tests**

Run:

```bash
cd Server && npm test
```

Expected: Node test runner exits with code 0.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd app && npm run build
```

Expected: `tsc && vite build` exits with code 0.

- [ ] **Step 4: Inspect final git status**

Run:

```bash
git status --short
```

Expected: no unstaged or staged changes remain after the task commits.

- [ ] **Step 5: Commit verification fixes only when they exist**

If verification required a small fix, return to the task that owns the changed files and use that task's commit command with the exact touched paths. If no fixes were required, do not create an empty commit.


## Self-Review

Spec coverage:

- Startup session restore is covered by Task 2.
- Retryable login/create failure is covered by Task 1.
- Logged-out room panel hiding is covered by Task 3.
- Server auth input consistency is covered by Task 4.
- Pencil design source update is covered by Task 5.
- Full app/server verification is covered by Task 6.

Placeholder scan: checked for unresolved markers and found none.

Type consistency: `AccountStatus`, `NetworkStateShape`, `accountError`, `restoreAccountSession`, `createAccount`, `login`, and existing Pencil node names match the current code and MCP inspection.
