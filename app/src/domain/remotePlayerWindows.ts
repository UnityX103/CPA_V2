import { useEffect } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { RemotePlayer } from './network';
import { useNetworkStore } from './network';
import {
    loadRemotePlayerCardPositions,
    type RemotePlayerCardPositions,
    type RemotePlayerCardPosition,
} from './remotePlayerCardPositions';

export const REMOTE_PLAYER_WINDOW_LABELS = [
    'remote-player-0',
    'remote-player-1',
    'remote-player-2',
    'remote-player-3',
    'remote-player-4',
    'remote-player-5',
    'remote-player-6',
] as const;

type RemotePlayerWindowLabel = typeof REMOTE_PLAYER_WINDOW_LABELS[number];

interface SyncRemotePlayerWindowsInput {
    localPlayerId: string | null;
    players: Record<string, RemotePlayer>;
}

interface Assignment {
    label: RemotePlayerWindowLabel;
    playerId: string;
}

const CARD_WIDTH = 153;
const CARD_HEIGHT = 94;
const DEFAULT_X = 120;
const DEFAULT_Y = 160;
const DEFAULT_OFFSET = 24;

let assignments = new Map<string, Assignment>();
let positionsPromise: Promise<RemotePlayerCardPositions> | null = null;

function loadPositionsOnce(): Promise<RemotePlayerCardPositions> {
    positionsPromise ??= loadRemotePlayerCardPositions();
    return positionsPromise;
}

function sortedRemotePlayerIds(input: SyncRemotePlayerWindowsInput): string[] {
    return Object.values(input.players)
        .map((player) => player.playerId)
        .filter((playerId) => playerId !== input.localPlayerId)
        .sort()
        .slice(0, REMOTE_PLAYER_WINDOW_LABELS.length);
}

function defaultPosition(slotIndex: number): RemotePlayerCardPosition {
    return {
        x: DEFAULT_X + slotIndex * DEFAULT_OFFSET,
        y: DEFAULT_Y + slotIndex * DEFAULT_OFFSET,
    };
}

function windowPosition(
    playerId: string,
    label: RemotePlayerWindowLabel,
    positions: RemotePlayerCardPositions,
): RemotePlayerCardPosition {
    return positions[playerId] ?? defaultPosition(REMOTE_PLAYER_WINDOW_LABELS.indexOf(label));
}

async function closeLabel(label: RemotePlayerWindowLabel): Promise<void> {
    try {
        const existing = await WebviewWindow.getByLabel(label);
        await existing?.close();
    } catch (err) {
        console.warn('[remote-player] close failed', label, err);
    }
}

function openWindow(
    label: RemotePlayerWindowLabel,
    playerId: string,
    position: RemotePlayerCardPosition,
): void {
    const params = new URLSearchParams({
        window: 'remote-player',
        playerId,
    });

    const remoteWindow = new WebviewWindow(label, {
        url: `index.html?${params.toString()}`,
        title: playerId,
        x: Math.round(position.x),
        y: Math.round(position.y),
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
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

    remoteWindow.once('tauri://error', (event) => {
        console.warn('[remote-player] failed to create window', label, event.payload);
    }).catch(() => {});
}

export async function syncRemotePlayerWindows(input: SyncRemotePlayerWindowsInput): Promise<void> {
    const desiredPlayerIds = new Set(sortedRemotePlayerIds(input));

    await Promise.all([...assignments.entries()].map(async ([playerId, assignment]) => {
        if (desiredPlayerIds.has(playerId)) return;
        assignments.delete(playerId);
        await closeLabel(assignment.label);
    }));

    const positions = await loadPositionsOnce();
    for (const playerId of desiredPlayerIds) {
        if (assignments.has(playerId)) continue;

        const usedLabels = new Set([...assignments.values()].map((assignment) => assignment.label));
        const label = REMOTE_PLAYER_WINDOW_LABELS.find((candidate) => !usedLabels.has(candidate));
        if (!label) return;

        assignments.set(playerId, { label, playerId });
        openWindow(label, playerId, windowPosition(playerId, label, positions));
    }
}

export async function closeAllRemotePlayerWindows(): Promise<void> {
    const labels = [...assignments.values()].map((assignment) => assignment.label);
    assignments = new Map();
    await Promise.all(labels.map((label) => closeLabel(label)));
}

export function resetRemotePlayerWindowControllerForTest(): void {
    assignments = new Map();
    positionsPromise = null;
}

export function useRemotePlayerWindowController(): void {
    const localPlayerId = useNetworkStore((s) => s.playerId);
    const players = useNetworkStore((s) => s.players);

    useEffect(() => {
        void syncRemotePlayerWindows({ localPlayerId, players });
    }, [localPlayerId, players]);
}
