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
        user: null,
        token: null,
        viewMode: 'self',
        actionError: null,
        events: {},
        compareEvents: {},
        programs: [],
        tomorrowProgramParameter: false,
        profile: null
    } as never);
};

describe('calendarStore programs', () => {
    afterEach(() => {
        resetStoreState();
        vi.restoreAllMocks();
        vi.useRealTimers();
        localStorage.clear();
    });

    it('moves only today incomplete events when the tomorrow parameter is activated', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 4, 10, 30));

        const todayEvent: CalendarEvent = {
            id: 'event-1',
            title: 'Open work',
            date: '2026-06-04',
            startTime: '09:00',
            completed: false,
            originDates: null
        };
        const completedEvent: CalendarEvent = {
            id: 'event-2',
            title: 'Done work',
            date: '2026-06-04',
            startTime: '10:00',
            completed: true,
            originDates: null
        };
        const failedEvent: CalendarEvent = {
            id: 'event-5',
            title: 'Failed work',
            date: '2026-06-04',
            startTime: '10:30',
            completed: false,
            failed: true,
            originDates: null
        };
        const tomorrowEvent: CalendarEvent = {
            id: 'event-3',
            title: 'Already tomorrow',
            date: '2026-06-05',
            startTime: '11:00',
            completed: false,
            originDates: null
        };
        const pastEvent: CalendarEvent = {
            id: 'event-4',
            title: 'Past open work',
            date: '2026-06-03',
            startTime: '08:00',
            completed: false,
            originDates: null
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({
                message: 'success',
                data: [todayEvent, completedEvent, failedEvent, tomorrowEvent, pastEvent]
            }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', version: 200 }))
            .mockResolvedValueOnce(jsonResponse({
                message: 'success',
                data: [{ ...todayEvent, date: '2026-06-05', version: 200 }, completedEvent, failedEvent, tomorrowEvent, pastEvent]
            }));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'ada' },
            viewMode: 'self'
        } as never);

        const didRun = await useCalendarStore.getState().setTomorrowProgramParameter(true);

        expect(didRun).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[1][0]).toBe(`${API_URL}/events/event-1`);
        expect(fetchMock.mock.calls.some((call) => call[0] === `${API_URL}/events/event-4`)).toBe(false);
        expect(fetchMock.mock.calls.some((call) => call[0] === `${API_URL}/events/event-5`)).toBe(false);
        const requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
        expect(requestBody.date).toBe('2026-06-05');
        expect(requestBody.resources).toEqual({ originDates: ['2026-06-04'] });
        expect(useCalendarStore.getState().tomorrowProgramParameter).toBe(false);
    });

    it('preserves existing profile preferences when saving programs', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ message: 'success' }))
            .mockResolvedValueOnce(jsonResponse({
                message: 'success',
                data: {
                    id: 'user-1',
                    username: 'ada',
                    avatar_url: null,
                    preferences: {
                        accentColor: '#123456',
                        programs: [{
                            id: 'program-1',
                            name: 'To Tomorrow Program',
                            activationTime: '06:30',
                            isEnabled: true
                        }]
                    },
                    isAdmin: false
                }
            }));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'ada' },
            profile: {
                id: 'user-1',
                username: 'ada',
                preferences: {
                    accentColor: '#123456'
                }
            }
        } as never);

        await useCalendarStore.getState().savePrograms([{
            id: 'program-1',
            name: 'To Tomorrow Program',
            activationTime: '06:30',
            isEnabled: true
        }]);

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(requestBody.preferences.accentColor).toBe('#123456');
        expect(requestBody.preferences.programs[0].activationTime).toBe('06:30');
        expect(useCalendarStore.getState().programs[0].isEnabled).toBe(true);
    });

    it('runs an enabled program at its activation time and closes the session with the protocol message', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 4, 6, 30));

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ message: 'success', data: [] }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', data: [] }));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'ada' },
            viewMode: 'self',
            programs: [{
                id: 'program-1',
                name: 'To Tomorrow Program',
                activationTime: '06:30',
                isEnabled: true
            }]
        } as never);

        await useCalendarStore.getState().checkAutomaticPrograms();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(useCalendarStore.getState().user).toBeNull();
        expect(useCalendarStore.getState().token).toBeNull();
        expect(useCalendarStore.getState().error).toBe('Tomorrow program activated, to disable, please go to Programs section.');
        expect(localStorage.getItem('program-run:user-1:program-1:06:30:2026-06-04')).toBe('1');
        expect(localStorage.getItem('program-pending-days:user-1:program-1')).toBeNull();
    });

    it('seeds today as pending for enabled programs before the activation time', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 19, 6, 0));
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'ada' },
            viewMode: 'self',
            programs: [{
                id: 'program-1',
                name: 'To Tomorrow Program',
                activationTime: '06:30',
                isEnabled: true,
                targetOffsetDays: 1
            }]
        } as never);

        await useCalendarStore.getState().checkAutomaticPrograms();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem('program-pending-days:user-1:program-1') || '[]')).toEqual(['2026-06-19']);
    });

    it('moves stale pending program days directly into the current day', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 19, 10, 0));
        localStorage.setItem('program-pending-days:user-1:program-1', JSON.stringify(['2026-06-17']));

        const staleEvent: CalendarEvent = {
            id: 'event-1',
            title: 'Stale work',
            date: '2026-06-17',
            startTime: '09:00',
            completed: false,
            originDates: null
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({
                message: 'success',
                data: [staleEvent]
            }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', version: 300 }))
            .mockResolvedValueOnce(jsonResponse({
                message: 'success',
                data: [{ ...staleEvent, date: '2026-06-19', version: 300 }]
            }));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'ada' },
            viewMode: 'self',
            programs: [{
                id: 'program-1',
                name: 'To Tomorrow Program',
                activationTime: '06:30',
                isEnabled: true,
                targetOffsetDays: 1
            }]
        } as never);

        await useCalendarStore.getState().checkAutomaticPrograms();

        const requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
        expect(requestBody.date).toBe('2026-06-19');
        expect(requestBody.resources).toEqual({ originDates: ['2026-06-17'] });
        expect(JSON.parse(localStorage.getItem('program-pending-days:user-1:program-1') || '[]')).toEqual(['2026-06-19']);
        expect(localStorage.getItem('program-run:user-1:program-1:06:30:2026-06-17')).toBe('1');
        expect(useCalendarStore.getState().error).toBe('Tomorrow program activated, to disable, please go to Programs section.');
    });

    it('keeps stale pending days retryable when a catch-up move fails', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 19, 10, 0));
        const previousCheck = new Date(2026, 5, 17, 6, 0).getTime();
        localStorage.setItem('program-last-check:user-1', String(previousCheck));
        localStorage.setItem('program-pending-days:user-1:program-1', JSON.stringify(['2026-06-17']));

        const staleEvent: CalendarEvent = {
            id: 'event-1',
            title: 'Stale work',
            date: '2026-06-17',
            startTime: '09:00',
            completed: false,
            originDates: null
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ message: 'success', data: [staleEvent] }))
            .mockResolvedValueOnce(jsonResponse({ error: 'Failed to update event' }, 500));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'ada' },
            viewMode: 'self',
            programs: [{
                id: 'program-1',
                name: 'To Tomorrow Program',
                activationTime: '06:30',
                isEnabled: true,
                targetOffsetDays: 1
            }]
        } as never);

        await useCalendarStore.getState().checkAutomaticPrograms();

        expect(Number(localStorage.getItem('program-last-check:user-1'))).toBe(previousCheck);
        expect(JSON.parse(localStorage.getItem('program-pending-days:user-1:program-1') || '[]')).toEqual(['2026-06-17', '2026-06-19']);
        expect(localStorage.getItem('program-run:user-1:program-1:06:30:2026-06-17')).toBeNull();
        expect(useCalendarStore.getState().user?.id).toBe('user-1');
    });

    it('does not advance the last check when a later catch-up move fails after an earlier success', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 21, 10, 0));
        const previousCheck = new Date(2026, 5, 19, 6, 0).getTime();
        localStorage.setItem('program-last-check:user-1', String(previousCheck));
        localStorage.setItem('program-pending-days:user-1:program-1', JSON.stringify(['2026-06-19']));

        const june19Event: CalendarEvent = {
            id: 'event-19',
            title: 'June 19 work',
            date: '2026-06-19',
            startTime: '09:00',
            completed: false,
            originDates: null
        };
        const june20Event: CalendarEvent = {
            id: 'event-20',
            title: 'June 20 work',
            date: '2026-06-20',
            startTime: '10:00',
            completed: false,
            originDates: null
        };
        const movedJune19Event = { ...june19Event, date: '2026-06-21', version: 240 };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ message: 'success', data: [june19Event, june20Event] }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', version: 240 }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', data: [movedJune19Event, june20Event] }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', data: [movedJune19Event, june20Event] }))
            .mockResolvedValueOnce(jsonResponse({ error: 'Failed to update event' }, 500));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'ada' },
            viewMode: 'self',
            programs: [{
                id: 'program-1',
                name: 'To Tomorrow Program',
                activationTime: '06:30',
                isEnabled: true,
                targetOffsetDays: 1
            }]
        } as never);

        await useCalendarStore.getState().checkAutomaticPrograms();

        expect(Number(localStorage.getItem('program-last-check:user-1'))).toBe(previousCheck);
        expect(localStorage.getItem('program-run:user-1:program-1:06:30:2026-06-19')).toBe('1');
        expect(localStorage.getItem('program-run:user-1:program-1:06:30:2026-06-20')).toBeNull();
        expect(JSON.parse(localStorage.getItem('program-pending-days:user-1:program-1') || '[]')).toEqual(['2026-06-21']);
        expect(useCalendarStore.getState().user?.id).toBe('user-1');
    });

    it('runs a missed enabled program after the system was inactive past the activation time', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 5, 6, 0));
        localStorage.setItem('program-last-check:user-1', String(new Date(2026, 5, 4, 6, 0).getTime()));

        const missedEvent: CalendarEvent = {
            id: 'event-1',
            title: 'Missed work',
            date: '2026-06-04',
            startTime: '09:00',
            completed: false,
            originDates: null
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({
                message: 'success',
                data: [missedEvent]
            }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', version: 250 }))
            .mockResolvedValueOnce(jsonResponse({
                message: 'success',
                data: [{ ...missedEvent, date: '2026-06-05', version: 250 }]
            }));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'ada' },
            viewMode: 'self',
            programs: [{
                id: 'program-1',
                name: 'To Tomorrow Program',
                activationTime: '06:30',
                isEnabled: true,
                targetOffsetDays: 1
            }]
        } as never);

        await useCalendarStore.getState().checkAutomaticPrograms();

        expect(fetchMock).toHaveBeenCalledTimes(3);
        const requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
        expect(requestBody.date).toBe('2026-06-05');
        expect(requestBody.resources).toEqual({ originDates: ['2026-06-04'] });
        expect(localStorage.getItem('program-run:user-1:program-1:06:30:2026-06-04')).toBe('1');
        expect(Number(localStorage.getItem('program-last-check:user-1'))).toBe(new Date(2026, 5, 5, 6, 0).getTime());
        expect(useCalendarStore.getState().error).toBe('Tomorrow program activated, to disable, please go to Programs section.');
    });

    it('uses the program target offset for a current-day activation', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 4, 6, 30));
        localStorage.setItem('program-last-check:user-1', String(new Date(2026, 5, 4, 6, 0).getTime()));

        const todayEvent: CalendarEvent = {
            id: 'event-1',
            title: 'Later work',
            date: '2026-06-04',
            startTime: '09:00',
            completed: false,
            originDates: null
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({
                message: 'success',
                data: [todayEvent]
            }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', version: 260 }))
            .mockResolvedValueOnce(jsonResponse({
                message: 'success',
                data: [{ ...todayEvent, date: '2026-06-07', version: 260 }]
            }));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'ada' },
            viewMode: 'self',
            programs: [{
                id: 'program-1',
                name: 'To Tomorrow Program',
                activationTime: '06:30',
                isEnabled: true,
                targetOffsetDays: 3
            }]
        } as never);

        await useCalendarStore.getState().checkAutomaticPrograms();

        const requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
        expect(requestBody.date).toBe('2026-06-07');
    });

    it('does not consume a missed check before enabled programs have loaded', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 15, 6, 0));
        const previousCheck = new Date(2026, 5, 13, 6, 0).getTime();
        localStorage.setItem('program-last-check:user-1', String(previousCheck));
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'ada' },
            viewMode: 'self',
            programs: [{
                id: 'program-1',
                name: 'To Tomorrow Program',
                activationTime: '06:30',
                isEnabled: false,
                targetOffsetDays: 1
            }]
        } as never);

        await useCalendarStore.getState().checkAutomaticPrograms();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(Number(localStorage.getItem('program-last-check:user-1'))).toBe(previousCheck);
    });

    it('recovers stored and reconstructed closed-app days into the current day', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 21, 10, 0));
        localStorage.setItem('program-last-check:user-1', String(new Date(2026, 5, 19, 6, 0).getTime()));
        localStorage.setItem('program-pending-days:user-1:program-1', JSON.stringify(['2026-06-19']));

        const june19Event: CalendarEvent = {
            id: 'event-19',
            title: 'June 19 work',
            date: '2026-06-19',
            startTime: '09:00',
            completed: false,
            originDates: null
        };
        const june20Event: CalendarEvent = {
            id: 'event-20',
            title: 'June 20 work',
            date: '2026-06-20',
            startTime: '10:00',
            completed: false,
            originDates: null
        };
        const movedJune19Event = { ...june19Event, date: '2026-06-21', version: 240 };
        const movedJune20Event = { ...june20Event, date: '2026-06-21', version: 250 };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ message: 'success', data: [june19Event, june20Event] }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', version: 240 }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', data: [movedJune19Event, june20Event] }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', data: [movedJune19Event, june20Event] }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', version: 250 }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', data: [movedJune19Event, movedJune20Event] }));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'ada' },
            viewMode: 'self',
            programs: [{
                id: 'program-1',
                name: 'To Tomorrow Program',
                activationTime: '06:30',
                isEnabled: true,
                targetOffsetDays: 1
            }]
        } as never);

        await useCalendarStore.getState().checkAutomaticPrograms();

        const updateBodies = fetchMock.mock.calls
            .filter((call) => String(call[0]).startsWith(`${API_URL}/events/event-`))
            .map((call) => JSON.parse(String(call[1]?.body)));

        expect(updateBodies).toEqual([
            expect.objectContaining({ date: '2026-06-21', resources: { originDates: ['2026-06-19'] } }),
            expect.objectContaining({ date: '2026-06-21', resources: { originDates: ['2026-06-20'] } })
        ]);
        expect(localStorage.getItem('program-run:user-1:program-1:06:30:2026-06-19')).toBe('1');
        expect(localStorage.getItem('program-run:user-1:program-1:06:30:2026-06-20')).toBe('1');
        expect(localStorage.getItem('program-run:user-1:program-1:06:30:2026-06-21')).toBeNull();
        expect(JSON.parse(localStorage.getItem('program-pending-days:user-1:program-1') || '[]')).toEqual(['2026-06-21']);
    });

});
