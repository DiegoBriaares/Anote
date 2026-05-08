const express = require('express');
const fs = require('fs');
const { createDatabase } = require('./db');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { ensureEventNotesSchema } = require('./ensureEventNotesSchema');

const app = express();
const defaultPort = process.env.NODE_ENV === 'production' ? 3001 : 3002;
const port = process.env.PORT || defaultPort;
const host = process.env.HOST || '0.0.0.0';
const SECRET_KEY = process.env.SECRET_KEY || 'da_vinci_secret_key'; // In prod, use env var
const adminUiDir = path.resolve(__dirname, '../../admin-db');
const staticAdminDir = path.resolve(__dirname, 'static_admin');

const normalizeCompletedValue = (value) => (
    value === true || value === 1 || value === '1' || value === 'true'
        ? 1
        : 0
);

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Database Setup
let hasInitializedDb = false;
function initDbOnce(onReady) {
    if (hasInitializedDb) {
        onReady?.();
        return;
    }
    hasInitializedDb = true;
    initDb(onReady);
}

const dbPath = path.resolve(__dirname, 'calendar.db');
const db = createDatabase(dbPath, (err, database) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Enable WAL mode for concurrency
        database.run('PRAGMA journal_mode = WAL;', (err) => {
            if (err) console.error('Failed to enable WAL mode:', err);
            else console.log('WAL mode enabled.');
        });
        initDbOnce();
    }
});

function initDb(onReady) {
    db.serialize(() => {
        // Base tables
        db.run(`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      user_id TEXT NOT NULL,
      start_time TEXT,
      priority INTEGER,
      note TEXT,
      link TEXT,
      completed INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0,
      resources TEXT,
      unlock_date TEXT
    )`);
        db.run(`CREATE TABLE IF NOT EXISTS postponed_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      date TEXT,
      user_id TEXT NOT NULL,
      start_time TEXT,
      priority INTEGER,
      note TEXT,
      link TEXT,
      completed INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0,
      resources TEXT
    )`);

        db.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar_url TEXT,
      preferences TEXT,
      is_admin INTEGER DEFAULT 0
    )`);

        db.run(`CREATE TABLE IF NOT EXISTS user_role_events (
      event_index INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      role_rank INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
      changed_at INTEGER NOT NULL,
      source TEXT,
      note TEXT
    )`);
        db.run('CREATE INDEX IF NOT EXISTS idx_user_role_events_user_event ON user_role_events(user_id, event_index)');

        // Seed default admin user (admin/admin123)
        // Password hash for 'admin123' generated with bcrypt (10 rounds)
        const adminPasswordHash = '$2b$10$sRiFIjv/oPy1CvL0HHU3.umRmD7fL0TQTgufBNobLph0zMskaCKYi';
        db.run(`INSERT OR IGNORE INTO users (id, username, password, is_admin) VALUES (?, ?, ?, 1)`,
            ['admin-default-001', 'admin', adminPasswordHash]);

        // Roles Table (formerly event_options)
        db.run('DROP TABLE IF EXISTS event_options');
        db.run(`CREATE TABLE IF NOT EXISTS roles (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            label TEXT NOT NULL,
            color TEXT,
            is_enabled INTEGER DEFAULT 1,
            order_index INTEGER DEFAULT 0
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS subroles (
            id TEXT PRIMARY KEY,
            role_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            label TEXT NOT NULL,
            color TEXT,
            is_enabled INTEGER DEFAULT 1,
            order_index INTEGER DEFAULT 0
        )`);

        ensureEventNotesSchema(db);

        // No default seed for user-specific options (users create their own)
    });

    db.serialize(() => {
        // Migration: Drop old single-global tables if they exist (detectable by schema but easier to just drop for this task)
        // I will just drop them for now to ensure clean state for "User Specific" features.
        // db.run('DROP TABLE IF EXISTS daily_facts');
        // db.run('DROP TABLE IF EXISTS day_backgrounds');

        // Actually, to avoid losing data on every restart, I need to NOT drop them unconditionally.
        // I'll leave the creation generic, but I will manually execute the DROP logic via a separate tool call ONCE 
        // OR I will simply create `user_daily_facts` and `user_day_backgrounds` to avoid conflict?
        // No, user wants standard names.

        // I'll implement a "migration" check.
    });

    db.run(`CREATE TABLE IF NOT EXISTS daily_facts_v2 (
      date TEXT,
      user_id TEXT,
      content TEXT,
      PRIMARY KEY (date, user_id)
   )`);

    db.run(`CREATE TABLE IF NOT EXISTS day_backgrounds_v2 (
      date TEXT,
      user_id TEXT,
      image_url TEXT,
      PRIMARY KEY (date, user_id)
   )`);

    db.run(`CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);

    migrateEventsSchemaIfNeeded(onReady);
}

function migrateEventsSchemaIfNeeded(onReady) {
    db.all('PRAGMA table_info(events)', (err, rows) => {
        if (err) {
            console.error('Error inspecting events schema:', err.message);
            onReady?.();
            return;
        }
        const hasUserId = rows.some((row) => row.name === 'user_id');
        const hasStartTime = rows.some((row) => row.name === 'start_time');
        const hasPriority = rows.some((row) => row.name === 'priority');
        const hasNote = rows.some((row) => row.name === 'note');
        const hasLink = rows.some((row) => row.name === 'link');
        const hasCompleted = rows.some((row) => row.name === 'completed');
        const hasUpdatedAt = rows.some((row) => row.name === 'updated_at');
        const hasResources = rows.some((row) => row.name === 'resources');
        const hasUnlockDate = rows.some((row) => row.name === 'unlock_date');

        const ensureIndex = () => {
            // ... existing index code ...
            db.run('CREATE INDEX IF NOT EXISTS idx_events_user_date ON events(user_id, date)', (idxErr) => {
                if (idxErr) {
                    console.error('Error ensuring events index:', idxErr.message);
                }
                migratePostponedEventsSchemaIfNeeded(() => ensureFriendshipsTable(onReady));
            });
        };

        // If core schema present, but missing optional cols, add them
        if (hasUserId) {
            db.serialize(() => {
                const addCol = (col, type) => {
                    db.run(`ALTER TABLE events ADD COLUMN ${col} ${type}`, (e) => {
                        if (e) console.error(`Error adding ${col}:`, e.message);
                    });
                };

                if (!hasStartTime) addCol('start_time', 'TEXT');
                if (!hasPriority) addCol('priority', 'INTEGER');
                if (!hasNote) addCol('note', 'TEXT');
                if (!hasLink) addCol('link', 'TEXT');
                if (!hasCompleted) addCol('completed', 'INTEGER DEFAULT 0');
                if (!hasUpdatedAt) {
                    db.run('ALTER TABLE events ADD COLUMN updated_at INTEGER DEFAULT 0', (e) => {
                        if (e) console.error('Error adding updated_at:', e.message);
                    });
                }
                if (!hasResources) {
                    db.run('ALTER TABLE events ADD COLUMN resources TEXT', (e) => {
                        if (e) console.error('Error adding resources:', e.message);
                        else console.log('Migration complete: events table now has resources column');
                    });
                }
                if (!hasUnlockDate) {
                    db.run('ALTER TABLE events ADD COLUMN unlock_date TEXT', (e) => {
                        if (e) console.error('Error adding unlock_date:', e.message);
                        else console.log('Migration complete: events table now has unlock_date column');
                    });
                }
                ensureIndex();
            });
            return;
        }

        console.warn('events table missing user_id; migrating existing data');
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            // Re-create table with new schema including updated_at and resources
            db.run(`CREATE TABLE IF NOT EXISTS events_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'legacy',
        start_time TEXT,
        priority INTEGER,
        note TEXT,
        link TEXT,
        completed INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        resources TEXT,
        unlock_date TEXT
      )`);
            db.run(`INSERT INTO events_new (id, title, date, start_time, priority, note, link, completed, updated_at, resources, unlock_date)
                    SELECT id, title, date, start_time, NULL, note, link, 0, updated_at, NULL, NULL FROM events`);
            db.run('DROP TABLE events');
            db.run('ALTER TABLE events_new RENAME TO events');
            db.run('COMMIT', (commitErr) => {
                if (commitErr) {
                    console.error('Migration commit failed:', commitErr.message);
                } else {
                    console.log('Migration complete: events table reorganized');
                }
                ensureIndex();
            });
        });
    });
}

function migratePostponedEventsSchemaIfNeeded(onReady) {
    db.all('PRAGMA table_info(postponed_events)', (err, rows) => {
        if (err) {
            console.error('Error inspecting postponed_events schema:', err.message);
            onReady?.();
            return;
        }
        if (!rows || rows.length === 0) {
        db.run(`CREATE TABLE IF NOT EXISTS postponed_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        date TEXT,
        user_id TEXT NOT NULL,
        start_time TEXT,
        priority INTEGER,
        note TEXT,
        link TEXT,
        completed INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        resources TEXT
      )`, (createErr) => {
                if (createErr) {
                    console.error('Error creating postponed_events table:', createErr.message);
                    onReady?.();
                    return;
                }
                db.run('CREATE INDEX IF NOT EXISTS idx_postponed_events_user ON postponed_events(user_id)', () => {
                    onReady?.();
                });
            });
            return;
        }

        const hasStartTime = rows.some((row) => row.name === 'start_time');
        const hasPriority = rows.some((row) => row.name === 'priority');
        const hasNote = rows.some((row) => row.name === 'note');
        const hasLink = rows.some((row) => row.name === 'link');
        const hasCompleted = rows.some((row) => row.name === 'completed');
        const hasUpdatedAt = rows.some((row) => row.name === 'updated_at');
        const hasResources = rows.some((row) => row.name === 'resources');

        const hasDateNotNull = rows.some((row) => row.name === 'date' && row.notnull === 1);

        db.serialize(() => {
            if (hasDateNotNull) {
                db.run(`CREATE TABLE IF NOT EXISTS postponed_events_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        date TEXT,
        user_id TEXT NOT NULL,
        start_time TEXT,
        priority INTEGER,
        note TEXT,
        link TEXT,
        completed INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        resources TEXT
      )`);
                db.run(`INSERT INTO postponed_events_new (id, title, date, user_id, start_time, priority, note, link, completed, updated_at, resources)
                        SELECT id, title, date, user_id, start_time, priority, note, link, 0, updated_at, resources FROM postponed_events`);
                db.run('DROP TABLE postponed_events');
                db.run('ALTER TABLE postponed_events_new RENAME TO postponed_events');
            }
            const addCol = (col, type) => {
                db.run(`ALTER TABLE postponed_events ADD COLUMN ${col} ${type}`, (e) => {
                    if (e) console.error(`Error adding postponed_events.${col}:`, e.message);
                });
            };
            if (!hasStartTime) addCol('start_time', 'TEXT');
            if (!hasPriority) addCol('priority', 'INTEGER');
            if (!hasNote) addCol('note', 'TEXT');
            if (!hasLink) addCol('link', 'TEXT');
            if (!hasCompleted) addCol('completed', 'INTEGER DEFAULT 0');
            if (!hasUpdatedAt) {
                db.run('ALTER TABLE postponed_events ADD COLUMN updated_at INTEGER DEFAULT 0', (e) => {
                    if (e) console.error('Error adding postponed_events.updated_at:', e.message);
                });
            }
            if (!hasResources) {
                db.run('ALTER TABLE postponed_events ADD COLUMN resources TEXT', (e) => {
                    if (e) console.error('Error adding postponed_events.resources:', e.message);
                });
            }
            db.run('CREATE INDEX IF NOT EXISTS idx_postponed_events_user ON postponed_events(user_id)', () => {
                onReady?.();
            });
        });
    });
}

function ensureFriendshipsTable(onReady) {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS friendships (
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      UNIQUE(user_a, user_b)
    )`, (err) => {
            if (err) {
                console.error('Error creating friendships table:', err.message);
            }
            ensureUserPrefs(onReady);
        });
    });
}

function ensureUserPrefs(onReady) {
    db.all('PRAGMA table_info(users)', (err, rows) => {
        if (err) {
            console.error('Error inspecting users schema:', err.message);
            onReady?.();
            return;
        }
        const hasPreferences = rows.some((r) => r.name === 'preferences');
        if (hasPreferences) {
            ensureAdminColumn(() => ensureDefaultConfig(onReady));
            return;
        }
        console.warn('users table missing preferences; migrating');
        db.serialize(() => {
            db.run('ALTER TABLE users ADD COLUMN preferences TEXT', (alterErr) => {
                if (alterErr) {
                    console.error('Error adding preferences column:', alterErr.message);
                } else {
                    console.log('Migration complete: users table now has preferences column');
                }
                ensureAdminColumn(() => ensureDefaultConfig(onReady));
            });
        });
    });
}

function ensureAdminColumn(onReady) {
    db.all('PRAGMA table_info(users)', (err, rows) => {
        if (err) {
            console.error('Error inspecting users schema:', err.message);
            onReady?.();
            return;
        }
        const hasIsAdmin = rows.some((r) => r.name === 'is_admin');
        if (hasIsAdmin) {
            onReady?.();
            return;
        }
        console.warn('users table missing is_admin; migrating');
        db.serialize(() => {
            db.run('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0', (alterErr) => {
                if (alterErr) {
                    console.error('Error adding is_admin column:', alterErr.message);
                } else {
                    console.log('Migration complete: users table now has is_admin column');
                }
                onReady?.();
            });
        });
    });
}

function ensureDefaultConfig(onReady) {
    const defaults = {
        'app_title': 'Anote',
        'app_subtitle': 'Mark progress, move plans, and keep your calendar notes in one place.',
        'console_title': 'Anote Console',
        'config_version': '1'
    };
    const legacyDefaults = {
        app_title: ['AUREUM CALENDAR', 'Plan Administration Management System', 'Administration Management Plan System', 'AMPS'],
        app_subtitle: ['Curate your own canvas, borrow a friend\'s atmosphere, and keep every session synchronized.'],
        console_title: ['Chronos Console']
    };

    db.serialize(() => {
        const stmt = db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)');
        Object.entries(defaults).forEach(([key, value]) => {
            stmt.run(key, value);
        });
        stmt.finalize((err) => {
            if (err) console.error('Error seeding config:', err);
            const migrations = Object.entries(legacyDefaults);
            if (migrations.length === 0) {
                onReady?.();
                return;
            }
            let remaining = migrations.length;
            migrations.forEach(([key, oldValues]) => {
                const placeholders = oldValues.map(() => '?').join(', ');
                db.run(
                    `UPDATE app_config SET value = ? WHERE key = ? AND value IN (${placeholders})`,
                    [defaults[key], key, ...oldValues],
                    (updateErr) => {
                        if (updateErr) console.error(`Error migrating default config ${key}:`, updateErr.message);
                        remaining -= 1;
                        if (remaining === 0) onReady?.();
                    }
                );
            });
        });
    });
}

// Auth Routes
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Invalid payload' });
    const trimmedUser = username.trim();
    if (!trimmedUser || password.length < 4) return res.status(400).json({ error: 'Username required; password must be at least 4 chars' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const id = crypto.randomUUID();

        const stmt = db.prepare('INSERT INTO users (id, username, password) VALUES (?, ?, ?)');
        stmt.run(id, trimmedUser, hashedPassword, function (err) { // Use function() for 'this' context
            if (err) {
                // Check for unique constraint error
                if (err.message.includes('UNIQUE constraint failed: users.username')) {
                    return res.status(400).json({ error: 'Username already exists' });
                }
                console.error('Error inserting user:', err.message);
                return res.status(500).json({ error: 'Server error during registration' });
            }
            const token = jwt.sign({ id, username: trimmedUser, isAdmin: false }, SECRET_KEY);
            res.status(201).json({ message: 'success', token, user: { id, username: trimmedUser, isAdmin: false } });
        });
        stmt.finalize();
    } catch (e) {
        console.error('Error during registration:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            console.error('Error fetching user for login:', err.message);
            return res.status(500).json({ error: 'Server error' });
        }
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            const isAdmin = !!user.is_admin;
            const token = jwt.sign({ id: user.id, username: user.username, isAdmin }, SECRET_KEY);
            res.json({ message: 'success', token, user: { id: user.id, username: user.username, isAdmin } });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    });
});

// Middleware to authenticate token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401); // Unauthorized

    jwt.verify(token, SECRET_KEY, (err, tokenUser) => {
        if (err) return res.sendStatus(403); // Forbidden

        db.get(
            'SELECT id, username, is_admin FROM users WHERE id = ?',
            [tokenUser.id],
            (dbErr, freshUser) => {
                if (dbErr) {
                    console.error('Error refreshing authenticated user:', dbErr.message);
                    return res.status(500).json({ error: 'Failed to refresh user session' });
                }

                if (!freshUser) {
                    return res.sendStatus(401);
                }

                req.user = {
                    id: freshUser.id,
                    username: freshUser.username,
                    isAdmin: !!freshUser.is_admin
                };
                next();
            }
        );
    });
};

const requireAdmin = (req, res, next) => {
    if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Routes

// Protect all event routes
app.use('/events', authenticateToken);

app.get('/events', (req, res) => {
    const sql = 'SELECT id, title, date, start_time as startTime, priority, note, link, completed, updated_at as version, resources, unlock_date as unlockDate FROM events WHERE user_id = ? ORDER BY date';
    db.all(sql, [req.user.id], (err, rows) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({
            message: 'success',
            data: rows
        });
    });
});

// POST /events - Add new events (bulk) for current user
app.post('/events', (req, res) => {
    const events = req.body.events; // Expecting array of { id?, title, date }

    if (!events || !Array.isArray(events)) {
        res.status(400).json({ error: 'Invalid input: events array required' });
        return;
    }

    const stmt = db.prepare('INSERT INTO events (id, title, date, user_id, start_time, priority, note, link, completed, updated_at, resources, unlock_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        let insertError = null;
        let insertedCount = 0;

        events.forEach(event => {
            if (insertError) return;
            if (!event.title || !event.date) {
                insertError = new Error('Invalid event payload: title and date are required');
                return;
            }
            const eventId = event.id || crypto.randomUUID();
            const cleanTime = event.startTime && typeof event.startTime === 'string' && event.startTime.trim() !== '' ? event.startTime.trim() : null;
            const cleanPriority = (event.priority === null || event.priority === undefined || (typeof event.priority === 'string' && event.priority.trim() === ''))
                ? null
                : (Number.isFinite(Number(event.priority)) ? Math.trunc(Number(event.priority)) : null);
            const cleanNote = event.note && typeof event.note === 'string' && event.note.trim() !== '' ? event.note.trim() : null;
            const cleanLink = event.link && typeof event.link === 'string' && event.link.trim() !== '' ? event.link.trim() : null;
            const cleanCompleted = normalizeCompletedValue(event.completed);
            const cleanUnlock = event.unlockDate ? event.unlockDate : null;
            // Ensure resources is valid JSON string or null
            let cleanResources = null;
            try {
                if (event.resources) {
                    cleanResources = typeof event.resources === 'string' ? event.resources : JSON.stringify(event.resources);
                }
            } catch (e) { }

            const now = Date.now();
            stmt.run(eventId, event.title, event.date, req.user.id, cleanTime, cleanPriority, cleanNote, cleanLink, cleanCompleted, now, cleanResources, cleanUnlock, (err) => {
                if (err) {
                    console.error('Error inserting event:', err.message);
                    insertError = err;
                    return;
                }
                insertedCount += 1;
            });
        });

        if (insertError) {
            db.run('ROLLBACK', (rollbackErr) => {
                if (rollbackErr) {
                    console.error('Error rolling back event insert:', rollbackErr.message);
                }
                res.status(500).json({ error: insertError.message || 'Failed to insert event' });
            });
            stmt.finalize();
            return;
        }

        db.run('COMMIT', (err) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'success', count: insertedCount });
        });
        stmt.finalize();
    });
});

// DELETE /events - Clear current user's events (for testing/reset)
app.delete('/events', (req, res) => {
    db.run('DELETE FROM events WHERE user_id = ?', [req.user.id], (err) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({ message: 'deleted all events for user' });
    });
});

// Update single event
app.put('/events/:id', (req, res) => {
    const { id } = req.params;
    const { title, date, startTime, priority, note, link, completed, version, resources, unlockDate } = req.body;
    if (!title || !date) return res.status(400).json({ error: 'Missing title or date' });

    const cleanTime = startTime && typeof startTime === 'string' && startTime.trim() !== '' ? startTime.trim() : null;
    const cleanPriority = (priority === null || priority === undefined || (typeof priority === 'string' && priority.trim() === ''))
        ? null
        : (Number.isFinite(Number(priority)) ? Math.trunc(Number(priority)) : null);
    const cleanNote = note && typeof note === 'string' && note.trim() !== '' ? note.trim() : null;
    const cleanLink = link && typeof link === 'string' && link.trim() !== '' ? link.trim() : null;
    const cleanCompleted = normalizeCompletedValue(completed);
    const cleanUnlock = unlockDate ? unlockDate : null;
    let cleanResources = null;
    try {
        if (resources) {
            cleanResources = typeof resources === 'string' ? resources : JSON.stringify(resources);
        }
    } catch (e) { }

    const newVersion = Date.now();

    // If client provided a version, we check it
    if (version) {
        db.get('SELECT updated_at FROM events WHERE id = ?', [id], (err, row) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (!row) return res.status(404).json({ error: 'Event not found' });

            // Optimistic Lock Check
            // If DB version > client version, it means someone else updated it logic
            if (row.updated_at && row.updated_at > version) {
                return res.status(409).json({ error: 'Conflict: Event has been modified by another user.', serverVersion: row.updated_at });
            }

            performUpdate();
        });
    } else {
        // No version provided? Just overwrite (legacy behavior or force update)
        // Or strictly require it? For now, we allow it but update the version.
        performUpdate();
    }

    function performUpdate() {
        db.run(
            `UPDATE events SET title = ?, date = ?, start_time = ?, priority = ?, note = ?, link = ?, completed = ?, updated_at = ?, resources = ?, unlock_date = ? WHERE id = ? AND user_id = ?`,
            [title, date, cleanTime, cleanPriority, cleanNote, cleanLink, cleanCompleted, newVersion, cleanResources, cleanUnlock, id, req.user.id],
            function (err) {
                if (err) {
                    console.error('Error updating event:', err.message);
                    return res.status(500).json({ error: 'Failed to update event' });
                }
                if (this.changes === 0) return res.status(404).json({ error: 'Event not found or permission denied' });
                res.json({ message: 'success', version: newVersion });
            }
        );
    }
});

app.patch('/events/:id/completed', (req, res) => {
    const { id } = req.params;
    const cleanCompleted = normalizeCompletedValue(req.body?.completed);
    const newVersion = Date.now();

    db.run(
        'UPDATE events SET completed = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [cleanCompleted, newVersion, id, req.user.id],
        function (err) {
            if (err) {
                console.error('Error updating event completion:', err.message);
                return res.status(500).json({ error: 'Failed to update event completion' });
            }
            if (this.changes === 0) return res.status(404).json({ error: 'Event not found or permission denied' });
            res.json({
                message: 'success',
                data: {
                    id,
                    completed: cleanCompleted,
                    version: newVersion
                }
            });
        }
    );
});

// Delete single event
app.delete('/events/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM events WHERE id = ? AND user_id = ?', [id, req.user.id], function (err) {
        if (err) {
            console.error('Error deleting event:', err.message);
            return res.status(500).json({ error: 'Failed to delete event' });
        }
        if (this.changes === 0) return res.status(404).json({ error: 'Event not found' });
        res.json({ message: 'success' });
    });
});

// Protect postponed events routes
app.use('/postponed-events', authenticateToken);

app.get('/postponed-events', (req, res) => {
    const sql = 'SELECT id, title, date, start_time as startTime, priority, note, link, completed, updated_at as version, resources FROM postponed_events WHERE user_id = ? ORDER BY updated_at DESC';
    db.all(sql, [req.user.id], (err, rows) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({
            message: 'success',
            data: rows
        });
    });
});

app.post('/postponed-events', (req, res) => {
    const events = req.body.events;
    if (!events || !Array.isArray(events)) {
        res.status(400).json({ error: 'Invalid input: events array required' });
        return;
    }

    const stmt = db.prepare('INSERT INTO postponed_events (id, title, date, user_id, start_time, priority, note, link, completed, updated_at, resources) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        events.forEach(event => {
            if (!event.title) {
                console.error('Invalid postponed event payload skipped');
                return;
            }
            const eventId = event.id || crypto.randomUUID();
            const cleanTime = event.startTime && typeof event.startTime === 'string' && event.startTime.trim() !== '' ? event.startTime.trim() : null;
            const cleanDate = typeof event.date === 'string' ? event.date.trim() : '';
            const cleanPriority = (event.priority === null || event.priority === undefined || (typeof event.priority === 'string' && event.priority.trim() === ''))
                ? null
                : (Number.isFinite(Number(event.priority)) ? Math.trunc(Number(event.priority)) : null);
            const cleanNote = event.note && typeof event.note === 'string' && event.note.trim() !== '' ? event.note.trim() : null;
            const cleanLink = event.link && typeof event.link === 'string' && event.link.trim() !== '' ? event.link.trim() : null;
            const cleanCompleted = normalizeCompletedValue(event.completed);
            let cleanResources = null;
            try {
                if (event.resources) {
                    cleanResources = typeof event.resources === 'string' ? event.resources : JSON.stringify(event.resources);
                }
            } catch (e) { }
            const now = Date.now();
            stmt.run(eventId, event.title, cleanDate, req.user.id, cleanTime, cleanPriority, cleanNote, cleanLink, cleanCompleted, now, cleanResources, (err) => {
                if (err) {
                    console.error('Error inserting postponed event:', err.message);
                }
            });
        });

        db.run('COMMIT', (err) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'success', count: events.length });
        });
    });

    stmt.finalize();
});

app.delete('/postponed-events', (req, res) => {
    db.run('DELETE FROM postponed_events WHERE user_id = ?', [req.user.id], (err) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({ message: 'deleted all postponed events for user' });
    });
});

app.put('/postponed-events/:id', (req, res) => {
    const { id } = req.params;
    const { title, date, startTime, priority, note, link, completed, version, resources } = req.body;
    if (!title) return res.status(400).json({ error: 'Missing title' });

    const cleanTime = startTime && typeof startTime === 'string' && startTime.trim() !== '' ? startTime.trim() : null;
    const cleanDate = typeof date === 'string' ? date.trim() : '';
    const cleanPriority = (priority === null || priority === undefined || (typeof priority === 'string' && priority.trim() === ''))
        ? null
        : (Number.isFinite(Number(priority)) ? Math.trunc(Number(priority)) : null);
    const cleanNote = note && typeof note === 'string' && note.trim() !== '' ? note.trim() : null;
    const cleanLink = link && typeof link === 'string' && link.trim() !== '' ? link.trim() : null;
    const cleanCompleted = normalizeCompletedValue(completed);
    let cleanResources = null;
    try {
        if (resources) {
            cleanResources = typeof resources === 'string' ? resources : JSON.stringify(resources);
        }
    } catch (e) { }

    const newVersion = Date.now();

    if (version) {
        db.get('SELECT updated_at FROM postponed_events WHERE id = ?', [id], (err, row) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (!row) return res.status(404).json({ error: 'Event not found' });
            if (row.updated_at && row.updated_at > version) {
                return res.status(409).json({ error: 'Conflict: Event has been modified by another user.', serverVersion: row.updated_at });
            }
            performUpdate();
        });
    } else {
        performUpdate();
    }

    function performUpdate() {
        db.run(
            `UPDATE postponed_events SET title = ?, date = ?, start_time = ?, priority = ?, note = ?, link = ?, completed = ?, updated_at = ?, resources = ? WHERE id = ? AND user_id = ?`,
            [title, cleanDate, cleanTime, cleanPriority, cleanNote, cleanLink, cleanCompleted, newVersion, cleanResources, id, req.user.id],
            function (err) {
                if (err) {
                    console.error('Error updating postponed event:', err.message);
                    return res.status(500).json({ error: 'Failed to update event' });
                }
                if (this.changes === 0) return res.status(404).json({ error: 'Event not found or permission denied' });
                res.json({ message: 'success', version: newVersion });
            }
        );
    }
});

app.delete('/postponed-events/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM postponed_events WHERE id = ? AND user_id = ?', [id, req.user.id], function (err) {
        if (err) {
            console.error('Error deleting postponed event:', err.message);
            return res.status(500).json({ error: 'Failed to delete event' });
        }
        if (this.changes === 0) return res.status(404).json({ error: 'Event not found' });
        res.json({ message: 'success' });
    });
});

// Helper to check friendship
function isFriend(currentUserId, friendId, cb) {
    const [a, b] = friendId < currentUserId ? [friendId, currentUserId] : [currentUserId, friendId];
    db.get('SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?', [a, b], (err, row) => {
        if (err) return cb(err);
        cb(null, !!row);
    });
}

// Profile routes
app.get('/me', authenticateToken, (req, res) => {
    db.get('SELECT id, username, avatar_url, preferences FROM users WHERE id = ?', [req.user.id], (err, row) => {
        if (err) return res.status(500).json({ error: 'Failed to load profile' });
        if (!row) return res.status(404).json({ error: 'User not found' });
        let preferences = {};
        try {
            preferences = row.preferences ? JSON.parse(row.preferences) : {};
        } catch (e) {
            preferences = {};
        }
        res.json({
            message: 'success',
            data: { id: row.id, username: row.username, avatar_url: row.avatar_url, preferences, isAdmin: !!req.user.isAdmin }
        });
    });
});

app.put('/me', authenticateToken, (req, res) => {
    const { avatar_url, preferences, username } = req.body;
    let prefString = null;
    try {
        prefString = JSON.stringify(preferences || {});
    } catch (e) {
        return res.status(400).json({ error: 'Invalid preferences' });
    }

    // If username is provided, validate it
    let newUsername = req.user.username;
    if (username !== undefined) {
        if (typeof username !== 'string') return res.status(400).json({ error: 'Invalid username' });
        const trimmed = username.trim();
        if (!trimmed) return res.status(400).json({ error: 'Username cannot be empty' });
        newUsername = trimmed;
    }

    // Check if username is different and available
    const updateProfile = () => {
        db.run('UPDATE users SET avatar_url = ?, preferences = ?, username = ? WHERE id = ?',
            [avatar_url || null, prefString, newUsername, req.user.id],
            function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed: users.username')) {
                        return res.status(400).json({ error: 'Username already taken' });
                    }
                    console.error('Error updating profile:', err.message);
                    return res.status(500).json({ error: 'Failed to update profile' });
                }
                res.json({ message: 'success' });
            }
        );
    };

    if (newUsername !== req.user.username) {
        // Check uniqueness explicitly if needed, but UNIQUE constraint handles it.
        // We rely on the UNIQUE constraint in the DB.
        updateProfile();
    } else {
        updateProfile();
    }
});

// Users directory (public list, requires auth)
app.get('/users', authenticateToken, (req, res) => {
    db.all('SELECT id, username, avatar_url FROM users WHERE id != ?', [req.user.id], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to load users' });
        }
        res.json({ message: 'success', data: rows });
    });
});

// Friendships (per-user)
app.get('/friends', authenticateToken, (req, res) => {
    const sql = `
    SELECT 
      CASE WHEN user_a = ? THEN user_b ELSE user_a END as id,
      u.username,
      u.avatar_url
    FROM friendships
    JOIN users u ON u.id = CASE WHEN user_a = ? THEN user_b ELSE user_a END
    WHERE user_a = ? OR user_b = ?`;
    db.all(sql, [req.user.id, req.user.id, req.user.id, req.user.id], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to load friends' });
        }
        res.json({ message: 'success', data: rows });
    });
});

app.post('/friends/share-events', authenticateToken, (req, res) => {
    const friendIds = Array.from(new Set((Array.isArray(req.body?.friendIds) ? req.body.friendIds : [])
        .filter((id) => typeof id === 'string' && id.trim() !== '')
        .map((id) => id.trim())));
    const dateKeys = Array.from(new Set((Array.isArray(req.body?.dateKeys) ? req.body.dateKeys : [])
        .filter((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim()))
        .map((date) => date.trim())))
        .sort();
    const hasEventSelection = Array.isArray(req.body?.eventIds);
    const eventIds = Array.from(new Set((hasEventSelection ? req.body.eventIds : [])
        .filter((id) => typeof id === 'string' && id.trim() !== '')
        .map((id) => id.trim())));

    if (friendIds.length === 0) return res.status(400).json({ error: 'Select at least one friend' });
    if (dateKeys.length === 0) return res.status(400).json({ error: 'Select at least one day' });
    if (hasEventSelection && eventIds.length === 0) return res.status(400).json({ error: 'Select at least one event' });
    if (friendIds.includes(req.user.id)) return res.status(400).json({ error: 'Cannot share events to yourself' });

    const friendPlaceholders = friendIds.map(() => '?').join(', ');
    const friendSql = `
        SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END as id
        FROM friendships
        WHERE (user_a = ? OR user_b = ?)
          AND (CASE WHEN user_a = ? THEN user_b ELSE user_a END) IN (${friendPlaceholders})`;

    db.all(friendSql, [req.user.id, req.user.id, req.user.id, req.user.id, ...friendIds], (friendErr, rows) => {
        if (friendErr) return res.status(500).json({ error: 'Friendship check failed' });

        const allowedFriendIds = rows.map((row) => row.id);
        if (allowedFriendIds.length !== friendIds.length) {
            return res.status(403).json({ error: 'Events can only be shared with friends' });
        }

        const datePlaceholders = dateKeys.map(() => '?').join(', ');
        const eventIdPlaceholders = eventIds.map(() => '?').join(', ');
        const eventIdClause = hasEventSelection ? ` AND id IN (${eventIdPlaceholders})` : '';
        const eventSql = `
            SELECT title, date, start_time as startTime, priority, note, link, completed, resources, unlock_date as unlockDate
            FROM events
            WHERE user_id = ? AND date IN (${datePlaceholders})${eventIdClause}
            ORDER BY date, start_time, title`;

        db.all(eventSql, [req.user.id, ...dateKeys, ...eventIds], (eventErr, sourceEvents) => {
            if (eventErr) return res.status(500).json({ error: 'Failed to load events to share' });

            const insertCount = sourceEvents.length * allowedFriendIds.length;
            if (insertCount === 0) {
                return res.json({ message: 'success', count: 0, days: dateKeys.length, friends: allowedFriendIds.length });
            }

            const stmt = db.prepare(`
                INSERT INTO events (id, title, date, user_id, start_time, priority, note, link, completed, updated_at, resources, unlock_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            const now = Date.now();
            let pending = insertCount;
            let inserted = 0;
            let insertError = null;

            const finish = () => {
                pending -= 1;
                if (pending > 0) return;

                stmt.finalize();
                if (insertError) {
                    db.run('ROLLBACK', (rollbackErr) => {
                        if (rollbackErr) console.error('Error rolling back shared events:', rollbackErr.message);
                        res.status(500).json({ error: 'Failed to share events' });
                    });
                    return;
                }

                db.run('COMMIT', (commitErr) => {
                    if (commitErr) return res.status(500).json({ error: commitErr.message });
                    res.json({
                        message: 'success',
                        count: inserted,
                        days: dateKeys.length,
                        friends: allowedFriendIds.length
                    });
                });
            };

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                allowedFriendIds.forEach((friendId) => {
                    sourceEvents.forEach((event) => {
                        stmt.run(
                            crypto.randomUUID(),
                            event.title,
                            event.date,
                            friendId,
                            event.startTime || null,
                            event.priority === null || event.priority === undefined
                                ? null
                                : (Number.isFinite(Number(event.priority)) ? Math.trunc(Number(event.priority)) : null),
                            event.note || null,
                            event.link || null,
                            normalizeCompletedValue(event.completed),
                            now,
                            event.resources || null,
                            event.unlockDate || null,
                            (insertErr) => {
                                if (insertErr) {
                                    console.error('Error sharing event:', insertErr.message);
                                    insertError = insertErr;
                                } else {
                                    inserted += 1;
                                }
                                finish();
                            }
                        );
                    });
                });
            });
        });
    });
});

app.post('/friends/:friendId', authenticateToken, (req, res) => {
    const friendId = req.params.friendId;
    if (!friendId) return res.status(400).json({ error: 'Missing friend id' });
    if (friendId === req.user.id) return res.status(400).json({ error: 'Cannot add yourself' });

    db.get('SELECT id FROM users WHERE id = ?', [friendId], (err, userRow) => {
        if (err) return res.status(500).json({ error: 'Lookup failed' });
        if (!userRow) return res.status(404).json({ error: 'User not found' });

        const [a, b] = friendId < req.user.id ? [friendId, req.user.id] : [req.user.id, friendId];
        db.run('INSERT OR IGNORE INTO friendships (user_a, user_b) VALUES (?, ?)', [a, b], (insertErr) => {
            if (insertErr) {
                console.error('Error creating friendship:', insertErr.message);
                return res.status(500).json({ error: 'Could not add friend' });
            }
            res.status(201).json({ message: 'success' });
        });
    });
});

app.delete('/friends/:friendId', authenticateToken, (req, res) => {
    const friendId = req.params.friendId;
    if (!friendId) return res.status(400).json({ error: 'Missing friend id' });

    const [a, b] = friendId < req.user.id ? [friendId, req.user.id] : [req.user.id, friendId];
    db.run('DELETE FROM friendships WHERE user_a = ? AND user_b = ?', [a, b], function (err) {
        if (err) {
            console.error('Error removing friendship:', err.message);
            return res.status(500).json({ error: 'Could not remove friend' });
        }
        res.json({ message: 'success', removed: this.changes });
    });
});

// Daily Facts Routes
// Daily Facts - Bulk Fetch
app.get('/daily-facts', authenticateToken, (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Missing start/end date' });

    // v2: Filter by user_id
    db.all('SELECT date, content FROM daily_facts_v2 WHERE user_id = ? AND date BETWEEN ? AND ?',
        [req.user.id, start, end],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const facts = {};
            rows.forEach(row => facts[row.date] = row.content);
            res.json({ message: 'success', data: facts });
        });
});

app.get('/daily-facts/:date', authenticateToken, (req, res) => {
    const { date } = req.params;
    db.get('SELECT content FROM daily_facts_v2 WHERE user_id = ? AND date = ?',
        [req.user.id, date],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'success', data: row ? row.content : null });
        });
});

app.post('/daily-facts', authenticateToken, (req, res) => {
    const { date, content } = req.body;
    db.run('INSERT OR REPLACE INTO daily_facts_v2 (date, user_id, content) VALUES (?, ?, ?)',
        [date, req.user.id, content],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'success' });
        }
    );
});

// Day Backgrounds
app.get('/day-backgrounds', authenticateToken, (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Missing start/end date' });

    db.all('SELECT date, image_url FROM day_backgrounds_v2 WHERE user_id = ? AND date BETWEEN ? AND ?',
        [req.user.id, start, end],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const backgrounds = {};
            rows.forEach(row => backgrounds[row.date] = row.image_url);
            res.json({ message: 'success', data: backgrounds });
        });
});

app.post('/day-backgrounds', authenticateToken, (req, res) => {
    const { date, imageUrl } = req.body;
    db.run('INSERT OR REPLACE INTO day_backgrounds_v2 (date, user_id, image_url) VALUES (?, ?, ?)',
        [date, req.user.id, imageUrl],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'success' });
        }
    );
});

// View a friend's calendar (read-only)
app.get('/friends/:friendId/events', authenticateToken, (req, res) => {
    const friendId = req.params.friendId;
    if (!friendId) return res.status(400).json({ error: 'Missing friend id' });
    if (friendId === req.user.id) return res.status(400).json({ error: 'Use /events for your own calendar' });

    db.get('SELECT id, username, preferences FROM users WHERE id = ?', [friendId], (userErr, friend) => {
        if (userErr) return res.status(500).json({ error: 'Lookup failed' });
        if (!friend) return res.status(404).json({ error: 'User not found' });

        isFriend(req.user.id, friendId, (err, ok) => {
            if (err) return res.status(500).json({ error: 'Friendship check failed' });
            if (!ok) return res.status(403).json({ error: 'Not friends' });

            db.all('SELECT id, title, date, start_time as startTime, priority, note, link, completed FROM events WHERE user_id = ? ORDER BY date', [friendId], (evErr, rows) => {
                if (evErr) return res.status(500).json({ error: 'Failed to load friend events' });
                let preferences = {};
                try {
                    preferences = friend.preferences ? JSON.parse(friend.preferences) : {};
                } catch (e) {
                    preferences = {};
                }
                res.json({ message: 'success', data: rows, friend: { id: friend.id, username: friend.username, preferences } });
            });
        });
    });
});
// App Config Routes
app.get('/config', (req, res) => {
    db.all('SELECT key, value FROM app_config', (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to load config' });
        const config = {};
        rows.forEach(row => {
            config[row.key] = row.value;
        });
        res.json({ message: 'success', data: config });
    });
});

app.put('/admin/config', authenticateToken, requireAdmin, (req, res) => {
    const { config } = req.body; // Expecting { key: value, ... }
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Invalid config payload' });

    // First, get current version
    db.get('SELECT value FROM app_config WHERE key = ?', ['config_version'], (err, row) => {
        if (err) {
            console.error('Error reading config version:', err.message);
            return res.status(500).json({ error: 'Failed to read config version' });
        }

        const currentVersion = parseInt(row?.value || '0', 10);
        const newVersion = currentVersion + 1;

        // Add new version to config
        const configWithVersion = { ...config, config_version: String(newVersion) };

        db.serialize(() => {
            db.run('BEGIN TRANSACTION', (beginErr) => {
                if (beginErr) {
                    console.error('Error starting transaction:', beginErr.message);
                    return res.status(500).json({ error: 'Failed to start transaction' });
                }
            });

            const stmt = db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)');
            let insertError = null;

            Object.entries(configWithVersion).forEach(([key, value]) => {
                stmt.run(key, String(value), (runErr) => {
                    if (runErr && !insertError) {
                        insertError = runErr;
                        console.error('Error inserting config key:', key, runErr.message);
                    }
                });
            });

            stmt.finalize((finalizeErr) => {
                if (finalizeErr || insertError) {
                    db.run('ROLLBACK');
                    console.error('Error finalizing config update:', finalizeErr?.message || insertError?.message);
                    return res.status(500).json({ error: 'Failed to save configuration' });
                }

                db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                        console.error('Error committing config:', commitErr.message);
                        return res.status(500).json({ error: 'Failed to commit configuration' });
                    }

                    // Fetch and return the saved config for confirmation
                    db.all('SELECT key, value FROM app_config', (fetchErr, rows) => {
                        if (fetchErr) {
                            console.error('Error fetching saved config:', fetchErr.message);
                            return res.json({ message: 'success', version: newVersion });
                        }
                        const savedConfig = {};
                        rows.forEach(r => { savedConfig[r.key] = r.value; });
                        console.log(`Config updated to version ${newVersion}`);
                        res.json({ message: 'success', data: savedConfig, version: newVersion });
                    });
                });
            });
        });
    });
});

app.get('/admin/users', authenticateToken, requireAdmin, (req, res) => {
    db.all('SELECT id, username, is_admin as isAdmin, avatar_url as avatarUrl FROM users', (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch users' });
        res.json({ message: 'success', data: rows });
    });
});

app.post('/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    const { username, password, isAdmin, avatarUrl } = req.body;
    if (!username || typeof username !== 'string') return res.status(400).json({ error: 'Username is required' });
    if (!password || typeof password !== 'string' || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const id = crypto.randomUUID();
        const stmt = db.prepare('INSERT INTO users (id, username, password, is_admin, avatar_url) VALUES (?, ?, ?, ?, ?)');
        stmt.run(id, username.trim(), hashedPassword, isAdmin ? 1 : 0, avatarUrl || null, (err) => {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Username already exists' });
                }
                console.error('Error creating user:', err.message);
                return res.status(500).json({ error: 'Failed to create user' });
            }
            res.status(201).json({ message: 'success', data: { id, username: username.trim(), isAdmin: !!isAdmin, avatarUrl: avatarUrl || null } });
        });
        stmt.finalize();
    } catch (e) {
        console.error('Error hashing password:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { username, password, isAdmin, avatarUrl } = req.body;

    if (username !== undefined && (typeof username !== 'string' || !username.trim())) {
        return res.status(400).json({ error: 'Invalid username' });
    }
    if (password !== undefined && (typeof password !== 'string' || password.length < 4)) {
        return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const updates = [];
    const params = [];

    if (username !== undefined) {
        updates.push('username = ?');
        params.push(username.trim());
    }
    if (avatarUrl !== undefined) {
        updates.push('avatar_url = ?');
        params.push(avatarUrl || null);
    }
    if (isAdmin !== undefined) {
        updates.push('is_admin = ?');
        params.push(isAdmin ? 1 : 0);
    }

    if (password !== undefined) {
        try {
            const hashed = await bcrypt.hash(password, 10);
            updates.push('password = ?');
            params.push(hashed);
        } catch (e) {
            console.error('Error hashing password:', e);
            return res.status(500).json({ error: 'Failed to hash password' });
        }
    }

    if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);

    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    db.run(sql, params, function (err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'Username already exists' });
            }
            console.error('Error updating user:', err.message);
            return res.status(500).json({ error: 'Failed to update user' });
        }
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'success' });
    });
});

app.delete('/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const { id } = req.params;
    db.serialize(() => {
        db.run('DELETE FROM events WHERE user_id = ?', [id]);
        db.run('DELETE FROM postponed_events WHERE user_id = ?', [id]);
        db.run('DELETE FROM friendships WHERE user_a = ? OR user_b = ?', [id, id]);
        db.run('DELETE FROM users WHERE id = ?', [id], function (err) {
            if (err) {
                console.error('Error deleting user:', err.message);
                return res.status(500).json({ error: 'Failed to delete user' });
            }
            if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
            res.json({ message: 'success' });
        });
    });
});

app.get('/admin/users', authenticateToken, requireAdmin, (req, res) => {
    const sql = `SELECT id, username, isAdmin, avatar_url, 
                (SELECT COUNT(*) FROM events WHERE user_id = users.id) as eventCount
                FROM users 
                ORDER BY username`;

    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching admin users:', err.message);
            return res.status(500).json({ error: 'Failed to fetch users' });
        }
        const users = rows.map(r => ({
            ...r,
            isAdmin: !!r.isAdmin
        }));
        res.json({ message: 'success', data: users });
    });
});

app.delete('/admin/users/bulk', authenticateToken, requireAdmin, (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Invalid or empty IDs array' });
    }

    const safeIds = ids.filter(id => typeof id === 'string' && id.trim().length > 0);
    if (safeIds.length === 0) return res.status(400).json({ error: 'No valid IDs provided' });

    // Prevent deleting self
    if (safeIds.includes(req.user.id)) {
        return res.status(400).json({ error: 'Cannot delete your own admin account' });
    }

    const placeholders = safeIds.map(() => '?').join(',');

    db.serialize(() => {
        // 1. Delete associated events
        db.run(`DELETE FROM events WHERE user_id IN (${placeholders})`, safeIds);
        db.run(`DELETE FROM postponed_events WHERE user_id IN (${placeholders})`, safeIds);

        // 2. Delete associated friendships
        db.run(`DELETE FROM friendships WHERE user_a IN (${placeholders}) OR user_b IN (${placeholders})`, [...safeIds, ...safeIds]);

        // 3. Delete users
        db.run(`DELETE FROM users WHERE id IN (${placeholders})`, safeIds, function (err) {
            if (err) {
                console.error('Error batch deleting users:', err.message);
                return res.status(500).json({ error: 'Failed to delete users' });
            }
            res.json({ message: 'success', deleted: this.changes });
        });
    });
});

app.get('/admin/events', authenticateToken, requireAdmin, (req, res) => {
    const { userId } = req.query;
    const params = [];
    let sql = `SELECT e.id, e.title, e.date, e.start_time as startTime, e.priority, e.note, e.link, e.completed, e.user_id as userId, u.username
               FROM events e
               JOIN users u ON u.id = e.user_id`;
    if (userId) {
        sql += ' WHERE e.user_id = ?';
        params.push(userId);
    }
    sql += ' ORDER BY e.date';

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Error fetching events:', err.message);
            return res.status(500).json({ error: 'Failed to fetch events' });
        }
        res.json({ message: 'success', data: rows });
    });
});

app.post('/admin/events', authenticateToken, requireAdmin, (req, res) => {
    const { userId, title, date, startTime, priority, note, link, completed } = req.body;
    if (!userId || !title || !date) return res.status(400).json({ error: 'userId, title, and date are required' });

    db.get('SELECT id FROM users WHERE id = ?', [userId], (userErr, user) => {
        if (userErr) return res.status(500).json({ error: 'User lookup failed' });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const eventId = crypto.randomUUID();
        const cleanTime = startTime && typeof startTime === 'string' && startTime.trim() !== '' ? startTime.trim() : null;
        const cleanNote = note && typeof note === 'string' && note.trim() !== '' ? note.trim() : null;
        const cleanLink = link && typeof link === 'string' && link.trim() !== '' ? link.trim() : null;
        const cleanCompleted = normalizeCompletedValue(completed);

        db.run(
            'INSERT INTO events (id, title, date, user_id, start_time, priority, note, link, completed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [eventId, title, date, userId, cleanTime, (priority === null || priority === undefined || (typeof priority === 'string' && priority.trim() === ''))
                ? null
                : (Number.isFinite(Number(priority)) ? Math.trunc(Number(priority)) : null), cleanNote, cleanLink, cleanCompleted],
            (err) => {
                if (err) {
                    console.error('Error creating event:', err.message);
                    return res.status(500).json({ error: 'Failed to create event' });
                }
                res.status(201).json({ message: 'success', data: { id: eventId } });
            }
        );
    });
});

app.delete('/admin/events/bulk', authenticateToken, requireAdmin, (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Invalid or empty IDs array' });
    }

    // Sanitize and filter out non-strings
    const safeIds = ids.filter(id => typeof id === 'string' && id.trim().length > 0);

    if (safeIds.length === 0) {
        return res.status(400).json({ error: 'No valid IDs provided' });
    }

    const placeholders = safeIds.map(() => '?').join(',');
    const sql = `DELETE FROM events WHERE id IN (${placeholders})`;

    db.run(sql, safeIds, function (err) {
        if (err) {
            console.error('Error batch deleting events:', err.message);
            return res.status(500).json({ error: 'Failed to delete events' });
        }
        res.json({ message: 'success', deleted: this.changes });
    });
});


app.put('/admin/events/:id', authenticateToken, requireAdmin, (req, res) => {
    const { id } = req.params;
    const { title, date, startTime, priority, note, link, completed } = req.body;
    if (!title || !date) return res.status(400).json({ error: 'title and date are required' });

    const cleanTime = startTime && typeof startTime === 'string' && startTime.trim() !== '' ? startTime.trim() : null;
    const cleanNote = note && typeof note === 'string' && note.trim() !== '' ? note.trim() : null;
    const cleanLink = link && typeof link === 'string' && link.trim() !== '' ? link.trim() : null;
    const cleanCompleted = normalizeCompletedValue(completed);

    db.run(
        `UPDATE events SET title = ?, date = ?, start_time = ?, priority = ?, note = ?, link = ?, completed = ? WHERE id = ?`,
        [title, date, cleanTime, (priority === null || priority === undefined || (typeof priority === 'string' && priority.trim() === ''))
            ? null
            : (Number.isFinite(Number(priority)) ? Math.trunc(Number(priority)) : null), cleanNote, cleanLink, cleanCompleted, id],
        function (err) {
            if (err) {
                console.error('Error updating event:', err.message);
                return res.status(500).json({ error: 'Failed to update event' });
            }
            if (this.changes === 0) return res.status(404).json({ error: 'Event not found' });
            res.json({ message: 'success' });
        }
    );
});

app.delete('/admin/events/:id', authenticateToken, requireAdmin, (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM events WHERE id = ?', [id], function (err) {
        if (err) {
            console.error('Error deleting event:', err.message);
            return res.status(500).json({ error: 'Failed to delete event' });
        }
        if (this.changes === 0) return res.status(404).json({ error: 'Event not found' });
        res.json({ message: 'success' });
    });
});

app.get('/admin/friends', authenticateToken, requireAdmin, (req, res) => {
    const sql = `
      SELECT f.user_a as userA, f.user_b as userB, ua.username as userAName, ub.username as userBName
      FROM friendships f
      JOIN users ua ON ua.id = f.user_a
      JOIN users ub ON ub.id = f.user_b
      ORDER BY ua.username, ub.username
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching friendships:', err.message);
            return res.status(500).json({ error: 'Failed to fetch friendships' });
        }
        res.json({ message: 'success', data: rows });
    });
});

app.post('/admin/friends', authenticateToken, requireAdmin, (req, res) => {
    const { userA, userB } = req.body;
    if (!userA || !userB) return res.status(400).json({ error: 'userA and userB are required' });
    if (userA === userB) return res.status(400).json({ error: 'Cannot friend the same user' });

    const ordered = userA < userB ? [userA, userB] : [userB, userA];

    db.all('SELECT id FROM users WHERE id IN (?, ?)', ordered, (err, rows) => {
        if (err) return res.status(500).json({ error: 'User lookup failed' });
        if (rows.length < 2) return res.status(404).json({ error: 'Both users must exist' });

        db.run('INSERT OR IGNORE INTO friendships (user_a, user_b) VALUES (?, ?)', ordered, (insertErr) => {
            if (insertErr) {
                console.error('Error creating friendship:', insertErr.message);
                return res.status(500).json({ error: 'Failed to create friendship' });
            }
            res.status(201).json({ message: 'success' });
        });
    });
});

app.delete('/admin/friends/:userA/:userB', authenticateToken, requireAdmin, (req, res) => {
    const { userA, userB } = req.params;
    if (!userA || !userB) return res.status(400).json({ error: 'Both ids are required' });
    const ordered = userA < userB ? [userA, userB] : [userB, userA];
    db.run('DELETE FROM friendships WHERE user_a = ? AND user_b = ?', ordered, function (err) {
        if (err) {
            console.error('Error deleting friendship:', err.message);
            return res.status(500).json({ error: 'Failed to delete friendship' });
        }
        if (this.changes === 0) return res.status(404).json({ error: 'Friendship not found' });
        res.json({ message: 'success' });
    });
});

// Admin Init (for seed script)
app.post('/admin/init', async (req, res) => {
    const { username, password, secret } = req.body;
    // Simple protection for init endpoint, though in prod this should be disabled or protected better
    if (secret !== SECRET_KEY) return res.status(403).json({ error: 'Forbidden' });

    if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const id = crypto.randomUUID();

        const stmt = db.prepare('INSERT INTO users (id, username, password, is_admin) VALUES (?, ?, ?, 1)');
        stmt.run(id, username, hashedPassword, function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    // Try to update if exists
                    db.run('UPDATE users SET password = ?, is_admin = 1 WHERE username = ?', [hashedPassword, username], (updateErr) => {
                        if (updateErr) return res.status(500).json({ error: 'Failed to upsert admin' });
                        res.json({ message: 'Admin user updated' });
                    });
                    return;
                }
                return res.status(500).json({ error: 'Failed to create admin' });
            }
            res.json({ message: 'Admin user created' });
        });
        stmt.finalize();
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});


// --- Roles Routes ---

// Get all roles
app.get('/roles', authenticateToken, (req, res) => {
    // Returns global roles? Or user specific? 
    // The previous implementation for event-options was user specific in code (WHERE user_id = ?) 
    // BUT the user asked for "global" in a previous turn, then accepted user-specific code...
    // The PROMPT says "besides for user... there should be a section... called roles".
    // I will stick to what the code WAS (User Scoped) or switch to GLOBAL?
    // "Change in all the sites instead of using terms context use role."
    // "besides for user, events, app config, there should be a section in the database admin panel page called roles"
    // The code I am replacing WAS `WHERE user_id = ?`.
    // I will keep it consistent with the previous state unless explicit instruction to make it global shared.
    // Wait, in Step 1087 (Plan), I wrote: "correction: The user said... so roles will be Global".
    // Let's check the previous state of `event_options` in `server/index.js`.
    // Line 1193: `SELECT * FROM event_options WHERE user_id = ?`
    // It WAS user specific.
    // However, looking at the User Request in Step 1162: "besides for user, events, app config, there should be a section in the database admin panel page called roles".
    // If it's in the ADMIN PANEL database view, it just shows table data.
    // If I look at the PREVIOUS "Global Event Options" request (Step 1032), I successfully implemented Global Options.
    // BUT then I seemingly reverted or the file content shows `user_id`.
    // Let's look at lines 76 in `server/index.js` from Step 1119 view: `user_id TEXT NOT NULL`.
    // So it WAS user specific recently.
    // I will keep `user_id` column but maybe the Admin wants to see ALL roles?
    // The user simply asked to rename "Context" to "Role". I should preserve the functionality (User Specific) unless I have strong reason not to.

    db.all('SELECT * FROM roles WHERE user_id = ? ORDER BY order_index ASC, label ASC', [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'success', data: rows });
    });
});

// Create role
app.post('/roles', authenticateToken, (req, res) => {
    const { label, color } = req.body;
    if (!label) return res.status(400).json({ error: 'Label required' });
    const id = crypto.randomUUID();

    db.get('SELECT MAX(order_index) as maxOrder FROM roles WHERE user_id = ?', [req.user.id], (err, row) => {
        const nextOrder = (row && row.maxOrder !== null) ? row.maxOrder + 1 : 0;

        db.run('INSERT INTO roles (id, user_id, label, color, order_index) VALUES (?, ?, ?, ?, ?)',
            [id, req.user.id, label, color, nextOrder],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'success', data: { id, user_id: req.user.id, label, color, is_enabled: 1, order_index: nextOrder } });
            }
        );
    });
});

// --- Subroles Routes ---

// Get all subroles
app.get('/subroles', authenticateToken, (req, res) => {
    db.all('SELECT * FROM subroles WHERE user_id = ? ORDER BY role_id, order_index ASC, label ASC', [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'success', data: rows });
    });
});

// Create subrole for a role
app.post('/roles/:roleId/subroles', authenticateToken, (req, res) => {
    const { roleId } = req.params;
    const { label, color } = req.body;
    if (!label) return res.status(400).json({ error: 'Label required' });
    const id = crypto.randomUUID();

    db.get('SELECT user_id FROM roles WHERE id = ?', [roleId], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        if (!row) return res.status(404).json({ error: 'Role not found' });
        if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

        db.get('SELECT MAX(order_index) as maxOrder FROM subroles WHERE user_id = ? AND role_id = ?', [req.user.id, roleId], (orderErr, orderRow) => {
            if (orderErr) return res.status(500).json({ error: orderErr.message });
            const nextOrder = (orderRow && orderRow.maxOrder !== null) ? orderRow.maxOrder + 1 : 0;

            db.run(
                'INSERT INTO subroles (id, role_id, user_id, label, color, order_index) VALUES (?, ?, ?, ?, ?, ?)',
                [id, roleId, req.user.id, label, color, nextOrder],
                (insertErr) => {
                    if (insertErr) return res.status(500).json({ error: insertErr.message });
                    res.json({ message: 'success', data: { id, role_id: roleId, user_id: req.user.id, label, color, is_enabled: 1, order_index: nextOrder } });
                }
            );
        });
    });
});

// Update subrole
app.put('/subroles/:id', authenticateToken, (req, res) => {
    const { label, color, is_enabled } = req.body;
    const { id } = req.params;

    db.get('SELECT user_id FROM subroles WHERE id = ?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        if (!row) return res.status(404).json({ error: 'Subrole not found' });
        if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

        db.run('UPDATE subroles SET label = ?, color = ?, is_enabled = ? WHERE id = ?',
            [label, color, is_enabled, id],
            (updateErr) => {
                if (updateErr) return res.status(500).json({ error: updateErr.message });
                res.json({ message: 'success' });
            }
        );
    });
});

// Delete subrole
app.delete('/subroles/:id', authenticateToken, (req, res) => {
    const { id } = req.params;

    db.get('SELECT user_id FROM subroles WHERE id = ?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        if (!row) return res.status(404).json({ error: 'Subrole not found' });
        if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

        db.run('DELETE FROM subroles WHERE id = ?', [id], (deleteErr) => {
            if (deleteErr) return res.status(500).json({ error: deleteErr.message });
            res.json({ message: 'success' });
        });
    });
});

// --- Upload Routes ---
const multer = require('multer');
const uploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'file-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage: uploadStorage });

// Generic Database Access for Admin
app.get('/admin/database/:table', authenticateToken, requireAdmin, (req, res) => {
    const { table } = req.params;
    const ALLOWED_TABLES = ['roles', 'event_notes', 'app_config'];

    if (!ALLOWED_TABLES.includes(table)) {
        return res.status(400).json({ error: 'Invalid table name' });
    }

    let sql;
    if (table === 'roles') {
        sql = `SELECT r.*, u.username 
               FROM roles r 
               LEFT JOIN users u ON r.user_id = u.id 
               ORDER BY u.username, r.order_index`;
    } else if (table === 'event_notes') {
        sql = `SELECT n.*, e.title as event_title, e.date as event_date, u.username
               FROM event_notes n
               LEFT JOIN events e ON n.event_id = e.id
               LEFT JOIN users u ON e.user_id = u.id
               ORDER BY u.username, e.date`;
    } else {
        sql = `SELECT * FROM ${table}`;
    }

    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error(`Error fetching ${table}:`, err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ message: 'success', data: rows });
    });
});

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.post('/upload', authenticateToken, upload.single('file'), (req, res) => {
    console.log('Upload request received');
    if (!req.file) {
        console.error('No file in request');
        return res.status(400).json({ error: 'No file uploaded' });
    }
    console.log('File uploaded:', req.file.path);
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, filename: req.file.originalname });
});

// Admin Routes for Roles
// Update role
app.put('/roles/:id', authenticateToken, (req, res) => {
    const { label, color, is_enabled, order_index } = req.body;
    const { id } = req.params;

    db.get('SELECT user_id FROM roles WHERE id = ?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        if (!row) return res.status(404).json({ error: 'Role not found' });
        if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

        db.run('UPDATE roles SET label = ?, color = ?, is_enabled = ? WHERE id = ?',
            [label, color, is_enabled, id],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'success' });
            }
        );
    });
});

// Delete role
app.delete('/roles/:id', authenticateToken, (req, res) => {
    const { id } = req.params;

    db.get('SELECT user_id FROM roles WHERE id = ?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        if (!row) return res.status(404).json({ error: 'Role not found' });
        if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

        db.serialize(() => {
            db.run('DELETE FROM subroles WHERE role_id = ? AND user_id = ?', [id, req.user.id]);
            db.run('DELETE FROM roles WHERE id = ?', [id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'success' });
            });
        });
    });
});

// Reorder roles
app.post('/roles/reorder', authenticateToken, (req, res) => {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'Invalid data' });

    try {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            orderedIds.forEach((id, index) => {
                db.run('UPDATE roles SET order_index = ? WHERE id = ? AND user_id = ?', [index, id, req.user.id]);
            });
            db.run("COMMIT", (err) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: 'Transaction failed' });
                }
                res.json({ message: 'success' });
            });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Event Notes Routes ---

// Get notes for an event (public/shared for now if you have eventId, or refine auth later)
app.get('/events/:eventId/notes', authenticateToken, (req, res) => {
    const { eventId } = req.params;
    db.all('SELECT * FROM event_notes WHERE event_id = ?', [eventId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'success', data: rows });
    });
});

// Save note for event+option
app.post('/events/:eventId/notes', authenticateToken, (req, res) => {
    const { eventId } = req.params;
    const { roleId, content } = req.body;

    // Verify user owns the event
    db.get('SELECT user_id FROM events WHERE id = ?', [eventId], (err, event) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (event.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

        const updatedAt = Date.now();
        db.run(
            'INSERT OR REPLACE INTO event_notes (event_id, role_id, content, updated_at) VALUES (?, ?, ?, ?)',
            [eventId, roleId, content, updatedAt],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'success' });
            }
        );
    });
});

// Serve the Full-Featured Database Admin Panel at root (port 3001)
app.use(express.static(staticAdminDir));
app.get('/', (req, res) => {
    res.sendFile(path.join(staticAdminDir, 'index.html'));
});


// Start server only when DB is ready
if (require.main === module) {
    initDbOnce(() => {
        // Serve the database admin panel at the root of the calendar server (port 3001) AFTER API routes
        // Wait, app.use(express.static) was moved up. We don't need it here again essentially.
        // We will keep the listener here.


        app.listen(port, host, () => {
            console.log(`Server running on port ${port} (listening on ${host})`);
        });
    });
}
