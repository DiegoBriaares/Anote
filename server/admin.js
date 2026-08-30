const express = require('express');

const { ApiError } = require('./http');

const orderedFriendIds = (first, second) => first < second ? [first, second] : [second, first];

const validateIdList = (value, { maximum = 1000 } = {}) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > maximum
        || value.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new ApiError(400, 'invalid_ids');
    }
    const ids = [...new Set(value.map((item) => item.trim()))];
    if (ids.length === 0) throw new ApiError(400, 'invalid_ids');
    return ids;
};

const createAdminService = ({
    db,
    eventService,
    userService,
    retireAttachments = (_collectCandidates, mutate) => db.transaction(mutate).immediate()
}) => {
    const listUsers = () => db.prepare(`
        SELECT u.id, u.username, u.is_admin AS isAdmin, u.avatar_url AS avatarUrl,
               COUNT(e.id) AS eventCount
        FROM users u LEFT JOIN events e ON e.user_id = u.id
        GROUP BY u.id ORDER BY u.username COLLATE NOCASE
    `).all().map((row) => ({ ...row, isAdmin: row.isAdmin === 1 }));

    const createUser = (input) => userService.create({
        username: input?.username,
        password: input?.password,
        isAdmin: input?.isAdmin === true
    });

    const updateUser = (id, input) => userService.update(id, input || {});

    const removeUsers = (actorId, rawIds) => {
        const ids = validateIdList(rawIds);
        if (ids.includes(actorId)) throw new ApiError(400, 'cannot_delete_current_user');
        const placeholders = ids.map(() => '?').join(',');
        return retireAttachments(
            () => db.prepare(`SELECT * FROM attachments WHERE owner_user_id IN (${placeholders})`).all(...ids),
            () => {
                const existing = db.prepare(`SELECT id, is_admin FROM users WHERE id IN (${placeholders})`).all(...ids);
                if (existing.length !== ids.length) throw new ApiError(404, 'user_not_found');
                const adminsRemoved = existing.filter((row) => row.is_admin === 1).length;
                const adminsTotal = db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get().count;
                if (adminsRemoved > 0 && adminsRemoved >= adminsTotal) throw new ApiError(409, 'last_admin_required');

                db.prepare(`DELETE FROM event_notes WHERE owner_user_id IN (${placeholders})`).run(...ids);
                for (const table of [
                    'attachments', 'program_runs', 'programs', 'sessions', 'subroles', 'roles',
                    'daily_facts_v2', 'day_backgrounds_v2', 'postponed_events', 'events', 'user_role_events'
                ]) {
                    const ownerColumn = ['attachments', 'programs', 'program_runs'].includes(table)
                        ? 'owner_user_id'
                        : 'user_id';
                    db.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} IN (${placeholders})`).run(...ids);
                }
                db.prepare(`DELETE FROM friendships WHERE user_a IN (${placeholders}) OR user_b IN (${placeholders})`)
                    .run(...ids, ...ids);
                return db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...ids).changes;
            },
        );
    };

    const listEvents = (userId) => {
        const where = userId ? 'WHERE e.user_id = ?' : '';
        return db.prepare(`
            SELECT e.id, e.title, e.date, e.start_time AS startTime,
                   e.completed, e.failed, e.user_id AS userId,
                   e.revision, e.revision AS version, u.username
            FROM events e JOIN users u ON u.id = e.user_id ${where}
            ORDER BY e.date, e.start_time, e.title
        `).all(...(userId ? [userId] : []));
    };

    const listRoles = () => db.prepare(`
        SELECT r.id, r.label, r.color, r.is_enabled AS isEnabled,
               r.order_index AS orderIndex, u.username
        FROM roles r JOIN users u ON u.id = r.user_id
        ORDER BY u.username COLLATE NOCASE, r.order_index, r.id
    `).all().map((row) => ({ ...row, isEnabled: row.isEnabled === 1 }));

    const createEvent = (input) => {
        if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(input?.userId)) {
            throw new ApiError(404, 'user_not_found');
        }
        return eventService.createMany(input.userId, [input])[0];
    };

    const updateEvent = (id, input) => {
        const event = db.prepare('SELECT user_id FROM events WHERE id = ?').get(id);
        if (!event) throw new ApiError(404, 'event_not_found');
        return eventService.update(
            event.user_id,
            id,
            input,
            Number(input?.revision ?? input?.version)
        );
    };

    const removeEvents = (rawEvents) => {
        if (!Array.isArray(rawEvents) || rawEvents.length === 0 || rawEvents.length > 1000) {
            throw new ApiError(400, 'invalid_events');
        }
        const events = rawEvents.map((event) => ({ id: event?.id, revision: Number(event?.revision) }));
        if (events.some((event) => typeof event.id !== 'string' || !event.id
            || !Number.isInteger(event.revision) || event.revision < 1)
            || new Set(events.map((event) => event.id)).size !== events.length) {
            throw new ApiError(400, 'invalid_events');
        }
        const select = db.prepare('SELECT user_id FROM events WHERE id = ?');
        const remove = db.prepare('DELETE FROM events WHERE id = ? AND user_id = ? AND revision = ?');
        const eventPlaceholders = events.map(() => '?').join(',');
        return retireAttachments(
            () => db.prepare(`SELECT * FROM attachments WHERE event_id IN (${eventPlaceholders})`)
                .all(...events.map((event) => event.id)),
            () => {
                let deleted = 0;
                for (const event of events) {
                    const existing = select.get(event.id);
                    if (!existing
                        || remove.run(event.id, existing.user_id, event.revision).changes !== 1) {
                        throw new ApiError(409, 'event_conflict_or_missing');
                    }
                    deleted += 1;
                }
                return deleted;
            },
        );
    };

    const removeEvent = (id, revision) => {
        const event = db.prepare('SELECT user_id FROM events WHERE id = ?').get(id);
        if (!event) throw new ApiError(404, 'event_not_found');
        eventService.remove(event.user_id, id, Number(revision));
    };

    const listFriendships = () => db.prepare(`
        SELECT f.user_a AS userA, f.user_b AS userB,
               ua.username AS userAName, ub.username AS userBName
        FROM friendships f JOIN users ua ON ua.id = f.user_a JOIN users ub ON ub.id = f.user_b
        ORDER BY ua.username, ub.username
    `).all();

    const createFriendship = (userA, userB) => {
        const [first, second] = orderedFriendIds(userA, userB);
        if (!first || first === second) throw new ApiError(400, 'invalid_friendship');
        if (db.prepare('SELECT COUNT(*) AS count FROM users WHERE id IN (?, ?)').get(first, second).count !== 2) {
            throw new ApiError(404, 'user_not_found');
        }
        db.prepare('INSERT OR IGNORE INTO friendships (user_a, user_b) VALUES (?, ?)').run(first, second);
    };

    const removeFriendship = (userA, userB) => {
        const [first, second] = orderedFriendIds(userA, userB);
        const result = db.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').run(first, second);
        if (result.changes !== 1) throw new ApiError(404, 'friendship_not_found');
    };

    return {
        createEvent,
        createFriendship,
        createUser,
        listEvents,
        listFriendships,
        listRoles,
        listUsers,
        removeEvent,
        removeEvents,
        removeFriendship,
        removeUsers,
        updateEvent,
        updateUser
    };
};

const createAdminRouter = ({ service, authenticate, requireAdmin }) => {
    const router = express.Router();
    router.use('/admin', authenticate, requireAdmin);

    router.get('/admin/users', (_req, res) => res.json({ message: 'success', data: service.listUsers() }));
    router.post('/admin/users', async (req, res, next) => {
        try {
            res.status(201).json({ message: 'success', data: await service.createUser(req.body) });
        } catch (error) {
            next(error);
        }
    });
    router.put('/admin/users/:id', async (req, res, next) => {
        try {
            await service.updateUser(req.params.id, req.body);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    router.delete('/admin/users/bulk', (req, res, next) => {
        try {
            res.json({ message: 'success', deleted: service.removeUsers(req.user.id, req.body?.ids) });
        } catch (error) {
            next(error);
        }
    });
    router.delete('/admin/users/:id', (req, res, next) => {
        try {
            res.json({ message: 'success', deleted: service.removeUsers(req.user.id, [req.params.id]) });
        } catch (error) {
            next(error);
        }
    });

    router.get('/admin/events', (req, res) => res.json({
        message: 'success',
        data: service.listEvents(typeof req.query.userId === 'string' ? req.query.userId : null)
    }));
    router.post('/admin/events', (req, res, next) => {
        try {
            res.status(201).json({ message: 'success', data: service.createEvent(req.body) });
        } catch (error) {
            next(error);
        }
    });
    router.put('/admin/events/:id', (req, res, next) => {
        try {
            const revision = service.updateEvent(req.params.id, req.body);
            res.json({ message: 'success', revision, version: revision });
        } catch (error) {
            next(error);
        }
    });
    router.delete('/admin/events', (req, res, next) => {
        try {
            res.json({ message: 'success', deleted: service.removeEvents(req.body?.events) });
        } catch (error) {
            next(error);
        }
    });
    router.delete('/admin/events/:id', (req, res, next) => {
        try {
            service.removeEvent(req.params.id, req.body?.revision ?? req.query.revision);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });

    router.get('/admin/friends', (_req, res) => res.json({ message: 'success', data: service.listFriendships() }));
    router.post('/admin/friends', (req, res, next) => {
        try {
            service.createFriendship(req.body?.userA, req.body?.userB);
            res.status(201).json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    router.delete('/admin/friends/:userA/:userB', (req, res, next) => {
        try {
            service.removeFriendship(req.params.userA, req.params.userB);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    router.get('/admin/roles', (_req, res) => res.json({ message: 'success', data: service.listRoles() }));
    return router;
};

module.exports = { createAdminRouter, createAdminService, validateIdList };
