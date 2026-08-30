import { adminApi, configurationApi } from '../../api/admin';
import { ApiError } from '../../api/client';
import { getApiErrorText, getAppText } from '../../i18n/appText';
import { normalizePriority } from '../../utils/priorityUtils';

import type { AppConfig, CalendarState } from '../calendarStore';
import { normalizeBoolean } from '../eventModel';
import type { OwnerContext } from './types';

type ConfigurationOwner = Pick<CalendarState,
    'fetchAppConfig' | 'updateAppConfig' | 'fetchAdminEvents' |
    'adminDeleteEvents' | 'fetchAdminUsers' | 'adminDeleteUsers' | 'fetchTableData'
>;

export const createConfigurationOwner = ({ set, get, logoutAndReset }: OwnerContext): ConfigurationOwner => ({
    fetchAppConfig: async () => {
        try {
            set({ appConfig: await configurationApi.read() as AppConfig });
        } catch {
            // Authentication and the calendar use safe localized defaults when configuration is unavailable.
        }
    },

    updateAppConfig: async (config) => {
        if (!get().user) return false;
        try {
            set({ appConfig: await configurationApi.update(config) as AppConfig });
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
    },

    fetchAdminEvents: async (userId) => {
        if (!get().user) return;
        try {
            const events = await adminApi.events(userId);
            set({ adminEvents: events.map((raw) => ({
                id: String(raw.id || ''),
                revision: Number(raw.revision),
                title: String(raw.title || ''),
                date: String(raw.date || ''),
                startTime: typeof (raw.startTime ?? raw.start_time) === 'string'
                    ? String(raw.startTime ?? raw.start_time)
                    : null,
                priority: normalizePriority(
                    typeof raw.priority === 'number' || typeof raw.priority === 'string'
                        ? raw.priority
                        : null
                ),
                note: typeof raw.note === 'string' ? raw.note : null,
                link: typeof raw.link === 'string' ? raw.link : null,
                completed: normalizeBoolean(raw.completed),
                failed: normalizeBoolean(raw.failed),
                userId: typeof (raw.userId ?? raw.user_id) === 'string'
                    ? String(raw.userId ?? raw.user_id)
                    : undefined,
                username: typeof raw.username === 'string' ? raw.username : undefined
            })) });
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
        }
    },

    adminDeleteEvents: async (ids) => {
        if (!get().user) return false;
        const selected = ids.map((id) => get().adminEvents.find((event) => event.id === id));
        if (selected.some((event) => !event || !Number.isInteger(event.revision) || event.revision < 1)) return false;
        try {
            await adminApi.removeEvents(selected.map((event) => ({
                id: event!.id,
                revision: event!.revision
            })));
            return true;
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
            return false;
        }
    },

    fetchAdminUsers: async () => {
        if (!get().user) return;
        try {
            const users = await adminApi.users();
            set({ adminUsers: users.map((raw) => ({
                id: String(raw.id || ''),
                username: String(raw.username || ''),
                isAdmin: normalizeBoolean(raw.isAdmin ?? raw.is_admin),
                avatarUrl: typeof (raw.avatarUrl ?? raw.avatar_url) === 'string'
                    ? String(raw.avatarUrl ?? raw.avatar_url)
                    : null,
                eventCount: Number(raw.eventCount ?? raw.event_count ?? 0)
            })) });
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
        }
    },

    adminDeleteUsers: async (ids) => {
        if (!get().user) return false;
        try {
            await adminApi.removeUsers(ids);
            return true;
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
            return false;
        }
    },

    fetchTableData: async (table) => {
        if (!get().user) return [];
        try {
            return await adminApi.table(table);
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
            return [];
        }
    }
});
