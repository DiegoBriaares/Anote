import { authApi, normalizeSessionUser } from '../../api/auth';
import { ApiError } from '../../api/client';
import { getApiErrorText, getAppText } from '../../i18n/appText';
import { normalizeApiAssetUrl } from '../../utils/api';
import { storage } from '../../utils/storage';

import type { CalendarState } from '../calendarStore';
import type { OwnerContext } from './types';

type SessionOwner = Pick<CalendarState,
    'restoreSession' | 'login' | 'register' | 'logout' | 'clearActionError'
>;

const normalizeUser = (candidate: Parameters<typeof normalizeSessionUser>[0]) => {
    const user = normalizeSessionUser(candidate);
    return {
        ...user,
        avatar_url: normalizeApiAssetUrl(user.avatar_url) || undefined
    };
};

export const createSessionOwner = ({ set, logoutAndReset }: OwnerContext): SessionOwner => ({
    clearActionError: () => set({ actionError: null }),

    restoreSession: async () => {
        // Legacy bearer credentials are never reused after the session migration.
        storage.removeItem('token');
        try {
            const user = normalizeUser((await authApi.session()).user);
            storage.setItem('user', JSON.stringify(user));
            set({
                user,
                sessionStatus: 'authenticated',
                viewingUserId: user.id,
                viewingUsername: user.username,
                viewingPreferences: null
            });
        } catch {
            logoutAndReset();
        }
    },

    login: async (username, password) => {
        set({ isLoading: true, error: null });
        try {
            const user = normalizeUser((await authApi.login(username, password)).user);
            storage.setItem('user', JSON.stringify(user));
            set({
                user,
                sessionStatus: 'authenticated',
                isLoading: false,
                viewMode: 'self',
                viewingUserId: user.id,
                viewingUsername: user.username,
                viewingPreferences: null
            });
        } catch (error) {
            set({
                error: error instanceof ApiError ? getApiErrorText(error.code) : getAppText().serviceUnavailable,
                isLoading: false
            });
        }
    },

    register: async (username, password) => {
        set({ isLoading: true, error: null });
        try {
            const user = normalizeUser((await authApi.register(username, password)).user);
            storage.setItem('user', JSON.stringify(user));
            set({
                user,
                sessionStatus: 'authenticated',
                isLoading: false,
                viewMode: 'self',
                viewingUserId: user.id,
                viewingUsername: user.username,
                viewingPreferences: null
            });
        } catch (error) {
            set({
                error: error instanceof ApiError ? getApiErrorText(error.code) : getAppText().serviceUnavailable,
                isLoading: false
            });
        }
    },

    logout: async () => {
        try {
            await authApi.logout();
        } finally {
            logoutAndReset();
        }
    }
});
