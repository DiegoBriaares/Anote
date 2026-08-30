const crypto = require('crypto');
const express = require('express');

const { resourcesForSharedCopy, safeEventLink } = require('./events');
const { ApiError } = require('./http');
const { isDateKey } = require('./time');
const { parsePreferences } = require('./users');

const orderedFriendIds = (first, second) => first < second ? [first, second] : [second, first];

const validateIdList = (value, { maximum = 1000 } = {}) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > maximum
        || value.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new ApiError(400, 'invalid_ids');
    }
    return [...new Set(value.map((item) => item.trim()))];
};

const publicFriendPreferences = (value) => {
    const preferences = parsePreferences(value);
    if (typeof preferences.backgroundUrl !== 'string'
        || preferences.backgroundUrl.length > 4096
        || preferences.backgroundUrl.startsWith('/attachments/')) {
        return {};
    }
    return { backgroundUrl: preferences.backgroundUrl };
};

const createSocialService = ({ db, now = () => new Date() }) => {
    const list = (ownerId) => db.prepare(`
        SELECT CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END AS id,
               u.username, u.avatar_url
        FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
        WHERE f.user_a = ? OR f.user_b = ?
        ORDER BY u.username COLLATE NOCASE
    `).all(ownerId, ownerId, ownerId, ownerId);

    const add = (ownerId, friendId) => {
        if (!friendId || friendId === ownerId) throw new ApiError(400, 'invalid_friend');
        if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(friendId)) throw new ApiError(404, 'user_not_found');
        const [first, second] = orderedFriendIds(ownerId, friendId);
        db.prepare('INSERT OR IGNORE INTO friendships (user_a, user_b) VALUES (?, ?)').run(first, second);
    };

    const remove = (ownerId, friendId) => {
        const [first, second] = orderedFriendIds(ownerId, friendId);
        return db.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').run(first, second).changes;
    };

    const shareEvents = (ownerId, input = {}) => {
        const friendIds = validateIdList(input.friendIds, { maximum: 100 });
        const dateKeys = validateIdList(input.dateKeys, { maximum: 366 });
        if (dateKeys.some((date) => !isDateKey(date))) throw new ApiError(400, 'invalid_date');
        const eventIds = input.eventIds === undefined ? null : validateIdList(input.eventIds);
        if (friendIds.includes(ownerId)) throw new ApiError(400, 'invalid_friend');
        const friendship = db.prepare('SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?');
        for (const friendId of friendIds) {
            const [first, second] = orderedFriendIds(ownerId, friendId);
            if (!friendship.get(first, second)) throw new ApiError(403, 'friendship_required');
        }
        const datePlaceholders = dateKeys.map(() => '?').join(',');
        const idClause = eventIds ? ` AND id IN (${eventIds.map(() => '?').join(',')})` : '';
        const source = db.prepare(`
            SELECT id, title, date, start_time AS startTime, priority, note, link,
                   completed, failed, resources, unlock_date AS unlockDate
            FROM events WHERE user_id = ? AND date IN (${datePlaceholders})${idClause}
            ORDER BY date, start_time, title
        `).all(ownerId, ...dateKeys, ...(eventIds || []));
        if (eventIds && source.length !== eventIds.length) throw new ApiError(400, 'invalid_event_selection');
        const shareable = source.map((event) => ({
            ...event,
            resources: resourcesForSharedCopy(event.resources)
        }));
        const copies = [];
        for (const friendId of friendIds) {
            for (const event of shareable) copies.push({ ...event, id: crypto.randomUUID(), ownerId: friendId });
        }
        const insert = db.prepare(`
            INSERT INTO events (
                id, title, date, user_id, start_time, priority, note, link,
                completed, failed, updated_at, revision, resources, unlock_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `);
        db.transaction(() => {
            const timestamp = now().getTime();
            for (const event of copies) insert.run(
                event.id, event.title, event.date, event.ownerId, event.startTime,
                event.priority, event.note, event.link, event.completed, event.failed,
                timestamp, event.resources, event.unlockDate
            );
        }).immediate();
        return { count: copies.length, days: dateKeys.length, friends: friendIds.length };
    };

    const friendEvents = (ownerId, friendId) => {
        const [first, second] = orderedFriendIds(ownerId, friendId);
        if (!db.prepare('SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?').get(first, second)) {
            throw new ApiError(404, 'friend_not_found');
        }
        const friend = db.prepare('SELECT id, username, preferences FROM users WHERE id = ?').get(friendId);
        if (!friend) throw new ApiError(404, 'friend_not_found');
        const data = db.prepare(`
            SELECT id, title, date, start_time AS startTime, priority, link,
                   completed, failed, revision AS version, revision
            FROM events WHERE user_id = ? ORDER BY date, start_time, title
        `).all(friendId).map((row) => ({ ...row, link: safeEventLink(row.link) }));
        return {
            data,
            friend: {
                id: friend.id,
                username: friend.username,
                preferences: publicFriendPreferences(friend.preferences)
            }
        };
    };

    return { add, friendEvents, list, remove, shareEvents };
};

const createSocialRouter = ({ service, authenticate }) => {
    const router = express.Router();
    router.get('/friends', authenticate, (req, res) => {
        res.json({ message: 'success', data: service.list(req.user.id) });
    });
    router.post('/friends/share-events', authenticate, (req, res, next) => {
        try {
            res.json({ message: 'success', ...service.shareEvents(req.user.id, req.body) });
        } catch (error) {
            next(error);
        }
    });
    router.get('/friends/:friendId/events', authenticate, (req, res, next) => {
        try {
            res.json({ message: 'success', ...service.friendEvents(req.user.id, req.params.friendId) });
        } catch (error) {
            next(error);
        }
    });
    router.post('/friends/:friendId', authenticate, (req, res, next) => {
        try {
            service.add(req.user.id, req.params.friendId);
            res.status(201).json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    router.delete('/friends/:friendId', authenticate, (req, res) => {
        res.json({ message: 'success', removed: service.remove(req.user.id, req.params.friendId) });
    });
    return router;
};

module.exports = { createSocialRouter, createSocialService, orderedFriendIds, publicFriendPreferences, validateIdList };
