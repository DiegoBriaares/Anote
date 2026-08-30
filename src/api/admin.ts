import { apiData, apiRequest, jsonBody } from './client';
import type { WireRecord } from './events';

export type Configuration = Record<string, string | boolean | undefined>;

export const configurationApi = {
    read: () => apiData<Configuration>('/config'),
    update: (config: Configuration) => apiData<Configuration>('/admin/config', { method: 'PUT', body: jsonBody({ config }) })
};

export const adminApi = {
    events: (userId?: string) => apiData<WireRecord[]>(`/admin/events${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
    removeEvents: (events: Array<{ id: string; revision: number }>) => apiRequest<{ message: string }>('/admin/events', {
        method: 'DELETE',
        body: jsonBody({ events })
    }),
    users: () => apiData<WireRecord[]>('/admin/users'),
    removeUsers: (ids: string[]) => apiRequest<{ message: string }>('/admin/users/bulk', { method: 'DELETE', body: jsonBody({ ids }) }),
    table: (table: 'roles' | 'event_notes') => apiData<unknown[]>(`/admin/database/${table}`)
};
