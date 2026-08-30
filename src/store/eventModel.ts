import type { CalendarEvent } from '../api/contracts';
import { normalizePriority } from '../utils/priorityUtils';
import { FALLBACK_POSTPONED_EVENT_DOMAIN, readPostponedEventDomain } from '../utils/postponedDomains';

export type WireEvent = Record<string, unknown> & {
    id?: unknown;
    title?: unknown;
    date?: unknown;
    startTime?: unknown;
    start_time?: unknown;
    priority?: unknown;
    note?: unknown;
    link?: unknown;
    completed?: unknown;
    failed?: unknown;
    version?: unknown;
    revision?: unknown;
    unlockDate?: unknown;
    unlock_date?: unknown;
    resources?: unknown;
};

export const normalizeBoolean = (value: unknown) => (
    value === true || value === 1 || value === '1' || value === 'true'
);

export const readRevision = (value: unknown) => (
    Number.isFinite(Number(value)) ? Number(value) : null
);

const hasOwn = (raw: WireEvent, key: string) => Object.prototype.hasOwnProperty.call(raw, key);

export const parseEventResources = (resources: unknown) => {
    if (!resources) return { originDates: null, wasPostponed: null, postponedView: null };
    try {
        const parsed = (typeof resources === 'string' ? JSON.parse(resources) : resources) as Record<string, unknown>;
        const originDates = Array.isArray(parsed?.originDates)
            ? parsed.originDates.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
            : [];
        return {
            originDates: originDates.length > 0 ? originDates : null,
            wasPostponed: parsed?.wasPostponed === true ? true : null,
            postponedView: readPostponedEventDomain(parsed?.postponedView)
        };
    } catch {
        return { originDates: null, wasPostponed: null, postponedView: null };
    }
};

export const sortEventsByTimeThenTitle = (events: CalendarEvent[]) => (
    [...events].sort((left, right) => (
        (left.startTime || '').localeCompare(right.startTime || '') || left.title.localeCompare(right.title)
    ))
);

export const findEventInDateMap = (source: Record<string, CalendarEvent[]>, eventId: string) => {
    for (const events of Object.values(source)) {
        const event = events.find((candidate) => candidate.id === eventId);
        if (event) return event;
    }
    return null;
};

export const upsertEventIntoDateMap = (source: Record<string, CalendarEvent[]>, event: CalendarEvent) => {
    const merged = { ...source };
    let previousEvent: CalendarEvent | null = null;
    for (const dateKey of Object.keys(merged)) {
        previousEvent = merged[dateKey].find((candidate) => candidate.id === event.id) || previousEvent;
        const remaining = merged[dateKey].filter((candidate) => candidate.id !== event.id);
        if (remaining.length === 0) delete merged[dateKey];
        else merged[dateKey] = remaining;
    }
    const nextEvent = { ...(previousEvent || {}), ...event } as CalendarEvent;
    merged[nextEvent.date] = sortEventsByTimeThenTitle([...(merged[nextEvent.date] || []), nextEvent]);
    return merged;
};

export const upsertExistingEventIntoDateMap = (source: Record<string, CalendarEvent[]>, event: CalendarEvent) => (
    findEventInDateMap(source, event.id) ? upsertEventIntoDateMap(source, event) : source
);

export const shouldKeepLocalEvent = (localEvent: CalendarEvent | null, incomingRevision: number | null) => (
    localEvent?.version !== null
    && localEvent?.version !== undefined
    && incomingRevision !== null
    && localEvent.version > incomingRevision
);

export const readWireEvent = (
    raw: WireEvent,
    previousEvent: CalendarEvent | null = null,
    postponed = false
): CalendarEvent => {
    const resources = parseEventResources(raw.resources);
    const revision = readRevision(raw.revision ?? raw.version);
    return {
        id: String(raw.id || ''),
        title: String(raw.title || ''),
        date: String(raw.date || ''),
        startTime: raw.startTime ?? raw.start_time ? String(raw.startTime ?? raw.start_time) : null,
        priority: normalizePriority(
            typeof raw.priority === 'string' || typeof raw.priority === 'number' ? raw.priority : null
        ),
        note: typeof raw.note === 'string' && raw.note ? raw.note : null,
        link: typeof raw.link === 'string' && raw.link ? raw.link : null,
        completed: hasOwn(raw, 'completed') ? normalizeBoolean(raw.completed) : previousEvent?.completed ?? false,
        failed: hasOwn(raw, 'failed') ? normalizeBoolean(raw.failed) : previousEvent?.failed ?? false,
        revision,
        version: revision,
        unlockDate: typeof (raw.unlockDate ?? raw.unlock_date) === 'string' ? String(raw.unlockDate ?? raw.unlock_date) : null,
        originDates: resources.originDates,
        wasPostponed: resources.wasPostponed,
        postponedView: postponed ? resources.postponedView ?? FALLBACK_POSTPONED_EVENT_DOMAIN : resources.postponedView
    };
};
