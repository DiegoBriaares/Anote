import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Control Center lifecycle ownership guard', () => {
    it('refuses legacy database mutation after enrollment before opening production data', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anote-user-op-guard-'));
        const production = path.join(root, 'production');
        fs.mkdirSync(path.join(root, 'registry'), { recursive: true });
        fs.mkdirSync(production);
        fs.writeFileSync(path.join(root, 'registry', 'installation.json'), '{}');

        const result = spawnSync(process.execPath, [
            path.resolve('scripts/prod_user_ops.cjs'),
            'make-admin',
            '--username=owner',
            `--target-dir=${production}`
        ], { encoding: 'utf8' });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('managed by Anote Control Center');
        expect(result.stderr).not.toContain('Database not found');
    });
});
