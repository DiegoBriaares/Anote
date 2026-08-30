const express = require('express');

const { ApiError } = require('./http');

const createNoteService = ({ db, now = () => new Date() }) => {
    const assertOwnedEvent = (ownerId, eventId) => {
        if (!db.prepare('SELECT 1 FROM events WHERE id = ? AND user_id = ?').get(eventId, ownerId)) {
            throw new ApiError(404, 'event_not_found');
        }
    };

    const list = (ownerId, eventId) => {
        assertOwnedEvent(ownerId, eventId);
        return db.prepare(`
            SELECT event_id, role_id, content, updated_at
            FROM event_notes
            WHERE event_id = ? AND owner_user_id = ?
            ORDER BY role_id
        `).all(eventId, ownerId);
    };

    const save = (ownerId, eventId, { roleId, content } = {}) => {
        assertOwnedEvent(ownerId, eventId);
        if (typeof roleId !== 'string' || !roleId
            || !db.prepare('SELECT 1 FROM roles WHERE id = ? AND user_id = ?').get(roleId, ownerId)) {
            throw new ApiError(404, 'role_not_found');
        }
        if (typeof content !== 'string' || content.length > 250_000) {
            throw new ApiError(400, 'invalid_note');
        }
        db.prepare(`
            INSERT INTO event_notes (event_id, role_id, owner_user_id, content, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(event_id, role_id) DO UPDATE
            SET content = excluded.content, updated_at = excluded.updated_at
        `).run(eventId, roleId, ownerId, content, now().getTime());
    };

    return { list, save };
};

const createNotesRouter = ({ service, authenticate }) => {
    const router = express.Router();
    router.get('/events/:eventId/notes', authenticate, (req, res, next) => {
        try {
            res.json({ message: 'success', data: service.list(req.user.id, req.params.eventId) });
        } catch (error) {
            next(error);
        }
    });
    router.post('/events/:eventId/notes', authenticate, (req, res, next) => {
        try {
            service.save(req.user.id, req.params.eventId, req.body);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    return router;
};

module.exports = { createNoteService, createNotesRouter };
