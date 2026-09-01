import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../utils/api';
import { useCalendarStore } from './calendarStore';

describe('calendarStore profile updates', () => {
    afterEach(() => {
        useCalendarStore.setState({
            user: null,
            sessionStatus: 'anonymous',
            profile: null,
            localPreferences: null
        });
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('refreshes profile after update to include avatar', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'success' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                    message: 'success',
                    data: {
                        id: 'user-1',
                        username: 'example-user',
                        avatar_url: '/attachments/avatar-1',
                        preferences: { noiseOverlay: true },
                        isAdmin: false
                    }
                }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            }));
        vi.stubGlobal('fetch', fetchMock);

        useCalendarStore.setState({
            user: { id: 'user-1', username: 'example-user', isAdmin: false }
        });

        await useCalendarStore.getState().updateProfile({ avatar_url: `${API_URL}/attachments/avatar-1` });

        const state = useCalendarStore.getState();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/me`);
        expect(fetchMock.mock.calls[0][1]?.method).toBe('PUT');
        expect(fetchMock.mock.calls[1][0]).toBe(`${API_URL}/me`);
        expect(state.profile?.avatar_url).toBe(`${API_URL}/attachments/avatar-1`);
        expect(state.user?.avatar_url).toBe(`${API_URL}/attachments/avatar-1`);
        const storedUser = JSON.parse(localStorage.getItem('user') || 'null');
        const storedProfile = JSON.parse(localStorage.getItem('profile') || 'null');
        expect(storedUser.avatar_url).toBe(`${API_URL}/attachments/avatar-1`);
        expect(storedProfile.avatar_url).toBe(`${API_URL}/attachments/avatar-1`);
    });

    it('reports a rejected profile update without claiming success', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            error: { code: 'USERNAME_UNAVAILABLE' },
            requestId: 'profile-conflict'
        }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' }
        })));
        useCalendarStore.setState({
            user: { id: 'user-1', username: 'example-user', isAdmin: false },
            actionError: null
        });

        const saved = await useCalendarStore.getState().updateProfile({ username: 'taken-user' });

        expect(saved).toBe(false);
        expect(useCalendarStore.getState().actionError).toBeTruthy();
    });

    it('changes the password through the authenticated profile API and resets the revoked session', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'success' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        }));
        vi.stubGlobal('fetch', fetchMock);
        useCalendarStore.setState({
            user: { id: 'user-1', username: 'example-user', isAdmin: false },
            sessionStatus: 'authenticated',
            actionError: null
        });

        const changed = await useCalendarStore.getState().changePassword('old password', '12345678');

        expect(changed).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/me/password`, expect.objectContaining({
            method: 'PUT',
            credentials: 'same-origin'
        }));
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
            currentPassword: 'old password',
            newPassword: '12345678'
        });
        expect(useCalendarStore.getState()).toMatchObject({
            user: null,
            sessionStatus: 'anonymous'
        });
    });
});
