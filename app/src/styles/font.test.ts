import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

function cssRules(source: string, selector: string): string[] {
    const blocks: string[] = [];
    let searchFrom = 0;
    while (true) {
        const index = source.indexOf(selector, searchFrom);
        if (index < 0) break;
        const start = source.indexOf('{', index);
        expect(start, `${selector} should have a block`).toBeGreaterThanOrEqual(0);
        const end = source.indexOf('}', start);
        expect(end, `${selector} block should close`).toBeGreaterThanOrEqual(0);
        blocks.push(source.slice(start + 1, end));
        searchFrom = end + 1;
    }
    return blocks;
}

function cssRule(source: string, selector: string): string {
    const index = source.indexOf(selector);
    expect(index, `${selector} should exist`).toBeGreaterThanOrEqual(0);
    const start = source.indexOf('{', index);
    expect(start, `${selector} should have a block`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf('}', start);
    expect(end, `${selector} block should close`).toBeGreaterThanOrEqual(0);
    return source.slice(start + 1, end);
}

describe('Maoken app font', () => {
    it('declares Maoken as the app font across the UI weight range', () => {
        const globalCss = readFileSync(path.join(here, 'global.css'), 'utf8');
        const tokensCss = readFileSync(path.join(here, 'tokens.css'), 'utf8');
        const fontFaces = cssRules(globalCss, '@font-face');
        const root = cssRule(tokensCss, ':root');
        const weights = fontFaces
            .map((fontFace) => fontFace.match(/font-weight:\s*(\d+)\s*;/)?.[1])
            .filter(Boolean)
            .sort();

        expect(weights).toEqual(['400', '500', '600', '700', '800', '900']);
        fontFaces.forEach((fontFace) => {
            expect(fontFace).toMatch(/font-family:\s*['"]MaokenAssortedSans['"]\s*;/);
            expect(fontFace).toMatch(/src:\s*url\(['"]?\/fonts\/MaokenAssortedSans\.ttf['"]?\)\s*format\(['"]truetype['"]\)\s*;/);
        });
        expect(root).toMatch(/--font-cn:\s*"MaokenAssortedSans"/);
    });
});
