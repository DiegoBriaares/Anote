import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createDatabase } = require('./db');

describe('event status schema migration', () => {
    it('adds failed to existing calendar and legacy postponed event tables', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anote-event-status-'));
        const dbPath = path.join(tmpDir, 'calendar.db');
        const legacyDb = createDatabase(dbPath, () => {});
        legacyDb.run(`CREATE TABLE events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            user_id TEXT NOT NULL,
            completed INTEGER DEFAULT 0
        )`);
        legacyDb.run(`CREATE TABLE postponed_events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            user_id TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            updated_at INTEGER DEFAULT 0,
            resources TEXT
        )`);
        legacyDb.close();

        const script = `
            const { initDbOnce } = require('./server/index');
            const { createDatabase } = require('./server/db');
            initDbOnce(() => {
                const db = createDatabase(process.env.ANOTE_DATABASE_PATH, () => {});
                const events = db.all('PRAGMA table_info(events)').map((column) => column.name);
                const postponed = db.all('PRAGMA table_info(postponed_events)').map((column) => column.name);
                db.close();
                process.stdout.write(JSON.stringify({ events, postponed }));
                process.exit(0);
            });
        `;
        const result = execFileSync(process.execPath, ['-e', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: {
                ...process.env,
                ANOTE_DATABASE_PATH: dbPath,
                ANOTE_UPLOAD_DIR: path.join(tmpDir, 'uploads'),
                NODE_ENV: 'development'
            }
        });
        const jsonStart = result.lastIndexOf('{');
        const migrated = JSON.parse(result.slice(jsonStart));

        expect(migrated.events).toContain('failed');
        expect(migrated.postponed).toContain('failed');
    });
});
