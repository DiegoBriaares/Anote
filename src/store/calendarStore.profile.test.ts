import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../utils/api';
import { useCalendarStore } from './calendarStore';

describe('calendarStore profile updates', () => {
    afterEach(() => {
        useCalendarStore.setState({
            user: null,
            token: null,
            profile: null,
            localPreferences: null
        } as any);
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('refreshes profile after update to include avatar', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ message: 'success' }) })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    message: 'success',
                    data: {
                        id: 'user-1',
                        username: 'example-user',
                        avatar_url: '/uploads/avatar.png',
                        preferences: { noiseOverlay: true },
                        isAdmin: false
                    }
                })
            });
        vi.stubGlobal('fetch', fetchMock as any);

        useCalendarStore.setState({
            token: 'token-123',
            user: { id: 'user-1', username: 'example-user', isAdmin: false }
        } as any);

        await useCalendarStore.getState().updateProfile({ avatar_url: `${API_URL}/uploads/avatar.png` });

        const state = useCalendarStore.getState();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/me`);
        expect(fetchMock.mock.calls[0][1]?.method).toBe('PUT');
        expect(fetchMock.mock.calls[1][0]).toBe(`${API_URL}/me`);
        expect(state.profile?.avatar_url).toBe(`${API_URL}/uploads/avatar.png`);
        expect(state.user?.avatar_url).toBe(`${API_URL}/uploads/avatar.png`);
        const storedUser = JSON.parse(localStorage.getItem('user') || 'null');
        const storedProfile = JSON.parse(localStorage.getItem('profile') || 'null');
        expect(storedUser.avatar_url).toBe(`${API_URL}/uploads/avatar.png`);
        expect(storedProfile.avatar_url).toBe(`${API_URL}/uploads/avatar.png`);
    });
});
