import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const capabilitiesPath = path.join(here, '../src-tauri/capabilities/default.json');

describe('local persistence capability', () => {
    it('allows the Tauri store operations used for account and preference restore', () => {
        const capabilities = JSON.parse(readFileSync(capabilitiesPath, 'utf8'));

        expect(capabilities.permissions).toEqual(expect.arrayContaining([
            'store:allow-load',
            'store:allow-get',
            'store:allow-set',
            'store:allow-delete',
            'store:allow-save',
        ]));
    });
});
