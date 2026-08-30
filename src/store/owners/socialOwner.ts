import { normalizeSessionUser } from '../../api/auth';
import { ApiError } from '../../api/client';
import { peopleApi } from '../../api/resources';
import { getApiErrorText, getAppText } from '../../i18n/appText';
import { normalizeApiAssetUrl } from '../../utils/api';
import { storage } from '../../utils/storage';

import type { CalendarState } from '../calendarStore';
import type { OwnerContext } from './types';

type SocialOwner = Pick<CalendarState,
    'fetchUsers' | 'fetchFriends' | 'addFriend' | 'removeFriend' |
    'fetchProfile' | 'updateProfile'
>;

const socialError = (error: unknown) => getApiErrorText(
    error instanceof ApiError ? error.code : 'REQUEST_FAILED'
);

export const createSocialOwner = ({ set, get, logoutAndReset }: OwnerContext): SocialOwner => ({
    fetchUsers: async () => {
        const { user } = get();
        if (!user) return;
        try {
            const users = (await peopleApi.users()).map(normalizeSessionUser);
            set({ users: users.filter((candidate) => candidate.id !== user.id), socialError: null });
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
            else if (get().currentView === 'friends') set({ socialError: socialError(error) });
        }
    },

    fetchFriends: async () => {
        if (!get().user) return;
        try {
            set({ friends: (await peopleApi.friends()).map(normalizeSessionUser), socialError: null });
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
            else set({ socialError: socialError(error) });
        }
    },

    addFriend: async (id) => {
        if (!get().user) return;
        try {
            await peopleApi.addFriend(id);
            await get().fetchFriends();
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
            else set({ socialError: socialError(error) });
        }
    },

    removeFriend: async (id) => {
        if (!get().user) return;
        try {
            await peopleApi.removeFriend(id);
            await get().fetchFriends();
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
            else set({ socialError: socialError(error) });
        }
    },

    fetchProfile: async () => {
        if (!get().user) return;
        try {
            const rawProfile = normalizeSessionUser(await peopleApi.profile());
            const profile = {
                ...rawProfile,
                avatar_url: normalizeApiAssetUrl(rawProfile.avatar_url) || undefined
            };
            set((state) => {
                const user = {
                    id: profile.id,
                    username: profile.username,
                    avatar_url: profile.avatar_url,
                    isAdmin: profile.isAdmin
                };
                const next: Partial<CalendarState> = { profile, user };
                if (state.viewMode === 'self') {
                    next.viewingUserId = profile.id;
                    next.viewingUsername = profile.username;
                    next.viewingPreferences = profile.preferences || null;
                }
                return next;
            });
            const user = {
                id: profile.id,
                username: profile.username,
                avatar_url: profile.avatar_url,
                isAdmin: profile.isAdmin
            };
            storage.setItem('user', JSON.stringify(user));
            storage.setItem('profile', JSON.stringify(profile));
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
        }
    },

    updateProfile: async (preferencesPatch) => {
        const { user } = get();
        if (!user) return false;
        try {
            const { avatar_url, username, ...preferences } = preferencesPatch;
            await peopleApi.updateProfile({
                avatar_url: avatar_url ?? get().profile?.avatar_url ?? user.avatar_url ?? null,
                preferences: { ...(get().profile?.preferences || {}), ...preferences },
                username: username ?? get().profile?.username ?? user.username
            });
            await get().fetchProfile();
            set({ actionError: null });
            return true;
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
            else set({
                actionError: error instanceof ApiError
                    ? getApiErrorText(error.code)
                    : getAppText().serviceUnavailable
            });
            return false;
        }
    }
});
