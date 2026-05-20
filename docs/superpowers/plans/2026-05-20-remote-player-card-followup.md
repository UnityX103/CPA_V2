# Remote Player Card Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the remote player card pin button with Pencil node `epxz9` and make remote synced key counters render reliably in node `oCExj`.

**Architecture:** Keep the accepted independent remote-player window architecture. The UI fix is local to `PlayerCard`; the sync fix is validated through the existing `RemoteState.bindingKey` and bridge snapshot path instead of adding a new WebSocket event. Tests prove the card structure, key pill visibility, mirror cloning, and remote-card route behavior.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Testing Library, Tauri 2 webview windows, Pencil MCP as source of truth.

---

## File Structure

- Modify `app/src/ui/PlayerCard.tsx`: move the pin button into `.pc-content`, normalize remote `bindingKey`, and hide empty key pills.
- Modify `app/src/ui/PlayerCard.css`: keep `.pc-content` as the containing block for `.pc-pin`; update comments to match Pencil hierarchy.
- Modify `app/src/ui/PlayerCard.test.tsx`: add failing tests for `epxz9` hierarchy and `oCExj` visibility rules.
- Modify `app/src/RemotePlayerCardApp.test.tsx`: prove a routed remote card displays mirrored `bindingKey`.
- Modify `app/src/domain/bridge/client.test.ts`: prove snapshot cloning preserves remote `bindingKey`.
- Modify `app/src/domain/bridge/host.test.ts`: prove `bindingKeySig` catches press-count changes and fixed remote labels remain mirror targets.

### Task 1: Add PlayerCard Regression Tests

**Files:**
- Modify: `app/src/ui/PlayerCard.test.tsx`

- [ ] **Step 1: Add helper imports and tests for pin hierarchy and key pill display**

Add these tests inside `app/src/ui/PlayerCard.test.tsx` after the existing active-app metadata tests and before the native drag tests:

```typescript
describe('PlayerCard Pencil hierarchy and remote key counter', () => {
    it('places the pin button inside the content stack so epxz9 is relative to D3ZIc', () => {
        const { container } = render(<PlayerCard player={player(state())} />);
        const content = container.querySelector('.pc-content');
        const pin = screen.getByRole('button', { name: '固定远端玩家卡牌' });

        expect(content).toBeTruthy();
        expect(content?.contains(pin)).toBe(true);
        expect(pin.parentElement).toBe(content);
    });

    it('renders oCExj key counter pill when the remote player broadcasts a synced key', () => {
        const { container } = render(<PlayerCard player={player(state({
            bindingKey: { keyLabel: 'Space', pressCount: 7 },
        }))} />);

        const timeRow = container.querySelector('.pc-time-row');
        expect(timeRow).toBeTruthy();
        expect(screen.getByText('Space')).toBeTruthy();
        expect(screen.getByText('7')).toBeTruthy();
    });

    it('hides oCExj key counter pill when bindingKey is null or has an empty label', () => {
        const { container, rerender } = render(<PlayerCard player={player(state({
            bindingKey: null,
        }))} />);

        expect(container.querySelector('.pc-time-row')).toBeNull();

        rerender(<PlayerCard player={player(state({
            bindingKey: { keyLabel: '   ', pressCount: 3 },
        }))} />);

        expect(container.querySelector('.pc-time-row')).toBeNull();
        expect(screen.queryByText('3')).toBeNull();
    });
});
```

- [ ] **Step 2: Run the focused test and verify at least the pin hierarchy test fails**

Run:

```bash
cd app
npx vitest run src/ui/PlayerCard.test.tsx
```

Expected: FAIL on `pin.parentElement` or `.pc-content.contains(pin)` because `.pc-pin` is currently a direct child of `.pc-card`. Existing tests may pass or fail independently; capture the first failure before editing implementation.

- [ ] **Step 3: Commit the failing tests**

Run:

```bash
git add app/src/ui/PlayerCard.test.tsx
git commit -m "test: cover remote player card follow-up"
```

Expected: commit succeeds with only the test file staged.

### Task 2: Fix PlayerCard Hierarchy and BindingKey Normalization

**Files:**
- Modify: `app/src/ui/PlayerCard.tsx`
- Modify: `app/src/ui/PlayerCard.css`
- Test: `app/src/ui/PlayerCard.test.tsx`

- [ ] **Step 1: Move pin into `.pc-content` and hide invalid key pills**

In `app/src/ui/PlayerCard.tsx`, replace the `binding` assignment and returned JSX with this structure:

```typescript
    const rawBinding = player.state?.bindingKey ?? null;
    const binding = rawBinding && rawBinding.keyLabel.trim()
        ? {
            keyLabel: rawBinding.keyLabel.trim(),
            pressCount: Math.max(0, Number.isFinite(rawBinding.pressCount) ? Math.trunc(rawBinding.pressCount) : 0),
        }
        : null;
```

Then make the returned tree place the pin button inside `.pc-content`, after the footer:

```tsx
    return (
        <div className="pc-card" onPointerDown={onCardPointerDown}>
            <div className="pc-content">
                <div className="pc-row pc-row-head">
                    <div className="pc-name-col">
                        <span className="pc-name">{player.playerName || '远端玩家'}</span>
                        <span className="pc-phase-badge" style={{ backgroundColor: badge.bg }}>
                            <span className="pc-phase-dot" />
                            <span className="pc-phase-text">{badge.label}</span>
                        </span>
                    </div>
                    {binding && (
                        <div className="pc-time-row">
                            <span className="pc-pill" title={`${binding.keyLabel} × ${binding.pressCount}`}>
                                <span className="pc-pill-key">{binding.keyLabel}</span>
                                <span className="pc-pill-count">{binding.pressCount}</span>
                            </span>
                        </div>
                    )}
                </div>

                <div className="pc-divider" />

                <div className="pc-footer">
                    <span className="pc-foot-icon" aria-hidden>
                        {appIcon ? (
                            <img className="pc-app-img" src={appIcon} alt="" draggable={false} />
                        ) : (
                            <AppWindowIcon />
                        )}
                    </span>
                    <span className="pc-foot-text" title={appName}>{appName}</span>
                </div>

                <button
                    type="button"
                    className="pc-pin"
                    aria-label="固定远端玩家卡牌"
                    title="固定远端玩家卡牌"
                    data-no-window-drag
                >
                    <PinIcon />
                </button>
            </div>
        </div>
    );
```

- [ ] **Step 2: Update the CSS comment so future edits keep the right containing block**

In `app/src/ui/PlayerCard.css`, replace the final `.pc-pin` comment with:

```css
/* pin btn epxz9: absolute (110, 50) inside D3ZIc / .pc-content.
 * Keeping the button as a .pc-content child makes Pencil's coordinates resolve
 * from the same containing block; .pc-card clipping still bounds the overflow. */
```

Do not change the `left`, `top`, `width`, or `height` values in this task.

- [ ] **Step 3: Run focused PlayerCard tests**

Run:

```bash
cd app
npx vitest run src/ui/PlayerCard.test.tsx
```

Expected: PASS for all `PlayerCard` tests.

- [ ] **Step 4: Commit the PlayerCard implementation**

Run:

```bash
git add app/src/ui/PlayerCard.tsx app/src/ui/PlayerCard.css
git commit -m "fix: align remote player card pin and key pill"
```

Expected: commit succeeds with only implementation files staged.

### Task 3: Add Remote Card Mirror Tests for BindingKey

**Files:**
- Modify: `app/src/RemotePlayerCardApp.test.tsx`
- Modify: `app/src/domain/bridge/client.test.ts`
- Modify: `app/src/domain/bridge/host.test.ts`

- [ ] **Step 1: Extend RemotePlayerCardApp test fixture with bindingKey**

In `app/src/RemotePlayerCardApp.test.tsx`, change the `p2.state.bindingKey` in `beforeEach` from `null` to:

```typescript
                    bindingKey: {
                        keyLabel: 'Space',
                        pressCount: 7,
                    },
```

Then add this test after `renders the player selected by route playerId`:

```typescript
    it('renders the remote synced key counter from mirrored network state', async () => {
        const { default: RemotePlayerCardApp } = await import('./RemotePlayerCardApp');

        render(<RemotePlayerCardApp />);

        expect(screen.getByText('Space')).toBeInTheDocument();
        expect(screen.getByText('7')).toBeInTheDocument();
    });
```

- [ ] **Step 2: Add bridge client clone assertion for remote bindingKey**

In `app/src/domain/bridge/client.test.ts`, inside `writes every snapshot section into the corresponding store`, add:

```typescript
        expect(useNetworkStore.getState().players['p-1'].state?.bindingKey).toEqual({
            keyLabel: 'A',
            pressCount: 7,
        });
```

Inside `detaches nested mirror state from the incoming snapshot object`, keep the existing mutation check and add this assertion before mutating `sample`:

```typescript
        expect(useNetworkStore.getState().players['p-1'].state?.bindingKey).not.toBe(
            sample.network.players['p-1'].state?.bindingKey,
        );
```

- [ ] **Step 3: Add bridge host signature assertion for bindingKey press count**

In `app/src/domain/bridge/host.test.ts`, add this test inside the `signatures` describe block, or create a `describe('bindingKeySig')` block near other signature tests:

```typescript
describe('bindingKeySig', () => {
    it('changes when the synced entry press count changes', () => {
        const base = {
            panelEnabled: true,
            entries: [{
                id: 'bk-1',
                label: 'Space',
                keyCode: 49,
                pressCount: 7,
                enabled: true,
            }],
            capturingId: null,
            syncedKeyId: 'bk-1',
        };
        const incremented = {
            ...base,
            entries: [{ ...base.entries[0], pressCount: 8 }],
        };

        expect(bindingKeySig(base)).not.toBe(bindingKeySig(incremented));
    });
});
```

If the file already has a matching assertion in `bindingKeySig ignores omitted permission fields and includes mirrored fields`, keep both only if they cover distinct behavior. Otherwise extend the existing test with the `incremented` assertion above.

- [ ] **Step 4: Run mirror tests**

Run:

```bash
cd app
npx vitest run src/RemotePlayerCardApp.test.tsx src/domain/bridge/client.test.ts src/domain/bridge/host.test.ts
```

Expected: PASS. If `RemotePlayerCardApp.test.tsx` fails because the card test environment cannot see `PlayerCard`, fix the test fixture import or DOM query; do not change product behavior for a test-only import issue.

- [ ] **Step 5: Commit mirror tests**

Run:

```bash
git add app/src/RemotePlayerCardApp.test.tsx app/src/domain/bridge/client.test.ts app/src/domain/bridge/host.test.ts
git commit -m "test: cover remote key counter mirrors"
```

Expected: commit succeeds with only test files staged.

### Task 4: Verify StateSync and Network Are Still the Source of Truth

**Files:**
- Test: `app/src/domain/stateSync.test.ts`
- Test: `app/src/domain/network.test.ts`
- Optional Modify: only if a focused failing test proves current behavior is wrong.

- [ ] **Step 1: Run existing state sync and network tests**

Run:

```bash
cd app
npx vitest run src/domain/stateSync.test.ts src/domain/network.test.ts
```

Expected: PASS. These tests already cover active app metadata and network player updates.

- [ ] **Step 2: If stateSync does not broadcast bindingKey press-count changes, add the failing test**

Only if Step 1 or manual inspection proves a missing coverage gap, add this test to `app/src/domain/stateSync.test.ts`:

```typescript
    it('sends a state update immediately when the synced binding key count changes', async () => {
        const sendStateUpdate = vi.fn();
        useNetworkStore.setState({
            status: 'joined',
            roomCode: 'R1',
            playerId: 'p1',
            sendStateUpdate,
        });
        useBindingKeyStore.setState({
            entries: [{
                id: 'bk-1',
                label: 'Space',
                keyCode: 49,
                pressCount: 0,
                enabled: true,
            }],
            syncedKeyId: 'bk-1',
        });
        renderHook(() => useStateSync());

        act(() => {
            useBindingKeyStore.getState().incrementByKeyCode(49);
        });

        await waitFor(() => expect(sendStateUpdate).toHaveBeenCalled());
        expect(sendStateUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
            bindingKey: { keyLabel: 'Space', pressCount: 1 },
        }));
    });
```

Expected before implementation: FAIL if `useStateSync` does not subscribe to `useBindingKeyStore`.

- [ ] **Step 3: If the new test fails, subscribe stateSync to bindingKey changes**

Only if Step 2 fails, add this subscription in `app/src/domain/stateSync.ts` next to the existing active-app subscription:

```typescript
        const unsubB = useBindingKeyStore.subscribe(() => {
            send();
        });
```

Then include `unsubB();` in the cleanup block:

```typescript
            unsubB();
```

Expected: synced key selection and press-count updates trigger `sendStateUpdate` immediately, while the existing payload dedupe still prevents duplicate sends.

- [ ] **Step 4: Run the state sync tests again**

Run:

```bash
cd app
npx vitest run src/domain/stateSync.test.ts src/domain/network.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit state-sync changes only if Step 2 required code changes**

If no code changed in this task, skip the commit. If code or test changed, run:

```bash
git add app/src/domain/stateSync.ts app/src/domain/stateSync.test.ts
git commit -m "fix: broadcast synced key counter changes"
```

Expected: commit succeeds with only state sync files staged.

### Task 5: Full Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run focused regression suite**

Run:

```bash
cd app
npx vitest run src/ui/PlayerCard.test.tsx src/RemotePlayerCardApp.test.tsx src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/domain/stateSync.test.ts src/domain/network.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run all frontend tests**

Run:

```bash
cd app
npm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
cd app
npm run build
```

Expected: PASS.

- [ ] **Step 4: Check worktree status**

Run:

```bash
git status --short
```

Expected: only intentional committed work remains, or the tree is clean.

---

## Self-Review

Spec coverage:

- `epxz9` placement is covered by Task 1 and Task 2.
- `oCExj` visibility is covered by Task 1, Task 2, and Task 3.
- Bridge/window timing is covered through existing `useBridgeClient` request behavior plus Task 3 mirror tests.
- State sync is guarded by Task 4 without assuming a bug before evidence.
- Verification commands match the design spec.

Placeholder scan: no unresolved placeholder markers or vague test instructions remain.

Type consistency: all referenced files and types exist in the current codebase: `RemoteState.bindingKey`, `bindingKeySig`, `useStateSync`, `RemotePlayerCardApp`, and `PlayerCard`.
