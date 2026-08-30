const crypto = require('crypto');
const bcrypt = require('bcrypt');
const express = require('express');

const { ApiError } = require('./http');

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_BYTES = 72;

const validateUsername = (value) => {
    const username = typeof value === 'string' ? value.trim() : '';
    if (!username || username.length > 80) throw new ApiError(400, 'invalid_username');
    return username;
};

const validatePassword = (value) => {
    if (typeof value !== 'string' || [...value].length < PASSWORD_MIN_LENGTH) {
        throw new ApiError(400, 'password_too_short', { minimumLength: PASSWORD_MIN_LENGTH });
    }
    if (Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_BYTES) {
        throw new ApiError(400, 'password_too_long', { maximumBytes: PASSWORD_MAX_BYTES });
    }
    return value;
};

const parsePreferences = (value) => {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};

const profileDto = (row) => ({
    id: row.id,
    username: row.username,
    avatar_url: row.avatar_url || null,
    preferences: parsePreferences(row.preferences),
    isAdmin: row.is_admin === 1
});

const createUserService = ({ db }) => {
    const usernameIsUnavailable = (username, exceptId = null) => db.prepare(`
        SELECT 1 FROM users
        WHERE username = ? COLLATE NOCASE AND (? IS NULL OR id != ?)
        LIMIT 1
    `).get(username, exceptId, exceptId) !== undefined;

    const profile = (id) => {
        const row = db.prepare('SELECT id, username, avatar_url, preferences, is_admin FROM users WHERE id = ?').get(id);
        if (!row) throw new ApiError(401, 'authentication_required');
        return profileDto(row);
    };

    const directory = (id) => db.prepare(`
        SELECT id, username, avatar_url
        FROM users WHERE id != ?
        ORDER BY username COLLATE NOCASE
    `).all(id);

    const create = async ({ username: rawUsername, password: rawPassword, isAdmin = false }) => {
        const username = validateUsername(rawUsername);
        const password = validatePassword(rawPassword);
        const hash = await bcrypt.hash(password, 12);
        const id = crypto.randomUUID();
        if (usernameIsUnavailable(username)) throw new ApiError(409, 'username_unavailable');
        try {
            db.prepare('INSERT INTO users (id, username, password, is_admin, preferences) VALUES (?, ?, ?, ?, ?)')
                .run(id, username, hash, isAdmin ? 1 : 0, '{}');
        } catch (error) {
            if (error.code?.startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'username_unavailable');
            throw error;
        }
        return { id, username, isAdmin, avatarUrl: null, preferences: {} };
    };

    const bootstrapAdministrator = async ({ username: rawUsername, password: rawPassword }) => {
        const username = validateUsername(rawUsername);
        const password = validatePassword(rawPassword);
        const hash = await bcrypt.hash(password, 12);
        const createFirst = db.transaction(() => {
            if (db.prepare('SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1').get()) {
                throw new ApiError(409, 'administrator_already_exists');
            }
            if (usernameIsUnavailable(username)) throw new ApiError(409, 'username_unavailable');
            const id = crypto.randomUUID();
            try {
                db.prepare('INSERT INTO users (id, username, password, is_admin, preferences) VALUES (?, ?, ?, 1, ?)')
                    .run(id, username, hash, '{}');
            } catch (error) {
                if (error.code?.startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'username_unavailable');
                throw error;
            }
            db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('registration_enabled', 'false')").run();
            return { id, username, isAdmin: true, avatarUrl: null, preferences: {} };
        });
        return createFirst.immediate();
    };

    const update = async (id, changes) => {
        const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!existing) throw new ApiError(404, 'user_not_found');
        const username = changes.username === undefined ? existing.username : validateUsername(changes.username);
        const nextAdmin = changes.isAdmin === undefined ? existing.is_admin === 1 : changes.isAdmin === true;
        if (existing.is_admin === 1 && !nextAdmin
            && db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get().count <= 1) {
            throw new ApiError(409, 'last_admin_required');
        }
        let passwordHash = existing.password;
        if (changes.password !== undefined) {
            passwordHash = await bcrypt.hash(validatePassword(changes.password), 12);
        }
        try {
            db.transaction(() => {
                if (usernameIsUnavailable(username, id)) throw new ApiError(409, 'username_unavailable');
                db.prepare('UPDATE users SET username = ?, password = ?, is_admin = ? WHERE id = ?')
                    .run(username, passwordHash, nextAdmin ? 1 : 0, id);
                if (changes.password !== undefined || (existing.is_admin === 1 && !nextAdmin)) {
                    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
                }
            }).immediate();
        } catch (error) {
            if (error.code?.startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'username_unavailable');
            throw error;
        }
    };

    const updateProfile = (id, changes = {}) => {
        const current = db.prepare('SELECT username, avatar_url, preferences FROM users WHERE id = ?').get(id);
        if (!current) throw new ApiError(401, 'authentication_required');
        const username = changes.username === undefined ? current.username : validateUsername(changes.username);
        const avatarUrl = changes.avatar_url;
        if (avatarUrl !== undefined && avatarUrl !== null
            && (typeof avatarUrl !== 'string' || !/^\/attachments\/[0-9a-f-]{36}$/.test(avatarUrl))) {
            throw new ApiError(400, 'invalid_avatar');
        }
        if (typeof avatarUrl === 'string') {
            const attachmentId = avatarUrl.slice('/attachments/'.length);
            if (!db.prepare("SELECT 1 FROM attachments WHERE id = ? AND owner_user_id = ? AND purpose = 'avatar'")
                .get(attachmentId, id)) {
                throw new ApiError(400, 'invalid_avatar');
            }
        }
        let preferences = parsePreferences(current.preferences);
        if (changes.preferences !== undefined) {
            if (!changes.preferences || typeof changes.preferences !== 'object' || Array.isArray(changes.preferences)) {
                throw new ApiError(400, 'invalid_preferences');
            }
            preferences = { ...changes.preferences };
        }
        delete preferences.programs;
        if (JSON.stringify(preferences).length > 100_000) throw new ApiError(400, 'preferences_too_large');
        try {
            if (usernameIsUnavailable(username, id)) throw new ApiError(409, 'username_unavailable');
            db.prepare('UPDATE users SET username = ?, avatar_url = ?, preferences = ? WHERE id = ?').run(
                username,
                avatarUrl === undefined ? current.avatar_url : avatarUrl,
                JSON.stringify(preferences),
                id
            );
        } catch (error) {
            if (error.code?.startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'username_unavailable');
            throw error;
        }
    };

    return { bootstrapAdministrator, create, directory, profile, update, updateProfile };
};

const createUsersRouter = ({ service, authenticate }) => {
    const router = express.Router();
    router.get('/me', authenticate, (req, res, next) => {
        try {
            res.json({ message: 'success', data: service.profile(req.user.id) });
        } catch (error) {
            next(error);
        }
    });
    router.put('/me', authenticate, (req, res, next) => {
        try {
            service.updateProfile(req.user.id, req.body);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    router.get('/users', authenticate, (req, res) => {
        res.json({ message: 'success', data: service.directory(req.user.id) });
    });
    return router;
};

module.exports = {
    PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_BYTES,
    createUserService,
    createUsersRouter,
    parsePreferences,
    profileDto,
    validatePassword,
    validateUsername
};
