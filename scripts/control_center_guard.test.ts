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

    it('cannot bypass enrollment by pairing a managed database with an unrelated target', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anote-user-op-db-guard-'));
        const managedProduction = path.join(root, 'managed', 'production');
        const unrelatedProduction = path.join(root, 'unrelated', 'production');
        fs.mkdirSync(path.join(root, 'managed', 'registry'), { recursive: true });
        fs.mkdirSync(path.join(managedProduction, 'data'), { recursive: true });
        fs.mkdirSync(path.join(unrelatedProduction, 'data'), { recursive: true });
        fs.writeFileSync(path.join(root, 'managed', 'registry', 'installation.json'), '{}');
        const managedDatabase = path.join(managedProduction, 'data', 'calendar.db');
        fs.writeFileSync(managedDatabase, 'not opened');

        const result = spawnSync(process.execPath, [
            path.resolve('scripts/prod_user_ops.cjs'),
            'make-admin',
            '--username=owner',
            `--target-dir=${unrelatedProduction}`,
            `--db=${managedDatabase}`
        ], { encoding: 'utf8' });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('require the database owned by --target-dir');
    });
});
