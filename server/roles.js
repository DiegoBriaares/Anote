const crypto = require('crypto');
const express = require('express');

const { ApiError } = require('./http');

const normalizeLabel = (value, code) => {
    const label = typeof value === 'string' ? value.trim() : '';
    if (!label || label.length > 120) throw new ApiError(400, code);
    return label;
};

const normalizeColor = (value) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 64) throw new ApiError(400, 'invalid_color');
    return value;
};

const createRoleService = ({ db }) => {
    const list = (ownerId) => db.prepare(`
        SELECT * FROM roles WHERE user_id = ?
        ORDER BY order_index, label COLLATE NOCASE
    `).all(ownerId);

    const create = (ownerId, input = {}) => {
        const nextOrder = (db.prepare('SELECT MAX(order_index) AS value FROM roles WHERE user_id = ?')
            .get(ownerId).value ?? -1) + 1;
        const row = {
            id: crypto.randomUUID(),
            user_id: ownerId,
            label: normalizeLabel(input.label, 'invalid_role'),
            color: normalizeColor(input.color),
            is_enabled: 1,
            order_index: nextOrder
        };
        db.prepare('INSERT INTO roles (id, user_id, label, color, order_index) VALUES (?, ?, ?, ?, ?)')
            .run(row.id, row.user_id, row.label, row.color, row.order_index);
        return row;
    };

    const update = (ownerId, id, input = {}) => {
        const current = db.prepare('SELECT * FROM roles WHERE id = ? AND user_id = ?').get(id, ownerId);
        if (!current) throw new ApiError(404, 'role_not_found');
        const result = db.prepare(`
            UPDATE roles SET label = ?, color = ?, is_enabled = ?
            WHERE id = ? AND user_id = ?
        `).run(
            normalizeLabel(input.label, 'invalid_role'),
            normalizeColor(input.color),
            input.is_enabled === undefined ? current.is_enabled : input.is_enabled ? 1 : 0,
            id,
            ownerId
        );
        if (result.changes !== 1) throw new ApiError(404, 'role_not_found');
    };

    const remove = (ownerId, id) => {
        const removed = db.transaction(() => {
            db.prepare('DELETE FROM subroles WHERE role_id = ? AND user_id = ?').run(id, ownerId);
            return db.prepare('DELETE FROM roles WHERE id = ? AND user_id = ?').run(id, ownerId).changes;
        }).immediate();
        if (removed !== 1) throw new ApiError(404, 'role_not_found');
    };

    const reorder = (ownerId, orderedIds) => {
        if (!Array.isArray(orderedIds) || orderedIds.length === 0 || orderedIds.length > 1000
            || orderedIds.some((id) => typeof id !== 'string' || !id.trim())
            || new Set(orderedIds).size !== orderedIds.length) {
            throw new ApiError(400, 'invalid_ids');
        }
        const total = db.prepare('SELECT COUNT(*) AS count FROM roles WHERE user_id = ?').get(ownerId).count;
        const placeholders = orderedIds.map(() => '?').join(',');
        const owned = db.prepare(`
            SELECT COUNT(*) AS count FROM roles
            WHERE user_id = ? AND id IN (${placeholders})
        `).get(ownerId, ...orderedIds).count;
        if (owned !== orderedIds.length || total !== orderedIds.length) throw new ApiError(409, 'role_order_conflict');
        const write = db.prepare('UPDATE roles SET order_index = ? WHERE id = ? AND user_id = ?');
        db.transaction(() => orderedIds.forEach((id, index) => write.run(index, id, ownerId))).immediate();
    };

    const listSubroles = (ownerId) => db.prepare(`
        SELECT * FROM subroles WHERE user_id = ?
        ORDER BY role_id, order_index, label COLLATE NOCASE
    `).all(ownerId);

    const createSubrole = (ownerId, roleId, input = {}) => {
        if (!db.prepare('SELECT 1 FROM roles WHERE id = ? AND user_id = ?').get(roleId, ownerId)) {
            throw new ApiError(404, 'role_not_found');
        }
        const nextOrder = (db.prepare(`
            SELECT MAX(order_index) AS value FROM subroles
            WHERE user_id = ? AND role_id = ?
        `).get(ownerId, roleId).value ?? -1) + 1;
        const row = {
            id: crypto.randomUUID(),
            role_id: roleId,
            user_id: ownerId,
            label: normalizeLabel(input.label, 'invalid_subrole'),
            color: normalizeColor(input.color),
            is_enabled: 1,
            order_index: nextOrder
        };
        db.prepare(`
            INSERT INTO subroles (id, role_id, user_id, label, color, order_index)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(row.id, row.role_id, row.user_id, row.label, row.color, row.order_index);
        return row;
    };

    const updateSubrole = (ownerId, id, input = {}) => {
        const current = db.prepare('SELECT * FROM subroles WHERE id = ? AND user_id = ?').get(id, ownerId);
        if (!current) throw new ApiError(404, 'subrole_not_found');
        const result = db.prepare(`
            UPDATE subroles SET label = ?, color = ?, is_enabled = ?
            WHERE id = ? AND user_id = ?
        `).run(
            normalizeLabel(input.label, 'invalid_subrole'),
            normalizeColor(input.color),
            input.is_enabled === undefined ? current.is_enabled : input.is_enabled ? 1 : 0,
            id,
            ownerId
        );
        if (result.changes !== 1) throw new ApiError(404, 'subrole_not_found');
    };

    const removeSubrole = (ownerId, id) => {
        const result = db.prepare('DELETE FROM subroles WHERE id = ? AND user_id = ?').run(id, ownerId);
        if (result.changes !== 1) throw new ApiError(404, 'subrole_not_found');
    };

    return { create, createSubrole, list, listSubroles, remove, removeSubrole, reorder, update, updateSubrole };
};

const createRolesRouter = ({ service, authenticate }) => {
    const router = express.Router();
    router.get('/roles', authenticate, (req, res) => res.json({ message: 'success', data: service.list(req.user.id) }));
    router.post('/roles', authenticate, (req, res, next) => {
        try {
            res.status(201).json({ message: 'success', data: service.create(req.user.id, req.body) });
        } catch (error) {
            next(error);
        }
    });
    router.put('/roles/:id', authenticate, (req, res, next) => {
        try {
            service.update(req.user.id, req.params.id, req.body);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    router.delete('/roles/:id', authenticate, (req, res, next) => {
        try {
            service.remove(req.user.id, req.params.id);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    router.post('/roles/reorder', authenticate, (req, res, next) => {
        try {
            service.reorder(req.user.id, req.body?.orderedIds);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    router.get('/subroles', authenticate, (req, res) => res.json({ message: 'success', data: service.listSubroles(req.user.id) }));
    router.post('/roles/:roleId/subroles', authenticate, (req, res, next) => {
        try {
            res.status(201).json({ message: 'success', data: service.createSubrole(req.user.id, req.params.roleId, req.body) });
        } catch (error) {
            next(error);
        }
    });
    router.put('/subroles/:id', authenticate, (req, res, next) => {
        try {
            service.updateSubrole(req.user.id, req.params.id, req.body);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    router.delete('/subroles/:id', authenticate, (req, res, next) => {
        try {
            service.removeSubrole(req.user.id, req.params.id);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    return router;
};

module.exports = { createRoleService, createRolesRouter, normalizeColor, normalizeLabel };
