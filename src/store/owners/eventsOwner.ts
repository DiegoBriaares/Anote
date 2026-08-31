import { eachDayOfInterval } from 'date-fns';

import { ApiError } from '../../api/client';
import type { CalendarEvent, UserPreferences } from '../../api/contracts';
import { eventsApi, type WireRecord } from '../../api/events';
import { getApiErrorText, getAppText } from '../../i18n/appText';
import { formatDate } from '../../utils/dateUtils';
import { eventStatusFields, readEventStatus } from '../../utils/eventStatus';
import { DEFAULT_POSTPONED_EVENT_DOMAIN } from '../../utils/postponedDomains';
import { normalizePriority } from '../../utils/priorityUtils';

import type { CalendarState } from '../calendarStore';
import {
    findEventInDateMap,
    normalizeBoolean,
    readRevision,
    readWireEvent,
    shouldKeepLocalEvent,
    sortEventsByTimeThenTitle,
    upsertEventIntoDateMap,
    upsertExistingEventIntoDateMap
} from '../eventModel';
import type { OwnerContext } from './types';

type EventsOwner = Pick<CalendarState,
    'fetchEvents' | 'fetchPostponedEvents' | 'fetchFriendEvents' | 'viewOwnCalendar' |
    'addEvent' | 'addEventsToRange' | 'addEventsBulk' | 'shareEventsToFriends' |
    'deleteEvent' | 'editEvent' | 'setEventStatus' | 'setEventCompleted' |
    'addPostponedEvent' | 'addPostponedEventsBulk' | 'deletePostponedEvent' |
    'editPostponedEvent' | 'moveIncompleteEventsToDate' | 'setViewDate' |
    'clearSelection' | 'toggleCompare'
>;

const isSessionError = (error: unknown) => error instanceof ApiError && error.status === 401;
const errorText = (error: unknown, fallback: string) => error instanceof ApiError
    ? getApiErrorText(error.code)
    : fallback;

const toWireEvent = (event: CalendarEvent): WireRecord => ({
    ...event,
    ...eventStatusFields(readEventStatus(event)),
    resources: event.originDates || event.wasPostponed || event.postponedView
        ? {
            originDates: event.originDates || undefined,
            wasPostponed: event.wasPostponed || undefined,
            postponedView: event.postponedView || undefined
        }
        : null
});

const toCreateWireEvent = (event: CalendarEvent): WireRecord => {
    const wire = toWireEvent(event);
    delete wire.id;
    delete wire.revision;
    delete wire.version;
    return wire;
};

const mergeEvents = (source: Record<string, CalendarEvent[]>, additions: CalendarEvent[]) => (
    additions.reduce(upsertEventIntoDateMap, source)
);

const readCreatedEvents = (rows: WireRecord[], postponed = false) => (
    rows.map((row) => readWireEvent(row, null, postponed))
);

const groupEvents = (
    rows: WireRecord[],
    previous: Record<string, CalendarEvent[]> = {}
): Record<string, CalendarEvent[]> => {
    const grouped: Record<string, CalendarEvent[]> = {};
    rows.forEach((raw) => {
        const prior = findEventInDateMap(previous, String(raw.id || ''));
        const incoming = readWireEvent(raw, prior);
        const event = shouldKeepLocalEvent(prior, incoming.revision ?? null) ? prior as CalendarEvent : incoming;
        grouped[event.date] = [...(grouped[event.date] || []), event];
    });
    Object.keys(grouped).forEach((date) => {
        grouped[date] = sortEventsByTimeThenTitle(grouped[date]);
    });
    return grouped;
};

const createCalendarEvent = (
    entry: {
        title: string;
        startTime?: string | null;
        time?: string;
        priority?: number | string | null;
        note?: string | null;
        link?: string | null;
        completed?: boolean | null;
        failed?: boolean | null;
        originDates?: string[] | null;
        wasPostponed?: boolean | null;
    },
    date: string
): CalendarEvent => {
    const rawTime = entry.startTime ?? entry.time;
    return {
        // The API owns durable event identity with Node's cryptographic UUID.
        // Creation drafts never enter application state with this placeholder.
        id: '',
        title: entry.title,
        date,
        startTime: rawTime?.trim() || null,
        priority: normalizePriority(entry.priority),
        note: entry.note?.trim() || null,
        link: entry.link?.trim() || null,
        ...eventStatusFields(readEventStatus(entry)),
        originDates: entry.originDates?.length ? entry.originDates : null,
        wasPostponed: entry.wasPostponed ? true : null
    };
};

export const createEventsOwner = ({ set, get, logoutAndReset }: OwnerContext): EventsOwner => ({
    fetchEvents: async () => {
        if (!get().user) return;
        try {
            const response = await eventsApi.list();
            const events = groupEvents(response.data, get().events);
            set((state) => state.viewMode === 'friend'
                ? { compareEvents: events }
                : {
                    events,
                    viewingPreferences: state.profile?.preferences || null,
                    compareEvents: events
                });
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
        }
    },

    fetchPostponedEvents: async () => {
        if (!get().user || get().viewMode === 'friend') return;
        try {
            const response = await eventsApi.listPostponed();
            const previous = get().postponedEvents;
            const events = response.data.map((raw) => {
                const prior = previous.find((candidate) => candidate.id === String(raw.id || '')) || null;
                const incoming = readWireEvent(raw, prior, true);
                return shouldKeepLocalEvent(prior, incoming.revision ?? null) ? prior as CalendarEvent : incoming;
            });
            set({ postponedEvents: sortEventsByTimeThenTitle(events) });
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
        }
    },

    fetchFriendEvents: async (friendId, friendName) => {
        if (!get().user) return;
        try {
            const response = await eventsApi.listFriend(friendId);
            const events = groupEvents(response.data);
            const username = typeof response.friend?.username === 'string'
                ? response.friend.username
                : friendName;
            set((state) => ({
                events,
                viewMode: 'friend',
                viewingUserId: friendId,
                viewingUsername: username,
                viewingPreferences: response.friend?.preferences as UserPreferences || null,
                compareEvents: Object.keys(state.compareEvents).length > 0 ? state.compareEvents : state.events,
                currentView: 'calendar'
            }));
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ socialError: errorText(error, getAppText().serviceUnavailable) });
        }
    },

    viewOwnCalendar: async () => {
        const { user, profile } = get();
        if (!user) return;
        set({
            viewMode: 'self',
            viewingUserId: user.id,
            viewingUsername: user.username,
            viewingPreferences: profile?.preferences || null,
            currentView: 'calendar'
        });
        await get().fetchEvents();
    },

    addEventsToRange: async (entries) => {
        const { selection, user, viewMode } = get();
        if (!selection.start || !selection.end || !user || viewMode === 'friend') return;
        const start = selection.start < selection.end ? selection.start : selection.end;
        const end = selection.start < selection.end ? selection.end : selection.start;
        const events = eachDayOfInterval({ start, end }).flatMap((day, index) => {
            const entry = entries[index];
            return entry?.title ? [createCalendarEvent(entry, formatDate(day))] : [];
        });
        if (events.length === 0) return;
        try {
            const response = await eventsApi.create(events.map(toCreateWireEvent));
            const persisted = readCreatedEvents(response.data);
            set((state) => ({ events: mergeEvents(state.events, persisted) }));
            await get().fetchEvents();
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ actionError: errorText(error, getAppText().addEventUnavailable) });
        }
    },

    addEventsBulk: async (entries) => {
        if (!get().user || get().viewMode === 'friend' || entries.length === 0) return false;
        const events = entries.flatMap((entry) => entry?.title && entry.date
            ? [createCalendarEvent(entry, entry.date)]
            : []);
        if (events.length === 0) return false;
        try {
            const response = await eventsApi.create(events.map(toCreateWireEvent));
            const persisted = readCreatedEvents(response.data);
            set((state) => ({ events: mergeEvents(state.events, persisted) }));
            await get().fetchEvents();
            return true;
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ actionError: errorText(error, getAppText().addEventUnavailable) });
            return false;
        }
    },

    shareEventsToFriends: async (friendIds, dateKeys, eventIds) => {
        if (!get().user || get().viewMode === 'friend') return false;
        if (friendIds.length === 0 || dateKeys.length === 0 || eventIds?.length === 0) return false;
        set({ actionError: null });
        try {
            await eventsApi.share(friendIds, dateKeys, eventIds);
            return true;
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ actionError: errorText(error, getAppText().shareUnavailable) });
            return false;
        }
    },

    addEvent: async (date, entry) => {
        if (!get().user || get().viewMode === 'friend' || !entry.title) return false;
        const event = createCalendarEvent(entry, formatDate(date));
        set({ actionError: null });
        try {
            const response = await eventsApi.create([toCreateWireEvent(event)]);
            const persisted = readCreatedEvents(response.data);
            set((state) => ({ events: mergeEvents(state.events, persisted) }));
            await get().fetchEvents();
            return true;
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ actionError: errorText(error, getAppText().addEventUnavailable) });
            return false;
        }
    },

    deleteEvent: async (id) => {
        if (!get().user || get().viewMode === 'friend') return;
        const existing = findEventInDateMap(get().events, id);
        if (!existing) return;
        try {
            await eventsApi.remove(id, existing.revision ?? existing.version);
            set((state) => ({
                events: Object.fromEntries(Object.entries(state.events)
                    .map(([date, events]) => [date, events.filter((event) => event.id !== id)])
                    .filter(([, events]) => events.length > 0))
            }));
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ actionError: errorText(error, getAppText().updateEventUnavailable) });
        }
    },

    editEvent: async (event) => {
        if (!get().user || get().viewMode === 'friend') return false;
        set({ actionError: null });
        try {
            const response = await eventsApi.update(event.id, {
                ...toWireEvent(event),
                revision: event.revision ?? event.version,
                unlockDate: event.unlockDate ?? null
            });
            const data = response.data && typeof response.data === 'object' ? response.data : response;
            const revision = readRevision(data.revision ?? data.version)
                ?? event.revision ?? event.version ?? null;
            const persisted = { ...event, ...eventStatusFields(readEventStatus(event)), revision, version: revision };
            set((state) => ({
                events: upsertEventIntoDateMap(state.events, persisted),
                compareEvents: state.viewMode === 'self'
                    ? upsertExistingEventIntoDateMap(state.compareEvents, persisted)
                    : state.compareEvents
            }));
            return true;
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ actionError: errorText(error, getAppText().updateEventUnavailable) });
            return false;
        }
    },

    setEventStatus: async (event, status) => {
        if (!get().user || get().viewMode === 'friend') return false;
        set({ actionError: null });
        try {
            const response = await eventsApi.setStatus(event.id, status, event.revision ?? event.version);
            const desired = eventStatusFields(status);
            const revision = readRevision(response.data?.revision ?? response.data?.version)
                ?? event.revision ?? event.version ?? null;
            const updated: CalendarEvent = {
                ...event,
                completed: normalizeBoolean(response.data?.completed ?? desired.completed),
                failed: normalizeBoolean(response.data?.failed ?? desired.failed),
                revision,
                version: revision
            };
            set((state) => ({
                events: upsertExistingEventIntoDateMap(state.events, updated),
                compareEvents: state.viewMode === 'self'
                    ? upsertExistingEventIntoDateMap(state.compareEvents, updated)
                    : state.compareEvents
            }));
            return true;
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ actionError: errorText(error, getAppText().completionUnavailable) });
            return false;
        }
    },

    setEventCompleted: async (event, completed) => get().setEventStatus(
        event,
        completed ? 'completed' : 'pending'
    ),

    setViewDate: (date) => set({ viewDate: date }),
    clearSelection: () => set({ selection: { start: null, end: null }, selectionActive: false }),

    addPostponedEventsBulk: async (entries) => {
        if (!get().user || get().viewMode === 'friend' || entries.length === 0) return false;
        const events = entries.flatMap((entry) => entry?.title ? [{
            ...createCalendarEvent(entry, ''),
            postponedView: entry.postponedView ?? DEFAULT_POSTPONED_EVENT_DOMAIN
        }] : []);
        if (events.length === 0) return false;
        try {
            const response = await eventsApi.createPostponed(events.map(toCreateWireEvent));
            const persisted = readCreatedEvents(response.data, true);
            set((state) => ({
                postponedEvents: sortEventsByTimeThenTitle([...state.postponedEvents, ...persisted])
            }));
            await get().fetchPostponedEvents();
            return true;
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ actionError: errorText(error, getAppText().addEventUnavailable) });
            return false;
        }
    },

    addPostponedEvent: async (entry) => {
        if (!get().user || get().viewMode === 'friend' || !entry.title) return;
        const event = {
            ...createCalendarEvent(entry, ''),
            postponedView: entry.postponedView ?? DEFAULT_POSTPONED_EVENT_DOMAIN
        };
        try {
            const response = await eventsApi.createPostponed([toCreateWireEvent(event)]);
            const persisted = readCreatedEvents(response.data, true);
            set((state) => ({
                postponedEvents: sortEventsByTimeThenTitle([...state.postponedEvents, ...persisted])
            }));
            await get().fetchPostponedEvents();
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ actionError: errorText(error, getAppText().addEventUnavailable) });
        }
    },

    deletePostponedEvent: async (id) => {
        if (!get().user || get().viewMode === 'friend') return;
        const existing = get().postponedEvents.find((event) => event.id === id);
        if (!existing) return;
        try {
            await eventsApi.removePostponed(id, existing.revision ?? existing.version);
            set((state) => ({
                postponedEvents: state.postponedEvents.filter((event) => event.id !== id)
            }));
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ actionError: errorText(error, getAppText().updateEventUnavailable) });
        }
    },

    editPostponedEvent: async (event) => {
        if (!get().user || get().viewMode === 'friend') return false;
        try {
            const response = await eventsApi.updatePostponed(event.id, {
                ...toWireEvent(event),
                revision: event.revision ?? event.version
            });
            const data = response.data && typeof response.data === 'object' ? response.data : response;
            const revision = readRevision(data.revision ?? data.version)
                ?? event.revision ?? event.version ?? null;
            const persisted = { ...event, ...eventStatusFields(readEventStatus(event)), revision, version: revision };
            set((state) => ({
                postponedEvents: sortEventsByTimeThenTitle(state.postponedEvents.map((candidate) => (
                    candidate.id === persisted.id ? { ...candidate, ...persisted } : candidate
                )))
            }));
            return true;
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ actionError: errorText(error, getAppText().updateEventUnavailable) });
            return false;
        }
    },

    moveIncompleteEventsToDate: async (sourceDateKeys, targetDateKey) => {
        if (!get().user || get().viewMode === 'friend') return false;
        const sources = [...new Set(sourceDateKeys.filter((date) => date && date !== targetDateKey))];
        if (sources.length === 0 || !targetDateKey) return false;
        try {
            await eventsApi.moveIncomplete(sources, targetDateKey);
            await get().fetchEvents();
            return true;
        } catch (error) {
            if (isSessionError(error)) logoutAndReset();
            else set({ actionError: errorText(error, getAppText().updateEventUnavailable) });
            return false;
        }
    },

    toggleCompare: () => set((state) => ({ compareMode: !state.compareMode }))
});
