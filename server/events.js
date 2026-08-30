const crypto = require('crypto');
const express = require('express');

const { eventStatusFields, isEventStatus, normalizeEventStatusFields } = require('./eventStatus');
const { ApiError } = require('./http');
const { isDateKey, isTime } = require('./time');

const optionalString = (value, maxLength) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') throw new ApiError(400, 'invalid_event');
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > maxLength) throw new ApiError(400, 'invalid_event');
    return trimmed;
};

const normalizeResources = (value) => {
    if (value === null || value === undefined || value === '') return null;
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        } catch {
            throw new ApiError(400, 'invalid_event_resources');
        }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ApiError(400, 'invalid_event_resources');
    }
    // Automatic-program provenance is owned exclusively by the program service.
    delete parsed.automaticProgramArrivalDate;
    const encoded = JSON.stringify(parsed);
    if (encoded.length > 100_000) throw new ApiError(400, 'event_resources_too_large');
    return encoded;
};

const mergeAutomaticProgramProvenance = (clientResources, storedResources) => {
    const client = clientResources ? JSON.parse(clientResources) : {};
    let stored = {};
    try {
        stored = storedResources ? JSON.parse(storedResources) : {};
    } catch {
        throw new ApiError(409, 'invalid_event_resources');
    }
    if (typeof stored.automaticProgramArrivalDate === 'string') {
        client.automaticProgramArrivalDate = stored.automaticProgramArrivalDate;
    }
    return Object.keys(client).length === 0 ? null : JSON.stringify(client);
};

const normalizePriority = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < -1000 || number > 1000) {
        throw new ApiError(400, 'invalid_event_priority');
    }
    return number;
};

const normalizeLink = (value) => {
    const link = optionalString(value, 4_096);
    if (!link) return null;
    let parsed;
    try {
        parsed = new URL(link);
    } catch {
        throw new ApiError(400, 'invalid_event_link');
    }
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        throw new ApiError(400, 'invalid_event_link');
    }
    return link;
};

const safeEventLink = (value) => {
    try {
        return normalizeLink(value);
    } catch {
        return null;
    }
};

const assertRevision = (revision) => {
    if (!Number.isInteger(revision) || revision < 1) throw new ApiError(428, 'revision_required');
};

const normalizeEvent = (raw, { postponed = false } = {}) => {
    if (!raw || typeof raw !== 'object') throw new ApiError(400, 'invalid_event');
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title || title.length > 500) throw new ApiError(400, 'invalid_event_title');
    const date = raw.date === null || raw.date === undefined ? '' : String(raw.date).trim();
    if ((!postponed || date) && !isDateKey(date)) throw new ApiError(400, 'invalid_event_date');
    const startTime = optionalString(raw.startTime, 5);
    if (startTime && !isTime(startTime)) throw new ApiError(400, 'invalid_event_time');
    const status = normalizeEventStatusFields(raw);
    const suppliedId = raw.id === undefined || raw.id === null || raw.id === '' ? null : raw.id;
    if (suppliedId !== null && (typeof suppliedId !== 'string' || !suppliedId.trim() || suppliedId.trim().length > 128)) {
        throw new ApiError(400, 'invalid_event');
    }
    const unlockDate = postponed ? null : optionalString(raw.unlockDate, 10);
    if (unlockDate && !isDateKey(unlockDate)) throw new ApiError(400, 'invalid_event_date');
    return {
        id: suppliedId === null ? crypto.randomUUID() : suppliedId.trim(),
        title,
        date,
        startTime,
        priority: normalizePriority(raw.priority),
        note: optionalString(raw.note, 50_000),
        link: normalizeLink(raw.link),
        completed: status.completed,
        failed: status.failed,
        resources: normalizeResources(raw.resources),
        unlockDate
    };
};

const eventDto = (row) => ({
    id: row.id,
    title: row.title,
    date: row.date || '',
    startTime: row.start_time,
    priority: row.priority,
    note: row.note,
    link: safeEventLink(row.link),
    completed: row.completed,
    failed: row.failed,
    version: row.revision,
    revision: row.revision,
    resources: row.resources,
    ...(Object.prototype.hasOwnProperty.call(row, 'unlock_date') ? { unlockDate: row.unlock_date } : {})
});

const expectedRevision = (req) => {
    const raw = req.body?.revision ?? req.body?.version ?? req.get('if-match');
    const revision = Number(raw);
    if (!Number.isInteger(revision) || revision < 1) throw new ApiError(428, 'revision_required');
    return revision;
};

const addOriginDate = (resources, sourceDate) => {
    let parsed = {};
    try {
        parsed = resources ? JSON.parse(resources) : {};
    } catch {
        throw new ApiError(409, 'invalid_event_resources');
    }
    const existing = Array.isArray(parsed.originDates)
        ? parsed.originDates.filter((value) => typeof value === 'string')
        : [];
    parsed.originDates = [...new Set([...existing, sourceDate])];
    return JSON.stringify(parsed);
};

const createEventService = ({ db, now = () => new Date() }) => {
    const list = (ownerId, postponed = false) => {
        const table = postponed ? 'postponed_events' : 'events';
        const unlock = postponed ? '' : ', unlock_date';
        return db.prepare(`
            SELECT id, title, date, start_time, priority, note, link, completed,
                   failed, revision, resources${unlock}
            FROM ${table} WHERE user_id = ?
            ORDER BY ${postponed ? 'updated_at DESC' : 'date, start_time, title'}
        `).all(ownerId).map(eventDto);
    };

    const createMany = (ownerId, rawEvents, postponed = false) => {
        if (!Array.isArray(rawEvents) || rawEvents.length === 0 || rawEvents.length > 1000) {
            throw new ApiError(400, 'invalid_events');
        }
        const events = rawEvents.map((event) => normalizeEvent(event, { postponed }));
        const table = postponed ? 'postponed_events' : 'events';
        const columns = postponed
            ? 'id, title, date, user_id, start_time, priority, note, link, completed, failed, updated_at, revision, resources'
            : 'id, title, date, user_id, start_time, priority, note, link, completed, failed, updated_at, revision, resources, unlock_date';
        const placeholders = postponed ? '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?' : '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?';
        const insert = db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`);
        const timestamp = now().getTime();
        const write = db.transaction(() => {
            for (const event of events) {
                const values = [
                    event.id, event.title, event.date, ownerId, event.startTime,
                    event.priority, event.note, event.link, event.completed,
                    event.failed, timestamp, event.resources
                ];
                if (!postponed) values.push(event.unlockDate);
                insert.run(...values);
            }
        });
        try {
            write.immediate();
        } catch (error) {
            if (error.code?.startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'event_conflict');
            throw error;
        }
        return events.map((event) => ({ id: event.id, version: 1, revision: 1 }));
    };

    const update = (ownerId, id, raw, revision, postponed = false) => {
        assertRevision(revision);
        const event = normalizeEvent({ ...raw, id }, { postponed });
        const table = postponed ? 'postponed_events' : 'events';
        const unlock = postponed ? '' : ', unlock_date = ?';
        const write = db.transaction(() => {
            const current = db.prepare(`SELECT resources FROM ${table} WHERE id = ? AND user_id = ? AND revision = ?`)
                .get(id, ownerId, revision);
            if (!current) throw new ApiError(409, 'event_conflict_or_missing');
            const resources = postponed
                ? event.resources
                : mergeAutomaticProgramProvenance(event.resources, current.resources);
            const values = [
                event.title, event.date, event.startTime, event.priority, event.note,
                event.link, event.completed, event.failed, now().getTime(), resources
            ];
            if (!postponed) values.push(event.unlockDate);
            values.push(id, ownerId, revision);
            const result = db.prepare(`
                UPDATE ${table}
                SET title = ?, date = ?, start_time = ?, priority = ?, note = ?,
                    link = ?, completed = ?, failed = ?, updated_at = ?,
                    resources = ?${unlock}, revision = revision + 1
                WHERE id = ? AND user_id = ? AND revision = ?
            `).run(...values);
            if (result.changes !== 1) throw new ApiError(409, 'event_conflict_or_missing');
            return revision + 1;
        });
        return write.immediate();
    };

    const updateStatus = (ownerId, id, status, revision, postponed = false) => {
        assertRevision(revision);
        if (!isEventStatus(status)) throw new ApiError(400, 'invalid_event_status');
        const table = postponed ? 'postponed_events' : 'events';
        const fields = eventStatusFields(status);
        const result = db.prepare(`
            UPDATE ${table}
            SET completed = ?, failed = ?, updated_at = ?, revision = revision + 1
            WHERE id = ? AND user_id = ? AND revision = ?
        `).run(fields.completed, fields.failed, now().getTime(), id, ownerId, revision);
        if (result.changes !== 1) throw new ApiError(409, 'event_conflict_or_missing');
        return { id, status, ...fields, version: revision + 1, revision: revision + 1 };
    };

    const remove = (ownerId, id, revision, postponed = false) => {
        assertRevision(revision);
        const table = postponed ? 'postponed_events' : 'events';
        const result = db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ? AND revision = ?`)
            .run(id, ownerId, revision);
        if (result.changes !== 1) throw new ApiError(409, 'event_conflict_or_missing');
    };

    const moveIncomplete = (ownerId, sourceDateKeys, targetDateKey) => {
        if (!Array.isArray(sourceDateKeys) || sourceDateKeys.length === 0 || sourceDateKeys.length > 366) {
            throw new ApiError(400, 'invalid_source_dates');
        }
        const sources = [...new Set(sourceDateKeys)];
        if (sources.some((date) => !isDateKey(date)) || !isDateKey(targetDateKey)) {
            throw new ApiError(400, 'invalid_event_date');
        }
        const effectiveSources = sources.filter((date) => date !== targetDateKey);
        if (effectiveSources.length === 0) return { movedEventCount: 0, events: [] };
        const placeholders = effectiveSources.map(() => '?').join(',');
        const move = db.transaction(() => {
            const events = db.prepare(`
                SELECT id, date, resources, revision FROM events
                WHERE user_id = ? AND date IN (${placeholders})
                  AND completed = 0 AND failed = 0
                ORDER BY date, id
            `).all(ownerId, ...effectiveSources);
            const update = db.prepare(`
                UPDATE events
                SET date = ?, resources = ?, updated_at = ?, revision = revision + 1
                WHERE id = ? AND user_id = ? AND revision = ?
                  AND completed = 0 AND failed = 0
            `);
            const timestamp = now().getTime();
            for (const event of events) {
                const result = update.run(
                    targetDateKey,
                    addOriginDate(event.resources, event.date),
                    timestamp,
                    event.id,
                    ownerId,
                    event.revision
                );
                if (result.changes !== 1) throw new ApiError(409, 'event_conflict_or_missing');
            }
            if (events.length === 0) return { movedEventCount: 0, events: [] };
            const ids = events.map((event) => event.id);
            const moved = db.prepare(`
                SELECT id, title, date, start_time, priority, note, link, completed,
                       failed, revision, resources, unlock_date
                FROM events WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})
                ORDER BY start_time, title
            `).all(ownerId, ...ids).map(eventDto);
            return { movedEventCount: moved.length, events: moved };
        });
        return move.immediate();
    };

    return { createMany, list, moveIncomplete, remove, update, updateStatus };
};

const createEventsRouter = ({ service, authenticate, postponed = false }) => {
    const router = express.Router();
    router.use(authenticate);
    router.get('/', (req, res) => res.json({ message: 'success', data: service.list(req.user.id, postponed) }));
    router.post('/', (req, res, next) => {
        try {
            const data = service.createMany(req.user.id, req.body?.events, postponed);
            res.status(201).json({ message: 'success', count: data.length, data });
        } catch (error) {
            next(error);
        }
    });
    if (!postponed) {
        router.post('/move-incomplete', (req, res, next) => {
            try {
                const data = service.moveIncomplete(
                    req.user.id,
                    req.body?.sourceDateKeys,
                    req.body?.targetDateKey
                );
                res.json({ message: 'success', data });
            } catch (error) {
                next(error);
            }
        });
    }
    router.put('/:id', (req, res, next) => {
        try {
            const revision = service.update(req.user.id, req.params.id, req.body, expectedRevision(req), postponed);
            res.json({ message: 'success', version: revision, revision });
        } catch (error) {
            next(error);
        }
    });
    router.patch('/:id/status', (req, res, next) => {
        try {
            const data = service.updateStatus(
                req.user.id,
                req.params.id,
                req.body?.status,
                expectedRevision(req),
                postponed
            );
            res.json({ message: 'success', data });
        } catch (error) {
            next(error);
        }
    });
    router.patch('/:id/completed', (req, res, next) => {
        try {
            const status = req.body?.completed === true || req.body?.completed === 1 ? 'completed' : 'pending';
            const data = service.updateStatus(req.user.id, req.params.id, status, expectedRevision(req), postponed);
            res.json({ message: 'success', data });
        } catch (error) {
            next(error);
        }
    });
    router.delete('/:id', (req, res, next) => {
        try {
            service.remove(req.user.id, req.params.id, expectedRevision(req), postponed);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    return router;
};

module.exports = {
    assertRevision,
    createEventService,
    createEventsRouter,
    eventDto,
    expectedRevision,
    normalizeEvent,
    safeEventLink
};
