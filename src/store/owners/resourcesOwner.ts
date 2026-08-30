import { attachmentsApi } from '../../api/attachments';
import { ApiError } from '../../api/client';
import { calendarResourcesApi } from '../../api/resources';
import { getApiErrorText, getAppText } from '../../i18n/appText';

import type { CalendarState, Role, Subrole } from '../calendarStore';
import type { OwnerContext } from './types';

type ResourcesOwner = Pick<CalendarState,
    'fetchMonthVisuals' | 'saveDailyFact' | 'saveDayBackground' |
    'fetchRoles' | 'fetchSubroles' | 'manageRoles' | 'manageSubroles' | 'reorderRoles' |
    'fetchEventNotes' | 'saveEventNote' | 'uploadFile'
>;

const handleSessionError = (error: unknown, logoutAndReset: OwnerContext['logoutAndReset']) => {
    if (error instanceof ApiError && error.status === 401) {
        logoutAndReset();
        return true;
    }
    return false;
};

const actionError = (error: unknown) => error instanceof ApiError
    ? getApiErrorText(error.code)
    : getAppText().serviceUnavailable;

export const createResourcesOwner = ({ set, get, logoutAndReset }: OwnerContext): ResourcesOwner => ({
    fetchMonthVisuals: async (start, end) => {
        if (!get().user) return;
        try {
            const [dailyFacts, dayBackgrounds] = await Promise.all([
                calendarResourcesApi.dailyFacts(start, end),
                calendarResourcesApi.dayBackgrounds(start, end)
            ]);
            set({ dailyFacts, dayBackgrounds });
        } catch (error) {
            handleSessionError(error, logoutAndReset);
        }
    },

    saveDailyFact: async (date, content) => {
        if (!get().user) return false;
        try {
            await calendarResourcesApi.saveDailyFact(date, content);
            set((state) => ({ dailyFacts: { ...state.dailyFacts, [date]: content }, actionError: null }));
            return true;
        } catch (error) {
            if (!handleSessionError(error, logoutAndReset)) set({ actionError: actionError(error) });
            return false;
        }
    },

    saveDayBackground: async (date, imageUrl) => {
        if (!get().user) return false;
        try {
            await calendarResourcesApi.saveDayBackground(date, imageUrl);
            set((state) => ({ dayBackgrounds: { ...state.dayBackgrounds, [date]: imageUrl }, actionError: null }));
            return true;
        } catch (error) {
            if (!handleSessionError(error, logoutAndReset)) set({ actionError: actionError(error) });
            return false;
        }
    },

    fetchRoles: async () => {
        if (!get().user) return;
        try {
            set({ roles: await calendarResourcesApi.roles() as unknown as Role[] });
        } catch (error) {
            handleSessionError(error, logoutAndReset);
        }
    },

    fetchSubroles: async () => {
        if (!get().user) return;
        try {
            set({ subroles: await calendarResourcesApi.subroles() as unknown as Subrole[] });
        } catch (error) {
            handleSessionError(error, logoutAndReset);
        }
    },

    manageRoles: async (action, payload) => {
        if (!get().user) return;
        try {
            if (action === 'create') {
                await calendarResourcesApi.createRole({ label: payload.label, color: payload.color });
            } else if (action === 'update' && payload.id) {
                await calendarResourcesApi.updateRole(payload.id, {
                    label: payload.label,
                    color: payload.color,
                    is_enabled: 1
                });
            } else if (action === 'delete' && payload.id) {
                await calendarResourcesApi.removeRole(payload.id);
            }
            await Promise.all([get().fetchRoles(), get().fetchSubroles()]);
        } catch (error) {
            if (!handleSessionError(error, logoutAndReset)) set({ actionError: actionError(error) });
        }
    },

    manageSubroles: async (action, payload) => {
        if (!get().user) return;
        try {
            if (action === 'create' && payload.roleId) {
                await calendarResourcesApi.createSubrole(payload.roleId, {
                    label: payload.label,
                    color: payload.color
                });
            } else if (action === 'update' && payload.id) {
                await calendarResourcesApi.updateSubrole(payload.id, {
                    label: payload.label,
                    color: payload.color,
                    is_enabled: 1
                });
            } else if (action === 'delete' && payload.id) {
                await calendarResourcesApi.removeSubrole(payload.id);
            }
            await get().fetchSubroles();
        } catch (error) {
            if (!handleSessionError(error, logoutAndReset)) set({ actionError: actionError(error) });
        }
    },

    reorderRoles: async (orderedIds) => {
        if (!get().user) return;
        try {
            await calendarResourcesApi.reorderRoles(orderedIds);
            await get().fetchRoles();
        } catch (error) {
            handleSessionError(error, logoutAndReset);
        }
    },

    fetchEventNotes: async (eventId) => {
        if (!get().user) return;
        try {
            const notes: Record<string, string> = {};
            (await calendarResourcesApi.eventNotes(eventId)).forEach((row) => {
                notes[row.role_id] = row.content || '';
            });
            set((state) => ({ eventNotes: { ...state.eventNotes, [eventId]: notes } }));
        } catch (error) {
            handleSessionError(error, logoutAndReset);
        }
    },

    saveEventNote: async (eventId, roleId, content) => {
        if (!get().user) return false;
        try {
            await calendarResourcesApi.saveEventNote(eventId, roleId, content);
            set((state) => ({
                eventNotes: {
                    ...state.eventNotes,
                    [eventId]: { ...(state.eventNotes[eventId] || {}), [roleId]: content }
                }
            }));
            return true;
        } catch (error) {
            if (!handleSessionError(error, logoutAndReset)) set({ actionError: actionError(error) });
            return false;
        }
    },

    uploadFile: async (file, purpose = 'note', eventId) => {
        if (!get().user) return null;
        try {
            return (await attachmentsApi.upload(file, purpose, eventId)).url;
        } catch (error) {
            if (!handleSessionError(error, logoutAndReset)) set({ actionError: actionError(error) });
            return null;
        }
    }
});
