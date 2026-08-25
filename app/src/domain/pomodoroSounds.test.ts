import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    BREAK_END_SOUNDS,
    DEFAULT_POMODORO_END_SOUNDS,
    FOCUS_END_SOUNDS,
    normalizePomodoroSoundSelection,
    playPomodoroEndSound,
} from './pomodoroSounds';

describe('Pomodoro end sounds', () => {
    it('offers distinct focus and break catalogs with the approved defaults', () => {
        expect(FOCUS_END_SOUNDS.map((sound) => sound.name)).toEqual([
            '清澈完成',
            '轻盈成功',
            '木琴奖励',
            '高铃认可',
        ]);
        expect(BREAK_END_SOUNDS.map((sound) => sound.name)).toEqual([
            '三连提示',
            '中低音通知',
            '复古闹铃',
        ]);
        expect(DEFAULT_POMODORO_END_SOUNDS.focus.builtinSoundId).toBe('clear-success');
        expect(DEFAULT_POMODORO_END_SOUNDS.break.builtinSoundId).toBe('triple-ping');
        const catalog = [...FOCUS_END_SOUNDS, ...BREAK_END_SOUNDS];
        expect(new Set(catalog.map((sound) => sound.id)).size).toBe(catalog.length);
        for (const sound of catalog) {
            expect(existsSync(resolve(process.cwd(), 'public', sound.src.slice(1)))).toBe(true);
        }
    });

    it('plays the sound selected for the completed phase', async () => {
        const playAudioSource = vi.fn(async () => {});

        await expect(playPomodoroEndSound(DEFAULT_POMODORO_END_SOUNDS, 'focus', {
            validateCustomSoundPath: vi.fn(),
            showCustomSoundMissingMessage: vi.fn(),
            playAudioSource,
        })).resolves.toBe(true);

        expect(playAudioSource).toHaveBeenCalledWith({
            kind: 'builtin',
            id: 'clear-success',
        });
    });

    it('validates a custom MP3 before authorizing and playing it', async () => {
        const validateCustomSoundPath = vi.fn(async () => ({ ok: true, message: null }));
        const playAudioSource = vi.fn(async () => {});

        await expect(playPomodoroEndSound({
            ...DEFAULT_POMODORO_END_SOUNDS,
            break: {
                sourceKind: 'custom',
                builtinSoundId: 'triple-ping',
                customSoundPath: '/Users/xpy/Music/rest.mp3',
            },
        }, 'break', {
            validateCustomSoundPath,
            showCustomSoundMissingMessage: vi.fn(),
            playAudioSource,
        })).resolves.toBe(true);

        expect(validateCustomSoundPath).toHaveBeenCalledWith('/Users/xpy/Music/rest.mp3');
        expect(playAudioSource).toHaveBeenCalledWith({
            kind: 'custom',
            path: '/Users/xpy/Music/rest.mp3',
        });
    });

    it('normalizes invalid built-in ids back to the phase default', () => {
        expect(normalizePomodoroSoundSelection({
            sourceKind: 'builtin',
            builtinSoundId: 'break-only-sound',
            customSoundPath: 42,
        }, DEFAULT_POMODORO_END_SOUNDS.focus, 'focus')).toEqual(DEFAULT_POMODORO_END_SOUNDS.focus);
    });
});
