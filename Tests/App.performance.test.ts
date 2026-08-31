import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repositoryRoot, 'src');

const sourceFiles = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(candidate);
        return entry.isFile() && candidate.endsWith('.tsx') ? [candidate] : [];
    });

describe('responsive navigation ownership', () => {
    it('keeps React views off whole-store subscriptions', () => {
        const offenders = sourceFiles(sourceRoot).filter((file) => /useCalendarStore\(\s*\)/.test(
            fs.readFileSync(file, 'utf8')
        ));

        expect(offenders).toEqual([]);
    });

    it('preloads menu workspaces without a shell-wide one-second transition', () => {
        const app = fs.readFileSync(path.join(sourceRoot, 'App.tsx'), 'utf8');

        expect(app).toContain('preloadMenuViews');
        expect(app).toContain('if (next) preloadMenuViews');
        expect(app).not.toContain('duration-1000');
    });
});
