import { describe, expect, it } from 'vitest';
import { fileNameFromPath } from './filePath';

describe('fileNameFromPath', () => {
    it('extracts display names from macOS, Windows and bare file paths', () => {
        expect(fileNameFromPath('/Users/xpy/Videos/cat.webm')).toBe('cat.webm');
        expect(fileNameFromPath(String.raw`C:\Videos\dog.webm`)).toBe('dog.webm');
        expect(fileNameFromPath('edited.webm')).toBe('edited.webm');
    });
});
