import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCalendarStore } from './calendarStore';

describe('calendarStore day administration navigation', () => {
    afterEach(() => {
        useCalendarStore.setState({
            currentView: 'calendar',
            dayAdministrationDate: null,
            actionError: null,
            socialError: null,
            events: {},
            users: [],
            user: null,
            sessionStatus: 'anonymous',
            viewMode: 'self'
        } as never);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('opens day administration for a Date value', () => {
        useCalendarStore.getState().navigateToDayAdministration(new Date(2026, 3, 23));

        expect(useCalendarStore.getState().currentView).toBe('day-administration');
        expect(useCalendarStore.getState().dayAdministrationDate).toBe('2026-04-23');
    });

    it('opens day administration for an existing date key', () => {
        useCalendarStore.getState().navigateToDayAdministration('2026-04-24');

        expect(useCalendarStore.getState().currentView).toBe('day-administration');
        expect(useCalendarStore.getState().dayAdministrationDate).toBe('2026-04-24');
    });

    it('ignores non-message arguments when logging out', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'success' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })));
        useCalendarStore.setState({
            user: { id: 'user-1', username: 'mira' },
            sessionStatus: 'authenticated',
            currentView: 'profile',
            error: null
        } as never);

        await (useCalendarStore.getState().logout as unknown as (message: unknown) => Promise<void>)({ type: 'click' });

        expect(useCalendarStore.getState().user).toBeNull();
        expect(useCalendarStore.getState().sessionStatus).toBe('anonymous');
        expect(useCalendarStore.getState().currentView).toBe('calendar');
        expect(useCalendarStore.getState().error).toBeNull();
    });

    it('keeps event state and reports action errors when adding an event fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            error: { code: 'REQUEST_FAILED' },
            requestId: 'request-1'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        })) as unknown as typeof fetch);

        useCalendarStore.setState({
            user: { id: 'user-1', username: 'mira' },
            sessionStatus: 'authenticated',
            viewMode: 'self',
            events: {}
        } as never);

        const didAdd = await useCalendarStore.getState().addEvent(new Date(2026, 3, 23), {
            title: 'New planning block'
        });

        expect(didAdd).toBe(false);
        expect(useCalendarStore.getState().events['2026-04-23']).toBeUndefined();
        expect(useCalendarStore.getState().actionError).toBe('That action could not be completed. Try again.');
    });

    it('leaves durable event identity to the API', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                message: 'success',
                data: [{ id: 'server-event-1', revision: 1, version: 1 }]
            }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                message: 'success',
                data: [{
                    id: 'server-event-1',
                    title: 'New planning block',
                    date: '2026-04-23',
                    revision: 1
                }]
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
        useCalendarStore.setState({
            user: { id: 'user-1', username: 'mira' },
            sessionStatus: 'authenticated',
            viewMode: 'self',
            events: {}
        } as never);

        expect(await useCalendarStore.getState().addEvent(new Date(2026, 3, 23), {
            title: 'New planning block'
        })).toBe(true);

        const createBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(createBody.events[0]).not.toHaveProperty('id');
        expect(useCalendarStore.getState().events['2026-04-23'][0].id).toBe('server-event-1');
    });

    it('does not show user directory load failures on the calendar page', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch);

        useCalendarStore.setState({
            user: { id: 'user-1', username: 'mira' },
            sessionStatus: 'authenticated',
            currentView: 'calendar',
            socialError: null
        } as never);

        await useCalendarStore.getState().fetchUsers();

        expect(useCalendarStore.getState().socialError).toBeNull();
    });

    it('shows user directory load failures in the friends page', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch);

        useCalendarStore.setState({
            user: { id: 'user-1', username: 'mira' },
            sessionStatus: 'authenticated',
            currentView: 'friends',
            socialError: null
        } as never);

        await useCalendarStore.getState().fetchUsers();

        expect(useCalendarStore.getState().socialError).toBe('Anote is unavailable right now. Check your connection and try again.');
    });
});
