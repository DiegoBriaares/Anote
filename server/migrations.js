const crypto = require('crypto');
const bcrypt = require('bcrypt');

const { isTime, isTimeZone, nextOccurrence } = require('./time');

const SCHEMA_VERSION = 4;

const tableColumns = (db, table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));

const hasForeignKey = (db, table, from, target) => db.prepare(`PRAGMA foreign_key_list(${table})`).all()
    .some((row) => row.from === from && row.table === target);

const addColumn = (db, table, definition) => {
    const [name] = definition.trim().split(/\s+/);
    if (!tableColumns(db, table).has(name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
};

const ensureBaseSchema = (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            avatar_url TEXT,
            preferences TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1))
        );
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            start_time TEXT,
            priority INTEGER,
            note TEXT,
            link TEXT,
            completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
            failed INTEGER NOT NULL DEFAULT 0 CHECK (failed IN (0, 1)),
            updated_at INTEGER NOT NULL DEFAULT 0,
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
            resources TEXT,
            unlock_date TEXT,
            CHECK (NOT (completed = 1 AND failed = 1))
        );
        CREATE TABLE IF NOT EXISTS postponed_events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            date TEXT,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            start_time TEXT,
            priority INTEGER,
            note TEXT,
            link TEXT,
            completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
            failed INTEGER NOT NULL DEFAULT 0 CHECK (failed IN (0, 1)),
            updated_at INTEGER NOT NULL DEFAULT 0,
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
            resources TEXT,
            CHECK (NOT (completed = 1 AND failed = 1))
        );
        CREATE TABLE IF NOT EXISTS roles (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            color TEXT,
            is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
            order_index INTEGER NOT NULL DEFAULT 0,
            UNIQUE (id, user_id)
        );
        CREATE TABLE IF NOT EXISTS subroles (
            id TEXT PRIMARY KEY,
            role_id TEXT NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            color TEXT,
            is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
            order_index INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (role_id, user_id) REFERENCES roles(id, user_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS friendships (
            user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            PRIMARY KEY (user_a, user_b),
            CHECK (user_a < user_b)
        );
        CREATE TABLE IF NOT EXISTS daily_facts_v2 (
            date TEXT NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content TEXT,
            PRIMARY KEY (date, user_id)
        );
        CREATE TABLE IF NOT EXISTS day_backgrounds_v2 (
            date TEXT NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            image_url TEXT,
            PRIMARY KEY (date, user_id)
        );
        CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS event_notes (
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            role_id TEXT NOT NULL,
            content TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (event_id, role_id)
        );
        CREATE TABLE IF NOT EXISTS user_role_events (
            event_index INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT UNIQUE NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            role_rank INTEGER NOT NULL,
            action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
            changed_at INTEGER NOT NULL,
            source TEXT,
            note TEXT
        );
    `);
};

const ensureLegacyColumns = (db) => {
    addColumn(db, 'users', 'avatar_url TEXT');
    addColumn(db, 'users', 'preferences TEXT');
    addColumn(db, 'users', 'is_admin INTEGER NOT NULL DEFAULT 0');

    for (const table of ['events', 'postponed_events']) {
        addColumn(db, table, "user_id TEXT NOT NULL DEFAULT 'legacy'");
        addColumn(db, table, 'start_time TEXT');
        addColumn(db, table, 'priority INTEGER');
        addColumn(db, table, 'note TEXT');
        addColumn(db, table, 'link TEXT');
        addColumn(db, table, 'completed INTEGER NOT NULL DEFAULT 0');
        addColumn(db, table, 'failed INTEGER NOT NULL DEFAULT 0');
        addColumn(db, table, 'updated_at INTEGER NOT NULL DEFAULT 0');
        addColumn(db, table, 'revision INTEGER NOT NULL DEFAULT 1');
        addColumn(db, table, 'resources TEXT');
    }
    addColumn(db, 'events', 'unlock_date TEXT');

    const ownedTables = ['events', 'postponed_events', 'roles', 'subroles', 'daily_facts_v2', 'day_backgrounds_v2'];
    const missingOwners = new Set();
    for (const table of ownedTables) {
        if (!tableColumns(db, table).has('user_id')) continue;
        for (const row of db.prepare(`
            SELECT DISTINCT owned.user_id
            FROM ${table} owned LEFT JOIN users u ON u.id = owned.user_id
            WHERE owned.user_id IS NOT NULL AND u.id IS NULL
        `).all()) missingOwners.add(row.user_id);
    }
    if (tableColumns(db, 'friendships').has('user_a')) {
        for (const row of db.prepare(`
            SELECT user_a AS user_id FROM friendships WHERE user_a IS NOT NULL
            UNION SELECT user_b AS user_id FROM friendships WHERE user_b IS NOT NULL
        `).all()) {
            if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(row.user_id)) missingOwners.add(row.user_id);
        }
    }
    const disabledPassword = missingOwners.size > 0
        ? bcrypt.hashSync(crypto.randomBytes(32).toString('base64url'), 12)
        : null;
    for (const id of missingOwners) {
        const suffix = crypto.createHash('sha256').update(id).digest('hex').slice(0, 16);
        db.prepare('INSERT INTO users (id, username, password, preferences, is_admin) VALUES (?, ?, ?, ?, 0)')
            .run(id, `legacy-${suffix}`, disabledPassword, '{}');
    }
    db.exec(`
        UPDATE events SET revision = 1 WHERE revision IS NULL OR revision < 1;
        UPDATE postponed_events SET revision = 1 WHERE revision IS NULL OR revision < 1;
        UPDATE events SET completed = 0 WHERE completed IS NULL;
        UPDATE events SET failed = 0 WHERE failed IS NULL;
        UPDATE events SET completed = 0 WHERE completed = 1 AND failed = 1;
        UPDATE postponed_events SET completed = 0 WHERE completed IS NULL;
        UPDATE postponed_events SET failed = 0 WHERE failed IS NULL;
        UPDATE postponed_events SET completed = 0 WHERE completed = 1 AND failed = 1;
    `);
};

const rebuildLegacyEvents = (db, table) => {
    if (hasForeignKey(db, table, 'user_id', 'users')) return;
    const isPostponed = table === 'postponed_events';
    const replacement = `${table}_hardened`;
    db.exec(`
        CREATE TABLE ${replacement} (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            date TEXT ${isPostponed ? '' : 'NOT NULL'},
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            start_time TEXT,
            priority INTEGER,
            note TEXT,
            link TEXT,
            completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
            failed INTEGER NOT NULL DEFAULT 0 CHECK (failed IN (0, 1)),
            updated_at INTEGER NOT NULL DEFAULT 0,
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
            resources TEXT,
            ${isPostponed ? '' : 'unlock_date TEXT,'}
            CHECK (NOT (completed = 1 AND failed = 1))
        );
        INSERT INTO ${replacement} (
            id, title, date, user_id, start_time, priority, note, link,
            completed, failed, updated_at, revision, resources${isPostponed ? '' : ', unlock_date'}
        )
        SELECT id, title, date, user_id, start_time, priority, note, link,
               CASE WHEN completed = 1 AND failed != 1 THEN 1 ELSE 0 END,
               CASE WHEN failed = 1 THEN 1 ELSE 0 END,
               COALESCE(updated_at, 0),
               CASE WHEN revision IS NULL OR revision < 1 THEN 1 ELSE revision END,
               resources${isPostponed ? '' : ', unlock_date'}
        FROM ${table};
        DROP TABLE ${table};
        ALTER TABLE ${replacement} RENAME TO ${table};
    `);
};

const repairLegacySubroleOwners = (db) => {
    const invalid = db.prepare(`
        SELECT s.id, s.role_id, s.user_id
        FROM subroles s LEFT JOIN roles r ON r.id = s.role_id AND r.user_id = s.user_id
        WHERE r.id IS NULL
    `).all();
    // A partially initialized legacy schema may have just created the empty
    // target subroles table while roles is still awaiting its composite key.
    // Avoid preparing an UPDATE against that temporarily mismatched FK.
    if (invalid.length === 0) return;
    const insertRole = db.prepare(`
        INSERT OR IGNORE INTO roles (id, user_id, label, color, is_enabled, order_index)
        VALUES (?, ?, 'Imported subrole parent', NULL, 1, ?)
    `);
    const updateSubrole = db.prepare('UPDATE subroles SET role_id = ? WHERE id = ?');
    const maxOrder = db.prepare('SELECT MAX(order_index) AS value FROM roles WHERE user_id = ?');
    for (const row of invalid) {
        const repairedRoleId = `imported-${crypto.createHash('sha256')
            .update(`${row.user_id}:${row.role_id}`)
            .digest('hex').slice(0, 32)}`;
        insertRole.run(repairedRoleId, row.user_id, (maxOrder.get(row.user_id).value ?? -1) + 1);
        updateSubrole.run(repairedRoleId, row.id);
    }
};

const rebuildLegacyRoles = (db) => {
    repairLegacySubroleOwners(db);
    if (!hasForeignKey(db, 'roles', 'user_id', 'users')) {
        db.exec(`
            CREATE TABLE roles_hardened (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                label TEXT NOT NULL,
                color TEXT,
                is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
                order_index INTEGER NOT NULL DEFAULT 0,
                UNIQUE (id, user_id)
            );
            INSERT INTO roles_hardened (id, user_id, label, color, is_enabled, order_index)
            SELECT id, user_id, label, color,
                   CASE WHEN is_enabled = 0 THEN 0 ELSE 1 END,
                   COALESCE(order_index, 0)
            FROM roles;
            DROP TABLE roles;
            ALTER TABLE roles_hardened RENAME TO roles;
        `);
    }
    if (!hasForeignKey(db, 'subroles', 'role_id', 'roles')
        || !hasForeignKey(db, 'subroles', 'user_id', 'users')) {
        db.exec(`
            CREATE TABLE subroles_hardened (
                id TEXT PRIMARY KEY,
                role_id TEXT NOT NULL,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                label TEXT NOT NULL,
                color TEXT,
                is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
                order_index INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (role_id, user_id) REFERENCES roles(id, user_id) ON DELETE CASCADE
            );
            INSERT INTO subroles_hardened (id, role_id, user_id, label, color, is_enabled, order_index)
            SELECT id, role_id, user_id, label, color,
                   CASE WHEN is_enabled = 0 THEN 0 ELSE 1 END,
                   COALESCE(order_index, 0)
            FROM subroles;
            DROP TABLE subroles;
            ALTER TABLE subroles_hardened RENAME TO subroles;
        `);
    }
};

const rebuildLegacyFriendships = (db) => {
    if (hasForeignKey(db, 'friendships', 'user_a', 'users')
        && hasForeignKey(db, 'friendships', 'user_b', 'users')) return;
    const rows = db.prepare('SELECT user_a, user_b FROM friendships').all();
    db.exec(`
        CREATE TABLE friendships_hardened (
            user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            PRIMARY KEY (user_a, user_b),
            CHECK (user_a < user_b)
        );
    `);
    const insert = db.prepare('INSERT OR IGNORE INTO friendships_hardened (user_a, user_b) VALUES (?, ?)');
    for (const row of rows) {
        if (!row.user_a || !row.user_b || row.user_a === row.user_b) continue;
        const [first, second] = row.user_a < row.user_b
            ? [row.user_a, row.user_b]
            : [row.user_b, row.user_a];
        insert.run(first, second);
    }
    db.exec('DROP TABLE friendships; ALTER TABLE friendships_hardened RENAME TO friendships;');
};

const rebuildLegacyUserData = (db) => {
    const definitions = [
        {
            table: 'daily_facts_v2',
            value: 'content',
            valueType: 'TEXT'
        },
        {
            table: 'day_backgrounds_v2',
            value: 'image_url',
            valueType: 'TEXT'
        }
    ];
    for (const { table, value, valueType } of definitions) {
        if (hasForeignKey(db, table, 'user_id', 'users')) continue;
        db.exec(`
            CREATE TABLE ${table}_hardened (
                date TEXT NOT NULL,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                ${value} ${valueType},
                PRIMARY KEY (date, user_id)
            );
            INSERT INTO ${table}_hardened (date, user_id, ${value})
            SELECT date, user_id, ${value} FROM ${table};
            DROP TABLE ${table};
            ALTER TABLE ${table}_hardened RENAME TO ${table};
        `);
    }
};

const rebuildLegacyOwnedSchemas = (db) => {
    rebuildLegacyEvents(db, 'events');
    rebuildLegacyEvents(db, 'postponed_events');
    rebuildLegacyRoles(db);
    rebuildLegacyFriendships(db);
    rebuildLegacyUserData(db);
};

const normalizeEventNotesSchema = (db) => {
    const columns = tableColumns(db, 'event_notes');
    const roleExpression = columns.has('role_id')
        ? 'role_id'
        : columns.has('option_id')
            ? 'option_id'
            : 'NULL';
    const contentExpression = columns.has('content') ? 'content' : 'NULL';
    const updatedExpression = columns.has('updated_at') ? 'updated_at' : 'NULL';
    const sourceCount = db.prepare('SELECT COUNT(*) AS count FROM event_notes').get().count;
    db.exec(`
        CREATE TABLE event_notes_legacy_migration (
            migration_ordinal INTEGER PRIMARY KEY,
            source_event_id,
            source_role_id,
            source_content,
            source_updated_at
        );
        INSERT INTO event_notes_legacy_migration (
            migration_ordinal, source_event_id, source_role_id,
            source_content, source_updated_at
        )
        SELECT ROW_NUMBER() OVER (
                   ORDER BY typeof(event_id), quote(event_id),
                            typeof(${roleExpression}), quote(${roleExpression}),
                            typeof(${contentExpression}), quote(${contentExpression}),
                            typeof(${updatedExpression}), quote(${updatedExpression})
               ),
               event_id, ${roleExpression}, ${contentExpression}, ${updatedExpression}
        FROM event_notes;
        DROP TABLE event_notes;
        CREATE TABLE event_notes (
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
            owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (event_id, role_id)
        );
        CREATE INDEX idx_event_notes_owner ON event_notes(owner_user_id, event_id);
        CREATE TRIGGER event_notes_owner_guard_insert
        BEFORE INSERT ON event_notes
        WHEN NOT EXISTS (
            SELECT 1 FROM events e JOIN roles r ON r.id = NEW.role_id
            WHERE e.id = NEW.event_id AND e.user_id = NEW.owner_user_id
              AND r.user_id = NEW.owner_user_id
        )
        BEGIN SELECT RAISE(ABORT, 'event note ownership mismatch'); END;
        CREATE TRIGGER event_notes_owner_guard_update
        BEFORE UPDATE OF event_id, role_id, owner_user_id ON event_notes
        WHEN NOT EXISTS (
            SELECT 1 FROM events e JOIN roles r ON r.id = NEW.role_id
            WHERE e.id = NEW.event_id AND e.user_id = NEW.owner_user_id
              AND r.user_id = NEW.owner_user_id
        )
        BEGIN SELECT RAISE(ABORT, 'event note ownership mismatch'); END;
    `);
    const stagedCount = db.prepare('SELECT COUNT(*) AS count FROM event_notes_legacy_migration').get().count;
    if (stagedCount !== sourceCount) throw new Error('Legacy event note staging did not conserve every source row');
    const legacyRows = db.prepare(`
        SELECT migration_ordinal AS ordinal,
               CAST(source_event_id AS TEXT) AS event_id,
               CAST(source_role_id AS TEXT) AS role_id,
               typeof(source_event_id) AS event_id_type,
               quote(source_event_id) AS event_id_sql,
               typeof(source_role_id) AS role_id_type,
               quote(source_role_id) AS role_id_sql,
               typeof(source_content) AS content_type,
               quote(source_content) AS content_sql,
               typeof(source_updated_at) AS updated_at_type,
               quote(source_updated_at) AS updated_at_sql
        FROM event_notes_legacy_migration
        ORDER BY migration_ordinal
    `).all();
    const selectEvent = db.prepare('SELECT user_id FROM events WHERE id = ?');
    const selectRole = db.prepare('SELECT user_id FROM roles WHERE id = ?');
    const roleOwnerSnapshot = new Map(db.prepare('SELECT id, user_id FROM roles ORDER BY id').all()
        .map((role) => [String(role.id), role.user_id]));
    const maxRoleOrder = db.prepare('SELECT MAX(order_index) AS value FROM roles WHERE user_id = ?');
    const insertRole = db.prepare(`
        INSERT OR IGNORE INTO roles (id, user_id, label, color, is_enabled, order_index)
        VALUES (?, ?, ?, NULL, 1, ?)
    `);
    const insertNoteFromLegacy = db.prepare(`
        INSERT INTO event_notes (event_id, role_id, owner_user_id, content, updated_at)
        SELECT ?, ?, ?, source_content, COALESCE(source_updated_at, 0)
        FROM event_notes_legacy_migration WHERE migration_ordinal = ?
    `);
    const insertRecoveryNote = db.prepare(`
        INSERT INTO legacy_event_note_recovery (
            id, migration_ordinal, source_event_id, source_role_id, source_content,
            source_updated_at, source_content_type, payload_sha256,
            reason_code, candidate_owner_user_id, ownership_basis,
            state, revision
        )
        SELECT ?, migration_ordinal, source_event_id, source_role_id, source_content,
               source_updated_at, typeof(source_content), ?, 'missing_event',
               ?, ?, 'unresolved', 1
        FROM event_notes_legacy_migration WHERE migration_ordinal = ?
    `);
    let activeCount = 0;
    let recoveryCount = 0;
    for (const row of legacyRows) {
        const event = selectEvent.get(row.event_id);
        if (!event) {
            const candidateOwnerId = row.role_id === null
                ? null
                : roleOwnerSnapshot.get(row.role_id) ?? null;
            const canonicalPayload = JSON.stringify({
                ordinal: row.ordinal,
                eventId: { type: row.event_id_type, sql: row.event_id_sql },
                roleId: { type: row.role_id_type, sql: row.role_id_sql },
                content: { type: row.content_type, sql: row.content_sql },
                updatedAt: { type: row.updated_at_type, sql: row.updated_at_sql }
            });
            const recoveryId = `legacy-note-${crypto.createHash('sha256')
                .update(canonicalPayload)
                .digest('hex')}`;
            const payloadSha256 = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
            insertRecoveryNote.run(
                recoveryId,
                payloadSha256,
                candidateOwnerId,
                candidateOwnerId ? 'role_owner_hint' : 'none',
                row.ordinal
            );
            recoveryCount += 1;
            continue;
        }
        let roleId = row.role_id ?? 'legacy';
        const role = selectRole.get(roleId);
        if (!role || role.user_id !== event.user_id) {
            if (role) {
                roleId = `imported-${crypto.createHash('sha256')
                    .update(JSON.stringify([event.user_id, row.role_id]))
                    .digest('hex')}`;
            }
            const order = (maxRoleOrder.get(event.user_id).value ?? -1) + 1;
            insertRole.run(roleId, event.user_id, 'Imported note role', order);
        }
        insertNoteFromLegacy.run(row.event_id, roleId, event.user_id, row.ordinal);
        activeCount += 1;
    }
    if (activeCount + recoveryCount !== legacyRows.length) {
        throw new Error('Legacy event note migration did not conserve every source row');
    }
    db.exec('DROP TABLE event_notes_legacy_migration');
};

const ensureIntegrityOwners = (db) => {
    const ownedTables = ['events', 'postponed_events', 'roles', 'subroles', 'daily_facts_v2', 'day_backgrounds_v2'];
    for (const table of ownedTables) {
        db.exec(`
            CREATE TRIGGER IF NOT EXISTS ${table}_require_user_insert
            BEFORE INSERT ON ${table}
            WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id)
            BEGIN SELECT RAISE(ABORT, '${table} owner does not exist'); END;
            CREATE TRIGGER IF NOT EXISTS ${table}_require_user_update
            BEFORE UPDATE OF user_id ON ${table}
            WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id)
            BEGIN SELECT RAISE(ABORT, '${table} owner does not exist'); END;
        `);
    }
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS users_username_ci_insert
        BEFORE INSERT ON users
        WHEN EXISTS (SELECT 1 FROM users WHERE username = NEW.username COLLATE NOCASE)
        BEGIN SELECT RAISE(ABORT, 'username unavailable'); END;
        CREATE TRIGGER IF NOT EXISTS users_username_ci_update
        BEFORE UPDATE OF username ON users
        WHEN EXISTS (
            SELECT 1 FROM users
            WHERE username = NEW.username COLLATE NOCASE AND id != OLD.id
        )
        BEGIN SELECT RAISE(ABORT, 'username unavailable'); END;
        CREATE INDEX IF NOT EXISTS idx_events_user_date ON events(user_id, date);
        CREATE INDEX IF NOT EXISTS idx_postponed_events_user ON postponed_events(user_id);
        CREATE INDEX IF NOT EXISTS idx_roles_user_order ON roles(user_id, order_index);
        CREATE INDEX IF NOT EXISTS idx_subroles_user_role ON subroles(user_id, role_id, order_index);
        CREATE INDEX IF NOT EXISTS idx_user_role_events_user_event ON user_role_events(user_id, event_index);
    `);
};

const ensureSecurityAndAutomationSchema = (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL UNIQUE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            idle_expires_at TEXT NOT NULL,
            absolute_expires_at TEXT NOT NULL,
            user_agent TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(idle_expires_at, absolute_expires_at);

        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            purpose TEXT NOT NULL CHECK (purpose IN ('avatar', 'note', 'background')),
            event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size INTEGER NOT NULL CHECK (size >= 0),
            sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
            created_at TEXT NOT NULL,
            CHECK (
                (purpose = 'note' AND event_id IS NOT NULL)
                OR (purpose != 'note' AND event_id IS NULL)
            )
        );
        CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_user_id, purpose);
        CREATE INDEX IF NOT EXISTS idx_attachments_event ON attachments(event_id);

        CREATE TABLE IF NOT EXISTS legacy_event_note_recovery (
            id TEXT PRIMARY KEY,
            migration_ordinal INTEGER NOT NULL UNIQUE,
            source_event_id,
            source_role_id,
            source_content,
            source_updated_at,
            source_content_type TEXT NOT NULL
                CHECK (source_content_type IN ('null', 'text', 'blob', 'integer', 'real')),
            payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
            reason_code TEXT NOT NULL CHECK (reason_code = 'missing_event'),
            candidate_owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
            ownership_basis TEXT NOT NULL CHECK (ownership_basis IN ('role_owner_hint', 'none')),
            state TEXT NOT NULL DEFAULT 'unresolved' CHECK (state = 'unresolved'),
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
        );
        CREATE INDEX IF NOT EXISTS idx_legacy_event_note_recovery_state
        ON legacy_event_note_recovery(state, id);
        CREATE INDEX IF NOT EXISTS idx_legacy_event_note_recovery_hint
        ON legacy_event_note_recovery(candidate_owner_user_id, state, id);
        CREATE INDEX IF NOT EXISTS idx_legacy_event_note_recovery_source
        ON legacy_event_note_recovery(source_event_id, source_role_id);

        CREATE TABLE IF NOT EXISTS programs (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
            activation_time TEXT NOT NULL,
            target_day_offset INTEGER NOT NULL DEFAULT 1 CHECK (target_day_offset BETWEEN 0 AND 365),
            time_zone TEXT NOT NULL,
            next_run_at TEXT,
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_programs_due ON programs(enabled, next_run_at);
        CREATE INDEX IF NOT EXISTS idx_programs_owner ON programs(owner_user_id);

        CREATE TABLE IF NOT EXISTS program_runs (
            id TEXT PRIMARY KEY,
            program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
            owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            source_date TEXT NOT NULL,
            target_date TEXT NOT NULL,
            moved_event_count INTEGER NOT NULL CHECK (moved_event_count >= 0),
            executed_at TEXT NOT NULL,
            automatic INTEGER NOT NULL CHECK (automatic IN (0, 1)),
            acknowledged_at TEXT,
            UNIQUE (program_id, source_date)
        );
        CREATE INDEX IF NOT EXISTS idx_program_runs_owner_notification ON program_runs(owner_user_id, executed_at, id);

        CREATE TRIGGER IF NOT EXISTS attachments_owner_guard_insert
        BEFORE INSERT ON attachments
        WHEN NEW.event_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM events
            WHERE id = NEW.event_id AND user_id = NEW.owner_user_id
        )
        BEGIN SELECT RAISE(ABORT, 'attachment ownership mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS attachments_owner_guard_update
        BEFORE UPDATE OF event_id, owner_user_id ON attachments
        WHEN NEW.event_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM events
            WHERE id = NEW.event_id AND user_id = NEW.owner_user_id
        )
        BEGIN SELECT RAISE(ABORT, 'attachment ownership mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS program_runs_owner_guard_insert
        BEFORE INSERT ON program_runs
        WHEN NOT EXISTS (
            SELECT 1 FROM programs
            WHERE id = NEW.program_id AND owner_user_id = NEW.owner_user_id
        )
        BEGIN SELECT RAISE(ABORT, 'program run ownership mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS program_runs_owner_guard_update
        BEFORE UPDATE OF program_id, owner_user_id ON program_runs
        WHEN NOT EXISTS (
            SELECT 1 FROM programs
            WHERE id = NEW.program_id AND owner_user_id = NEW.owner_user_id
        )
        BEGIN SELECT RAISE(ABORT, 'program run ownership mismatch'); END;
    `);
};

const seedConfiguration = (db, legacyInstallation) => {
    const defaults = {
        app_title: 'Anote',
        app_subtitle: 'Mark progress, move plans, and keep your calendar notes in one place.',
        console_title: 'Anote Console',
        config_version: '1',
        registration_enabled: legacyInstallation ? 'true' : 'false'
    };
    const insert = db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(defaults)) insert.run(key, value);
    db.prepare(`UPDATE app_config SET value = 'Anote' WHERE key = 'app_title' AND value IN ('AUREUM CALENDAR', 'Plan Administration Management System', 'Administration Management Plan System', 'AMPS')`).run();
    db.prepare(`UPDATE app_config SET value = 'Anote Console' WHERE key = 'console_title' AND value = 'Chronos Console'`).run();
};

const migratePreferencePrograms = (db, defaultTimeZone, now, isProduction) => {
    if (!isTimeZone(defaultTimeZone) && isProduction) {
        throw new Error('A valid installation IANA time zone is required to migrate automatic programs');
    }
    const fallbackTimeZone = isTimeZone(defaultTimeZone) ? defaultTimeZone : 'UTC';
    const users = db.prepare('SELECT id, preferences FROM users WHERE preferences IS NOT NULL ORDER BY id').all();
    const insert = db.prepare(`
        INSERT INTO programs (
            id, owner_user_id, name, enabled, activation_time, target_day_offset,
            time_zone, next_run_at, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const updatePreferences = db.prepare('UPDATE users SET preferences = ? WHERE id = ?');
    const timestamp = now.toISOString();

    for (const user of users) {
        let preferences;
        try {
            preferences = JSON.parse(user.preferences);
        } catch {
            continue;
        }
        if (!Array.isArray(preferences?.programs)) continue;
        const profileTimeZone = isTimeZone(preferences.timeZone)
            ? preferences.timeZone
            : isTimeZone(preferences.timezone)
                ? preferences.timezone
                : fallbackTimeZone;

        for (const [index, raw] of preferences.programs.entries()) {
            if (!raw || typeof raw !== 'object') continue;
            const requestedId = typeof raw.id === 'string' && raw.id.trim()
                ? raw.id.trim()
                : `${user.id}-program-${index + 1}`;
            let id = requestedId;
            let collision = 0;
            while (db.prepare('SELECT 1 FROM programs WHERE id = ?').get(id)) {
                id = `imported-${crypto.createHash('sha256')
                    .update(JSON.stringify([user.id, requestedId, index, collision]))
                    .digest('hex').slice(0, 32)}`;
                collision += 1;
                if (collision > 10_000) throw new Error('Legacy program identities cannot be normalized safely');
            }
            const activationTime = isTime(raw.activationTime) ? raw.activationTime : '00:00';
            const timeZone = isTimeZone(raw.timeZone) ? raw.timeZone : profileTimeZone;
            const targetOffset = Number.isFinite(Number(raw.targetOffsetDays))
                ? Math.min(365, Math.max(0, Math.trunc(Number(raw.targetOffsetDays))))
                : 1;
            const enabled = raw.isEnabled === true;
            const nextRunAt = enabled ? nextOccurrence(now, activationTime, timeZone).instant.toISOString() : null;
            insert.run(
                id,
                user.id,
                typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'To Tomorrow Program',
                enabled ? 1 : 0,
                activationTime,
                targetOffset,
                timeZone,
                nextRunAt,
                timestamp,
                timestamp
            );
        }
        const { programs: _removed, ...remaining } = preferences;
        updatePreferences.run(JSON.stringify(remaining), user.id);
    }
};

const migrations = [
    {
        version: 1,
        name: 'core-schema-and-legacy-columns',
        checksumSources: [
            ensureBaseSchema,
            ensureLegacyColumns,
            addColumn,
            hasForeignKey,
            rebuildLegacyEvents,
            repairLegacySubroleOwners,
            rebuildLegacyRoles,
            rebuildLegacyFriendships,
            rebuildLegacyUserData,
            rebuildLegacyOwnedSchemas
        ],
        run(db) {
            ensureBaseSchema(db);
            ensureLegacyColumns(db);
            rebuildLegacyOwnedSchemas(db);
        }
    },
    {
        version: 2,
        name: 'integrity-owners-and-configuration',
        checksumSources: [ensureIntegrityOwners, seedConfiguration],
        run(db, context) {
            const legacyInstallation = db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0;
            ensureIntegrityOwners(db);
            seedConfiguration(db, legacyInstallation);
            if (!context.isProduction && process.env.ANOTE_SEED_DEVELOPMENT_ADMIN === '1') {
                db.prepare(`INSERT OR IGNORE INTO users (id, username, password, is_admin) VALUES (?, ?, ?, 1)`).run(
                    'admin-default-001',
                    'admin',
                    '$2b$10$sRiFIjv/oPy1CvL0HHU3.umRmD7fL0TQTgufBNobLph0zMskaCKYi'
                );
            }
        }
    },
    {
        version: 3,
        name: 'sessions-attachments-programs-and-notes',
        checksumSources: [ensureSecurityAndAutomationSchema, normalizeEventNotesSchema],
        run(db) {
            ensureSecurityAndAutomationSchema(db);
            normalizeEventNotesSchema(db);
        }
    },
    {
        version: 4,
        name: 'legacy-program-preferences',
        checksumSources: [migratePreferencePrograms],
        run(db, context) {
            migratePreferencePrograms(db, context.defaultTimeZone, context.now(), context.isProduction);
            db.prepare('DELETE FROM sessions').run();
        }
    }
];

const migrationChecksum = (migration) => crypto.createHash('sha256')
    .update(JSON.stringify({ version: migration.version, name: migration.name }))
    .update(migration.run.toString())
    .update(migration.checksumSources.map((source) => source.toString()).join('\n'))
    .digest('hex');

const validateMigrationDefinitions = () => {
    const versions = migrations.map((migration) => migration.version);
    const names = migrations.map((migration) => migration.name);
    if (new Set(versions).size !== versions.length || new Set(names).size !== names.length) {
        throw new Error('Duplicate migration identity');
    }
    if (versions.some((version, index) => version !== index + 1) || versions.at(-1) !== SCHEMA_VERSION) {
        throw new Error('Migration definitions are not contiguous');
    }
};

const migrateDatabase = (db, context = {}) => {
    validateMigrationDefinitions();
    const migrationContext = {
        defaultTimeZone: context.defaultTimeZone ?? (context.isProduction === true ? null : 'UTC'),
        isProduction: context.isProduction === true,
        now: context.now || (() => new Date())
    };
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL,
            checksum TEXT NOT NULL
        );
    `);
    const appliedRows = db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
    for (const [index, row] of appliedRows.entries()) {
        if (row.version > SCHEMA_VERSION) throw new Error(`Database schema ${row.version} is newer than this application`);
        if (row.version !== index + 1) throw new Error('Database migration history has a gap');
        const definition = migrations[row.version - 1];
        if (!definition || row.name !== definition.name || row.checksum !== migrationChecksum(definition)) {
            throw new Error(`Database migration identity drift at version ${row.version}`);
        }
    }
    const applied = new Set(appliedRows.map((row) => row.version));
    const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)');

    for (const migration of migrations) {
        if (applied.has(migration.version)) continue;
        const apply = db.transaction(() => {
            migration.run(db, migrationContext);
            record.run(
                migration.version,
                migration.name,
                migrationContext.now().toISOString(),
                migrationChecksum(migration)
            );
        });
        apply.immediate();
    }

    const version = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version || 0;
    if (version !== SCHEMA_VERSION) throw new Error(`Unsupported database schema version: ${version}`);
    return version;
};

module.exports = { SCHEMA_VERSION, migrateDatabase };
