const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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

const isTimeZone = (value) => {
    if (typeof value !== 'string' || value.length > 128) return false;
    try {
        getFormatter(value).format(new Date(0));
        return true;
    } catch {
        return false;
    }
};

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
    nextOccurrence,
    toDateKey,
    wallTimeToInstant,
    zonedParts
};
