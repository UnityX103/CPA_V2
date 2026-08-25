import {
    showCustomSoundMissingMessage,
    validateCustomSoundPath,
    type CustomSoundValidation,
} from './soundFiles';
import { playSound, type SoundSource } from './audioPlayback';

export type PomodoroSoundPhase = 'focus' | 'break';
export type PomodoroSoundSourceKind = 'off' | 'builtin' | 'custom';

export interface PomodoroSoundSelection {
    sourceKind: PomodoroSoundSourceKind;
    builtinSoundId: string;
    customSoundPath: string;
}

export interface PomodoroEndSounds {
    focus: PomodoroSoundSelection;
    break: PomodoroSoundSelection;
}

export interface BuiltinPomodoroSound {
    readonly id: string;
    readonly name: string;
    readonly phase: PomodoroSoundPhase;
    readonly src: string;
}

export const FOCUS_END_SOUNDS: readonly BuiltinPomodoroSound[] = [
    { id: 'clear-success', name: '清澈完成', phase: 'focus', src: '/sounds/pomodoro/focus-clear-success.mp3' },
    { id: 'light-success', name: '轻盈成功', phase: 'focus', src: '/sounds/pomodoro/focus-light-success.mp3' },
    { id: 'glockenspiel-reward', name: '木琴奖励', phase: 'focus', src: '/sounds/pomodoro/focus-glockenspiel-reward.mp3' },
    { id: 'high-bell-approval', name: '高铃认可', phase: 'focus', src: '/sounds/pomodoro/focus-high-bell-approval.mp3' },
];

export const BREAK_END_SOUNDS: readonly BuiltinPomodoroSound[] = [
    { id: 'triple-ping', name: '三连提示', phase: 'break', src: '/sounds/pomodoro/break-triple-ping.mp3' },
    { id: 'mid-bass-notice', name: '中低音通知', phase: 'break', src: '/sounds/pomodoro/break-mid-bass-notice.mp3' },
    { id: 'vintage-alarm', name: '复古闹铃', phase: 'break', src: '/sounds/pomodoro/break-vintage-alarm.mp3' },
];

export const DEFAULT_POMODORO_END_SOUNDS: PomodoroEndSounds = {
    focus: {
        sourceKind: 'builtin',
        builtinSoundId: 'clear-success',
        customSoundPath: '',
    },
    break: {
        sourceKind: 'builtin',
        builtinSoundId: 'triple-ping',
        customSoundPath: '',
    },
};

export function clonePomodoroEndSounds(sounds: PomodoroEndSounds): PomodoroEndSounds {
    return {
        focus: { ...sounds.focus },
        break: { ...sounds.break },
    };
}

export function samePomodoroEndSounds(a: PomodoroEndSounds, b: PomodoroEndSounds): boolean {
    return sameSoundSelection(a.focus, b.focus) && sameSoundSelection(a.break, b.break);
}

export function soundsForPhase(phase: PomodoroSoundPhase): readonly BuiltinPomodoroSound[] {
    return phase === 'focus' ? FOCUS_END_SOUNDS : BREAK_END_SOUNDS;
}

export function builtinSoundForSelection(
    selection: PomodoroSoundSelection,
    phase: PomodoroSoundPhase,
): BuiltinPomodoroSound | null {
    return soundsForPhase(phase).find((sound) => sound.id === selection.builtinSoundId) ?? null;
}

export function normalizePomodoroSoundSelection(
    value: unknown,
    fallback: PomodoroSoundSelection,
    phase: PomodoroSoundPhase,
): PomodoroSoundSelection {
    if (!isObject(value)) return { ...fallback };
    const sourceKind = value.sourceKind === 'off' || value.sourceKind === 'custom'
        ? value.sourceKind
        : 'builtin';
    const requestedBuiltinId = typeof value.builtinSoundId === 'string'
        ? value.builtinSoundId
        : fallback.builtinSoundId;
    const builtinSoundId = soundsForPhase(phase).some((sound) => sound.id === requestedBuiltinId)
        ? requestedBuiltinId
        : fallback.builtinSoundId;

    return {
        sourceKind,
        builtinSoundId,
        customSoundPath: typeof value.customSoundPath === 'string'
            ? value.customSoundPath
            : fallback.customSoundPath,
    };
}

interface PomodoroSoundPlaybackDeps {
    validateCustomSoundPath: (path: string) => Promise<CustomSoundValidation>;
    showCustomSoundMissingMessage: (text: string) => Promise<void>;
    playAudioSource: (source: SoundSource) => Promise<void>;
}

const defaultPlaybackDeps: PomodoroSoundPlaybackDeps = {
    validateCustomSoundPath,
    showCustomSoundMissingMessage,
    playAudioSource,
};

export async function playAudioSource(source: SoundSource): Promise<void> {
    await playSound(source);
}

export async function playPomodoroSound(
    selection: PomodoroSoundSelection,
    phase: PomodoroSoundPhase,
    deps: PomodoroSoundPlaybackDeps = defaultPlaybackDeps,
): Promise<boolean> {
    if (selection.sourceKind === 'off') return false;

    if (selection.sourceKind === 'builtin') {
        const sound = builtinSoundForSelection(selection, phase);
        if (!sound) return false;
        await deps.playAudioSource({ kind: 'builtin', id: sound.id });
        return true;
    }

    if (!selection.customSoundPath) return false;
    const validation = await deps.validateCustomSoundPath(selection.customSoundPath);
    if (!validation.ok) {
        await deps.showCustomSoundMissingMessage(validation.message ?? '自定义铃声不可用，请重新选择');
        return false;
    }

    await deps.playAudioSource({ kind: 'custom', path: selection.customSoundPath });
    return true;
}

export async function playPomodoroEndSound(
    sounds: PomodoroEndSounds,
    phase: PomodoroSoundPhase,
    deps: PomodoroSoundPlaybackDeps = defaultPlaybackDeps,
): Promise<boolean> {
    return playPomodoroSound(sounds[phase], phase, deps);
}

function sameSoundSelection(a: PomodoroSoundSelection, b: PomodoroSoundSelection): boolean {
    return a.sourceKind === b.sourceKind
        && a.builtinSoundId === b.builtinSoundId
        && a.customSoundPath === b.customSoundPath;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
