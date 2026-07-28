import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { ensureEventNotesSchema } = require('./ensureEventNotesSchema');
const { createDatabase } = require('./db');

let dbsToClose: Array<{ close: () => void }> = [];

const run = (db: any, sql: string, params: unknown[] = []) => {
    db.run(sql, params);
};

const all = (db: any, sql: string, params: unknown[] = []) => {
    return db.all(sql, params);
};

const closeDb = (db: any) => {
    db.close();
};

afterEach(async () => {
    const closers = dbsToClose;
    dbsToClose = [];
    for (const db of closers) {
        closeDb(db);
    }
});

describe('ensureEventNotesSchema', () => {
    it('migrates legacy event_notes without losing rows', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-event-notes-'));
        const dbPath = path.join(tmpDir, 'calendar.db');
        const db = createDatabase(dbPath, () => {});
        dbsToClose.push(db);

        run(db, 'CREATE TABLE event_notes (event_id TEXT PRIMARY KEY, content TEXT)');
        run(db, 'INSERT INTO event_notes (event_id, content) VALUES (?, ?)', ['event-1', 'Keep me']);

        await new Promise<void>((resolve) => ensureEventNotesSchema(db, resolve));

        const rows = all(db, 'SELECT * FROM event_notes');
        expect(rows).toHaveLength(1);
        expect(rows[0].event_id).toBe('event-1');
        expect(rows[0].role_id).toBe('legacy');
        expect(rows[0].content).toBe('Keep me');

        const columns = all(db, 'PRAGMA table_info(event_notes)');
        const pkColumns = columns.filter((col) => col.pk > 0).map((col) => col.name);
        expect(pkColumns).toEqual(['event_id', 'role_id']);
    });

    it('preserves option_id values when migrating', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-event-notes-option-'));
        const dbPath = path.join(tmpDir, 'calendar.db');
        const db = createDatabase(dbPath, () => {});
        dbsToClose.push(db);

        run(db, 'CREATE TABLE event_notes (event_id TEXT PRIMARY KEY, option_id TEXT, content TEXT)');
        run(db, 'INSERT INTO event_notes (event_id, option_id, content) VALUES (?, ?, ?)', ['event-2', 'role-7', 'Note']);

        await new Promise<void>((resolve) => ensureEventNotesSchema(db, resolve));

        const rows = all(db, 'SELECT * FROM event_notes');
        expect(rows).toHaveLength(1);
        expect(rows[0].event_id).toBe('event-2');
        expect(rows[0].role_id).toBe('role-7');
        expect(rows[0].content).toBe('Note');
    });

    it('falls back to legacy role when option_id is null', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-event-notes-option-null-'));
        const dbPath = path.join(tmpDir, 'calendar.db');
        const db = createDatabase(dbPath, () => {});
        dbsToClose.push(db);

        run(db, 'CREATE TABLE event_notes (event_id TEXT PRIMARY KEY, option_id TEXT, content TEXT)');
        run(db, 'INSERT INTO event_notes (event_id, option_id, content) VALUES (?, ?, ?)', ['event-3', null, 'No role']);

        await new Promise<void>((resolve) => ensureEventNotesSchema(db, resolve));

        const rows = all(db, 'SELECT * FROM event_notes');
        expect(rows).toHaveLength(1);
        expect(rows[0].event_id).toBe('event-3');
        expect(rows[0].role_id).toBe('legacy');
        expect(rows[0].content).toBe('No role');
    });
});
