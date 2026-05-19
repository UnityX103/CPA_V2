import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const libRsPath = path.join(here, '../src-tauri/src/lib.rs');

function libRs(): string {
    return readFileSync(libRsPath, 'utf8');
}

function rustFunction(source: string, name: string): { signature: string; body: string } | null {
    const signatureStart = source.search(new RegExp(`(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${name}\\s*\\(`));
    if (signatureStart < 0) return null;

    const bodyStart = source.indexOf('{', signatureStart);
    if (bodyStart < 0) return null;

    let depth = 0;
    for (let i = bodyStart; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) {
                return {
                    signature: source.slice(signatureStart, bodyStart),
                    body: source.slice(bodyStart + 1, i),
                };
            }
        }
    }
    return null;
}

function blockAfter(source: string, anchor: string): string | null {
    const anchorIndex = source.indexOf(anchor);
    if (anchorIndex < 0) return null;

    const blockStart = source.indexOf('{', anchorIndex);
    if (blockStart < 0) return null;

    let depth = 0;
    for (let i = blockStart; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(blockStart + 1, i);
        }
    }
    return null;
}

describe('Tauri app exit lifecycle', () => {
    it('requests full app exit when the main window closes despite hidden auxiliary windows', () => {
        const source = libRs();
        const installer = rustFunction(source, 'install_main_window_exit_on_close');
        const run = rustFunction(source, 'run');

        expect(installer, 'main close exit installer should exist').not.toBeNull();
        expect(run, 'run function should exist').not.toBeNull();
        if (!installer || !run) return;

        expect(installer.body).toMatch(/get_webview_window\("main"\)/);
        expect(installer.body).toMatch(/\.on_window_event\s*\(/);
        expect(installer.body).toMatch(/WindowEvent::CloseRequested/);
        expect(installer.body).toMatch(/\.exit\(\s*0\s*\)/);

        const setupBlock = blockAfter(run.body, '.setup(move |app|');
        expect(setupBlock, 'setup block should exist').not.toBeNull();
        expect(setupBlock).toMatch(/install_main_window_exit_on_close\(\s*app\.handle\(\)\.clone\(\)\s*\)/);
    });
});
