const crypto = require('crypto');
const bcrypt = require('bcrypt');
const express = require('express');

const { ApiError } = require('./http');

const { PASSWORD_MIN_LENGTH, createUserService } = require('./users');

const DUMMY_PASSWORD_HASH = '$2b$12$PRr/5eo0pR6.av68dr6Wce/3a0lpDLHlc4BpVPnO2ar9FOj8shkiu';

const parseCookies = (header) => {
    if (!header) return {};
    return Object.fromEntries(header.split(';').map((item) => {
        const separator = item.indexOf('=');
        if (separator < 0) return [item.trim(), ''];
        try {
            return [item.slice(0, separator).trim(), decodeURIComponent(item.slice(separator + 1).trim())];
        } catch {
            return [item.slice(0, separator).trim(), ''];
        }
    }));
};

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

const userDto = (row) => {
    let preferences = {};
    try {
        const parsed = row.preferences ? JSON.parse(row.preferences) : {};
        preferences = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        preferences = {};
    }
    return {
        id: row.id,
        username: row.username,
        isAdmin: row.is_admin === 1,
        avatarUrl: row.avatar_url || null,
        preferences
    };
};

const sessionCookie = (config, req, token, maxAge) => {
    const attributes = [
        `${config.sessionCookieName}=${token ? encodeURIComponent(token) : ''}`,
        'Path=/api',
        'HttpOnly',
        'SameSite=Strict',
        `Max-Age=${maxAge}`
    ];
    if (config.secureCookies || req.secure) attributes.push('Secure');
    return attributes.join('; ');
};

const createSessionService = ({ db, config, now = () => new Date() }) => {
    const create = (userId, userAgent) => {
        const token = crypto.randomBytes(32).toString('base64url');
        const createdAt = now();
        const idleExpiry = new Date(createdAt.getTime() + config.sessionIdleSeconds * 1000);
        const absoluteExpiry = new Date(createdAt.getTime() + config.sessionAbsoluteSeconds * 1000);
        db.prepare('DELETE FROM sessions WHERE idle_expires_at <= ? OR absolute_expires_at <= ?')
            .run(createdAt.toISOString(), createdAt.toISOString());
        db.prepare(`
            INSERT INTO sessions (
                id, token_hash, user_id, created_at, last_seen_at,
                idle_expires_at, absolute_expires_at, user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            crypto.randomUUID(),
            tokenHash(token),
            userId,
            createdAt.toISOString(),
            createdAt.toISOString(),
            idleExpiry.toISOString(),
            absoluteExpiry.toISOString(),
            typeof userAgent === 'string' ? userAgent.slice(0, 512) : null
        );
        return token;
    };

    const read = (token) => {
        if (!token || token.length > 256) return null;
        const row = db.prepare(`
            SELECT s.id AS session_id, s.last_seen_at, s.idle_expires_at,
                   s.absolute_expires_at, u.id, u.username, u.is_admin,
                   u.avatar_url, u.preferences
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
        `).get(tokenHash(token));
        if (!row) return null;
        const current = now();
        const idleExpiry = Date.parse(row.idle_expires_at);
        const absoluteExpiry = Date.parse(row.absolute_expires_at);
        const lastSeen = Date.parse(row.last_seen_at);
        if (!Number.isFinite(idleExpiry) || !Number.isFinite(absoluteExpiry) || !Number.isFinite(lastSeen)
            || idleExpiry <= current.getTime() || absoluteExpiry <= current.getTime()) {
            db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
            return null;
        }
        if (current.getTime() - lastSeen >= 5 * 60 * 1000) {
            const nextIdleExpiry = new Date(Math.min(
                current.getTime() + config.sessionIdleSeconds * 1000,
                absoluteExpiry
            ));
            db.prepare('UPDATE sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?')
                .run(current.toISOString(), nextIdleExpiry.toISOString(), row.session_id);
        }
        return { sessionId: row.session_id, user: userDto(row) };
    };

    const remove = (token) => {
        if (!token || token.length > 256) return;
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    };

    return { create, read, remove };
};

const createAuth = ({ db, config, now, userService, comparePassword = bcrypt.compare }) => {
    const sessions = createSessionService({ db, config, now });
    const users = userService || createUserService({ db });
    const cookieToken = (req) => parseCookies(req.get('cookie'))[config.sessionCookieName];
    const expireSessionCookie = (req, res) => {
        res.set('Set-Cookie', sessionCookie(config, req, '', 0));
    };

    const authenticate = (req, _res, next) => {
        const session = sessions.read(cookieToken(req));
        if (!session) return next(new ApiError(401, 'authentication_required'));
        req.user = session.user;
        req.sessionId = session.sessionId;
        next();
    };

    const requireAdmin = (req, _res, next) => {
        if (!req.user?.isAdmin) return next(new ApiError(403, 'admin_required'));
        next();
    };

    const loginFailures = new Map();
    const registrationAttempts = new Map();
    const evict = (entries, current) => {
        for (const [key, entry] of entries) {
            if (entry.resetAt <= current) entries.delete(key);
        }
        while (entries.size >= 5000) entries.delete(entries.keys().next().value);
    };
    const loginKey = (req) => `${req.ip}:${String(req.body?.username || '').trim().toLocaleLowerCase()}`;
    const checkLoginLimit = (req, _res, next) => {
        const current = Date.now();
        const entry = loginFailures.get(loginKey(req));
        if (entry && entry.resetAt > current && entry.count >= 5) {
            return next(new ApiError(429, 'rate_limited', {
                retryAfterSeconds: Math.ceil((entry.resetAt - current) / 1000)
            }));
        }
        if (entry?.resetAt <= current) loginFailures.delete(loginKey(req));
        next();
    };
    const recordLoginFailure = (req) => {
        const key = loginKey(req);
        const current = Date.now();
        if (!loginFailures.has(key)) evict(loginFailures, current);
        const entry = loginFailures.get(key);
        loginFailures.set(key, !entry || entry.resetAt <= current
            ? { count: 1, resetAt: current + 15 * 60 * 1000 }
            : { ...entry, count: entry.count + 1 });
    };
    const clearLoginFailures = (req) => loginFailures.delete(loginKey(req));
    const recordRegistrationAttempt = (req) => {
        const key = req.ip;
        const current = Date.now();
        if (!registrationAttempts.has(key)) evict(registrationAttempts, current);
        const entry = registrationAttempts.get(key);
        if (entry && entry.resetAt > current && entry.count >= 3) {
            throw new ApiError(429, 'rate_limited', {
                retryAfterSeconds: Math.ceil((entry.resetAt - current) / 1000)
            });
        }
        registrationAttempts.set(key, !entry || entry.resetAt <= current
            ? { count: 1, resetAt: current + 60 * 60 * 1000 }
            : { ...entry, count: entry.count + 1 });
    };
    const registrationEnabled = () => db.prepare(`
        SELECT 1 FROM app_config WHERE key = 'registration_enabled' AND value = 'true'
    `).get() !== undefined;
    const register = async ({ username, password, userAgent }) => {
        if (!registrationEnabled()) throw new ApiError(403, 'registration_disabled');
        const prepared = await users.prepareCreate({ username, password, isAdmin: false });
        return db.transaction(() => {
            if (!registrationEnabled()) throw new ApiError(403, 'registration_disabled');
            const user = users.insertPrepared(prepared);
            const token = sessions.create(user.id, userAgent);
            return { token, user };
        }).immediate();
    };
    const login = async ({ username, password, userAgent }) => {
        const candidates = db.prepare(`
            SELECT id, username, password, is_admin, avatar_url, preferences
            FROM users WHERE username = ? COLLATE NOCASE
            ORDER BY username
        `).all(username);
        const candidate = candidates.find((item) => item.username === username)
            || (candidates.length === 1 ? candidates[0] : null);
        const matched = await comparePassword(password, candidate?.password || DUMMY_PASSWORD_HASH);
        if (!candidate || !matched) throw new ApiError(401, 'invalid_credentials');
        return db.transaction(() => {
            const current = db.prepare(`
                SELECT id, username, password, is_admin, avatar_url, preferences
                FROM users WHERE id = ? AND password = ?
            `).get(candidate.id, candidate.password);
            if (!current) throw new ApiError(401, 'invalid_credentials');
            return { token: sessions.create(current.id, userAgent), user: userDto(current) };
        }).immediate();
    };
    const router = express.Router();

    router.post('/register', async (req, res, next) => {
        try {
            if (!registrationEnabled()) throw new ApiError(403, 'registration_disabled');
            recordRegistrationAttempt(req);
            const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
            const password = req.body?.password;
            try {
                const { token, user } = await register({
                    username,
                    password,
                    userAgent: req.get('user-agent')
                });
                res.set('Set-Cookie', sessionCookie(config, req, token, config.sessionAbsoluteSeconds));
                res.status(201).json({ message: 'success', user });
            } catch (error) {
                if (error instanceof ApiError && ['USERNAME_UNAVAILABLE', 'INVALID_USERNAME'].includes(error.code)) {
                    throw new ApiError(400, 'registration_rejected');
                }
                throw error;
            }
        } catch (error) {
            next(error);
        }
    });

    router.post('/login', checkLoginLimit, async (req, res, next) => {
        try {
            const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
            const password = req.body?.password;
            if (!username || typeof password !== 'string') {
                recordLoginFailure(req);
                throw new ApiError(401, 'invalid_credentials');
            }
            let authenticated;
            try {
                authenticated = await login({
                    username,
                    password,
                    userAgent: req.get('user-agent')
                });
            } catch (error) {
                if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
                    recordLoginFailure(req);
                }
                throw error;
            }
            clearLoginFailures(req);
            res.set('Set-Cookie', sessionCookie(
                config,
                req,
                authenticated.token,
                config.sessionAbsoluteSeconds
            ));
            res.json({ message: 'success', user: authenticated.user });
        } catch (error) {
            next(error);
        }
    });

    router.get('/session', authenticate, (req, res) => res.json({ user: req.user }));

    router.post('/logout', (req, res) => {
        sessions.remove(cookieToken(req));
        expireSessionCookie(req, res);
        res.json({ message: 'success' });
    });

    return { authenticate, expireSessionCookie, login, register, requireAdmin, router, sessions };
};

module.exports = { PASSWORD_MIN_LENGTH, createAuth, createSessionService, parseCookies, tokenHash, userDto };
