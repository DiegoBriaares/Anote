const express = require('express');

const { ApiError } = require('./http');
const { isDateKey } = require('./time');

const validateRange = (start, end) => {
    if (!isDateKey(start) || !isDateKey(end) || start > end) throw new ApiError(400, 'invalid_date_range');
    const first = Date.parse(`${start}T00:00:00.000Z`);
    const last = Date.parse(`${end}T00:00:00.000Z`);
    if ((last - first) / 86_400_000 > 366) throw new ApiError(400, 'invalid_date_range');
};

const createCalendarMetadataService = ({
    db,
    retireAttachments = (_collectCandidates, mutate) => db.transaction(mutate).immediate()
}) => {
    const dailyFacts = (ownerId, start, end) => {
        validateRange(start, end);
        const rows = db.prepare(`
            SELECT date, content FROM daily_facts_v2
            WHERE user_id = ? AND date BETWEEN ? AND ?
        `).all(ownerId, start, end);
        return Object.fromEntries(rows.map((row) => [row.date, row.content]));
    };

    const dailyFact = (ownerId, date) => {
        if (!isDateKey(date)) throw new ApiError(400, 'invalid_date');
        return db.prepare('SELECT content FROM daily_facts_v2 WHERE user_id = ? AND date = ?')
            .get(ownerId, date)?.content ?? null;
    };

    const saveDailyFact = (ownerId, date, content) => {
        if (!isDateKey(date) || typeof content !== 'string' || content.length > 20_000) {
            throw new ApiError(400, 'invalid_daily_fact');
        }
        db.prepare(`
            INSERT INTO daily_facts_v2 (date, user_id, content) VALUES (?, ?, ?)
            ON CONFLICT(date, user_id) DO UPDATE SET content = excluded.content
        `).run(date, ownerId, content);
    };

    const dayBackgrounds = (ownerId, start, end) => {
        validateRange(start, end);
        const rows = db.prepare(`
            SELECT date, image_url FROM day_backgrounds_v2
            WHERE user_id = ? AND date BETWEEN ? AND ?
        `).all(ownerId, start, end);
        return Object.fromEntries(rows.map((row) => [row.date, row.image_url]));
    };

    const saveDayBackground = (ownerId, date, imageUrl) => {
        if (!isDateKey(date) || typeof imageUrl !== 'string' || imageUrl.length > 4096) {
            throw new ApiError(400, 'invalid_day_background');
        }
        if (imageUrl.startsWith('/attachments/')) {
            const id = imageUrl.slice('/attachments/'.length);
            if (!/^[0-9a-f-]{36}$/.test(id)
                || !db.prepare("SELECT 1 FROM attachments WHERE id = ? AND owner_user_id = ? AND purpose = 'background'")
                    .get(id, ownerId)) {
                throw new ApiError(400, 'invalid_day_background');
            }
        } else if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
            throw new ApiError(400, 'invalid_day_background');
        }
        const current = db.prepare('SELECT image_url FROM day_backgrounds_v2 WHERE date = ? AND user_id = ?')
            .get(date, ownerId)?.image_url;
        const previousId = current?.startsWith('/attachments/') && current !== imageUrl
            ? current.slice('/attachments/'.length)
            : null;
        retireAttachments(
            () => previousId ? db.prepare(`
                SELECT * FROM attachments WHERE id = ? AND owner_user_id = ? AND purpose = 'background'
            `).all(previousId, ownerId) : [],
            () => db.prepare(`
                INSERT INTO day_backgrounds_v2 (date, user_id, image_url) VALUES (?, ?, ?)
                ON CONFLICT(date, user_id) DO UPDATE SET image_url = excluded.image_url
            `).run(date, ownerId, imageUrl),
        );
    };

    return { dailyFact, dailyFacts, dayBackgrounds, saveDailyFact, saveDayBackground };
};

const createCalendarMetadataRouter = ({ service, authenticate }) => {
    const router = express.Router();
    router.get('/daily-facts', authenticate, (req, res, next) => {
        try {
            res.json({ message: 'success', data: service.dailyFacts(req.user.id, req.query.start, req.query.end) });
        } catch (error) {
            next(error);
        }
    });
    router.get('/daily-facts/:date', authenticate, (req, res, next) => {
        try {
            res.json({ message: 'success', data: service.dailyFact(req.user.id, req.params.date) });
        } catch (error) {
            next(error);
        }
    });
    router.post('/daily-facts', authenticate, (req, res, next) => {
        try {
            service.saveDailyFact(req.user.id, req.body?.date, req.body?.content);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    router.get('/day-backgrounds', authenticate, (req, res, next) => {
        try {
            res.json({ message: 'success', data: service.dayBackgrounds(req.user.id, req.query.start, req.query.end) });
        } catch (error) {
            next(error);
        }
    });
    router.post('/day-backgrounds', authenticate, (req, res, next) => {
        try {
            service.saveDayBackground(req.user.id, req.body?.date, req.body?.imageUrl);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    return router;
};

module.exports = { createCalendarMetadataRouter, createCalendarMetadataService, validateRange };
