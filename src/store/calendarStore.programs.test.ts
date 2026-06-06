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
                data: [todayEvent, completedEvent, tomorrowEvent, pastEvent]
            }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', version: 200 }))
            .mockResolvedValueOnce(jsonResponse({
                message: 'success',
                data: [{ ...todayEvent, date: '2026-06-05', version: 200 }, completedEvent, tomorrowEvent, pastEvent]
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

    it('uses the program target offset when moving a missed source day', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 5, 6, 0));
        localStorage.setItem('program-last-check:user-1', String(new Date(2026, 5, 4, 6, 0).getTime()));

        const missedEvent: CalendarEvent = {
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
                data: [missedEvent]
            }))
            .mockResolvedValueOnce(jsonResponse({ message: 'success', version: 260 }))
            .mockResolvedValueOnce(jsonResponse({
                message: 'success',
                data: [{ ...missedEvent, date: '2026-06-07', version: 260 }]
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

});
