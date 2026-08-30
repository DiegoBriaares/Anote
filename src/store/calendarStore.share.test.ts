import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../utils/api';
import { useCalendarStore } from './calendarStore';

describe('calendarStore event sharing', () => {
    afterEach(() => {
        useCalendarStore.setState({
            user: null,
            sessionStatus: 'anonymous',
            viewMode: 'self',
            actionError: null
        } as never);
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('posts selected friends and days to the share events endpoint', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'success', count: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        }));
        vi.stubGlobal('fetch', fetchMock);

        useCalendarStore.setState({
            user: { id: 'user-1', username: 'mira', isAdmin: false },
            sessionStatus: 'authenticated',
            viewMode: 'self'
        } as never);

        const result = await useCalendarStore.getState().shareEventsToFriends(['friend-1'], ['2026-04-23']);

        expect(result).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/friends/share-events`, expect.objectContaining({
            method: 'POST',
            credentials: 'same-origin',
            body: JSON.stringify({
                friendIds: ['friend-1'],
                dateKeys: ['2026-04-23']
            })
        }));
        const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
        expect(headers.get('Content-Type')).toBe('application/json');
        expect(headers.has('Authorization')).toBe(false);
    });

    it('includes selected event ids when sharing is filtered', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'success', count: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        }));
        vi.stubGlobal('fetch', fetchMock);

        useCalendarStore.setState({
            user: { id: 'user-1', username: 'mira', isAdmin: false },
            sessionStatus: 'authenticated',
            viewMode: 'self'
        } as never);

        const result = await useCalendarStore.getState().shareEventsToFriends(
            ['friend-1'],
            ['2026-04-23'],
            ['event-1']
        );

        expect(result).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/friends/share-events`, expect.objectContaining({
            method: 'POST',
            credentials: 'same-origin',
            body: JSON.stringify({
                friendIds: ['friend-1'],
                dateKeys: ['2026-04-23'],
                eventIds: ['event-1']
            })
        }));
        const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
        expect(headers.get('Content-Type')).toBe('application/json');
        expect(headers.has('Authorization')).toBe(false);
    });
});
