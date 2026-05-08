import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../utils/api';
import { useCalendarStore } from './calendarStore';

describe('calendarStore event sharing', () => {
    afterEach(() => {
        useCalendarStore.setState({
            user: null,
            token: null,
            viewMode: 'self',
            actionError: null
        } as never);
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('posts selected friends and days to the share events endpoint', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ message: 'success', count: 1 })
        });
        vi.stubGlobal('fetch', fetchMock);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'mira', isAdmin: false },
            viewMode: 'self'
        } as never);

        const result = await useCalendarStore.getState().shareEventsToFriends(['friend-1'], ['2026-04-23']);

        expect(result).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/friends/share-events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer token-123'
            },
            body: JSON.stringify({
                friendIds: ['friend-1'],
                dateKeys: ['2026-04-23']
            })
        });
    });
});
