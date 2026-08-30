import { apiRequest, jsonBody } from './client';
import { parseSessionResponse, type SessionResponse, type User } from './contracts';

type AuthResponse = SessionResponse & { message?: 'success' };

export const authApi = {
    session: async () => parseSessionResponse(await apiRequest<unknown>('/session')),
    login: async (username: string, password: string) => parseSessionResponse(await apiRequest<unknown>('/login', {
        method: 'POST',
        body: jsonBody({ username, password })
    })) as AuthResponse,
    register: async (username: string, password: string) => parseSessionResponse(await apiRequest<unknown>('/register', {
        method: 'POST',
        body: jsonBody({ username, password })
    })) as AuthResponse,
    logout: () => apiRequest<{ message: 'success' }>('/logout', { method: 'POST' })
};

export const normalizeSessionUser = (user: User): User => ({
    ...user,
    avatar_url: user.avatarUrl ?? user.avatar_url ?? null
});
