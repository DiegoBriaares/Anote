const express = require('express');

const { ApiError } = require('./http');

const PUBLIC_KEYS = Object.freeze([
    'app_title',
    'app_subtitle',
    'console_title',
    'config_version',
    'registration_enabled'
]);

const MUTABLE_KEYS = new Set(['app_title', 'app_subtitle', 'console_title', 'registration_enabled']);

const createConfigurationService = ({ db }) => {
    const read = () => {
        const placeholders = PUBLIC_KEYS.map(() => '?').join(',');
        const rows = db.prepare(`SELECT key, value FROM app_config WHERE key IN (${placeholders})`).all(...PUBLIC_KEYS);
        return Object.fromEntries(rows.map((row) => [row.key, row.value]));
    };

    const update = (input) => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'invalid_config');
        const expectedVersion = Number.parseInt(String(input.config_version ?? ''), 10);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new ApiError(428, 'config_revision_required');
        const entries = Object.entries(input).filter(([key]) => key !== 'config_version');
        if (entries.length === 0 || entries.some(([key]) => !MUTABLE_KEYS.has(key))) {
            throw new ApiError(400, 'invalid_config_key');
        }
        const normalized = entries.map(([key, rawValue]) => {
            if (key === 'registration_enabled') {
                if (rawValue !== true && rawValue !== false && rawValue !== 'true' && rawValue !== 'false') {
                    throw new ApiError(400, 'invalid_config_value');
                }
                return [key, rawValue === true || rawValue === 'true' ? 'true' : 'false'];
            }
            if (typeof rawValue !== 'string' || rawValue.length > 5000) throw new ApiError(400, 'invalid_config_value');
            if ((key === 'app_title' || key === 'console_title') && !rawValue.trim()) {
                throw new ApiError(400, 'invalid_config_value');
            }
            return [key, rawValue];
        });
        const write = db.prepare(`
            INSERT INTO app_config (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
        db.transaction(() => {
            const current = Number.parseInt(
                db.prepare("SELECT value FROM app_config WHERE key = 'config_version'").get()?.value || '0',
                10
            );
            if (current !== expectedVersion) {
                throw new ApiError(409, 'config_conflict', { currentVersion: current });
            }
            for (const [key, value] of normalized) write.run(key, value);
            const changed = db.prepare(`
                UPDATE app_config SET value = ?
                WHERE key = 'config_version' AND value = ?
            `).run(String(current + 1), String(current));
            if (changed.changes !== 1) throw new ApiError(409, 'config_conflict');
        }).immediate();
        return read();
    };

    return { read, update };
};

const createConfigurationRouter = ({ service, authenticate, requireAdmin }) => {
    const router = express.Router();
    router.get('/config', (_req, res) => res.json({ message: 'success', data: service.read() }));
    router.put('/admin/config', authenticate, requireAdmin, (req, res, next) => {
        try {
            res.json({ message: 'success', data: service.update(req.body?.config) });
        } catch (error) {
            next(error);
        }
    });
    return router;
};

module.exports = { createConfigurationRouter, createConfigurationService, PUBLIC_KEYS };
