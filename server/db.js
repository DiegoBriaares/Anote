const fs = require('fs');
const path = require('path');
const BetterSqlite3 = require('better-sqlite3');

/**
 * Open Anote's single database owner.
 *
 * The native synchronous API is deliberate: statement failures must unwind
 * the owning transaction or abort startup, never disappear into callbacks.
 */
const createDatabase = (databasePath) => {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    const db = new BetterSqlite3(databasePath);
    try {
        fs.chmodSync(databasePath, 0o600);
    } catch (error) {
        if (process.platform !== 'win32') throw error;
    }
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = FULL');
    if (db.pragma('foreign_keys', { simple: true }) !== 1
        || String(db.pragma('journal_mode', { simple: true })).toLocaleLowerCase() !== 'wal'
        || db.pragma('busy_timeout', { simple: true }) !== 5000) {
        db.close();
        throw new Error('Required SQLite connection policy could not be established');
    }
    return db;
};

const closeDatabase = (db) => {
    if (!db?.open) return;
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
};

module.exports = { createDatabase, closeDatabase };
