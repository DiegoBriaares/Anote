import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const testDirectory = path.dirname(fileURLToPath(import.meta.url));

const { MAX_ATTACHMENT_BYTES, createAttachmentService } = require('./attachments');
const { createAdminService } = require('./admin');
const { createRuntime } = require('./app');
const { createSessionService, tokenHash } = require('./auth');
const { closeDatabase, createDatabase } = require('./db');
const { createEventService } = require('./events');
const { ApiError } = require('./http');
const { SCHEMA_VERSION, migrateDatabase } = require('./migrations');
const { createProgramService, startProgramScheduler } = require('./programs');
const { wallTimeToInstant, zonedParts } = require('./time');
const { createUserService } = require('./users');

interface TestDatabase {
    prepare: (sql: string) => {
        run: (...parameters: unknown[]) => unknown;
    };
}

const cleanupPaths: string[] = [];

const temporaryDirectory = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anote-backend-'));
    cleanupPaths.push(directory);
    return directory;
};

const createTestDatabase = (now = () => new Date('2026-01-01T12:00:00.000Z')) => {
    const directory = temporaryDirectory();
    const db = createDatabase(path.join(directory, 'calendar.db'));
    migrateDatabase(db, { defaultTimeZone: 'UTC', now });
    return { db, directory };
};

const insertUser = (db: TestDatabase, id: string, username = id, password = '$2b$12$disabled') => {
    db.prepare('INSERT INTO users (id, username, password, preferences, is_admin) VALUES (?, ?, ?, ?, 0)')
        .run(id, username, password, '{}');
};

afterEach(() => {
    while (cleanupPaths.length > 0) {
        fs.rmSync(cleanupPaths.pop(), { recursive: true, force: true });
    }
});

describe('fail-closed schema migrations', () => {
    it('refuses a production program migration without a valid installation time zone', () => {
        const directory = temporaryDirectory();
        const db = createDatabase(path.join(directory, 'invalid-time-zone.db'));
        db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, preferences TEXT)');
        db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(
            'u1',
            'one',
            'disabled',
            JSON.stringify({ programs: [{ name: 'Carry', activationTime: '08:00', isEnabled: true }] })
        );

        expect(() => migrateDatabase(db, {
            defaultTimeZone: 'Not/A_Time_Zone',
            isProduction: true,
            now: () => new Date('2026-01-01T00:00:00.000Z')
        })).toThrow('valid installation IANA time zone');
        expect(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version).toBe(3);
        expect(JSON.parse(db.prepare('SELECT preferences FROM users WHERE id = ?').get('u1').preferences).programs)
            .toHaveLength(1);
        closeDatabase(db);
    });

    it('does not invent UTC when a production installation time zone is missing', () => {
        const directory = temporaryDirectory();
        const db = createDatabase(path.join(directory, 'missing-time-zone.db'));
        db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, preferences TEXT)');
        db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(
            'u1',
            'one',
            'disabled',
            JSON.stringify({ programs: [{ name: 'Carry', activationTime: '08:00', isEnabled: true }] })
        );

        expect(() => migrateDatabase(db, {
            isProduction: true,
            now: () => new Date('2026-01-01T00:00:00.000Z')
        })).toThrow('valid installation IANA time zone');
        expect(JSON.parse(db.prepare('SELECT preferences FROM users WHERE id = ?').get('u1').preferences).programs)
            .toHaveLength(1);
        closeDatabase(db);
    });

    it('preserves legacy rows, normalizes notes, and migrates each user program exactly once', () => {
        const directory = temporaryDirectory();
        const db = createDatabase(path.join(directory, 'legacy.db'));
        db.exec(`
            CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, preferences TEXT);
            CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, user_id TEXT NOT NULL);
            CREATE TABLE event_notes (event_id TEXT NOT NULL, option_id TEXT, content TEXT, updated_at INTEGER);
        `);
        const firstPreferences = JSON.stringify({
            programs: [{ id: 'to-tomorrow-program', name: 'To Tomorrow', activationTime: '08:30', isEnabled: true, targetOffsetDays: 1, timeZone: 'Asia/Tokyo' }],
            language: 'es',
            timeZone: 'Europe/Madrid'
        });
        const secondPreferences = JSON.stringify({
            programs: [{ id: 'to-tomorrow-program', name: 'To Tomorrow', activationTime: '08:30', isEnabled: true, targetOffsetDays: 1 }],
            language: 'es',
            timeZone: 'Europe/Madrid'
        });
        db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('u1', 'one', 'disabled', firstPreferences);
        db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('u2', 'two', 'disabled', secondPreferences);
        db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run('e1', 'Keep me', '2026-01-01', 'u1');
        db.prepare('INSERT INTO event_notes VALUES (?, ?, ?, ?)').run('e1', 'role-legacy', 'note', 10);

        const version = migrateDatabase(db, {
            defaultTimeZone: 'America/Mexico_City',
            now: () => new Date('2026-01-01T12:00:00.000Z')
        });

        expect(version).toBe(SCHEMA_VERSION);
        expect(db.prepare('SELECT title, revision FROM events WHERE id = ?').get('e1')).toEqual({ title: 'Keep me', revision: 1 });
        expect(db.prepare('SELECT role_id, content FROM event_notes').get()).toEqual({ role_id: 'role-legacy', content: 'note' });
        const programs = db.prepare('SELECT owner_user_id, time_zone FROM programs ORDER BY owner_user_id').all();
        expect(programs).toEqual([
            { owner_user_id: 'u1', time_zone: 'Asia/Tokyo' },
            { owner_user_id: 'u2', time_zone: 'Europe/Madrid' }
        ]);
        expect(JSON.parse(db.prepare('SELECT preferences FROM users WHERE id = ?').get('u1').preferences)).toEqual({
            language: 'es',
            timeZone: 'Europe/Madrid'
        });
        expect(db.prepare("SELECT value FROM app_config WHERE key = 'registration_enabled'").get().value).toBe('true');
        expect(migrateDatabase(db, { defaultTimeZone: 'UTC' })).toBe(SCHEMA_VERSION);
        db.prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1").run();
        expect(() => migrateDatabase(db, { defaultTimeZone: 'UTC' })).toThrow('identity drift');
        closeDatabase(db);
    });

    it('refuses a database created by a newer application version', () => {
        const { db } = createTestDatabase();
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)')
            .run(99, 'future', new Date().toISOString(), 'future');
        expect(() => migrateDatabase(db, { defaultTimeZone: 'UTC' })).toThrow('newer than this application');
        closeDatabase(db);
    });

    it('rebuilds the representative legacy ownership graph without losing valid business rows', () => {
        const directory = temporaryDirectory();
        const db = createDatabase(path.join(directory, 'representative-legacy.db'));
        db.exec(`
            CREATE TABLE users (
                id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL, preferences TEXT
            );
            CREATE TABLE events (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL,
                user_id TEXT NOT NULL, completed INTEGER DEFAULT 0,
                failed INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0
            );
            CREATE TABLE postponed_events (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT,
                user_id TEXT NOT NULL, completed INTEGER DEFAULT 0,
                failed INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0
            );
            CREATE TABLE roles (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL,
                color TEXT, is_enabled INTEGER DEFAULT 1, order_index INTEGER DEFAULT 0
            );
            CREATE TABLE subroles (
                id TEXT PRIMARY KEY, role_id TEXT NOT NULL, user_id TEXT NOT NULL,
                label TEXT NOT NULL, color TEXT, is_enabled INTEGER DEFAULT 1,
                order_index INTEGER DEFAULT 0
            );
            CREATE TABLE friendships (user_a TEXT NOT NULL, user_b TEXT NOT NULL, UNIQUE(user_a, user_b));
            CREATE TABLE daily_facts_v2 (date TEXT, user_id TEXT, content TEXT, PRIMARY KEY(date, user_id));
            CREATE TABLE day_backgrounds_v2 (date TEXT, user_id TEXT, image_url TEXT, PRIMARY KEY(date, user_id));
            CREATE TABLE event_notes (event_id TEXT NOT NULL, option_id TEXT, content TEXT, updated_at INTEGER);
            CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT);
        `);
        db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('u1', 'One', 'disabled', '{}');
        db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('u2', 'Two', 'disabled', '{}');
        db.prepare('INSERT INTO events (id, title, date, user_id) VALUES (?, ?, ?, ?)')
            .run('e1', 'Preserved event', '2026-01-01', 'u1');
        db.prepare('INSERT INTO postponed_events (id, title, date, user_id) VALUES (?, ?, ?, ?)')
            .run('p1', 'Preserved postponed event', null, 'u2');
        db.prepare('INSERT INTO roles VALUES (?, ?, ?, ?, ?, ?)').run('r1', 'u1', 'Owner one', null, 1, 0);
        db.prepare('INSERT INTO subroles VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run('s1', 'r1', 'u2', 'Cross-owner legacy subrole', null, 1, 0);
        db.prepare('INSERT INTO friendships VALUES (?, ?)').run('u2', 'u1');
        db.prepare('INSERT INTO friendships VALUES (?, ?)').run('u1', 'u2');
        db.prepare('INSERT INTO friendships VALUES (?, ?)').run('u1', 'orphan-user');
        db.prepare('INSERT INTO daily_facts_v2 VALUES (?, ?, ?)').run('2026-01-01', 'u1', 'fact');
        db.prepare('INSERT INTO day_backgrounds_v2 VALUES (?, ?, ?)').run('2026-01-01', 'u2', 'https://example.test/a.png');
        db.prepare('INSERT INTO event_notes VALUES (?, ?, ?, ?)').run('e1', 'r1', 'preserved note', 10);

        expect(migrateDatabase(db, { defaultTimeZone: 'UTC' })).toBe(SCHEMA_VERSION);

        expect(db.pragma('foreign_key_check')).toEqual([]);
        expect(db.prepare('SELECT title FROM events WHERE id = ?').get('e1').title).toBe('Preserved event');
        expect(db.prepare('SELECT title FROM postponed_events WHERE id = ?').get('p1').title)
            .toBe('Preserved postponed event');
        expect(db.prepare('SELECT content FROM event_notes WHERE event_id = ?').get('e1').content).toBe('preserved note');
        expect(db.prepare('SELECT user_a, user_b FROM friendships ORDER BY user_a, user_b').all()).toEqual([
            { user_a: 'orphan-user', user_b: 'u1' },
            { user_a: 'u1', user_b: 'u2' }
        ]);
        const repairedSubrole = db.prepare(`
            SELECT s.role_id, s.user_id, r.user_id AS role_owner
            FROM subroles s JOIN roles r ON r.id = s.role_id
            WHERE s.id = 's1'
        `).get();
        expect(repairedSubrole.user_id).toBe('u2');
        expect(repairedSubrole.role_owner).toBe('u2');
        expect(db.prepare("SELECT value FROM app_config WHERE key = 'registration_enabled'").get().value).toBe('true');
        expect(db.prepare("SELECT username FROM users WHERE id = 'orphan-user'").get().username).toMatch(/^legacy-/);
        closeDatabase(db);
    });

    it('rolls back a failed migration phase and resumes after the corrupt row is repaired', () => {
        const directory = temporaryDirectory();
        const db = createDatabase(path.join(directory, 'migration-failure.db'));
        db.exec(`
            CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
            CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, user_id TEXT NOT NULL);
            CREATE TABLE event_notes (event_id TEXT NOT NULL, option_id TEXT, content TEXT, updated_at INTEGER);
            INSERT INTO users VALUES ('u1', 'one', 'disabled');
            INSERT INTO event_notes VALUES ('missing-event', 'missing-role', 'must not disappear', 1);
        `);

        expect(() => migrateDatabase(db, { defaultTimeZone: 'UTC' })).toThrow('references missing event');
        expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([
            { version: 1 },
            { version: 2 }
        ]);
        expect(db.prepare('SELECT content FROM event_notes').get().content).toBe('must not disappear');
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attachments'").get())
            .toBeUndefined();

        db.prepare("DELETE FROM event_notes WHERE event_id = 'missing-event'").run();
        expect(migrateDatabase(db, { defaultTimeZone: 'UTC' })).toBe(SCHEMA_VERSION);
        closeDatabase(db);
    });
});

describe('event transaction and revision ownership', () => {
    it('rejects stale writes and moves incomplete events atomically', () => {
        const { db } = createTestDatabase();
        insertUser(db, 'u1');
        const service = createEventService({ db, now: () => new Date('2026-01-01T12:00:00.000Z') });
        const created = service.createMany('u1', [
            { id: 'a', title: 'A', date: '2026-01-01' },
            { id: 'b', title: 'B', date: '2026-01-01' }
        ]);
        expect(created.every((event: { revision: number }) => event.revision === 1)).toBe(true);
        expect(service.update('u1', 'a', { title: 'A2', date: '2026-01-01' }, 1)).toBe(2);
        expect(() => service.update('u1', 'a', { title: 'stale', date: '2026-01-01' }, 1))
            .toThrowError(ApiError);
        expect(db.prepare('SELECT title, revision FROM events WHERE id = ?').get('a')).toEqual({ title: 'A2', revision: 2 });
        expect(() => service.update('u1', 'a', {
            title: 'Invalid unlock', date: '2026-01-01', unlockDate: '2026-02-31'
        }, 2)).toThrowError(ApiError);
        expect(db.prepare('SELECT title, revision FROM events WHERE id = ?').get('a')).toEqual({ title: 'A2', revision: 2 });

        db.exec(`
            CREATE TRIGGER fail_second_move BEFORE UPDATE OF date ON events
            WHEN NEW.id = 'b'
            BEGIN SELECT RAISE(ABORT, 'injected move failure'); END;
        `);
        expect(() => service.moveIncomplete('u1', ['2026-01-01'], '2026-01-02')).toThrow('injected move failure');
        expect(db.prepare('SELECT id, date FROM events ORDER BY id').all()).toEqual([
            { id: 'a', date: '2026-01-01' },
            { id: 'b', date: '2026-01-01' }
        ]);
        closeDatabase(db);
    });

    it('rolls back an nth admin selection and keeps stale and foreign failures non-enumerating', () => {
        const { db } = createTestDatabase();
        insertUser(db, 'u1');
        insertUser(db, 'u2');
        const events = createEventService({ db });
        events.createMany('u1', [
            { id: 'first', title: 'First', date: '2026-01-01' },
            { id: 'second', title: 'Second', date: '2026-01-01' }
        ]);
        events.createMany('u2', [{ id: 'foreign', title: 'Foreign', date: '2026-01-01' }]);
        expect(events.update('u1', 'second', { title: 'Second revision', date: '2026-01-01' }, 1)).toBe(2);
        const admin = createAdminService({ db, eventService: events, userService: createUserService({ db }) });

        let staleCode;
        try {
            admin.removeEvents([{ id: 'first', revision: 1 }, { id: 'second', revision: 1 }]);
        } catch (error) {
            staleCode = error.code;
        }
        expect(staleCode).toBe('EVENT_CONFLICT_OR_MISSING');
        expect(db.prepare("SELECT id FROM events WHERE id IN ('first', 'second') ORDER BY id").all()).toEqual([
            { id: 'first' },
            { id: 'second' }
        ]);

        const failureCode = (id: string) => {
            try {
                events.update('u1', id, { title: 'Denied', date: '2026-01-01' }, 1);
            } catch (error) {
                return error.code;
            }
            return null;
        };
        expect(failureCode('foreign')).toBe('EVENT_CONFLICT_OR_MISSING');
        expect(failureCode('missing')).toBe('EVENT_CONFLICT_OR_MISSING');
        expect(admin.removeEvents([{ id: 'first', revision: 1 }, { id: 'second', revision: 2 }])).toBe(2);
        closeDatabase(db);
    });
});

describe('automatic program transaction ownership', () => {
    it('moves every eligible event and records one idempotent run', () => {
        const now = () => new Date('2026-01-01T12:00:00.000Z');
        const { db } = createTestDatabase(now);
        insertUser(db, 'u1');
        const events = createEventService({ db, now });
        events.createMany('u1', [
            { id: 'pending-a', title: 'A', date: '2026-01-01' },
            { id: 'pending-b', title: 'B', date: '2026-01-01' },
            { id: 'done', title: 'Done', date: '2026-01-01', completed: true }
        ]);
        const programs = createProgramService({ db, now });
        const program = programs.create('u1', {
            name: 'Tomorrow', enabled: true, activationTime: '08:00', targetDayOffset: 1, timeZone: 'UTC'
        });

        const first = programs.run('u1', program.id, { expectedRevision: program.revision });
        const second = programs.run('u1', program.id, { expectedRevision: program.revision });
        expect(first).toEqual(second);
        expect(first).toMatchObject({ sourceDate: '2026-01-01', targetDate: '2026-01-02', movedEventCount: 2 });
        expect(db.prepare('SELECT COUNT(*) AS count FROM program_runs').get().count).toBe(1);
        expect(db.prepare("SELECT COUNT(*) AS count FROM events WHERE date = '2026-01-02'").get().count).toBe(2);
        expect(db.prepare("SELECT date FROM events WHERE id = 'done'").get().date).toBe('2026-01-01');
        closeDatabase(db);
    });

    it('rolls back event changes and ledger creation on an injected write failure', () => {
        const now = () => new Date('2026-01-01T12:00:00.000Z');
        const { db } = createTestDatabase(now);
        insertUser(db, 'u1');
        createEventService({ db, now }).createMany('u1', [
            { id: 'a', title: 'A', date: '2026-01-01' },
            { id: 'b', title: 'B', date: '2026-01-01' }
        ]);
        const programs = createProgramService({ db, now });
        const program = programs.create('u1', {
            name: 'Tomorrow', enabled: true, activationTime: '08:00', targetDayOffset: 1, timeZone: 'UTC'
        });
        db.exec(`
            CREATE TRIGGER fail_program_move BEFORE UPDATE OF date ON events
            WHEN NEW.id = 'b'
            BEGIN SELECT RAISE(ABORT, 'injected program failure'); END;
        `);
        expect(() => programs.run('u1', program.id, { expectedRevision: program.revision })).toThrow('injected program failure');
        expect(db.prepare('SELECT DISTINCT date FROM events').all()).toEqual([{ date: '2026-01-01' }]);
        expect(db.prepare('SELECT COUNT(*) AS count FROM program_runs').get().count).toBe(0);
        closeDatabase(db);
    });

    it('catches up missed sources without cascading them through the current occurrence or a later program', () => {
        const now = () => new Date('2026-01-03T12:00:00.000Z');
        const { db } = createTestDatabase(now);
        insertUser(db, 'u1');
        const events = createEventService({ db, now });
        events.createMany('u1', [
            { id: 'old-a', title: 'Old A', date: '2026-01-01' },
            { id: 'old-b', title: 'Old B', date: '2026-01-02' },
            { id: 'today', title: 'Today', date: '2026-01-03' }
        ]);
        const programs = createProgramService({ db, now });
        const program = programs.create('u1', {
            name: 'Tomorrow', enabled: true, activationTime: '08:00', targetDayOffset: 1, timeZone: 'UTC'
        });
        db.prepare('UPDATE programs SET next_run_at = ? WHERE id = ?').run('2026-01-01T08:00:00.000Z', program.id);

        const firstRuns = programs.runDue();
        const restartedPrograms = createProgramService({ db, now });
        const laterProgram = restartedPrograms.create('u1', {
            name: 'Later', enabled: true, activationTime: '09:00', targetDayOffset: 2, timeZone: 'UTC'
        });
        db.prepare('UPDATE programs SET next_run_at = ? WHERE id = ?').run('2026-01-03T09:00:00.000Z', laterProgram.id);
        const runs = [...firstRuns, ...restartedPrograms.runDue()];

        expect(runs.map((run: { sourceDate: string; movedEventCount: number }) => [run.sourceDate, run.movedEventCount])).toEqual([
            ['2026-01-01', 1],
            ['2026-01-02', 1],
            ['2026-01-03', 1],
            ['2026-01-03', 0]
        ]);
        expect(db.prepare('SELECT id, date FROM events ORDER BY id').all()).toEqual([
            { id: 'old-a', date: '2026-01-03' },
            { id: 'old-b', date: '2026-01-03' },
            { id: 'today', date: '2026-01-04' }
        ]);
        expect(db.prepare('SELECT next_run_at FROM programs WHERE id = ?').get(program.id).next_run_at)
            .toBe('2026-01-04T08:00:00.000Z');
        const notifications = restartedPrograms.notifications('u1', null);
        expect(notifications.data).toHaveLength(4);
        const sessions = createSessionService({
            db,
            config: { sessionIdleSeconds: 3600, sessionAbsoluteSeconds: 7200 },
            now
        });
        sessions.create('u1', 'test');
        const sessionId = db.prepare('SELECT id FROM sessions WHERE user_id = ?').get('u1').id;
        expect(() => restartedPrograms.completeNotifications(
            'u1',
            [...notifications.data.map((run: { id: string }) => run.id), 'missing-run'],
            sessionId
        )).toThrowError(ApiError);
        expect(restartedPrograms.notifications('u1', notifications.cursor).data).toHaveLength(4);
        expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count).toBe(1);
        restartedPrograms.completeNotifications(
            'u1',
            notifications.data.map((run: { id: string }) => run.id),
            sessionId
        );
        expect(restartedPrograms.notifications('u1', notifications.cursor).data).toHaveLength(0);
        expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count).toBe(0);
        closeDatabase(db);
    });

    it('rolls back a multi-program save when any supplied revision is stale', () => {
        const { db } = createTestDatabase();
        insertUser(db, 'u1');
        const programs = createProgramService({ db });
        const first = programs.create('u1', {
            name: 'First', enabled: false, activationTime: '08:00', targetDayOffset: 1, timeZone: 'UTC'
        });
        const second = programs.create('u1', {
            name: 'Second', enabled: false, activationTime: '09:00', targetDayOffset: 1, timeZone: 'UTC'
        });

        expect(() => programs.updateMany('u1', [
            { ...first, name: 'Changed first' },
            { ...second, name: 'Changed second', revision: 99 }
        ])).toThrowError(ApiError);
        expect(programs.list('u1').map((program: { name: string; revision: number }) => ({
            name: program.name,
            revision: program.revision
        })).sort((left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name))).toEqual([
            { name: 'First', revision: 1 },
            { name: 'Second', revision: 1 }
        ]);
        closeDatabase(db);
    });

    it('cancels the queued scheduler tick before shutdown returns', async () => {
        let runCount = 0;
        const stop = startProgramScheduler({
            service: { runDue: () => { runCount += 1; } },
            intervalMs: 60_000,
            logger: { error: () => undefined }
        });
        stop();
        await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
        expect(runCount).toBe(0);
    });
});

describe('credentials and opaque sessions', () => {
    it('enforces twelve Unicode characters and case-insensitive username uniqueness for new accounts', async () => {
        const { db } = createTestDatabase();
        const users = createUserService({ db });
        await expect(users.create({ username: 'short', password: '12345678901' }))
            .rejects.toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
        await expect(users.create({ username: 'too-long', password: 'x'.repeat(73) }))
            .rejects.toMatchObject({ code: 'PASSWORD_TOO_LONG' });
        const user = await users.create({ username: 'CaseOwner', password: '🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐' });
        expect(user.username).toBe('CaseOwner');
        expect(db.prepare('SELECT password FROM users WHERE id = ?').get(user.id).password).toMatch(/^\$2b\$12\$/);
        await expect(users.create({ username: 'caseowner', password: 'another valid password' }))
            .rejects.toMatchObject({ code: 'USERNAME_UNAVAILABLE' });
        expect(db.prepare("SELECT value FROM app_config WHERE key = 'registration_enabled'").get().value).toBe('false');
        closeDatabase(db);
    });

    it('stores only token hashes and deletes idle and absolute-expired sessions', () => {
        const { db } = createTestDatabase();
        insertUser(db, 'u1');
        let current = new Date('2026-01-01T00:00:00.000Z');
        const baseConfig = {
            sessionIdleSeconds: 10,
            sessionAbsoluteSeconds: 30
        };
        const idleSessions = createSessionService({ db, config: baseConfig, now: () => current });
        const idleToken = idleSessions.create('u1', 'test');
        const stored = db.prepare('SELECT token_hash FROM sessions').get();
        expect(stored.token_hash).toBe(tokenHash(idleToken));
        expect(stored.token_hash).not.toContain(idleToken);
        expect(idleSessions.read(idleToken)?.user.id).toBe('u1');
        current = new Date('2026-01-01T00:00:11.000Z');
        expect(idleSessions.read(idleToken)).toBeNull();
        expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count).toBe(0);

        current = new Date('2026-01-01T00:00:00.000Z');
        const absoluteSessions = createSessionService({
            db,
            config: { sessionIdleSeconds: 100, sessionAbsoluteSeconds: 30 },
            now: () => current
        });
        const absoluteToken = absoluteSessions.create('u1', 'test');
        current = new Date('2026-01-01T00:00:31.000Z');
        expect(absoluteSessions.read(absoluteToken)).toBeNull();
        expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count).toBe(0);
        closeDatabase(db);
    });
});

describe('session and request boundary', () => {
    it('uses an opaque HttpOnly cookie, enforces origin, and exposes release identity', async () => {
        const directory = temporaryDirectory();
        const db = createDatabase(path.join(directory, 'api.db'));
        migrateDatabase(db, { defaultTimeZone: 'UTC' });
        const hash = await bcrypt.hash('correct horse battery staple', 4);
        insertUser(db, 'admin', 'admin', hash);
        insertUser(db, 'viewer', 'viewer', hash);
        db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run('admin');
        db.prepare('UPDATE users SET preferences = ? WHERE id = ?')
            .run(JSON.stringify({ backgroundUrl: 'https://example.test/background.png', privateSetting: 'not-shared' }), 'admin');
        db.prepare("INSERT INTO app_config (key, value) VALUES ('internal_secret', 'must-not-be-public')").run();
        const config = {
            isProduction: true,
            databasePath: path.join(directory, 'api.db'),
            uploadDir: path.join(directory, 'uploads'),
            sessionCookieName: 'anote_session',
            sessionIdleSeconds: 3600,
            sessionAbsoluteSeconds: 7200,
            secureCookies: false,
            defaultTimeZone: 'UTC',
            release: { id: 'release-test', version: '1.2.3', sourceCommit: 'abc123' }
        };
        fs.mkdirSync(config.uploadDir);
        const runtime = createRuntime({ config, database: db, scheduler: false });
        const server = runtime.app.listen(0, '127.0.0.1');
        await new Promise<void>((resolve) => server.once('listening', resolve));
        const address = server.address();
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const publicConfig = await fetch(`${baseUrl}/config`);
        expect(publicConfig.status).toBe(200);
        expect((await publicConfig.json()).data).not.toHaveProperty('internal_secret');
        const missingRoute = await fetch(`${baseUrl}/missing-route`, {
            headers: { 'x-request-id': 'backend-contract-request' }
        });
        expect(missingRoute.headers.get('x-request-id')).toBe('backend-contract-request');
        expect(await missingRoute.json()).toEqual({
            error: { code: 'ROUTE_NOT_FOUND' },
            requestId: 'backend-contract-request'
        });

        const missingOrigin = await fetch(`${baseUrl}/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'correct horse battery staple' })
        });
        expect(missingOrigin.status).toBe(403);
        expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count).toBe(0);

        const registration = await fetch(`${baseUrl}/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ username: 'new-user', password: 'correct horse battery staple' })
        });
        expect(registration.status).toBe(403);
        expect(await registration.json()).toMatchObject({ error: { code: 'REGISTRATION_DISABLED' } });

        db.prepare("UPDATE app_config SET value = 'true' WHERE key = 'registration_enabled'").run();
        const registrationCases = [
            { username: 'admin', password: 'correct horse battery staple', code: 'REGISTRATION_REJECTED' },
            { username: '', password: 'correct horse battery staple', code: 'REGISTRATION_REJECTED' },
            { username: 'too-short', password: '12345678901', code: 'PASSWORD_TOO_SHORT' }
        ];
        for (const registrationCase of registrationCases) {
            const response = await fetch(`${baseUrl}/register`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: baseUrl },
                body: JSON.stringify(registrationCase)
            });
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ error: { code: registrationCase.code } });
        }
        const registrationLimited = await fetch(`${baseUrl}/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ username: 'fourth', password: 'correct horse battery staple' })
        });
        expect(registrationLimited.status).toBe(429);
        expect(await registrationLimited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });

        const wrongExisting = await fetch(`${baseUrl}/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ username: 'admin', password: 'wrong password' })
        });
        expect(wrongExisting.status).toBe(401);
        expect(await wrongExisting.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const denied = await fetch(`${baseUrl}/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: baseUrl },
                body: JSON.stringify({ username: 'missing-user', password: 'wrong password' })
            });
            expect(denied.status).toBe(401);
        }
        const limited = await fetch(`${baseUrl}/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ username: 'missing-user', password: 'wrong password' })
        });
        expect(limited.status).toBe(429);
        expect(await limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const denied = await fetch(`${baseUrl}/login`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    origin: baseUrl,
                    'x-forwarded-for': `203.0.113.${attempt + 1}, 198.51.100.20`
                },
                body: JSON.stringify({ username: 'xff-probe', password: 'wrong password' })
            });
            expect(denied.status).toBe(401);
        }
        const spoofLimited = await fetch(`${baseUrl}/login`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                origin: baseUrl,
                'x-forwarded-for': '203.0.113.250, 198.51.100.20'
            },
            body: JSON.stringify({ username: 'xff-probe', password: 'wrong password' })
        });
        expect(spoofLimited.status).toBe(429);

        const login = await fetch(`${baseUrl}/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ username: 'admin', password: 'correct horse battery staple' })
        });
        expect(login.status).toBe(200);
        const loginBody = await login.json();
        expect(loginBody).not.toHaveProperty('token');
        const cookie = login.headers.get('set-cookie');
        expect(cookie).toContain('anote_session=');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).toContain('Path=/api');

        const session = await fetch(`${baseUrl}/session`, { headers: { cookie } });
        expect(await session.json()).toMatchObject({ user: { id: 'admin', isAdmin: true } });

        const eventResponse = await fetch(`${baseUrl}/events`, {
            method: 'POST',
            headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ events: [{ id: 'private-event', title: 'Private', date: '2026-01-01' }] })
        });
        expect(eventResponse.status).toBe(201);
        db.exec(`
            CREATE TRIGGER redact_injected_failure BEFORE INSERT ON events
            WHEN NEW.id = 'redaction-probe'
            BEGIN SELECT RAISE(ABORT, '/private/secret.db password=do-not-leak'); END;
        `);
        const redactedFailure = await fetch(`${baseUrl}/events`, {
            method: 'POST',
            headers: {
                cookie,
                'content-type': 'application/json',
                origin: baseUrl,
                'x-request-id': 'redaction-probe-request'
            },
            body: JSON.stringify({ events: [{ id: 'redaction-probe', title: 'Probe', date: '2026-01-01' }] })
        });
        const redactedPayload = await redactedFailure.json();
        expect(redactedFailure.status).toBe(409);
        expect(redactedPayload).toEqual({
            error: { code: 'EVENT_CONFLICT' },
            requestId: 'redaction-probe-request'
        });
        expect(JSON.stringify(redactedPayload)).not.toContain('secret.db');
        db.exec('DROP TRIGGER redact_injected_failure');
        const postponedResponse = await fetch(`${baseUrl}/postponed-events`, {
            method: 'POST',
            headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ events: [{ id: 'private-postponed', title: 'Private postponed', date: null }] })
        });
        expect(postponedResponse.status).toBe(201);
        const roleResponse = await fetch(`${baseUrl}/roles`, {
            method: 'POST',
            headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ label: 'Private role' })
        });
        const role = (await roleResponse.json()).data;
        const saveNote = await fetch(`${baseUrl}/events/private-event/notes`, {
            method: 'POST',
            headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ roleId: role.id, content: 'owner only' })
        });
        expect(saveNote.status).toBe(200);

        const viewerLogin = await fetch(`${baseUrl}/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ username: 'viewer', password: 'correct horse battery staple' })
        });
        const viewerCookie = viewerLogin.headers.get('set-cookie');
        const deniedNote = await fetch(`${baseUrl}/events/private-event/notes`, { headers: { cookie: viewerCookie } });
        expect(deniedNote.status).toBe(404);
        expect(await deniedNote.json()).toMatchObject({ error: { code: 'EVENT_NOT_FOUND' } });

        const deniedEvent = await fetch(`${baseUrl}/events/private-event`, {
            method: 'PUT',
            headers: { cookie: viewerCookie, 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ title: 'Tampered', date: '2026-01-01', revision: 1 })
        });
        expect(deniedEvent.status).toBe(409);
        expect(await deniedEvent.json()).toMatchObject({ error: { code: 'EVENT_CONFLICT_OR_MISSING' } });
        const deniedPostponed = await fetch(`${baseUrl}/postponed-events/private-postponed`, {
            method: 'DELETE',
            headers: { cookie: viewerCookie, 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ revision: 1 })
        });
        expect(deniedPostponed.status).toBe(409);
        expect(await deniedPostponed.json()).toMatchObject({ error: { code: 'EVENT_CONFLICT_OR_MISSING' } });
        const deniedRole = await fetch(`${baseUrl}/roles/${role.id}`, {
            method: 'PUT',
            headers: { cookie: viewerCookie, 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ label: 'Tampered' })
        });
        expect(deniedRole.status).toBe(404);
        expect(await deniedRole.json()).toMatchObject({ error: { code: 'ROLE_NOT_FOUND' } });
        const deniedAdmin = await fetch(`${baseUrl}/admin/users`, { headers: { cookie: viewerCookie } });
        expect(deniedAdmin.status).toBe(403);
        expect(await deniedAdmin.json()).toMatchObject({ error: { code: 'ADMIN_REQUIRED' } });
        expect(db.prepare("SELECT title FROM events WHERE id = 'private-event'").get().title).toBe('Private');

        const notYetFriend = await fetch(`${baseUrl}/friends/admin/events`, { headers: { cookie: viewerCookie } });
        expect(notYetFriend.status).toBe(404);
        const addFriend = await fetch(`${baseUrl}/friends/admin`, {
            method: 'POST',
            headers: { cookie: viewerCookie, origin: baseUrl }
        });
        expect(addFriend.status).toBe(201);
        const friendEvents = await fetch(`${baseUrl}/friends/admin/events`, { headers: { cookie: viewerCookie } });
        const friendPayload = await friendEvents.json();
        expect(friendPayload.data[0]).not.toHaveProperty('note');
        expect(friendPayload.friend.preferences).toEqual({ backgroundUrl: 'https://example.test/background.png' });

        const currentConfig = (await (await fetch(`${baseUrl}/config`)).json()).data;
        const changedConfig = await fetch(`${baseUrl}/admin/config`, {
            method: 'PUT',
            headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ config: { ...currentConfig, app_title: 'Anote test' } })
        });
        expect(changedConfig.status).toBe(200);
        expect((await changedConfig.json()).data.app_title).toBe('Anote test');
        const staleConfig = await fetch(`${baseUrl}/admin/config`, {
            method: 'PUT',
            headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ config: { ...currentConfig, app_title: 'Stale title' } })
        });
        expect(staleConfig.status).toBe(409);
        expect(await staleConfig.json()).toMatchObject({ error: { code: 'CONFIG_CONFLICT' } });
        expect(db.prepare("SELECT value FROM app_config WHERE key = 'app_title'").get().value).toBe('Anote test');

        const rejected = await fetch(`${baseUrl}/admin/config`, {
            method: 'PUT',
            headers: { cookie, 'content-type': 'application/json', origin: 'http://attacker.invalid' },
            body: JSON.stringify({ config: { app_title: 'Compromised' } })
        });
        expect(rejected.status).toBe(403);
        expect(await rejected.json()).toMatchObject({ error: { code: 'ORIGIN_NOT_ALLOWED' } });
        const health = await fetch(`${baseUrl}/health/ready`);
        expect(await health.json()).toEqual({
            status: 'ready',
            data: { releaseId: 'release-test', version: '1.2.3', sourceCommit: 'abc123', schemaVersion: SCHEMA_VERSION }
        });

        const sessionCountBeforeLogout = db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count;
        const logout = await fetch(`${baseUrl}/logout`, {
            method: 'POST',
            headers: { cookie: viewerCookie, origin: baseUrl }
        });
        expect(logout.status).toBe(200);
        expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count).toBe(sessionCountBeforeLogout - 1);
        const loggedOutSession = await fetch(`${baseUrl}/session`, { headers: { cookie: viewerCookie } });
        expect(loggedOutSession.status).toBe(401);

        await new Promise<void>((resolve, reject) => server.close((error: Error) => error ? reject(error) : resolve()));
        runtime.close();
        closeDatabase(db);
    });
});

describe('attachment authorization', () => {
    it('keeps note files owner-only while allowing authenticated avatar reads', () => {
        const { db, directory } = createTestDatabase();
        insertUser(db, 'u1');
        insertUser(db, 'u2');
        createEventService({ db }).createMany('u1', [{ id: 'event', title: 'Event', date: '2026-01-01' }]);
        const uploadDir = path.join(directory, 'uploads');
        fs.mkdirSync(uploadDir);
        const service = createAttachmentService({ db, uploadDir });
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const note = service.create({
            ownerId: 'u1', purpose: 'note', eventId: 'event',
            file: { buffer: png, mimetype: 'image/png', originalname: 'note.png', size: png.length }
        });
        expect(() => service.read('u2', note.id)).toThrowError(ApiError);
        const avatar = service.create({
            ownerId: 'u1', purpose: 'avatar',
            file: { buffer: png, mimetype: 'image/png', originalname: 'avatar.png', size: png.length }
        });
        expect(() => createUserService({ db }).updateProfile('u2', { avatar_url: avatar.url }))
            .toThrowError(ApiError);
        createUserService({ db }).updateProfile('u1', { avatar_url: avatar.url });
        const readableAvatar = service.read('u2', avatar.id);
        expect(readableAvatar.attachment.purpose).toBe('avatar');
        fs.appendFileSync(readableAvatar.filePath, 'tampered');
        expect(() => service.read('u2', avatar.id)).toThrowError(ApiError);
        expect(() => service.create({
            ownerId: 'u1', purpose: 'avatar',
            file: { buffer: png, mimetype: 'image/png', originalname: 'avatar.jpg', size: png.length }
        })).toThrowError(ApiError);
        expect(() => service.create({
            ownerId: 'u1', purpose: 'avatar',
            file: {
                buffer: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1),
                mimetype: 'image/png',
                originalname: 'oversized.png',
                size: MAX_ATTACHMENT_BYTES + 1
            }
        })).toThrowError(ApiError);
        expect(() => service.create({
            ownerId: 'u1', purpose: 'note', eventId: 'event',
            file: {
                buffer: Buffer.from('<svg><script>alert(1)</script></svg>'),
                mimetype: 'image/svg+xml',
                originalname: 'active.svg',
                size: 36
            }
        })).toThrowError(ApiError);

        const beforeFailure = fs.readdirSync(uploadDir).sort();
        db.exec(`
            CREATE TRIGGER fail_attachment_metadata BEFORE INSERT ON attachments
            WHEN NEW.original_name = 'atomic.png'
            BEGIN SELECT RAISE(ABORT, 'injected metadata failure'); END;
        `);
        expect(() => service.create({
            ownerId: 'u1', purpose: 'avatar',
            file: { buffer: png, mimetype: 'image/png', originalname: 'atomic.png', size: png.length }
        })).toThrow('injected metadata failure');
        expect(fs.readdirSync(uploadDir).sort()).toEqual(beforeFailure);
        db.exec('DROP TRIGGER fail_attachment_metadata');

        db.prepare(`
            INSERT INTO attachments (
                id, owner_user_id, purpose, event_id, original_name,
                stored_name, mime_type, size, sha256, created_at
            ) VALUES (?, ?, 'avatar', NULL, ?, ?, 'image/png', 1, ?, ?)
        `).run('unsafe-path', 'u1', 'unsafe.png', '../outside.png', '0'.repeat(64), new Date().toISOString());
        expect(() => service.read('u1', 'unsafe-path')).toThrowError(ApiError);
        closeDatabase(db);
    });
});

describe('timezone behavior', () => {
    it('resolves a DST gap to the first valid local wall time', () => {
        const instant = wallTimeToInstant('2026-03-08', '02:30', 'America/New_York');
        const local = zonedParts(instant, 'America/New_York');
        expect([local.year, local.month, local.day]).toEqual([2026, 3, 8]);
        expect(local.hour).toBeGreaterThanOrEqual(3);
    });

    it('selects one deterministic instant for a repeated DST wall time', () => {
        const instant = wallTimeToInstant('2026-11-01', '01:30', 'America/New_York');
        expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
        expect(zonedParts(instant, 'America/New_York')).toMatchObject({
            year: 2026,
            month: 11,
            day: 1,
            hour: 1,
            minute: 30
        });
    });
});

describe('offline administrator bootstrap', () => {
    it('accepts credentials only through stdin and refuses a second bootstrap', () => {
        const directory = temporaryDirectory();
        const databasePath = path.join(directory, 'bootstrap.db');
        const uploadDir = path.join(directory, 'uploads');
        const environment = {
            ...process.env,
            ANOTE_DATABASE_PATH: databasePath,
            ANOTE_UPLOAD_DIR: uploadDir,
            ANOTE_DEFAULT_TIME_ZONE: 'UTC'
        };
        const command = path.join(testDirectory, 'bootstrap-admin.js');
        const input = JSON.stringify({ username: 'owner', password: 'a very strong password' });
        const first = childProcess.spawnSync(process.execPath, [command], { env: environment, input, encoding: 'utf8' });
        expect(first.status).toBe(0);
        expect(first.stdout).not.toContain('a very strong password');
        const second = childProcess.spawnSync(process.execPath, [command], { env: environment, input, encoding: 'utf8' });
        expect(second.status).toBe(1);
        expect(second.stderr).toContain('ADMINISTRATOR_ALREADY_EXISTS');
    });
});
