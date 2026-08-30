import { apiData, apiRequest, jsonBody } from './client';
import { parseList, parseUser } from './contracts';
import type { WireRecord } from './events';

export type FriendCalendar = {
    data: WireRecord[];
    friend?: { username?: string; preferences?: Record<string, unknown> };
};

export const peopleApi = {
    users: async () => parseList(await apiData<unknown>('/users'), parseUser),
    profile: async () => parseUser(await apiData<unknown>('/me')),
    updateProfile: (value: WireRecord) => apiRequest<{ message: string }>('/me', { method: 'PUT', body: jsonBody(value) }),
    friends: async () => parseList(await apiData<unknown>('/friends'), parseUser),
    addFriend: (id: string) => apiRequest<{ message: string }>(`/friends/${encodeURIComponent(id)}`, { method: 'POST' }),
    removeFriend: (id: string) => apiRequest<{ message: string }>(`/friends/${encodeURIComponent(id)}`, { method: 'DELETE' })
};

export const calendarResourcesApi = {
    dailyFacts: (start: string, end: string) => apiData<Record<string, string>>(`/daily-facts?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
    dayBackgrounds: (start: string, end: string) => apiData<Record<string, string>>(`/day-backgrounds?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
    saveDailyFact: (date: string, content: string) => apiRequest<{ message: string }>('/daily-facts', { method: 'POST', body: jsonBody({ date, content }) }),
    saveDayBackground: (date: string, imageUrl: string) => apiRequest<{ message: string }>('/day-backgrounds', { method: 'POST', body: jsonBody({ date, imageUrl }) }),
    roles: () => apiData<WireRecord[]>('/roles'),
    subroles: () => apiData<WireRecord[]>('/subroles'),
    createRole: (payload: WireRecord) => apiRequest<{ message: string }>('/roles', { method: 'POST', body: jsonBody(payload) }),
    updateRole: (id: string, payload: WireRecord) => apiRequest<{ message: string }>(`/roles/${encodeURIComponent(id)}`, { method: 'PUT', body: jsonBody(payload) }),
    removeRole: (id: string) => apiRequest<{ message: string }>(`/roles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    createSubrole: (roleId: string, payload: WireRecord) => apiRequest<{ message: string }>(`/roles/${encodeURIComponent(roleId)}/subroles`, { method: 'POST', body: jsonBody(payload) }),
    updateSubrole: (id: string, payload: WireRecord) => apiRequest<{ message: string }>(`/subroles/${encodeURIComponent(id)}`, { method: 'PUT', body: jsonBody(payload) }),
    removeSubrole: (id: string) => apiRequest<{ message: string }>(`/subroles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    reorderRoles: (orderedIds: string[]) => apiRequest<{ message: string }>('/roles/reorder', { method: 'POST', body: jsonBody({ orderedIds }) }),
    eventNotes: (eventId: string) => apiData<Array<{ role_id: string; content: string }>>(`/events/${encodeURIComponent(eventId)}/notes`),
    saveEventNote: (eventId: string, roleId: string, content: string) => apiRequest<{ message: string }>(`/events/${encodeURIComponent(eventId)}/notes`, { method: 'POST', body: jsonBody({ roleId, content }) })
};
