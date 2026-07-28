const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const defaultStateRoot = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
const DEFAULT_PROD_DIR = process.env.ANOTE_PRODUCTION_HOME
    || process.env.PROD_DIR
    || path.join(defaultStateRoot, 'Anote', 'production');
const DEFAULT_CONFIG_PATH = process.env.PROD_USER_OPS_CONFIG
    ? path.resolve(process.cwd(), process.env.PROD_USER_OPS_CONFIG)
    : path.join(__dirname, 'prod_user_ops.local.json');
const ROLE_DEFINITIONS = {
    user: { rank: 0, grantsAdmin: false },
    admin: { rank: 100, grantsAdmin: true }
};

const getArgValue = (args, ...names) => {
    for (const name of names) {
        const longPrefix = `--${name}=`;
        const shortPrefix = `-${name}=`;
        const arg = args.find((entry) => entry.startsWith(longPrefix) || entry.startsWith(shortPrefix));
        if (arg) {
            return arg.slice(arg.indexOf('=') + 1).trim();
        }
    }

    return '';
};

const hasFlag = (args, ...names) => {
    return names.some((name) => args.includes(`--${name}`) || args.includes(`-${name}`));
};

const sqlLiteral = (value) => {
    if (value === null || value === undefined) {
        return 'NULL';
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : 'NULL';
    }

    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }

    return `'${String(value).replace(/'/g, "''")}'`;
};

const parseJsonOutput = (output) => {
    const trimmed = output.trim();
    return trimmed ? JSON.parse(trimmed) : [];
};

const canUseSqliteCli = () => {
    try {
        execFileSync('sqlite3', ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
};

const printUsage = () => {
    console.error('Usage: node scripts/prod_user_ops.cjs <command> [options]');
    console.error('');
    console.error('Commands:');
    console.error('  make-admin       (--username=<username> | --id=<user-id>) [--note=<text>]');
    console.error('  remove-admin     (--username=<username> | --id=<user-id>) [--note=<text>]');
    console.error('  change-username  (--username=<current> | --id=<user-id>) --new-username=<new>');
    console.error('  history          (--username=<username> | --id=<user-id>)');
    console.error('  show-default-dir');
    console.error('  set-default-dir  --dir=<path>');
    console.error('');
    console.error('Options:');
    console.error(`  --target-dir=<path>   Production directory. Defaults to ${DEFAULT_PROD_DIR}`);
    console.error('  --dir=<path>          Short alias for --target-dir.');
    console.error('  --dir-default         Persist the current --dir/--target-dir as the local default.');
    console.error('  --def                 Short alias for --dir-default.');
    console.error('  --db=<path>           Override database path directly.');
    console.error('  --verbose             Show adapter/fallback diagnostics.');
    console.error('  --allow-in-place      Override the safety guard that refuses running from inside the production copy.');
};

const createLogger = (verbose) => {
    return {
        verbose: (message) => {
            if (verbose) {
                console.log(message);
            }
        }
    };
};

const readLocalConfig = () => {
    if (!fs.existsSync(DEFAULT_CONFIG_PATH)) {
        return {};
    }

    try {
        const raw = fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8').trim();
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        throw new Error(`Failed to read local config at ${DEFAULT_CONFIG_PATH}: ${error.message}`);
    }
};

const writeLocalConfig = (config) => {
    fs.writeFileSync(DEFAULT_CONFIG_PATH, `${JSON.stringify(config, null, 4)}\n`);
};

const resolveRequestedTargetDir = (args) => {
    const localConfig = readLocalConfig();
    const requestedDir = getArgValue(args, 'target-dir', 'dir');
    const envDir = process.env.ANOTE_PRODUCTION_HOME || process.env.PROD_DIR;
    const configuredDir = localConfig.defaultProdDir;
    const source = requestedDir
        ? 'cli'
        : envDir
            ? 'env'
            : configuredDir
                ? 'config'
                : 'built-in';
    const selectedDir = requestedDir || envDir || configuredDir || DEFAULT_PROD_DIR;

    return {
        targetDir: path.resolve(process.cwd(), selectedDir),
        source,
        configPath: DEFAULT_CONFIG_PATH
    };
};

const maybePersistDefaultTargetDir = (args, targetDir) => {
    if (!hasFlag(args, 'dir-default', 'def')) {
        return false;
    }

    const requestedDir = getArgValue(args, 'target-dir', 'dir');
    if (!requestedDir) {
        throw new Error('Use --dir=<path> or --target-dir=<path> together with --dir-default');
    }

    const currentConfig = readLocalConfig();
    writeLocalConfig({
        ...currentConfig,
        defaultProdDir: targetDir
    });
    return true;
};

const resolveTargetContext = (command, args) => {
    const resolvedDir = resolveRequestedTargetDir(args);
    const dbArg = getArgValue(args, 'db');
    const verbose = hasFlag(args, 'verbose');
    const allowInPlace = hasFlag(args, 'allow-in-place');
    const targetDir = resolvedDir.targetDir;
    const dbPath = dbArg
        ? path.resolve(process.cwd(), dbArg)
        : path.join(targetDir, 'data', 'calendar.db');
    const repoRoot = path.resolve(__dirname, '..');
    const isShowCommand = command === 'show-default-dir';
    const requiresDatabase = command !== 'show-default-dir' && command !== 'set-default-dir';

    if (!isShowCommand && !allowInPlace && repoRoot === targetDir) {
        throw new Error(`Refusing to run production user ops from inside the target directory (${targetDir}). Run from the development repo or pass --allow-in-place.`);
    }

    if (!isShowCommand && !fs.existsSync(targetDir) && !dbArg) {
        throw new Error(`Production directory not found: ${targetDir}`);
    }

    if (requiresDatabase && !fs.existsSync(dbPath)) {
        throw new Error(`Database not found at ${dbPath}`);
    }

    const persistedAsDefault = maybePersistDefaultTargetDir(args, targetDir);

    return {
        targetDir,
        dbPath,
        verbose,
        logger: createLogger(verbose),
        targetDirSource: resolvedDir.source,
        configPath: resolvedDir.configPath,
        persistedAsDefault
    };
};

const tryLoadBetterSqlite = (targetDir) => {
    const candidates = [
        () => require('better-sqlite3'),
        () => require(path.join(targetDir, 'server', 'node_modules', 'better-sqlite3')),
        () => require(path.join(__dirname, '..', 'server', 'node_modules', 'better-sqlite3'))
    ];

    let lastError;
    for (const load of candidates) {
        try {
            return { Database: load(), error: null };
        } catch (error) {
            lastError = error;
        }
    }

    return { Database: null, error: lastError };
};

const openDatabase = (context) => {
    const { targetDir, dbPath, logger } = context;
    const betterSqlite = tryLoadBetterSqlite(targetDir);

    if (betterSqlite.Database) {
        try {
            const db = new betterSqlite.Database(dbPath);
            db.pragma('busy_timeout = 5000');
            return {
                mode: 'better-sqlite3',
                get: (sql) => db.prepare(sql).get(),
                all: (sql) => db.prepare(sql).all(),
                run: (sql) => db.prepare(sql).run(),
                exec: (sql) => db.exec(sql),
                close: () => db.close()
            };
        } catch (error) {
            if (!canUseSqliteCli()) {
                throw error;
            }

            logger.verbose(`better-sqlite3 failed for this Node.js runtime (${error.message}). Falling back to sqlite3 CLI.`);
        }
    } else if (!canUseSqliteCli()) {
        const dependencyError = betterSqlite.error?.message || 'better-sqlite3 could not be loaded';
        throw new Error(`${dependencyError}. sqlite3 CLI is also unavailable`);
    } else {
        logger.verbose('better-sqlite3 is unavailable for this Node.js runtime. Falling back to sqlite3 CLI.');
    }

    const sqliteBaseArgs = ['-cmd', '.timeout 5000'];
    return {
        mode: 'sqlite3-cli',
        get: (sql) => {
            const rows = parseJsonOutput(execFileSync('sqlite3', [...sqliteBaseArgs, '-json', dbPath, sql], { encoding: 'utf8' }));
            return rows[0];
        },
        all: (sql) => {
            return parseJsonOutput(execFileSync('sqlite3', [...sqliteBaseArgs, '-json', dbPath, sql], { encoding: 'utf8' }));
        },
        run: (sql) => {
            execFileSync('sqlite3', [...sqliteBaseArgs, dbPath, `${sql};`], { stdio: 'ignore' });
        },
        exec: (sql) => {
            execFileSync('sqlite3', [...sqliteBaseArgs, dbPath, sql], { stdio: 'ignore' });
        },
        close: () => {}
    };
};

const parseUserIdentifier = (args) => {
    const username = getArgValue(args, 'username');
    const userId = getArgValue(args, 'id');

    if ((!username && !userId) || (username && userId)) {
        throw new Error('Provide exactly one of --username or --id');
    }

    return username
        ? { field: 'username', value: username, label: `username '${username}'` }
        : { field: 'id', value: userId, label: `id '${userId}'` };
};

const getRoleRank = (role, fallback = 0) => {
    return ROLE_DEFINITIONS[role]?.rank ?? fallback;
};

const roleGrantsAdmin = (role, rank) => {
    if (ROLE_DEFINITIONS[role]) {
        return ROLE_DEFINITIONS[role].grantsAdmin;
    }

    return Number(rank) >= ROLE_DEFINITIONS.admin.rank;
};

const ensureUsersSchema = (db, requiredColumns) => {
    const usersTable = db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'");
    if (!usersTable) {
        throw new Error('users table not found');
    }

    const columns = db.all('PRAGMA table_info(users)');
    for (const columnName of requiredColumns) {
        if (!columns.some((column) => column.name === columnName)) {
            throw new Error(`users.${columnName} column not found`);
        }
    }
};

const ensureRoleHistorySchema = (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_role_events (
            event_index INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT UNIQUE NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL,
            role_rank INTEGER NOT NULL,
            action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
            changed_at INTEGER NOT NULL,
            source TEXT,
            note TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_user_role_events_user_event
            ON user_role_events(user_id, event_index);
    `);
};

const getUser = (db, identifier) => {
    return db.get(`
        SELECT id, username, is_admin
        FROM users
        WHERE ${identifier.field} = ${sqlLiteral(identifier.value)}
        LIMIT 1
    `);
};

const getRoleEvents = (db, userId) => {
    return db.all(`
        SELECT event_index, event_id, user_id, role, role_rank, action, changed_at, source, note
        FROM user_role_events
        WHERE user_id = ${sqlLiteral(userId)}
        ORDER BY event_index ASC
    `);
};

const insertRoleEvent = (db, userId, role, action, source, note) => {
    const eventId = crypto.randomUUID();
    const roleRank = getRoleRank(role);
    const changedAt = Date.now();

    db.run(`
        INSERT INTO user_role_events (event_id, user_id, role, role_rank, action, changed_at, source, note)
        VALUES (
            ${sqlLiteral(eventId)},
            ${sqlLiteral(userId)},
            ${sqlLiteral(role)},
            ${sqlLiteral(roleRank)},
            ${sqlLiteral(action)},
            ${sqlLiteral(changedAt)},
            ${sqlLiteral(source)},
            ${sqlLiteral(note || null)}
        )
    `);
};

const ensureSeededRoleHistory = (db, user, sourceBase) => {
    const countRow = db.get(`
        SELECT COUNT(*) AS count
        FROM user_role_events
        WHERE user_id = ${sqlLiteral(user.id)}
    `);

    if (Number(countRow?.count || 0) > 0) {
        return;
    }

    insertRoleEvent(db, user.id, 'user', 'grant', `${sourceBase}:seed`, 'Seeded from current users row');
    if (Number(user.is_admin) === 1) {
        insertRoleEvent(db, user.id, 'admin', 'grant', `${sourceBase}:seed`, 'Seeded from current users row');
    }
};

const resolveRoleState = (events) => {
    const activeRoles = new Map();

    for (const event of events) {
        const rank = Number(event.role_rank ?? getRoleRank(event.role));
        if (event.action === 'grant') {
            activeRoles.set(event.role, rank);
        } else if (event.action === 'revoke') {
            activeRoles.delete(event.role);
        }
    }

    if (!activeRoles.size) {
        activeRoles.set('user', ROLE_DEFINITIONS.user.rank);
    }

    let highestRole = { role: 'user', rank: ROLE_DEFINITIONS.user.rank };
    for (const [role, rank] of activeRoles.entries()) {
        if (rank > highestRole.rank) {
            highestRole = { role, rank };
        }
    }

    return {
        activeRoles: Array.from(activeRoles.entries())
            .map(([role, rank]) => ({ role, rank }))
            .sort((left, right) => right.rank - left.rank || left.role.localeCompare(right.role)),
        highestRole,
        isAdmin: roleGrantsAdmin(highestRole.role, highestRole.rank)
    };
};

const syncAdminFlag = (db, userId, roleState) => {
    db.run(`
        UPDATE users
        SET is_admin = ${roleState.isAdmin ? 1 : 0}
        WHERE id = ${sqlLiteral(userId)}
    `);
};

const ensureUsernameAvailable = (db, newUsername, currentUserId) => {
    const existingUser = db.get(`
        SELECT id
        FROM users
        WHERE username = ${sqlLiteral(newUsername)}
        LIMIT 1
    `);

    if (existingUser && existingUser.id !== currentUserId) {
        throw new Error(`Username '${newUsername}' is already in use`);
    }
};

const formatTimestamp = (value) => {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : String(value);
};

const runMakeAdmin = (db, args) => {
    const identifier = parseUserIdentifier(args);
    const note = getArgValue(args, 'note');

    ensureUsersSchema(db, ['username', 'is_admin']);
    ensureRoleHistorySchema(db);

    const user = getUser(db, identifier);
    if (!user) {
        throw new Error(`User with ${identifier.label} was not found in the database`);
    }

    ensureSeededRoleHistory(db, user, 'prod:user:make-admin');

    let roleState = resolveRoleState(getRoleEvents(db, user.id));
    if (roleState.activeRoles.some((role) => role.role === 'admin')) {
        syncAdminFlag(db, user.id, roleState);
        console.log(`User '${user.username}' is already an admin.`);
        return;
    }

    insertRoleEvent(db, user.id, 'admin', 'grant', 'prod:user:make-admin', note);
    roleState = resolveRoleState(getRoleEvents(db, user.id));
    syncAdminFlag(db, user.id, roleState);

    const updatedUser = db.get(`
        SELECT id, username
        FROM users
        WHERE id = ${sqlLiteral(user.id)}
        LIMIT 1
    `);

    console.log(`Successfully promoted '${updatedUser.username}' to admin.`);
};

const runRemoveAdmin = (db, args) => {
    const identifier = parseUserIdentifier(args);
    const note = getArgValue(args, 'note');

    ensureUsersSchema(db, ['username', 'is_admin']);
    ensureRoleHistorySchema(db);

    const user = getUser(db, identifier);
    if (!user) {
        throw new Error(`User with ${identifier.label} was not found in the database`);
    }

    ensureSeededRoleHistory(db, user, 'prod:user:remove-admin');

    let roleState = resolveRoleState(getRoleEvents(db, user.id));
    if (!roleState.activeRoles.some((role) => role.role === 'admin')) {
        syncAdminFlag(db, user.id, roleState);
        console.log(`User '${user.username}' is not currently an admin.`);
        return;
    }

    insertRoleEvent(db, user.id, 'admin', 'revoke', 'prod:user:remove-admin', note);
    roleState = resolveRoleState(getRoleEvents(db, user.id));
    syncAdminFlag(db, user.id, roleState);

    console.log(`Successfully reverted '${user.username}' from 'admin' to '${roleState.highestRole.role}'.`);
};

const runChangeUsername = (db, args) => {
    const identifier = parseUserIdentifier(args);
    const newUsername = getArgValue(args, 'new-username').trim();

    if (!newUsername) {
        throw new Error('Provide --new-username');
    }

    ensureUsersSchema(db, ['username']);

    const user = getUser(db, identifier);
    if (!user) {
        throw new Error(`User with ${identifier.label} was not found in the database`);
    }

    if (user.username === newUsername) {
        console.log(`User '${user.username}' already has that username.`);
        return;
    }

    ensureUsernameAvailable(db, newUsername, user.id);
    db.run(`
        UPDATE users
        SET username = ${sqlLiteral(newUsername)}
        WHERE id = ${sqlLiteral(user.id)}
    `);

    console.log(`Successfully changed username from '${user.username}' to '${newUsername}'.`);
};

const runHistory = (db, args) => {
    const identifier = parseUserIdentifier(args);

    ensureUsersSchema(db, ['username', 'is_admin']);
    ensureRoleHistorySchema(db);

    const user = getUser(db, identifier);
    if (!user) {
        throw new Error(`User with ${identifier.label} was not found in the database`);
    }

    ensureSeededRoleHistory(db, user, 'prod:user:history');

    const events = getRoleEvents(db, user.id);
    const roleState = resolveRoleState(events);

    console.log(`Role history for '${user.username}':`);
    for (const event of events) {
        const source = event.source ? ` source=${event.source}` : '';
        const note = event.note ? ` note=${event.note}` : '';
        console.log(`${event.event_index}. ${formatTimestamp(event.changed_at)} ${event.action} ${event.role} (rank ${event.role_rank})${source}${note}`);
    }
    console.log(`Current highest active role: ${roleState.highestRole.role}`);
    console.log(`Admin access: ${roleState.isAdmin ? 'yes' : 'no'}`);
};

const runShowDefaultDir = (_db, args, context) => {
    const localConfig = readLocalConfig();
    const configuredDir = localConfig.defaultProdDir ? path.resolve(localConfig.defaultProdDir) : null;

    console.log(`Resolved production directory: ${context.targetDir}`);
    console.log(`Resolution source: ${context.targetDirSource}`);
    if (configuredDir) {
        console.log(`Saved default directory: ${configuredDir}`);
        console.log(`Local config file: ${context.configPath}`);
    } else {
        console.log('Saved default directory: none');
        console.log(`Fallback built-in default: ${DEFAULT_PROD_DIR}`);
    }
};

const runSetDefaultDir = (_db, args, context) => {
    const requestedDir = getArgValue(args, 'target-dir', 'dir');
    if (!requestedDir) {
        throw new Error('Provide --dir=<path> or --target-dir=<path>');
    }

    if (!fs.existsSync(context.targetDir)) {
        throw new Error(`Production directory not found: ${context.targetDir}`);
    }

    const currentConfig = readLocalConfig();
    writeLocalConfig({
        ...currentConfig,
        defaultProdDir: context.targetDir
    });
    console.log(`Saved default production directory: ${context.targetDir}`);
    console.log(`Local config file: ${context.configPath}`);
};

const COMMANDS = {
    'make-admin': runMakeAdmin,
    'remove-admin': runRemoveAdmin,
    'change-username': runChangeUsername,
    history: runHistory,
    'show-default-dir': runShowDefaultDir,
    'set-default-dir': runSetDefaultDir
};

const runCli = (argv) => {
    const [command, ...args] = argv;
    if (!command || !COMMANDS[command]) {
        printUsage();
        process.exit(command ? 1 : 0);
    }

    let db;
    try {
        const context = resolveTargetContext(command, args);
        context.logger.verbose(`Target production directory: ${context.targetDir}`);
        context.logger.verbose(`Target directory source: ${context.targetDirSource}`);
        if (context.persistedAsDefault) {
            console.log(`Saved default production directory: ${context.targetDir}`);
            console.log(`Local config file: ${context.configPath}`);
        }
        context.logger.verbose(`Target database: ${context.dbPath}`);

        if (command === 'show-default-dir' || command === 'set-default-dir') {
            COMMANDS[command](null, args, context);
        } else {
            db = openDatabase(context);
            COMMANDS[command](db, args, context);
            db.close();
        }
        process.exit(0);
    } catch (error) {
        db?.close?.();
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

if (require.main === module) {
    runCli(process.argv.slice(2));
}

module.exports = { runCli };
