import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../utils/api';
import { useCalendarStore, type CalendarEvent } from './calendarStore';

const jsonResponse = (data: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    json: async () => data
});

const resetStoreState = () => {
    useCalendarStore.setState({
        token: null,
        viewMode: 'self',
        actionError: null,
        events: {},
        postponedEvents: [],
        compareEvents: {},
        viewingPreferences: null,
        profile: null
    } as never);
};

describe('calendarStore completed events', () => {
    afterEach(() => {
        resetStoreState();
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('maps completed flags from the events API response', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({
                message: 'success',
                data: [
                    {
                        id: 'event-1',
                        title: 'Finish report',
                        date: '2026-04-23',
                        startTime: '09:00',
                        priority: 1,
                        note: null,
                        link: null,
                        completed: 1,
                        resources: null
                    }
                ]
            })
        );
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            viewMode: 'self'
        } as never);

        await useCalendarStore.getState().fetchEvents();

        const storedEvent = useCalendarStore.getState().events['2026-04-23']?.[0];
        expect(storedEvent?.completed).toBe(true);
    });

    it('sends completed when editing an event and keeps the refreshed state', async () => {
        const editedEvent: CalendarEvent = {
            id: 'event-1',
            title: 'Finish report',
            date: '2026-04-23',
            startTime: '09:00',
            priority: 1,
            note: null,
            link: null,
            completed: true,
            originDates: null,
            wasPostponed: null
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ message: 'success' }));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            viewMode: 'self',
            events: {
                '2026-04-23': [{
                    ...editedEvent,
                    completed: false
                }]
            }
        } as never);

        const didEdit = await useCalendarStore.getState().editEvent(editedEvent);

        expect(didEdit).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/events/event-1`);
        const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(requestBody.completed).toBe(true);
        expect(useCalendarStore.getState().events['2026-04-23']?.[0]?.completed).toBe(true);
        expect(useCalendarStore.getState().actionError).toBeNull();
    });

    it('only marks an event completed after the completion request succeeds', async () => {
        const event: CalendarEvent = {
            id: 'event-1',
            title: 'Finish report',
            date: '2026-04-23',
            startTime: '09:00',
            priority: 1,
            note: null,
            link: null,
            completed: false,
            version: 100,
            unlockDate: null,
            originDates: null,
            wasPostponed: null
        };
        let resolveFetch: (value: ReturnType<typeof jsonResponse>) => void = () => {};
        const fetchPromise = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
            resolveFetch = resolve;
        });
        const fetchMock = vi.fn().mockReturnValue(fetchPromise);
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            viewMode: 'self',
            events: {
                '2026-04-23': [event]
            },
            compareEvents: {
                '2026-04-23': [event]
            }
        } as never);

        const completionPromise = useCalendarStore.getState().setEventCompleted(event, true);

        expect(useCalendarStore.getState().events['2026-04-23']?.[0]?.completed).toBe(false);
        expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/events/event-1/completed`, expect.objectContaining({
            method: 'PATCH'
        }));

        resolveFetch(jsonResponse({
            message: 'success',
            data: {
                id: 'event-1',
                completed: 1,
                version: 200
            }
        }));

        await completionPromise;

        expect(useCalendarStore.getState().events['2026-04-23']?.[0]?.completed).toBe(true);
        expect(useCalendarStore.getState().events['2026-04-23']?.[0]?.version).toBe(200);
        expect(useCalendarStore.getState().compareEvents['2026-04-23']?.[0]?.completed).toBe(true);
        expect(useCalendarStore.getState().actionError).toBeNull();
    });

    it('keeps completion unchanged when the completion request fails', async () => {
        const event: CalendarEvent = {
            id: 'event-1',
            title: 'Finish report',
            date: '2026-04-23',
            startTime: '09:00',
            priority: 1,
            note: null,
            link: null,
            completed: false,
            originDates: null,
            wasPostponed: null
        };
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({ error: 'Failed to update event completion' }, 500)
        );
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            viewMode: 'self',
            events: {
                '2026-04-23': [event]
            }
        } as never);

        const didUpdate = await useCalendarStore.getState().setEventCompleted(event, true);

        expect(didUpdate).toBe(false);
        expect(useCalendarStore.getState().events['2026-04-23']?.[0]?.completed).toBe(false);
        expect(useCalendarStore.getState().actionError).toBe('Failed to update event completion');
    });

    it('falls back to the full event update when the completion endpoint is not available', async () => {
        const event: CalendarEvent = {
            id: 'event-1',
            title: 'Finish report',
            date: '2026-04-23',
            startTime: '09:00',
            priority: 1,
            note: null,
            link: null,
            completed: false,
            version: 100,
            unlockDate: null,
            originDates: null,
            wasPostponed: null
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ error: 'Not Found' }, 404))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', version: 250 }));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            viewMode: 'self',
            events: {
                '2026-04-23': [event]
            },
            compareEvents: {
                '2026-04-23': [event]
            }
        } as never);

        const didUpdate = await useCalendarStore.getState().setEventCompleted(event, true);

        expect(didUpdate).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/events/event-1/completed`);
        expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH');
        expect(fetchMock.mock.calls[1][0]).toBe(`${API_URL}/events/event-1`);
        expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
        const fallbackBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
        expect(fallbackBody.completed).toBe(true);
        expect(useCalendarStore.getState().events['2026-04-23']?.[0]?.completed).toBe(true);
        expect(useCalendarStore.getState().events['2026-04-23']?.[0]?.version).toBe(250);
        expect(useCalendarStore.getState().actionError).toBeNull();
    });

    it('does not let an older events refresh overwrite a newer completion save', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({
                message: 'success',
                data: [
                    {
                        id: 'event-1',
                        title: 'Finish report',
                        date: '2026-04-23',
                        startTime: '09:00',
                        priority: 1,
                        note: null,
                        link: null,
                        completed: 0,
                        version: 200,
                        resources: null
                    }
                ]
            })
        );
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            viewMode: 'self',
            events: {
                '2026-04-23': [{
                    id: 'event-1',
                    title: 'Finish report',
                    date: '2026-04-23',
                    startTime: '09:00',
                    priority: 1,
                    note: null,
                    link: null,
                    completed: true,
                    version: 300,
                    originDates: null,
                    wasPostponed: null
                }]
            }
        } as never);

        await useCalendarStore.getState().fetchEvents();

        const storedEvent = useCalendarStore.getState().events['2026-04-23']?.[0];
        expect(storedEvent?.completed).toBe(true);
        expect(storedEvent?.version).toBe(300);
    });

    it('preserves local completion when an older API response omits the completed field', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({
                message: 'success',
                data: [
                    {
                        id: 'event-1',
                        title: 'Finish report',
                        date: '2026-04-23',
                        startTime: '09:00',
                        priority: 1,
                        note: null,
                        link: null,
                        version: 300,
                        resources: null
                    }
                ]
            })
        );
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            viewMode: 'self',
            events: {
                '2026-04-23': [{
                    id: 'event-1',
                    title: 'Finish report',
                    date: '2026-04-23',
                    startTime: '09:00',
                    priority: 1,
                    note: null,
                    link: null,
                    completed: true,
                    version: 300,
                    originDates: null,
                    wasPostponed: null
                }]
            }
        } as never);

        await useCalendarStore.getState().fetchEvents();

        expect(useCalendarStore.getState().events['2026-04-23']?.[0]?.completed).toBe(true);
    });

    it('moves an edited event to its new date without needing a refetch', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({ message: 'success' })
        );
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            viewMode: 'self',
            events: {
                '2026-04-23': [{
                    id: 'event-1',
                    title: 'Finish report',
                    date: '2026-04-23',
                    startTime: '09:00',
                    priority: 1,
                    note: null,
                    link: null,
                    completed: false,
                    originDates: null,
                    wasPostponed: null
                }]
            },
            compareEvents: {
                '2026-04-23': [{
                    id: 'event-1',
                    title: 'Finish report',
                    date: '2026-04-23',
                    startTime: '09:00',
                    priority: 1,
                    note: null,
                    link: null,
                    completed: false,
                    originDates: null,
                    wasPostponed: null
                }]
            }
        } as never);

        const didEdit = await useCalendarStore.getState().editEvent({
            id: 'event-1',
            title: 'Finish report',
            date: '2026-04-24',
            startTime: '09:00',
            priority: 1,
            note: null,
            link: null,
            completed: true,
            originDates: null,
            wasPostponed: null
        });

        expect(didEdit).toBe(true);
        expect(useCalendarStore.getState().events['2026-04-23']).toBeUndefined();
        expect(useCalendarStore.getState().events['2026-04-24']?.[0]?.completed).toBe(true);
        expect(useCalendarStore.getState().compareEvents['2026-04-24']?.[0]?.completed).toBe(true);
    });

    it('keeps the previous completion state when an edit request fails', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({ error: 'Failed to update event' }, 500)
        );
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            viewMode: 'self',
            events: {
                '2026-04-23': [{
                    id: 'event-1',
                    title: 'Finish report',
                    date: '2026-04-23',
                    startTime: '09:00',
                    priority: 1,
                    note: null,
                    link: null,
                    completed: false,
                    originDates: null,
                    wasPostponed: null
                }]
            }
        } as never);

        const didEdit = await useCalendarStore.getState().editEvent({
            id: 'event-1',
            title: 'Finish report',
            date: '2026-04-23',
            startTime: '09:00',
            priority: 1,
            note: null,
            link: null,
            completed: true,
            originDates: null,
            wasPostponed: null
        });

        expect(didEdit).toBe(false);
        expect(useCalendarStore.getState().events['2026-04-23']?.[0]?.completed).toBe(false);
        expect(useCalendarStore.getState().actionError).toBe('Failed to update event');
    });

    it('maps completed flags from the postponed events API response', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({
                message: 'success',
                data: [
                    {
                        id: 'postponed-1',
                        title: 'Deferred audit',
                        date: '',
                        startTime: '10:00',
                        priority: 2,
                        note: null,
                        link: null,
                        completed: 1,
                        resources: JSON.stringify({ postponedView: 'all' })
                    }
                ]
            })
        );
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            viewMode: 'self'
        } as never);

        await useCalendarStore.getState().fetchPostponedEvents();

        expect(useCalendarStore.getState().postponedEvents[0]?.completed).toBe(true);
    });

    it('maps the Today postponed domain from the postponed events API response', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({
                message: 'success',
                data: [
                    {
                        id: 'postponed-today-1',
                        title: 'Today deferred audit',
                        date: '',
                        startTime: '10:00',
                        priority: 2,
                        note: null,
                        link: null,
                        completed: 0,
                        resources: JSON.stringify({ postponedView: 'today' })
                    }
                ]
            })
        );
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            viewMode: 'self'
        } as never);

        await useCalendarStore.getState().fetchPostponedEvents();

        expect(useCalendarStore.getState().postponedEvents[0]?.postponedView).toBe('today');
    });
});
