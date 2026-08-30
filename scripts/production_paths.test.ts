import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = path.resolve('scripts/production_paths.sh');

const resolvePaths = (env: NodeJS.ProcessEnv) => execFileSync(
    'bash',
    ['-c', 'source "$1"; printf "%s\n%s\n%s" "$ANOTE_PRODUCTION_HOME" "$ANOTE_DATA_DIR" "$ANOTE_ENV_FILE"', 'bash', script],
    { encoding: 'utf8', env: { ...process.env, ...env } }
).split('\n');

describe('production path ownership', () => {
    it('derives every production path from an explicit production home', () => {
        const [home, data, envFile] = resolvePaths({
            ANOTE_PRODUCTION_HOME: '/private/example-anote-production'
        });

        expect(home).toBe('/private/example-anote-production');
        expect(data).toBe('/private/example-anote-production/data');
        expect(envFile).toBe('/private/example-anote-production/production.env');
    });

    it('uses an operating-system state directory without embedding a user name', () => {
        const [home] = resolvePaths({
            ANOTE_PRODUCTION_HOME: '',
            HOME: '/private/example-home',
            XDG_STATE_HOME: '/private/example-state'
        });

        const expected = process.platform === 'darwin'
            ? '/private/example-home/Library/Application Support/Anote/production'
            : '/private/example-state/Anote/production';
        expect(home).toBe(expected);
    });

    it('refuses legacy production ownership after Control Center enrollment', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anote-control-center-guard-'));
        const productionHome = path.join(root, 'production');
        fs.mkdirSync(path.join(root, 'registry'), { recursive: true });
        fs.writeFileSync(path.join(root, 'registry', 'installation.json'), '{}');

        const result = spawnSync(
            'bash',
            ['-c', 'source "$1"', 'bash', script],
            {
                encoding: 'utf8',
                env: { ...process.env, ANOTE_PRODUCTION_HOME: productionHome }
            }
        );

        expect(result.status).toBe(73);
        expect(result.stderr).toContain('managed by Anote Control Center');
    });
});
