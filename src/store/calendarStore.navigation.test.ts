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
            token: null,
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

    it('keeps event state and reports action errors when adding an event fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Server Error',
            json: async () => ({ error: 'Database unavailable' })
        }) as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'mira' },
            viewMode: 'self',
            events: {}
        } as never);

        const didAdd = await useCalendarStore.getState().addEvent(new Date(2026, 3, 23), {
            title: 'New planning block'
        });

        expect(didAdd).toBe(false);
        expect(useCalendarStore.getState().events['2026-04-23']).toBeUndefined();
        expect(useCalendarStore.getState().actionError).toBe('Database unavailable');
    });

    it('does not show user directory load failures on the calendar page', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'mira' },
            currentView: 'calendar',
            socialError: null
        } as never);

        await useCalendarStore.getState().fetchUsers();

        expect(useCalendarStore.getState().socialError).toBeNull();
    });

    it('shows user directory load failures in the friends page', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'mira' },
            currentView: 'friends',
            socialError: null
        } as never);

        await useCalendarStore.getState().fetchUsers();

        expect(useCalendarStore.getState().socialError).toBe('Unable to load users');
    });
});
