const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const FIXED_OFFSET_PATTERN = /^(?:GMT|UTC)\s*([+-])?\s*(\d{1,2})?(?::?([0-5]\d))?$/i;

const formatterCache = new Map();

const getFormatter = (timeZone) => {
    if (!formatterCache.has(timeZone)) {
        formatterCache.set(timeZone, new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        }));
    }
    return formatterCache.get(timeZone);
};

const parseFixedOffset = (value) => {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(FIXED_OFFSET_PATTERN);
    if (!match) return null;
    if (!match[1]) return match[2] || match[3] ? null : 0;
    if (!match[2]) return null;
    const hours = Number(match[2]);
    const minutes = Number(match[3] || 0);
    const maximumHours = match[1] === '-' ? 12 : 14;
    if (hours > maximumHours || (hours === maximumHours && minutes !== 0)) return null;
    const total = (hours * 60) + minutes;
    return match[1] === '-' ? -total : total;
};

const normalizeTimeZone = (value) => {
    if (typeof value !== 'string' || value.trim().length > 128) return null;
    const trimmed = value.trim();
    const fixedOffset = parseFixedOffset(trimmed);
    if (fixedOffset !== null) {
        if (fixedOffset === 0) return 'GMT';
        const sign = fixedOffset < 0 ? '-' : '+';
        const absolute = Math.abs(fixedOffset);
        const hours = Math.floor(absolute / 60);
        const minutes = absolute % 60;
        return `GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
    }
    try {
        getFormatter(trimmed).format(new Date(0));
        return trimmed;
    } catch {
        return null;
    }
};

const isTimeZone = (value) => normalizeTimeZone(value) !== null;

const isDateKey = (value) => {
    if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;
};

const isTime = (value) => typeof value === 'string' && TIME_PATTERN.test(value);

const zonedParts = (instant, timeZone) => {
    const fixedOffset = parseFixedOffset(timeZone);
    if (fixedOffset !== null) {
        const shifted = new Date(instant.getTime() + fixedOffset * 60 * 1000);
        return {
            year: shifted.getUTCFullYear(),
            month: shifted.getUTCMonth() + 1,
            day: shifted.getUTCDate(),
            hour: shifted.getUTCHours(),
            minute: shifted.getUTCMinutes(),
            second: shifted.getUTCSeconds()
        };
    }
    const parts = Object.fromEntries(
        getFormatter(timeZone).formatToParts(instant)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, Number(part.value)])
    );
    return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second
    };
};

const toDateKey = (instant, timeZone) => {
    const { year, month, day } = zonedParts(instant, timeZone);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const addDays = (dateKey, amount) => {
    if (!isDateKey(dateKey) || !Number.isInteger(amount)) throw new Error('Invalid date arithmetic');
    const [year, month, day] = dateKey.split('-').map(Number);
    const result = new Date(Date.UTC(year, month - 1, day + amount));
    return result.toISOString().slice(0, 10);
};

// Convert a wall-clock time to an instant without relying on the host timezone.
// On a DST gap, the first valid instant after the requested wall time is used.
const wallTimeToInstant = (dateKey, time, timeZone) => {
    if (!isDateKey(dateKey) || !isTime(time) || !isTimeZone(timeZone)) {
        throw new Error('Invalid zoned date/time');
    }
    const [year, month, day] = dateKey.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const fixedOffset = parseFixedOffset(timeZone);
    if (fixedOffset !== null) return new Date(desiredUtc - fixedOffset * 60 * 1000);
    let candidate = new Date(desiredUtc);

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const observed = zonedParts(candidate, timeZone);
        const observedUtc = Date.UTC(
            observed.year,
            observed.month - 1,
            observed.day,
            observed.hour,
            observed.minute,
            observed.second
        );
        const difference = desiredUtc - observedUtc;
        if (difference === 0) return candidate;
        candidate = new Date(candidate.getTime() + difference);
    }

    // DST gaps have no exact representation. Scan forward to the first wall
    // clock at or after the requested value on the same local date.
    const start = new Date(candidate.getTime() - (3 * 60 * 60 * 1000));
    for (let offset = 0; offset <= 6 * 60; offset += 1) {
        const probe = new Date(start.getTime() + offset * 60 * 1000);
        const parts = zonedParts(probe, timeZone);
        if (`${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` !== dateKey) continue;
        if (parts.hour > hour || (parts.hour === hour && parts.minute >= minute)) return probe;
    }
    throw new Error('Unable to resolve zoned date/time');
};

const nextOccurrence = (now, activationTime, timeZone) => {
    let sourceDate = toDateKey(now, timeZone);
    let instant = wallTimeToInstant(sourceDate, activationTime, timeZone);
    if (instant.getTime() <= now.getTime()) {
        sourceDate = addDays(sourceDate, 1);
        instant = wallTimeToInstant(sourceDate, activationTime, timeZone);
    }
    return { sourceDate, instant };
};

module.exports = {
    addDays,
    isDateKey,
    isTime,
    isTimeZone,
    normalizeTimeZone,
    nextOccurrence,
    toDateKey,
    wallTimeToInstant,
    zonedParts
};
