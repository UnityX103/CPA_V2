# Remote Player Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore multiplayer sync end to end so test players entering a local room show independent draggable remote player card windows that match Pencil node `drqFB` and display each remote player's active app title and icon.

**Architecture:** Restore the Server checkout in this worktree, then extend the existing room protocol with `activeApp.windowTitle` and `activeApp.iconDataUrl`. The main Tauri window owns a fixed pool of remote player card windows (`remote-player-0` through `remote-player-6`) because rooms cap at 8 players, while each card window renders a single `PlayerCard` through the existing bridge snapshot flow and persists its native window position by `playerId`.

**Tech Stack:** Tauri 2, React 19, TypeScript, Zustand, Vitest/jsdom, Node `node:test`, `ws`, Pencil MCP export, Playwright-style browser screenshot verification when available.

---

## File Structure

- Restore: `Server/` from `/Users/xpy/Desktop/NanZhai/CPA_V2/Server`
  - Keeps the current worktree capable of `cd Server && npm test`.
- Modify: `Server/src/protocol.js`
  - Whitelist-normalizes new active app fields.
- Modify: `Server/src/RoomManager.js`
  - Normalizes and clones active app fields at the authoritative room state layer.
- Modify: `Server/test/protocol.test.js`
  - Covers parse/normalize of active app title and icon data.
- Modify: `Server/test/integration.test.js`
  - Covers create/join/state/broadcast/snapshot with app title and icon.
- Modify: `app/src/domain/network.ts`
  - Extends `RemoteActiveApp` and keeps received players typed.
- Modify: `app/src/domain/stateSync.ts`
  - Sends local active app title and icon data.
- Modify: `app/src/domain/stateSync.test.ts`
  - Adds direct `buildRemoteStateForTest` coverage.
- Create: `app/src/domain/remotePlayerCardPositions.ts`
  - Loads and saves persisted card window positions by `playerId`.
- Create: `app/src/domain/remotePlayerWindows.ts`
  - Opens/closes the fixed remote player card window pool.
- Create: `app/src/domain/remotePlayerWindows.test.ts`
  - Verifies non-local window creation, slot reuse, and close behavior.
- Modify: `app/src/domain/bridge/host.ts`
  - Emits snapshots to all fixed remote player window labels.
- Modify: `app/src/domain/bridge/client.ts`
  - Existing mirror path should already work; tests must cover remote card use.
- Modify: `app/src/domain/bridge/host.test.ts`
  - Verifies remote player labels receive snapshots.
- Modify: `app/src/main.tsx`
  - Routes `?window=remote-player` to `RemotePlayerCardApp`.
- Create: `app/src/RemotePlayerCardApp.tsx`
  - Bridge client app for one remote player card window.
- Create: `app/src/RemotePlayerCardApp.test.tsx`
  - Verifies the route selects the right player and saves moved positions.
- Modify: `app/src/App.tsx`
  - Calls `useRemotePlayerWindowController()`.
- Modify: `app/src/App.test.tsx`
  - Verifies the controller is mounted.
- Modify: `app/src/ui/PlayerCard.tsx`
  - Uses `windowTitle`, real `iconDataUrl`, and native window drag.
- Modify: `app/src/ui/PlayerCard.css`
  - Adds image styling and no-drag regions while preserving `drqFB` geometry.
- Create: `app/src/ui/PlayerCard.test.tsx`
  - Covers title priority, icon priority, fallback, and drag behavior.
- Modify: `app/src/DevAlignApp.tsx`
  - Allows the comparison helper to open directly on target `drqFB`.
- Modify: `app/src-tauri/capabilities/default.json`
  - Adds fixed remote player labels to the allowed windows list.
- Optional if dynamic JS window creation cannot set position reliably: modify `app/src-tauri/src/lib.rs`
  - Add a narrow command to read current monitor bounds or set card position. Prefer frontend-only APIs first.
- Create: `app/scripts/compare-player-card.mjs`
  - Generates a one-card HTML comparison against `app/public/dev-align/drqFB.png`.
- Modify: `app/package.json`
  - Adds a `test:player-card-visual` script for the comparison script.

---

### Task 1: Restore Server Checkout In This Worktree

**Files:**
- Restore: `Server/`

- [ ] **Step 1: Verify current Server gitlink and reference checkout**

Run:

```bash
git ls-tree HEAD Server
git -C /Users/xpy/Desktop/NanZhai/CPA_V2/Server rev-parse --short HEAD
git -C /Users/xpy/Desktop/NanZhai/CPA_V2/Server status --short
```

Expected:

```text
160000 commit 9a98bf4d97d14497f30e4221dc7eb34a1e231686	Server
9a98bf4
```

If the reference checkout has unrelated dirty files, stop and report them before copying.

- [ ] **Step 2: Restore the worktree Server directory from the reference checkout**

Run:

```bash
rm -rf Server
cp -R /Users/xpy/Desktop/NanZhai/CPA_V2/Server Server
rm -rf Server/.git Server/node_modules Server/.omc
```

Expected: `Server/package.json`, `Server/src/protocol.js`, and `Server/test/protocol.test.js` exist.

- [ ] **Step 3: Install Server dependencies if needed**

Run:

```bash
cd Server && npm install --package-lock=false
```

Expected: install succeeds and `Server/node_modules/ws` exists. If `node_modules` is ignored, do not commit it.

- [ ] **Step 4: Run baseline Server tests**

Run:

```bash
cd Server && npm test
```

Expected: all existing Server tests pass.

- [ ] **Step 5: Commit the restoration separately if Git tracks Server contents**

Run:

```bash
git status --short Server
git add Server
git commit -m "chore: restore local server checkout"
```

Expected: commit succeeds if Server files are newly tracked. If Git still treats `Server` as a gitlink and refuses normal staging, stop and report the exact status before proceeding.

---

### Task 2: Extend Server Active App Protocol

**Files:**
- Modify: `Server/src/protocol.js`
- Modify: `Server/src/RoomManager.js`
- Modify: `Server/test/protocol.test.js`
- Modify: `Server/test/integration.test.js`

- [ ] **Step 1: Add failing protocol tests**

Append to `Server/test/protocol.test.js`:

```js
test('parseClientMessage preserves active app window title and icon data', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: {
                name: 'Visual Studio Code',
                bundleId: 'com.microsoft.VSCode',
                windowTitle: 'network.ts - CPA_V2',
                iconDataUrl: 'data:image/png;base64,QUFB',
                evilExtra: 'strip-me'
            },
            bindingKey: null
        }
    }));

    assert.deepEqual(message.state.activeApp, {
        name: 'Visual Studio Code',
        bundleId: 'com.microsoft.VSCode',
        windowTitle: 'network.ts - CPA_V2',
        iconDataUrl: 'data:image/png;base64,QUFB'
    });
});

test('parseClientMessage clamps long active app title and icon data fields', () =>
{
    const long = 'x'.repeat(300);
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: {
                name: 'App',
                bundleId: 'com.example.App',
                windowTitle: long,
                iconDataUrl: long
            },
            bindingKey: null
        }
    }));

    assert.equal(message.state.activeApp.windowTitle.length, 256);
    assert.equal(message.state.activeApp.iconDataUrl.length, 256);
});
```

- [ ] **Step 2: Run protocol tests and verify failure**

Run:

```bash
cd Server && node --test test/protocol.test.js
```

Expected: first new test fails because `windowTitle` and `iconDataUrl` are missing from `activeApp`.

- [ ] **Step 3: Implement `normalizeActiveApp` in `Server/src/protocol.js`**

Replace the current `normalizeActiveApp` with:

```js
function normalizeActiveApp(activeApp)
{
    if (activeApp == null || typeof activeApp !== 'object')
    {
        return null;
    }

    const name = clampString(activeApp.name);
    const bundleId = clampString(activeApp.bundleId);
    const windowTitle = activeApp.windowTitle == null
        ? undefined
        : clampString(activeApp.windowTitle);
    const iconDataUrl = activeApp.iconDataUrl == null
        ? undefined
        : clampString(activeApp.iconDataUrl);
    const iconId = activeApp.iconId == null
        ? undefined
        : clampString(activeApp.iconId);

    if (!name && !bundleId)
    {
        return null;
    }

    return stripUndefinedFields({
        name,
        bundleId,
        windowTitle,
        iconDataUrl,
        iconId
    });
}
```

- [ ] **Step 4: Add RoomManager integration tests**

Append to `Server/test/integration.test.js`:

```js
test('player_state_broadcast and room_snapshot preserve active app title and icon data', async (t) =>
{
    const app = await createPomodoroServer({
        port: 0,
        heartbeatIntervalMs: 5000,
        initTimeoutMs: 1000
    });
    t.after(async () => { await app.close(); });

    const clientA = await openClient(app.url);
    const clientB = await openClient(app.url);
    const inboxA = createMessageCollector(clientA);
    const inboxB = createMessageCollector(clientB);
    t.after(() => { clientA.close(); clientB.close(); });

    sendJson(clientA, { type: 'create_room', playerName: 'A' });
    const roomCreated = await inboxA.waitFor('room_created');
    await inboxA.waitFor('room_snapshot');

    sendJson(clientB, { type: 'join_room', roomCode: roomCreated.roomCode, playerName: 'B' });
    await inboxB.waitFor('room_joined');
    await inboxB.waitFor('room_snapshot');
    await inboxA.waitFor('player_joined');

    const activeApp = {
        name: 'Visual Studio Code',
        bundleId: 'com.microsoft.VSCode',
        windowTitle: 'stateSync.ts - CPA_V2',
        iconDataUrl: 'data:image/png;base64,QUFB'
    };

    sendJson(clientA, {
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1499, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp,
            bindingKey: { keyLabel: 'Space', pressCount: 9 }
        }
    });

    const broadcast = await inboxB.waitFor('player_state_broadcast');
    assert.deepEqual(broadcast.state.activeApp, activeApp);

    const clientC = await openClient(app.url);
    const inboxC = createMessageCollector(clientC);
    t.after(() => { clientC.close(); });

    sendJson(clientC, { type: 'join_room', roomCode: roomCreated.roomCode, playerName: 'C' });
    await inboxC.waitFor('room_joined');
    const snapshot = await inboxC.waitFor('room_snapshot');
    const playerA = snapshot.players.find((p) => p.playerName === 'A');

    assert.ok(playerA, 'snapshot includes A');
    assert.deepEqual(playerA.state.activeApp, activeApp);
});
```

- [ ] **Step 5: Run integration tests and verify whether RoomManager needs changes**

Run:

```bash
cd Server && node --test test/integration.test.js
```

Expected: If it fails because `RoomManager` keeps extra fields or drops fields, update `Server/src/RoomManager.js` in the next step. If it passes, still add an explicit normalizer for consistency.

- [ ] **Step 6: Add explicit active app normalization to `Server/src/RoomManager.js`**

Add near `normalizeBindingKey`:

```js
const MAX_STRING_FIELD_BYTES = 256;

function clampString(value)
{
    if (typeof value !== 'string')
    {
        return '';
    }
    if (value.length > MAX_STRING_FIELD_BYTES)
    {
        return value.slice(0, MAX_STRING_FIELD_BYTES);
    }
    return value;
}

function normalizeActiveApp(activeApp)
{
    if (activeApp == null || typeof activeApp !== 'object')
    {
        return null;
    }

    const name = clampString(activeApp.name);
    const bundleId = clampString(activeApp.bundleId);
    const windowTitle = activeApp.windowTitle == null ? undefined : clampString(activeApp.windowTitle);
    const iconDataUrl = activeApp.iconDataUrl == null ? undefined : clampString(activeApp.iconDataUrl);
    const iconId = activeApp.iconId == null ? undefined : clampString(activeApp.iconId);

    if (!name && !bundleId)
    {
        return null;
    }

    return Object.fromEntries(
        Object.entries({ name, bundleId, windowTitle, iconDataUrl, iconId })
            .filter(([, value]) => value !== undefined)
    );
}
```

Then change `normalizeRemoteState` in `RoomManager.js` from:

```js
activeApp: state.activeApp ?? null,
```

to:

```js
activeApp: normalizeActiveApp(state.activeApp),
```

- [ ] **Step 7: Run Server tests**

Run:

```bash
cd Server && npm test
```

Expected: all Server tests pass.

- [ ] **Step 8: Commit Server protocol work**

Run:

```bash
git add Server/src/protocol.js Server/src/RoomManager.js Server/test/protocol.test.js Server/test/integration.test.js
git commit -m "feat: sync active app metadata"
```

Expected: commit succeeds.

---

### Task 3: Extend Frontend RemoteState And State Sync

**Files:**
- Modify: `app/src/domain/network.ts`
- Modify: `app/src/domain/stateSync.ts`
- Modify: `app/src/domain/stateSync.test.ts`
- Modify: `app/src/domain/network.test.ts`

- [ ] **Step 1: Export testable remote-state builder and add failing stateSync test**

Modify `app/src/domain/stateSync.ts` so `buildRemoteState` becomes exported:

```ts
export function buildRemoteStateForTest(): RemoteState {
    return buildRemoteState();
}
```

Add to `app/src/domain/stateSync.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { useActiveAppStore } from './activeApp';
import { buildRemoteStateForTest } from './stateSync';

describe('stateSync active app metadata', () => {
    beforeEach(() => {
        useActiveAppStore.setState({ current: null });
    });

    it('includes active app title and icon in remote state', () => {
        useActiveAppStore.setState({
            current: {
                name: 'Rider',
                bundle_id: 'com.jetbrains.rider',
                window_title: 'PlayerCard.tsx - CPA_V2',
                icon_data_url: 'data:image/png;base64,QUFB',
            },
        });

        expect(buildRemoteStateForTest().activeApp).toEqual({
            name: 'Rider',
            bundleId: 'com.jetbrains.rider',
            windowTitle: 'PlayerCard.tsx - CPA_V2',
            iconDataUrl: 'data:image/png;base64,QUFB',
        });
    });
});
```

- [ ] **Step 2: Run focused stateSync test and verify failure**

Run:

```bash
cd app && npx vitest run src/domain/stateSync.test.ts
```

Expected: fails because `RemoteActiveApp` lacks `windowTitle` and `iconDataUrl`.

- [ ] **Step 3: Extend `RemoteActiveApp` in `network.ts`**

Change the interface to:

```ts
export interface RemoteActiveApp {
    name: string;
    bundleId: string;
    windowTitle?: string | null;
    iconDataUrl?: string | null;
    iconId?: string;
}
```

- [ ] **Step 4: Map fields in `stateSync.ts`**

Replace the active app mapping with:

```ts
activeApp: active
    ? {
        name: active.name,
        bundleId: active.bundle_id,
        windowTitle: active.window_title ?? null,
        iconDataUrl: active.icon_data_url ?? null,
    }
    : null,
```

- [ ] **Step 5: Add network broadcast coverage**

Add to `app/src/domain/network.test.ts`:

```ts
it('accepts active app title and icon fields in remote player state', () => {
    const state = {
        pomodoro: { phase: 0, remainingSeconds: 1200, currentRound: 1, totalRounds: 4, isRunning: true },
        activeApp: {
            name: 'Safari',
            bundleId: 'com.apple.Safari',
            windowTitle: 'Apple - Safari',
            iconDataUrl: 'data:image/png;base64,QUFB',
        },
        bindingKey: null,
    };

    useNetworkStore.setState({
        players: {
            p1: { playerId: 'p1', playerName: '远端玩家', state: null },
        },
    });

    useNetworkStore.setState((s) => ({
        players: {
            ...s.players,
            p1: { ...s.players.p1, state },
        },
    }));

    expect(useNetworkStore.getState().players.p1.state?.activeApp).toEqual(state.activeApp);
});
```

- [ ] **Step 6: Run frontend domain tests**

Run:

```bash
cd app && npx vitest run src/domain/stateSync.test.ts src/domain/network.test.ts
```

Expected: both test files pass.

- [ ] **Step 7: Commit frontend state sync**

Run:

```bash
git add app/src/domain/network.ts app/src/domain/stateSync.ts app/src/domain/stateSync.test.ts app/src/domain/network.test.ts
git commit -m "feat: include active app metadata in player state"
```

Expected: commit succeeds.

---

### Task 4: Make PlayerCard Match Active App Title/Icon And Native Drag

**Files:**
- Modify: `app/src/ui/PlayerCard.tsx`
- Modify: `app/src/ui/PlayerCard.css`
- Create: `app/src/ui/PlayerCard.test.tsx`

- [ ] **Step 1: Add failing PlayerCard tests**

Create `app/src/ui/PlayerCard.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemotePlayer } from '../domain/network';
import { PlayerCard } from './PlayerCard';

const { startDragging } = vi.hoisted(() => ({
    startDragging: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        startDragging: () => {
            startDragging();
            return Promise.resolve();
        },
    }),
}));

const basePlayer: RemotePlayer = {
    playerId: 'p1',
    playerName: '远端玩家',
    state: {
        pomodoro: { phase: 0, remainingSeconds: 1200, currentRound: 1, totalRounds: 4, isRunning: true },
        activeApp: {
            name: 'VS Code',
            bundleId: 'com.microsoft.VSCode',
            windowTitle: 'PlayerCard.tsx - CPA_V2',
            iconDataUrl: 'data:image/png;base64,QUFB',
        },
        bindingKey: { keyLabel: 'Space', pressCount: 47 },
    },
};

beforeEach(() => {
    startDragging.mockReset();
});

afterEach(() => {
    cleanup();
});

describe('PlayerCard', () => {
    it('prefers active app window title over app name', () => {
        render(<PlayerCard player={basePlayer} />);

        expect(screen.getByText('PlayerCard.tsx - CPA_V2')).toBeInTheDocument();
        expect(screen.queryByText('VS Code')).toBeNull();
    });

    it('falls back to app name and then waiting text', () => {
        const noTitle = {
            ...basePlayer,
            state: {
                ...basePlayer.state!,
                activeApp: { name: 'Safari', bundleId: 'com.apple.Safari', windowTitle: '' },
            },
        };
        const { rerender } = render(<PlayerCard player={noTitle} />);
        expect(screen.getByText('Safari')).toBeInTheDocument();

        rerender(<PlayerCard player={{ ...basePlayer, state: null }} />);
        expect(screen.getByText('待加入')).toBeInTheDocument();
    });

    it('uses remote app icon data when present', () => {
        render(<PlayerCard player={basePlayer} />);

        const icon = screen.getByRole('img', { hidden: true });
        expect(icon).toHaveAttribute('src', 'data:image/png;base64,QUFB');
        expect(screen.queryByTestId('player-card-fallback-icon')).toBeNull();
    });

    it('uses fallback icon when remote app icon data is missing', () => {
        render(<PlayerCard player={{
            ...basePlayer,
            state: {
                ...basePlayer.state!,
                activeApp: { name: 'VS Code', bundleId: 'com.microsoft.VSCode' },
            },
        }} />);

        expect(screen.getByTestId('player-card-fallback-icon')).toBeInTheDocument();
    });

    it('starts native drag from card background but not from pin button', () => {
        render(<PlayerCard player={basePlayer} />);

        fireEvent.pointerDown(screen.getByRole('article', { name: '远端玩家' }), { button: 0 });
        expect(startDragging).toHaveBeenCalledTimes(1);

        fireEvent.pointerDown(screen.getByRole('button', { name: '固定远端玩家卡牌' }), { button: 0 });
        expect(startDragging).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run PlayerCard test and verify failure**

Run:

```bash
cd app && npx vitest run src/ui/PlayerCard.test.tsx
```

Expected: fails because PlayerCard has no title/icon support and does not call `startDragging`.

- [ ] **Step 3: Update `PlayerCard.tsx`**

Replace `PlayerCard` with this structure, keeping existing helper logic:

```tsx
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { RemotePlayer, RemoteState } from '../domain/network';
import { shouldStartWindowDrag } from './windowDrag';
import './PlayerCard.css';

interface PlayerCardProps {
    player: RemotePlayer;
}

interface PhaseBadge {
    label: string;
    bg: string;
}

function deriveBadge(state: RemoteState | null): PhaseBadge {
    if (!state) return { label: '待加入', bg: '#B5A49A' };
    if (state.pomodoro.phase === 2) return { label: '已完成', bg: '#6366F1' };
    if (!state.pomodoro.isRunning) return { label: '已暂停', bg: '#E08C10' };
    if (state.pomodoro.phase === 1) return { label: '休息中', bg: '#34A853' };
    return { label: '专注中', bg: '#D15F3D' };
}

export function PlayerCard({ player }: PlayerCardProps) {
    const badge = deriveBadge(player.state);
    const app = player.state?.activeApp ?? null;
    const appName = app?.windowTitle?.trim() || app?.name?.trim() || '待加入';
    const appIcon = app?.iconDataUrl || null;
    const binding = player.state?.bindingKey ?? null;

    const onPanelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!shouldStartWindowDrag(e.button, e.target)) return;
        void getCurrentWindow().startDragging().catch(() => {
            /* drag may fail in non-Tauri/test env */
        });
    };

    return (
        <div
            className="pc-card"
            role="article"
            aria-label={player.playerName || '远端玩家'}
            onPointerDown={onPanelPointerDown}
        >
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

                <div className="pc-footer" title={appName}>
                    {appIcon ? (
                        <img className="pc-foot-img" src={appIcon} alt="" draggable={false} />
                    ) : (
                        <AppWindowIcon />
                    )}
                    <span className="pc-foot-text">{appName}</span>
                </div>
                <button
                    className="pc-pin"
                    type="button"
                    aria-label="固定远端玩家卡牌"
                    data-no-window-drag
                >
                    <PinIcon />
                </button>
            </div>
        </div>
    );
}

function AppWindowIcon() {
    return (
        <svg
            data-testid="player-card-fallback-icon"
            className="pc-foot-icon"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <rect width="20" height="16" x="2" y="4" rx="2" />
            <path d="M2 10h20M6 7v.01M9 7v.01M12 7v.01" />
        </svg>
    );
}

function PinIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M14 4v5l3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3V4h-1V2h8v2h-1z" />
        </svg>
    );
}
```

- [ ] **Step 4: Update `PlayerCard.css` image and pin rules**

Add or adjust:

```css
.pc-card {
    height: 94px;
}

.pc-foot-img,
.pc-foot-icon {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    display: inline-flex;
}

.pc-foot-img {
    object-fit: contain;
    border-radius: 3px;
}

.pc-pin {
    cursor: default;
    padding: 0;
}
```

Keep the existing `width: var(--pc-w)`, `padding: var(--pc-padding)`, radius, fill, stroke, and gap rules.

- [ ] **Step 5: Run PlayerCard tests**

Run:

```bash
cd app && npx vitest run src/ui/PlayerCard.test.tsx
```

Expected: all PlayerCard tests pass.

- [ ] **Step 6: Commit PlayerCard work**

Run:

```bash
git add app/src/ui/PlayerCard.tsx app/src/ui/PlayerCard.css app/src/ui/PlayerCard.test.tsx
git commit -m "feat: show remote app metadata on player cards"
```

Expected: commit succeeds.

---

### Task 5: Persist Remote Player Card Positions

**Files:**
- Create: `app/src/domain/remotePlayerCardPositions.ts`
- Create: `app/src/domain/remotePlayerCardPositions.test.ts`

- [ ] **Step 1: Add failing persistence tests**

Create `app/src/domain/remotePlayerCardPositions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = {
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
};

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(() => Promise.resolve(store)),
}));

describe('remotePlayerCardPositions', () => {
    beforeEach(() => {
        store.get.mockReset();
        store.set.mockReset();
        store.save.mockReset();
        vi.resetModules();
    });

    it('loads only valid player card positions', async () => {
        store.get.mockResolvedValue({
            v: 1,
            positions: {
                p1: { x: 10, y: 20 },
                bad: { x: 'left', y: 20 },
            },
        });

        const { loadRemotePlayerCardPositions } = await import('./remotePlayerCardPositions');

        await expect(loadRemotePlayerCardPositions()).resolves.toEqual({
            p1: { x: 10, y: 20 },
        });
    });

    it('saves positions as v1 payload', async () => {
        const { saveRemotePlayerCardPosition } = await import('./remotePlayerCardPositions');

        await saveRemotePlayerCardPosition('p1', { x: 30, y: 40 });

        expect(store.set).toHaveBeenCalledWith('remotePlayerCardPositions', {
            v: 1,
            positions: {
                p1: { x: 30, y: 40 },
            },
        });
        expect(store.save).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run persistence test and verify failure**

Run:

```bash
cd app && npx vitest run src/domain/remotePlayerCardPositions.test.ts
```

Expected: fails because the module does not exist.

- [ ] **Step 3: Implement `remotePlayerCardPositions.ts`**

Create `app/src/domain/remotePlayerCardPositions.ts`:

```ts
import { load } from '@tauri-apps/plugin-store';

const STORE_PATH = 'settings.json';
const STORE_KEY = 'remotePlayerCardPositions';

export interface RemotePlayerCardPosition {
    x: number;
    y: number;
}

export type RemotePlayerCardPositions = Record<string, RemotePlayerCardPosition>;

interface PersistedRemotePlayerCardPositionsV1 {
    v: 1;
    positions: RemotePlayerCardPositions;
}

let cache: RemotePlayerCardPositions | null = null;

function isPosition(value: unknown): value is RemotePlayerCardPosition {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<RemotePlayerCardPosition>;
    return typeof candidate.x === 'number'
        && Number.isFinite(candidate.x)
        && typeof candidate.y === 'number'
        && Number.isFinite(candidate.y);
}

function normalizePositions(value: unknown): RemotePlayerCardPositions {
    if (!value || typeof value !== 'object') return {};
    const candidate = value as Partial<PersistedRemotePlayerCardPositionsV1>;
    if (candidate.v !== 1 || !candidate.positions || typeof candidate.positions !== 'object') return {};

    return Object.fromEntries(
        Object.entries(candidate.positions).filter(([, position]) => isPosition(position)),
    );
}

async function openStore() {
    return load(STORE_PATH, { defaults: {}, autoSave: false });
}

export async function loadRemotePlayerCardPositions(): Promise<RemotePlayerCardPositions> {
    if (cache) return { ...cache };
    try {
        const store = await openStore();
        cache = normalizePositions(await store.get<unknown>(STORE_KEY));
        return { ...cache };
    } catch (err) {
        console.warn('[remotePlayerCardPositions] load failed', err);
        cache = {};
        return {};
    }
}

export async function saveRemotePlayerCardPosition(
    playerId: string,
    position: RemotePlayerCardPosition,
): Promise<void> {
    try {
        const positions = await loadRemotePlayerCardPositions();
        const next = {
            ...positions,
            [playerId]: position,
        };
        cache = next;
        const store = await openStore();
        await store.set(STORE_KEY, { v: 1, positions: next } satisfies PersistedRemotePlayerCardPositionsV1);
        await store.save();
    } catch (err) {
        console.warn('[remotePlayerCardPositions] save failed', err);
    }
}
```

- [ ] **Step 4: Run persistence tests**

Run:

```bash
cd app && npx vitest run src/domain/remotePlayerCardPositions.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit persistence module**

Run:

```bash
git add app/src/domain/remotePlayerCardPositions.ts app/src/domain/remotePlayerCardPositions.test.ts
git commit -m "feat: persist remote player card positions"
```

Expected: commit succeeds.

---

### Task 6: Add Remote Player Window Controller

**Files:**
- Create: `app/src/domain/remotePlayerWindows.ts`
- Create: `app/src/domain/remotePlayerWindows.test.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/host.test.ts`
- Modify: `app/src-tauri/capabilities/default.json`

- [ ] **Step 1: Add remote player labels to Tauri capabilities**

Modify `app/src-tauri/capabilities/default.json` windows array to include:

```json
"remote-player-0",
"remote-player-1",
"remote-player-2",
"remote-player-3",
"remote-player-4",
"remote-player-5",
"remote-player-6"
```

The full beginning should look like:

```json
"windows": [
  "main",
  "settings",
  "pomodoro-video-player",
  "input-counter",
  "remote-player-0",
  "remote-player-1",
  "remote-player-2",
  "remote-player-3",
  "remote-player-4",
  "remote-player-5",
  "remote-player-6"
],
```

- [ ] **Step 2: Add failing controller tests**

Create `app/src/domain/remotePlayerWindows.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNetworkStore } from './network';

const { createdWindows, closedLabels } = vi.hoisted(() => ({
    createdWindows: [] as Array<{ label: string; options: Record<string, unknown> }>,
    closedLabels: [] as string[],
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    WebviewWindow: class {
        label: string;
        constructor(label: string, options: Record<string, unknown>) {
            this.label = label;
            createdWindows.push({ label, options });
        }
        static async getByLabel(label: string) {
            return {
                close: async () => {
                    closedLabels.push(label);
                },
            };
        }
        async once() {
            return undefined;
        }
    },
}));

vi.mock('./remotePlayerCardPositions', () => ({
    loadRemotePlayerCardPositions: vi.fn(() => Promise.resolve({
        p2: { x: 321, y: 123 },
    })),
}));

describe('remotePlayerWindows', () => {
    beforeEach(() => {
        createdWindows.length = 0;
        closedLabels.length = 0;
        useNetworkStore.setState({
            playerId: 'self',
            players: {},
        });
    });

    it('opens one fixed-label window per non-local player', async () => {
        const {
            resetRemotePlayerWindowsForTest,
            syncRemotePlayerWindowsForTest,
        } = await import('./remotePlayerWindows');
        resetRemotePlayerWindowsForTest();
        useNetworkStore.setState({
            players: {
                self: { playerId: 'self', playerName: '我', state: null },
                p2: { playerId: 'p2', playerName: '远端', state: null },
            },
        });

        await syncRemotePlayerWindowsForTest();

        expect(createdWindows).toHaveLength(1);
        expect(createdWindows[0].label).toBe('remote-player-0');
        expect(createdWindows[0].options.url).toBe('index.html?window=remote-player&playerId=p2');
        expect(createdWindows[0].options.x).toBe(321);
        expect(createdWindows[0].options.y).toBe(123);
    });

    it('closes a remote player window when the player leaves', async () => {
        const {
            resetRemotePlayerWindowsForTest,
            syncRemotePlayerWindowsForTest,
        } = await import('./remotePlayerWindows');
        resetRemotePlayerWindowsForTest();
        useNetworkStore.setState({
            players: {
                p2: { playerId: 'p2', playerName: '远端', state: null },
            },
        });

        await syncRemotePlayerWindowsForTest();
        useNetworkStore.setState({ players: {} });
        await syncRemotePlayerWindowsForTest();

        expect(closedLabels).toContain('remote-player-0');
    });
});
```

- [ ] **Step 3: Run controller tests and verify failure**

Run:

```bash
cd app && npx vitest run src/domain/remotePlayerWindows.test.ts
```

Expected: fails because the module does not exist.

- [ ] **Step 4: Implement `remotePlayerWindows.ts`**

Create `app/src/domain/remotePlayerWindows.ts`:

```ts
import { useEffect } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useNetworkStore } from './network';
import { loadRemotePlayerCardPositions } from './remotePlayerCardPositions';

export const REMOTE_PLAYER_WINDOW_LABELS = [
    'remote-player-0',
    'remote-player-1',
    'remote-player-2',
    'remote-player-3',
    'remote-player-4',
    'remote-player-5',
    'remote-player-6',
] as const;

const CARD_W = 153;
const CARD_H = 94;
const DEFAULT_X = 270;
const DEFAULT_Y = 20;
const OFFSET = 24;

const assigned = new Map<string, string>();

function defaultPosition(index: number): { x: number; y: number } {
    return {
        x: DEFAULT_X + index * OFFSET,
        y: DEFAULT_Y + index * OFFSET,
    };
}

async function closeLabel(label: string): Promise<void> {
    const existing = await WebviewWindow.getByLabel(label);
    await existing?.close().catch(() => {});
}

async function openPlayerWindow(playerId: string, label: string, index: number): Promise<void> {
    await closeLabel(label);
    const positions = await loadRemotePlayerCardPositions();
    const position = positions[playerId] ?? defaultPosition(index);
    const params = new URLSearchParams({ window: 'remote-player', playerId });
    const win = new WebviewWindow(label, {
        url: `index.html?${params.toString()}`,
        title: '远端玩家',
        x: Math.round(position.x),
        y: Math.round(position.y),
        width: CARD_W,
        height: CARD_H,
        transparent: true,
        decorations: false,
        alwaysOnTop: true,
        resizable: false,
        shadow: false,
        skipTaskbar: true,
        focus: false,
        backgroundColor: [0, 0, 0, 0],
        dragDropEnabled: false,
    });
    await win.once('tauri://error', (event) => {
        console.warn('[remote-player] failed to create card window', event.payload);
    }).catch(() => {});
}

export async function syncRemotePlayerWindowsForTest(): Promise<void> {
    const net = useNetworkStore.getState();
    const remotePlayerIds = Object.values(net.players)
        .filter((player) => player.playerId !== net.playerId)
        .map((player) => player.playerId)
        .sort();

    for (const [playerId, label] of [...assigned.entries()]) {
        if (!remotePlayerIds.includes(playerId)) {
            assigned.delete(playerId);
            await closeLabel(label);
        }
    }

    for (const playerId of remotePlayerIds) {
        if (assigned.has(playerId)) continue;
        const label = REMOTE_PLAYER_WINDOW_LABELS.find((candidate) => ![...assigned.values()].includes(candidate));
        if (!label) {
            console.warn('[remote-player] no free remote player window slot');
            continue;
        }
        assigned.set(playerId, label);
        await openPlayerWindow(playerId, label, REMOTE_PLAYER_WINDOW_LABELS.indexOf(label));
    }
}

export function resetRemotePlayerWindowsForTest(): void {
    assigned.clear();
}

export function useRemotePlayerWindowController(): void {
    useEffect(() => {
        let cancelled = false;
        const sync = () => {
            if (cancelled) return;
            void syncRemotePlayerWindowsForTest();
        };
        sync();
        const unsubscribe = useNetworkStore.subscribe(sync);
        return () => {
            cancelled = true;
            unsubscribe();
            for (const label of assigned.values()) {
                void closeLabel(label);
            }
            assigned.clear();
        };
    }, []);
}
```

- [ ] **Step 5: Extend bridge host snapshot targets**

In `app/src/domain/bridge/host.ts`, import labels:

```ts
import { REMOTE_PLAYER_WINDOW_LABELS } from '../remotePlayerWindows';
```

Replace:

```ts
const MIRROR_WINDOW_LABELS = ['settings', 'input-counter'] as const;
```

with:

```ts
const MIRROR_WINDOW_LABELS = ['settings', 'input-counter', ...REMOTE_PLAYER_WINDOW_LABELS] as const;
```

- [ ] **Step 6: Run controller tests**

Run:

```bash
cd app && npx vitest run src/domain/remotePlayerWindows.test.ts src/domain/bridge/host.test.ts
```

Expected: controller tests pass and existing bridge host tests still pass. If host tests mock `WebviewWindow.getByLabel`, update expected labels to include the seven remote player labels.

- [ ] **Step 7: Commit window controller**

Run:

```bash
git add app/src/domain/remotePlayerWindows.ts app/src/domain/remotePlayerWindows.test.ts app/src/domain/bridge/host.ts app/src/domain/bridge/host.test.ts app/src-tauri/capabilities/default.json
git commit -m "feat: manage remote player card windows"
```

Expected: commit succeeds.

---

### Task 7: Add RemotePlayerCardApp Route

**Files:**
- Create: `app/src/RemotePlayerCardApp.tsx`
- Create: `app/src/RemotePlayerCardApp.test.tsx`
- Modify: `app/src/main.tsx`
- Modify: `app/src/App.tsx`
- Modify: `app/src/App.test.tsx`

- [ ] **Step 1: Add failing app route test**

Create `app/src/RemotePlayerCardApp.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNetworkStore } from './domain/network';

const { savePosition, onMoved } = vi.hoisted(() => ({
    savePosition: vi.fn(),
    onMoved: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        onMoved: onMoved,
        outerPosition: () => Promise.resolve({ x: 12, y: 34 }),
    }),
}));

vi.mock('./domain/remotePlayerCardPositions', () => ({
    saveRemotePlayerCardPosition: savePosition,
}));

beforeEach(() => {
    vi.stubGlobal('location', new URL('http://localhost:1420/?window=remote-player&playerId=p2'));
    onMoved.mockImplementation((handler: () => void) => {
        handler();
        return Promise.resolve(() => {});
    });
    savePosition.mockReset();
    useNetworkStore.setState({
        players: {
            p2: {
                playerId: 'p2',
                playerName: '远端玩家',
                state: {
                    pomodoro: { phase: 0, remainingSeconds: 1200, currentRound: 1, totalRounds: 4, isRunning: true },
                    activeApp: { name: 'Rider', bundleId: 'com.jetbrains.rider', windowTitle: 'Plan.md' },
                    bindingKey: null,
                },
            },
        },
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('RemotePlayerCardApp', () => {
    it('renders the player selected by route playerId', async () => {
        const { default: RemotePlayerCardApp } = await import('./RemotePlayerCardApp');

        render(<RemotePlayerCardApp />);

        expect(screen.getByText('远端玩家')).toBeInTheDocument();
        expect(screen.getByText('Plan.md')).toBeInTheDocument();
    });

    it('saves native card window position on move', async () => {
        const { default: RemotePlayerCardApp } = await import('./RemotePlayerCardApp');

        render(<RemotePlayerCardApp />);

        expect(savePosition).toHaveBeenCalledWith('p2', { x: 12, y: 34 });
    });
});
```

- [ ] **Step 2: Run route test and verify failure**

Run:

```bash
cd app && npx vitest run src/RemotePlayerCardApp.test.tsx
```

Expected: fails because the route module does not exist.

- [ ] **Step 3: Implement `RemotePlayerCardApp.tsx`**

Create `app/src/RemotePlayerCardApp.tsx`:

```tsx
import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useBridgeClient } from './domain/bridge/client';
import { useNetworkStore } from './domain/network';
import { saveRemotePlayerCardPosition } from './domain/remotePlayerCardPositions';
import { PlayerCard } from './ui/PlayerCard';
import './styles/global.css';

function routePlayerId(): string {
    return new URLSearchParams(window.location.search).get('playerId') ?? '';
}

export default function RemotePlayerCardApp() {
    useBridgeClient();
    const playerId = routePlayerId();
    const player = useNetworkStore((s) => s.players[playerId]);

    useEffect(() => {
        let cancelled = false;
        let unlisten = () => {};
        getCurrentWindow().onMoved(async () => {
            if (cancelled || !playerId) return;
            const position = await getCurrentWindow().outerPosition();
            if (cancelled) return;
            await saveRemotePlayerCardPosition(playerId, { x: position.x, y: position.y });
        }).then((u) => {
            if (cancelled) u();
            else unlisten = u;
        }).catch((error) => {
            console.warn('[remote-player] onMoved failed', error);
        });
        return () => {
            cancelled = true;
            unlisten();
        };
    }, [playerId]);

    if (!player) return null;

    return (
        <main className="remote-player-card-root" aria-label="远端玩家卡牌">
            <PlayerCard player={player} />
        </main>
    );
}
```

- [ ] **Step 4: Add route to `main.tsx`**

Add import:

```ts
import RemotePlayerCardApp from "./RemotePlayerCardApp";
```

Change Root selection to include:

```ts
: which === "remote-player"
    ? RemotePlayerCardApp
```

The final chain should route `settings`, `devalign`, `video-player`, `input-counter`, `remote-player`, and then `App`.

- [ ] **Step 5: Mount controller in `App.tsx`**

Import:

```ts
import { useRemotePlayerWindowController } from './domain/remotePlayerWindows';
```

Call inside `App()` with other controllers:

```ts
useRemotePlayerWindowController();
```

- [ ] **Step 6: Update `App.test.tsx`**

Add hoisted mock:

```ts
useRemotePlayerWindowController: vi.fn(),
```

Add module mock:

```ts
vi.mock('./domain/remotePlayerWindows', () => ({ useRemotePlayerWindowController }));
```

In the composition test, assert:

```ts
expect(useRemotePlayerWindowController).toHaveBeenCalledTimes(1);
```

- [ ] **Step 7: Run route and App tests**

Run:

```bash
cd app && npx vitest run src/RemotePlayerCardApp.test.tsx src/App.test.tsx
```

Expected: both pass.

- [ ] **Step 8: Commit remote player route**

Run:

```bash
git add app/src/RemotePlayerCardApp.tsx app/src/RemotePlayerCardApp.test.tsx app/src/main.tsx app/src/App.tsx app/src/App.test.tsx
git commit -m "feat: add remote player card app"
```

Expected: commit succeeds.

---

### Task 8: Add Pixel/HTML Comparison Check

**Files:**
- Create: `app/scripts/compare-player-card.mjs`
- Modify: `app/src/DevAlignApp.tsx`
- Modify: `app/package.json`
- Existing baseline: `app/public/dev-align/drqFB.png`

- [ ] **Step 1: Let DevAlign open directly on `drqFB`**

Modify `app/src/DevAlignApp.tsx` so the default target and mode can come from query params:

```tsx
function initialTargetId(): string {
    const target = new URLSearchParams(window.location.search).get('target');
    return TARGETS.some((item) => item.id === target) ? target! : TARGETS[0].id;
}

function initialMode(): Mode {
    return new URLSearchParams(window.location.search).get('mode') === 'overlay' ? 'overlay' : 'side';
}
```

Then replace:

```tsx
const [targetId, setTargetId] = useState(TARGETS[0].id);
const [mode, setMode] = useState<Mode>('side');
```

with:

```tsx
const [targetId, setTargetId] = useState(initialTargetId);
const [mode, setMode] = useState<Mode>(initialMode);
```

This keeps the existing DevAlign UI unchanged while allowing `?window=devalign&target=drqFB&mode=side` to open straight to the player card comparison.

- [ ] **Step 2: Add visual comparison script**

Create `app/scripts/compare-player-card.mjs`:

```js
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const baseline = resolve('public/dev-align/drqFB.png');
const outHtml = resolve('tmp/player-card-compare.html');

if (!existsSync(baseline))
{
    throw new Error(`Missing baseline image: ${baseline}`);
}

mkdirSync(dirname(outHtml), { recursive: true });
writeFileSync(outHtml, `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>PlayerCard compare</title>
  <style>
    body { margin: 0; font-family: sans-serif; background: #f8f8f8; }
    .wrap { display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
    .pane { display: grid; gap: 8px; }
    .label { font: 12px system-ui; color: #555; }
    iframe { width: 520px; height: 180px; border: 0; background: white; }
    img { width: 153px; height: 94px; image-rendering: auto; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="pane">
      <div class="label">Pencil drqFB</div>
      <img src="../public/dev-align/drqFB.png" alt="Pencil baseline">
    </div>
    <div class="pane">
      <div class="label">Live DevAlign drqFB</div>
      <iframe src="../dist/index.html?window=devalign&target=drqFB&mode=side"></iframe>
    </div>
  </div>
</body>
</html>
`);

console.log(`PlayerCard comparison HTML written to ${outHtml}`);
console.log('Open it after npm run build and inspect Pencil vs live drqFB at 153x94.');
```

This script intentionally creates deterministic HTML first. The iframe uses the existing DevAlign app, which renders the real React `PlayerCard` with the existing mock player next to the Pencil baseline.

- [ ] **Step 3: Add npm script**

In `app/package.json`, add:

```json
"test:player-card-visual": "node scripts/compare-player-card.mjs"
```

- [ ] **Step 4: Run visual script**

Run:

```bash
cd app && npm run test:player-card-visual
```

Expected:

```text
PlayerCard comparison HTML written to ...
Open it after npm run build and inspect Pencil vs live drqFB at 153x94.
```

- [ ] **Step 5: Commit visual helper**

Run:

```bash
git add app/scripts/compare-player-card.mjs app/src/DevAlignApp.tsx app/package.json
git commit -m "test: add player card visual comparison"
```

Expected: commit succeeds.

---

### Task 9: Full Verification And Local Server Smoke

**Files:**
- No new files expected.

- [ ] **Step 1: Run Server tests**

Run:

```bash
cd Server && npm test
```

Expected: all Server tests pass.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
cd app && npx vitest run \
  src/domain/stateSync.test.ts \
  src/domain/network.test.ts \
  src/domain/remotePlayerCardPositions.test.ts \
  src/domain/remotePlayerWindows.test.ts \
  src/ui/PlayerCard.test.tsx \
  src/RemotePlayerCardApp.test.tsx \
  src/App.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 3: Run all frontend tests**

Run:

```bash
cd app && npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 4: Build frontend**

Run:

```bash
cd app && npm run build
```

Expected: `tsc && vite build` pass.

- [ ] **Step 5: Generate visual comparison HTML**

Run:

```bash
cd app && npm run test:player-card-visual
```

Expected: `app/tmp/player-card-compare.html` exists and references `public/dev-align/drqFB.png`.

- [ ] **Step 6: Start local Server**

Run in a long-running terminal:

```bash
cd Server && npm start
```

Expected: Server listens on `ws://127.0.0.1:8039`.

- [ ] **Step 7: Start the Tauri app**

Run in another terminal:

```bash
./start.sh
```

Expected: app opens; if port `8039` is already busy, `start.sh` skips Server startup and launches Tauri dev.

- [ ] **Step 8: Manual multiplayer smoke**

Use the Settings online tab to create or join a test room. Open a second frontend/app instance if needed, or use a Server test client to join the same room and send:

```json
{
  "v": 1,
  "type": "player_state_update",
  "state": {
    "pomodoro": {
      "phase": 0,
      "remainingSeconds": 1200,
      "currentRound": 1,
      "totalRounds": 4,
      "isRunning": true
    },
    "activeApp": {
      "name": "Visual Studio Code",
      "bundleId": "com.microsoft.VSCode",
      "windowTitle": "PlayerCard.tsx - CPA_V2",
      "iconDataUrl": "data:image/png;base64,QUFB"
    },
    "bindingKey": {
      "keyLabel": "Space",
      "pressCount": 47
    }
  }
}
```

Expected:

- A remote player card window appears.
- The card shows `PlayerCard.tsx - CPA_V2`.
- The card shows the remote icon when the data URL is a valid image; invalid placeholder data falls back safely if the browser cannot decode it.
- Dragging the card moves only that card window.
- Closing/leaving the remote player removes only that card window.

- [ ] **Step 9: Final status check**

Run:

```bash
git status --short
```

Expected: only intentional generated artifacts remain. Do not commit `node_modules` or `app/tmp`.
