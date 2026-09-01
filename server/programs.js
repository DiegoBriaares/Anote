const crypto = require('crypto');
const express = require('express');

const { ApiError } = require('./http');
const { addDays, isTime, nextOccurrence, normalizeTimeZone, toDateKey, wallTimeToInstant } = require('./time');

const programDto = (row) => ({
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    activationTime: row.activation_time,
    targetDayOffset: row.target_day_offset,
    timeZone: row.time_zone,
    nextRunAt: row.next_run_at,
    revision: row.revision,
    lastRunAt: row.last_run_at || null
});

const runDto = (row) => ({
    id: row.id,
    programId: row.program_id,
    sourceDate: row.source_date,
    targetDate: row.target_date,
    movedEventCount: row.moved_event_count,
    executedAt: row.executed_at,
    automatic: row.automatic === 1
});

const normalizeProgramInput = (raw, existing = {}) => {
    if (!raw || typeof raw !== 'object') throw new ApiError(400, 'invalid_program');
    const name = raw.name === undefined ? existing.name : (typeof raw.name === 'string' ? raw.name.trim() : '');
    const activationTime = raw.activationTime ?? existing.activation_time;
    const targetDayOffset = raw.targetDayOffset ?? raw.targetOffsetDays ?? existing.target_day_offset;
    const timeZone = normalizeTimeZone(raw.timeZone ?? existing.time_zone);
    const enabled = raw.enabled ?? raw.isEnabled ?? (existing.enabled === 1);
    if (!name || name.length > 120) throw new ApiError(400, 'invalid_program_name');
    if (!isTime(activationTime)) throw new ApiError(400, 'invalid_program_time');
    if (!timeZone) throw new ApiError(400, 'invalid_program_time_zone');
    if (typeof targetDayOffset !== 'number'
        || !Number.isInteger(targetDayOffset)
        || targetDayOffset < 0
        || targetDayOffset > 365) {
        throw new ApiError(400, 'invalid_program_offset');
    }
    if (typeof enabled !== 'boolean') throw new ApiError(400, 'invalid_program_enabled');
    return { name, activationTime, targetDayOffset, timeZone, enabled };
};

const parseEventResources = (resources) => {
    let parsed = {};
    try {
        parsed = resources ? JSON.parse(resources) : {};
    } catch {
        throw new ApiError(409, 'invalid_event_resources');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ApiError(409, 'invalid_event_resources');
    }
    return parsed;
};

const appendOriginDate = (resources, sourceDate, automaticArrivalDate = null) => {
    const parsed = parseEventResources(resources);
    const prior = Array.isArray(parsed.originDates)
        ? parsed.originDates.filter((item) => typeof item === 'string')
        : [];
    parsed.originDates = [...new Set([...prior, sourceDate])];
    if (automaticArrivalDate) parsed.automaticProgramArrivalDate = automaticArrivalDate;
    else delete parsed.automaticProgramArrivalDate;
    return JSON.stringify(parsed);
};

const isAutomaticArrivalForDate = (resources, date) => {
    try {
        return parseEventResources(resources).automaticProgramArrivalDate === date;
    } catch {
        return false;
    }
};

const createProgramService = ({ db, now = () => new Date() }) => {
    const selectProgram = db.prepare(`
        SELECT p.*,
               (SELECT MAX(executed_at) FROM program_runs r WHERE r.program_id = p.id) AS last_run_at
        FROM programs p WHERE p.id = ? AND p.owner_user_id = ?
    `);

    const list = (ownerId) => db.prepare(`
        SELECT p.*,
               (SELECT MAX(executed_at) FROM program_runs r WHERE r.program_id = p.id) AS last_run_at
        FROM programs p WHERE p.owner_user_id = ? ORDER BY p.created_at, p.id
    `).all(ownerId).map(programDto);

    const create = (ownerId, raw) => {
        const program = normalizeProgramInput(raw);
        const timestamp = now();
        const nextRunAt = program.enabled
            ? nextOccurrence(timestamp, program.activationTime, program.timeZone).instant.toISOString()
            : null;
        const id = crypto.randomUUID();
        db.prepare(`
            INSERT INTO programs (
                id, owner_user_id, name, enabled, activation_time,
                target_day_offset, time_zone, next_run_at, revision,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
            id, ownerId, program.name, program.enabled ? 1 : 0,
            program.activationTime, program.targetDayOffset, program.timeZone,
            nextRunAt, timestamp.toISOString(), timestamp.toISOString()
        );
        return programDto(selectProgram.get(id, ownerId));
    };

    const update = (ownerId, id, raw) => {
        const revision = Number(raw?.revision);
        if (!Number.isInteger(revision) || revision < 1) throw new ApiError(428, 'revision_required');
        const existing = selectProgram.get(id, ownerId);
        if (!existing || existing.revision !== revision) throw new ApiError(409, 'program_conflict_or_missing');
        const program = normalizeProgramInput(raw, existing);
        const timestamp = now();
        const schedulingChanged = program.enabled !== (existing.enabled === 1)
            || program.activationTime !== existing.activation_time
            || program.timeZone !== existing.time_zone;
        const nextRunAt = !program.enabled
            ? null
            : schedulingChanged || !existing.next_run_at
                ? nextOccurrence(timestamp, program.activationTime, program.timeZone).instant.toISOString()
                : existing.next_run_at;
        const result = db.prepare(`
            UPDATE programs
            SET name = ?, enabled = ?, activation_time = ?, target_day_offset = ?,
                time_zone = ?, next_run_at = ?, revision = revision + 1,
                updated_at = ?
            WHERE id = ? AND owner_user_id = ? AND revision = ?
        `).run(
            program.name, program.enabled ? 1 : 0, program.activationTime,
            program.targetDayOffset, program.timeZone, nextRunAt,
            timestamp.toISOString(), id, ownerId, revision
        );
        if (result.changes !== 1) throw new ApiError(409, 'program_conflict_or_missing');
        return programDto(selectProgram.get(id, ownerId));
    };

    const updateMany = (ownerId, rawPrograms) => {
        if (!Array.isArray(rawPrograms) || rawPrograms.length === 0 || rawPrograms.length > 100) {
            throw new ApiError(400, 'invalid_programs');
        }
        const ids = rawPrograms.map((program) => program?.id);
        if (ids.some((id) => typeof id !== 'string' || !id)
            || new Set(ids).size !== ids.length) {
            throw new ApiError(400, 'invalid_programs');
        }
        return db.transaction(() => rawPrograms.map((program) => (
            update(ownerId, program.id, program)
        ))).immediate();
    };

    const remove = (ownerId, id, revision) => {
        if (!Number.isInteger(revision) || revision < 1) throw new ApiError(428, 'revision_required');
        const result = db.prepare('DELETE FROM programs WHERE id = ? AND owner_user_id = ? AND revision = ?')
            .run(id, ownerId, revision);
        if (result.changes !== 1) throw new ApiError(409, 'program_conflict_or_missing');
    };

    const run = (ownerId, id, {
        automatic = false,
        sourceDate,
        expectedRevision
    } = {}) => {
        const timestamp = now();
        const execute = db.transaction(() => {
            const program = selectProgram.get(id, ownerId);
            if (!program) throw new ApiError(404, 'program_not_found');
            if (!automatic) {
                if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
                    throw new ApiError(428, 'revision_required');
                }
                if (program.revision !== expectedRevision) throw new ApiError(409, 'program_conflict_or_missing');
            }
            if (program.enabled !== 1) throw new ApiError(409, 'program_disabled');
            if (automatic && (!program.next_run_at || program.next_run_at > timestamp.toISOString())) return null;
            const currentDate = toDateKey(timestamp, program.time_zone);
            const selectedSourceDate = sourceDate || currentDate;
            if (selectedSourceDate > currentDate) throw new ApiError(400, 'future_program_source');
            const existing = db.prepare('SELECT * FROM program_runs WHERE program_id = ? AND source_date = ?')
                .get(id, selectedSourceDate);
            if (existing) {
                if (program.enabled) {
                    const nextRunAt = wallTimeToInstant(
                        addDays(selectedSourceDate, 1),
                        program.activation_time,
                        program.time_zone
                    ).toISOString();
                    db.prepare('UPDATE programs SET next_run_at = ?, updated_at = ? WHERE id = ?')
                        .run(nextRunAt, timestamp.toISOString(), id);
                }
                return runDto(existing);
            }
            const targetDate = selectedSourceDate < currentDate
                ? currentDate
                : addDays(selectedSourceDate, program.target_day_offset);
            const events = db.prepare(`
                SELECT id, resources FROM events
                WHERE user_id = ? AND date = ? AND completed = 0 AND failed = 0
                ORDER BY id
            `).all(ownerId, selectedSourceDate).filter((event) => (
                selectedSourceDate !== currentDate || !isAutomaticArrivalForDate(event.resources, currentDate)
            ));
            const move = db.prepare(`
                UPDATE events
                SET date = ?, resources = ?, revision = revision + 1, updated_at = ?
                WHERE id = ? AND user_id = ? AND date = ? AND completed = 0 AND failed = 0
            `);
            let moved = 0;
            for (const event of events) {
                const changes = move.run(
                    targetDate,
                    appendOriginDate(
                        event.resources,
                        selectedSourceDate,
                        selectedSourceDate < currentDate ? targetDate : null
                    ),
                    timestamp.getTime(),
                    event.id,
                    ownerId,
                    selectedSourceDate
                ).changes;
                moved += changes;
            }
            const runRow = {
                id: crypto.randomUUID(),
                program_id: id,
                owner_user_id: ownerId,
                source_date: selectedSourceDate,
                target_date: targetDate,
                moved_event_count: moved,
                executed_at: timestamp.toISOString(),
                automatic: automatic ? 1 : 0
            };
            db.prepare(`
                INSERT INTO program_runs (
                    id, program_id, owner_user_id, source_date, target_date,
                    moved_event_count, executed_at, automatic
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(...Object.values(runRow));
            const nextRunAt = program.enabled
                ? wallTimeToInstant(addDays(selectedSourceDate, 1), program.activation_time, program.time_zone).toISOString()
                : null;
            db.prepare('UPDATE programs SET next_run_at = ?, updated_at = ? WHERE id = ?')
                .run(nextRunAt, timestamp.toISOString(), id);
            return runDto(runRow);
        });
        const result = execute.immediate();
        return result;
    };

    const runDue = ({ onError } = {}) => {
        const current = now();
        const due = db.prepare(`
            SELECT id, owner_user_id, time_zone, activation_time, next_run_at
            FROM programs
            WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
            ORDER BY next_run_at, id LIMIT 100
        `).all(current.toISOString());
        const results = [];
        for (const dueProgram of due) {
            try {
                let program = dueProgram;
                let occurrences = 0;
                while (program.next_run_at && program.next_run_at <= current.toISOString() && occurrences < 366) {
                    const sourceDate = toDateKey(new Date(program.next_run_at), program.time_zone);
                    const result = run(program.owner_user_id, program.id, { automatic: true, sourceDate });
                    if (result) results.push(result);
                    program = db.prepare('SELECT id, owner_user_id, time_zone, activation_time, next_run_at FROM programs WHERE id = ?')
                        .get(program.id);
                    occurrences += 1;
                }
            } catch (error) {
                if (!onError) throw error;
                onError(error, { programId: dueProgram.id });
            }
        }
        return results;
    };

    const notifications = (ownerId, after) => {
        const validAfter = typeof after === 'string' && !Number.isNaN(Date.parse(after)) ? after : '1970-01-01T00:00:00.000Z';
        const rows = db.prepare(`
            SELECT * FROM program_runs
            WHERE owner_user_id = ? AND automatic = 1 AND acknowledged_at IS NULL
            ORDER BY executed_at, id LIMIT 100
        `).all(ownerId);
        return {
            data: rows.map(runDto),
            cursor: rows.at(-1)?.executed_at || validAfter
        };
    };

    const completeNotifications = (ownerId, rawRunIds) => {
        if (!Array.isArray(rawRunIds) || rawRunIds.length === 0 || rawRunIds.length > 100
            || rawRunIds.some((id) => typeof id !== 'string' || !id)
            || new Set(rawRunIds).size !== rawRunIds.length) {
            throw new ApiError(400, 'invalid_program_notifications');
        }
        const complete = db.transaction(() => {
            const acknowledge = db.prepare(`
                UPDATE program_runs SET acknowledged_at = ?
                WHERE id = ? AND owner_user_id = ? AND automatic = 1 AND acknowledged_at IS NULL
            `);
            const timestamp = now().toISOString();
            for (const runId of rawRunIds) {
                if (acknowledge.run(timestamp, runId, ownerId).changes !== 1) {
                    throw new ApiError(409, 'program_notification_conflict');
                }
            }
        });
        complete.immediate();
    };

    return {
        completeNotifications,
        create,
        list,
        notifications,
        remove,
        run,
        runDue,
        update,
        updateMany
    };
};

const createProgramsRouter = ({ service, authenticate }) => {
    const router = express.Router();
    router.use(authenticate);
    router.get('/', (req, res) => res.json({ message: 'success', data: service.list(req.user.id) }));
    router.post('/', (req, res, next) => {
        try {
            res.status(201).json({ message: 'success', data: service.create(req.user.id, req.body) });
        } catch (error) {
            next(error);
        }
    });
    router.put('/', (req, res, next) => {
        try {
            res.json({ message: 'success', data: service.updateMany(req.user.id, req.body?.programs) });
        } catch (error) {
            next(error);
        }
    });
    router.get('/run-notifications', (req, res) => {
        const result = service.notifications(req.user.id, req.query.after);
        res.json({ message: 'success', ...result });
    });
    router.post('/run-notifications/complete', (req, res, next) => {
        try {
            service.completeNotifications(req.user.id, req.body?.runIds);
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    router.put('/:id', (req, res, next) => {
        try {
            res.json({ message: 'success', data: service.update(req.user.id, req.params.id, req.body) });
        } catch (error) {
            next(error);
        }
    });
    router.delete('/:id', (req, res, next) => {
        try {
            service.remove(req.user.id, req.params.id, Number(req.body?.revision ?? req.query.revision));
            res.json({ message: 'success' });
        } catch (error) {
            next(error);
        }
    });
    router.post('/:id/run', (req, res, next) => {
        try {
            res.json({
                message: 'success',
                data: service.run(req.user.id, req.params.id, { expectedRevision: Number(req.body?.revision) })
            });
        } catch (error) {
            next(error);
        }
    });
    return router;
};

const startProgramScheduler = ({ service, intervalMs = 30_000, logger = console }) => {
    let running = false;
    let stopped = false;
    const tick = () => {
        if (running || stopped) return;
        running = true;
        try {
            service.runDue({
                onError: (error, context) => logger.error('Automatic program run failed', {
                    programId: context.programId,
                    name: typeof error?.name === 'string' ? error.name : 'Error',
                    code: typeof error?.code === 'string' ? error.code : 'UNKNOWN'
                })
            });
        } catch (error) {
            logger.error('Automatic program scheduler failed', {
                name: typeof error?.name === 'string' ? error.name : 'Error',
                code: typeof error?.code === 'string' ? error.code : 'UNKNOWN'
            });
        } finally {
            running = false;
        }
    };
    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    const immediate = setImmediate(tick);
    immediate.unref?.();
    return () => {
        stopped = true;
        clearImmediate(immediate);
        clearInterval(timer);
    };
};

module.exports = { createProgramService, createProgramsRouter, programDto, runDto, startProgramScheduler };
