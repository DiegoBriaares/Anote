import { create } from 'zustand';
import { formatDate } from '../utils/dateUtils';
import { API_URL, normalizeApiAssetUrl } from '../utils/api';
import { normalizePriority } from '../utils/priorityUtils';
import { storage } from '../utils/storage';
import { eachDayOfInterval } from 'date-fns';

// Polyfill for crypto.randomUUID if not available (e.g. older Safari)
if (!crypto.randomUUID) {
    crypto.randomUUID = () => {
        return (([1e7] as any) + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c: any) =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    };
}

export interface CalendarEvent {
    id: string;
    title: string;
    date: string;
    startTime?: string | null;
    priority?: number | null;
    note?: string | null;
    link?: string | null;
    originDates?: string[] | null;
    wasPostponed?: boolean | null;
    postponedView?: 'week' | 'all' | null;
}

export interface Role {
    id: string;
    label: string;
    color?: string | null;
    is_enabled?: number;
    order_index?: number;
}

export interface Subrole extends Role {
    role_id: string;
}

export interface AppConfig {
    app_title?: string;
    app_subtitle?: string;
    console_title?: string;
    config_version?: string;
    [key: string]: string | undefined;
}

export interface AdminEvent {
    id: string;
    title: string;
    date: string;
    startTime?: string | null;
    priority?: number | null;
    note?: string | null;
    link?: string | null;
    userId?: string;
    username?: string;
}

const parseEventResources = (resources: any) => {
    if (!resources) return { originDates: null, wasPostponed: null, postponedView: null };
    try {
        const parsed = typeof resources === 'string' ? JSON.parse(resources) : resources;
        const origins = parsed?.originDates;
        const wasPostponed = parsed?.wasPostponed === true;
        const postponedView = parsed?.postponedView === 'week'
            ? 'week'
            : parsed?.postponedView === 'all'
                ? 'all'
                : null;
        if (!Array.isArray(origins)) {
            return { originDates: null, wasPostponed: wasPostponed ? true : null, postponedView };
        }
        const cleaned = origins.filter((item: any) => typeof item === 'string' && item.trim() !== '');
        return { originDates: cleaned.length > 0 ? cleaned : null, wasPostponed: wasPostponed ? true : null, postponedView };
    } catch {
        return { originDates: null, wasPostponed: null, postponedView: null };
    }
};

export interface AdminUser {
    id: string;
    username: string;
    isAdmin?: boolean;
    avatarUrl?: string | null;
    eventCount?: number;
}

interface User {
    id: string;
    username: string;
    avatar_url?: string;
    preferences?: UserPreferences;
    isAdmin?: boolean;
}

interface Selection {
    start: Date | null;
    end: Date | null;
}

interface CalendarState {
    // Auth State
    user: User | null;
    token: string | null;
    isLoading: boolean;
    error: string | null;
    login: (u: string, p: string) => Promise<void>;
    register: (u: string, p: string) => Promise<void>;
    logout: () => void;

    // Calendar State
    events: Record<string, CalendarEvent[]>;
    postponedEvents: CalendarEvent[];
    selection: Selection;
    selectionActive: boolean;
    viewDate: Date;
    viewMode: 'self' | 'friend';
    viewingUserId: string | null;
    viewingUsername: string | null;
    viewingPreferences: UserPreferences | null;
    profile: User | null;
    localPreferences: UserPreferences | null;
    currentView: 'calendar' | 'postponed' | 'profile' | 'friends' | 'roles' | 'admin';

    setSelection: (start: Date | null, end: Date | null) => void;
    setSelectionActive: (active: boolean) => void;
    fetchEvents: () => Promise<void>;
    fetchPostponedEvents: () => Promise<void>;
    fetchFriendEvents: (friendId: string, friendName: string) => Promise<void>;
    viewOwnCalendar: () => Promise<void>;
    addEvent: (date: Date, entry: { title: string; time?: string; startTime?: string; link?: string; note?: string; priority?: number | string | null }) => Promise<void>;
    addEventsToRange: (entries: Array<{ title: string; time?: string; startTime?: string; link?: string; note?: string; priority?: number | string | null }>) => Promise<void>;
    addEventsBulk: (entries: Array<{ title: string; date: string; startTime?: string | null; priority?: number | string | null; link?: string | null; note?: string | null; originDates?: string[] | null; wasPostponed?: boolean | null }>) => Promise<boolean>;
    deleteEvent: (id: string) => Promise<void>;
    editEvent: (event: CalendarEvent) => Promise<void>;
    addPostponedEvent: (entry: { title: string; time?: string; startTime?: string; link?: string; note?: string; priority?: number | string | null; postponedView?: 'week' | 'all' }) => Promise<void>;
    addPostponedEventsBulk: (entries: Array<{ title: string; startTime?: string | null; priority?: number | string | null; link?: string | null; note?: string | null; originDates?: string[] | null; postponedView?: 'week' | 'all' }>) => Promise<boolean>;
    deletePostponedEvent: (id: string) => Promise<void>;
    editPostponedEvent: (event: CalendarEvent) => Promise<void>;
    setViewDate: (date: Date) => void;
    clearSelection: () => void;
    setLocalPreferences: (prefs: Partial<UserPreferences> & { _updatedAt?: number }) => void;
    navigateToProfile: () => void;
    navigateToFriends: () => void;
    navigateToRoles: () => void;
    navigateToCalendar: () => void;
    navigateToAdmin: () => void;
    navigateToPostponed: () => void;

    // Social
    users: User[];
    friends: User[];
    socialError: string | null;
    fetchUsers: () => Promise<void>;
    fetchFriends: () => Promise<void>;
    addFriend: (id: string) => Promise<void>;
    removeFriend: (id: string) => Promise<void>;
    fetchProfile: () => Promise<void>;
    updateProfile: (prefs: Partial<UserPreferences> & { avatar_url?: string | null; username?: string }) => Promise<void>;

    // Visuals
    dailyFacts: Record<string, string>;
    dayBackgrounds: Record<string, string>;
    fetchMonthVisuals: (start: string, end: string) => Promise<void>;
    saveDailyFact: (date: string, content: string) => Promise<void>;
    saveDayBackground: (date: string, imageUrl: string) => Promise<void>;

    // Roles & Notes
    roles: Role[];
    subroles: Subrole[];
    fetchRoles: () => Promise<void>;
    fetchSubroles: () => Promise<void>;
    manageRoles: (action: 'create' | 'update' | 'delete', payload: { id?: string; label?: string; color?: string }) => Promise<void>;
    manageSubroles: (action: 'create' | 'update' | 'delete', payload: { id?: string; roleId?: string; label?: string; color?: string }) => Promise<void>;
    reorderRoles: (orderedIds: string[]) => Promise<void>;
    eventNotes: Record<string, Record<string, string>>;
    fetchEventNotes: (eventId: string) => Promise<void>;
    saveEventNote: (eventId: string, roleId: string, content: string) => Promise<boolean>;
    uploadFile: (file: File) => Promise<string | null>;

    // Compare
    compareMode: boolean;
    compareEvents: Record<string, CalendarEvent[]>;
    toggleCompare: () => void;

    // Admin
    appConfig: AppConfig | null;
    fetchAppConfig: () => Promise<void>;
    updateAppConfig: (config: AppConfig) => Promise<boolean>;
    bootstrap: () => Promise<void>;
    adminEvents: AdminEvent[];
    fetchAdminEvents: (userId?: string) => Promise<void>;
    adminDeleteEvents: (ids: string[]) => Promise<boolean>;
    adminUsers: AdminUser[];
    fetchAdminUsers: () => Promise<void>;
    adminDeleteUsers: (ids: string[]) => Promise<boolean>;
    fetchTableData: (table: 'roles' | 'event_notes') => Promise<any[]>;
}

export const useCalendarStore = create<CalendarState>((set, get) => {
    const logoutAndReset = () => {
        storage.removeItem('token');
        storage.removeItem('user');
        storage.removeItem('profile');
        set({
            user: null,
            token: null,
            events: {},
            postponedEvents: [],
            friends: [],
            users: [],
            viewMode: 'self',
            viewingUserId: null,
            viewingUsername: null,
            viewingPreferences: null,
            profile: null,
            currentView: 'calendar',
            dailyFacts: {},
            dayBackgrounds: {},
            roles: [],
            subroles: [],
            eventNotes: {},
            compareMode: false,
            compareEvents: {},
            appConfig: null,
            adminEvents: [],
            adminUsers: []
        });
    };

    return {
        // Auth Initial State
        user: JSON.parse(storage.getItem('user') || 'null'),
        token: storage.getItem('token'),
        isLoading: false,
        error: null,

        // Calendar Initial State
        events: {},
        postponedEvents: [],
        selection: { start: null, end: null },
        selectionActive: false,
        viewDate: new Date(),
        viewMode: 'self',
        viewingUserId: JSON.parse(storage.getItem('user') || 'null')?.id || null,
        viewingUsername: JSON.parse(storage.getItem('user') || 'null')?.username || null,
        viewingPreferences: null,
        profile: null,
        localPreferences: (() => {
            try {
                return JSON.parse(storage.getItem('preferences') || 'null');
            } catch {
                return null;
            }
        })(),
        currentView: 'calendar',
        users: [],
        friends: [],
        socialError: null,
        dailyFacts: {},
        dayBackgrounds: {},
        roles: [],
        subroles: [],
        eventNotes: {},
        compareMode: false,
        compareEvents: {},
        appConfig: null,
        adminEvents: [],
        adminUsers: [],

        // Auth Actions
        login: async (username, password) => {
            set({ isLoading: true, error: null });
            try {
                const res = await fetch(`${API_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                });
                const data = await res.json();

                if (res.ok) {
                    const nextUser = {
                        ...data.user,
                        avatar_url: normalizeApiAssetUrl(data.user.avatar_url) || undefined
                    };
                    storage.setItem('token', data.token);
                    storage.setItem('user', JSON.stringify(nextUser));
                    set({
                        user: nextUser,
                        token: data.token,
                        isLoading: false,
                        viewMode: 'self',
                        viewingUserId: nextUser.id,
                        viewingUsername: nextUser.username,
                        viewingPreferences: null
                    });
                    await Promise.all([get().fetchEvents(), get().fetchFriends(), get().fetchUsers(), get().fetchProfile()]);
                } else {
                    set({ error: data.error, isLoading: false });
                }
            } catch (e) {
                set({ error: 'Connection failed. Is the API running at ' + API_URL + '?', isLoading: false });
            }
        },

        register: async (username, password) => {
            set({ isLoading: true, error: null });
            try {
                const res = await fetch(`${API_URL}/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                });
                const data = await res.json();

                if (res.ok) {
                    const nextUser = {
                        ...data.user,
                        avatar_url: normalizeApiAssetUrl(data.user.avatar_url) || undefined
                    };
                    storage.setItem('token', data.token);
                    storage.setItem('user', JSON.stringify(nextUser));
                    set({
                        user: nextUser,
                        token: data.token,
                        isLoading: false,
                        viewMode: 'self',
                        viewingUserId: nextUser.id,
                        viewingUsername: nextUser.username,
                        viewingPreferences: null
                    });
                    await Promise.all([get().fetchEvents(), get().fetchFriends(), get().fetchUsers(), get().fetchProfile()]);
                } else {
                    set({ error: data.error, isLoading: false });
                }
            } catch (e) {
                set({ error: 'Connection failed. Is the API running at ' + API_URL + '?', isLoading: false });
            }
        },

        logout: logoutAndReset,

        setSelection: (start, end) => set({ selection: { start, end } }),
        setSelectionActive: (active) => set({ selectionActive: active }),
        setLocalPreferences: (prefs) => {
            set((state) => {
                const merged = { ...(state.localPreferences || {}), ...prefs };
                storage.setItem('preferences', JSON.stringify(merged));
                return { localPreferences: merged };
            });
        },
        navigateToProfile: () => set({ currentView: 'profile' }),
        navigateToFriends: () => set({ currentView: 'friends' }),
        navigateToRoles: () => set({ currentView: 'roles' }),
        navigateToCalendar: () => set({ currentView: 'calendar' }),
        navigateToAdmin: () => set({ currentView: 'admin' }),
        navigateToPostponed: () => set({ currentView: 'postponed' }),

        fetchEvents: async () => {
            const { token } = get();
            if (!token) {
                logoutAndReset();
                return;
            }
            try {
                const response = await fetch(`${API_URL}/events`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.status === 401 || response.status === 403) {
                    logoutAndReset();
                    return;
                }

                const data = await response.json();

                if (data.message === 'success') {
                    const eventsMap: Record<string, CalendarEvent[]> = {};
                    data.data.forEach((raw: any) => {
                        const timeVal = raw.startTime ?? raw.start_time ?? null;
                        const { originDates, wasPostponed } = parseEventResources(raw.resources);
                        const event: CalendarEvent = {
                            id: raw.id,
                            title: raw.title,
                            date: raw.date,
                            startTime: timeVal ? String(timeVal) : null,
                            priority: normalizePriority(raw.priority),
                            note: raw.note || null,
                            link: raw.link || null,
                            originDates,
                            wasPostponed
                        };
                        if (!eventsMap[event.date]) {
                            eventsMap[event.date] = [];
                        }
                        eventsMap[event.date].push(event);
                    });
                    // keep a stable order per day for predictable display
                    Object.keys(eventsMap).forEach((dateKey) => {
                        eventsMap[dateKey] = eventsMap[dateKey].sort((a, b) => {
                            const tA = a.startTime || '';
                            const tB = b.startTime || '';
                            if (tA !== tB) return tA.localeCompare(tB);
                            return a.title.localeCompare(b.title);
                        });
                    });
                    set((state) => {
                        if (state.viewMode === 'friend') {
                            return { compareEvents: eventsMap };
                        }
                        return {
                            events: eventsMap,
                            viewingPreferences: state.profile?.preferences || null,
                            compareEvents: eventsMap
                        };
                    });
                }
            } catch (error) {
                console.error('Failed to fetch events:', error);
            }
        },
        fetchPostponedEvents: async () => {
            const { token, viewMode } = get();
            if (!token || viewMode === 'friend') return;
            try {
                const response = await fetch(`${API_URL}/postponed-events`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.status === 401 || response.status === 403) {
                    logoutAndReset();
                    return;
                }
                const data = await response.json();
                if (data.message === 'success') {
                    const eventsList: CalendarEvent[] = [];
                    data.data.forEach((raw: any) => {
                        const timeVal = raw.startTime ?? raw.start_time ?? null;
                        const { originDates, wasPostponed, postponedView } = parseEventResources(raw.resources);
                        const event: CalendarEvent = {
                            id: raw.id,
                            title: raw.title,
                            date: raw.date || '',
                            startTime: timeVal ? String(timeVal) : null,
                            priority: normalizePriority(raw.priority),
                            note: raw.note || null,
                            link: raw.link || null,
                            originDates,
                            wasPostponed,
                            postponedView: postponedView ?? 'all'
                        };
                        eventsList.push(event);
                    });
                    const sorted = eventsList.sort((a, b) => {
                        const tA = a.startTime || '';
                        const tB = b.startTime || '';
                        if (tA !== tB) return tA.localeCompare(tB);
                        return a.title.localeCompare(b.title);
                    });
                    set({ postponedEvents: sorted });
                }
            } catch (error) {
                console.error('Failed to fetch postponed events:', error);
            }
        },

        fetchFriendEvents: async (friendId, friendName) => {
            const { token } = get();
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/friends/${friendId}/events`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                const data = await res.json();
                if (data.message === 'success') {
                    const eventsMap: Record<string, CalendarEvent[]> = {};
                    data.data.forEach((raw: any) => {
                        const timeVal = raw.startTime ?? raw.start_time ?? null;
                        const event: CalendarEvent = {
                            id: raw.id,
                            title: raw.title,
                            date: raw.date,
                            startTime: timeVal ? String(timeVal) : null,
                            priority: normalizePriority(raw.priority),
                            note: raw.note || null,
                            link: raw.link || null
                        };
                        if (!eventsMap[event.date]) {
                            eventsMap[event.date] = [];
                        }
                        eventsMap[event.date].push(event);
                    });
                    Object.keys(eventsMap).forEach((dateKey) => {
                        eventsMap[dateKey] = eventsMap[dateKey].sort((a, b) => {
                            const tA = a.startTime || '';
                            const tB = b.startTime || '';
                            if (tA !== tB) return tA.localeCompare(tB);
                            return a.title.localeCompare(b.title);
                        });
                    });
                    const friendLabel = data.friend?.username || friendName;
                    set((state) => ({
                        events: eventsMap,
                        viewMode: 'friend',
                        viewingUserId: friendId,
                        viewingUsername: friendLabel,
                        viewingPreferences: data.friend?.preferences || null,
                        compareEvents: state.compareEvents && Object.keys(state.compareEvents).length > 0 ? state.compareEvents : state.events,
                        currentView: 'calendar'
                    }));
                } else {
                    set({ socialError: data.error || 'Failed to load friend calendar' });
                }
            } catch (e) {
                set({ socialError: 'Unable to load friend calendar' });
            }
        },

        viewOwnCalendar: async () => {
            const { user } = get();
            if (!user) return;
            set({
                viewMode: 'self',
                viewingUserId: user.id,
                viewingUsername: user.username,
                viewingPreferences: get().profile?.preferences || null,
                currentView: 'calendar'
            });
            await get().fetchEvents();
        },

        addEventsToRange: async (titles) => {
            const { selection, fetchEvents, token, user, viewMode } = get();
            if (!selection.start || !selection.end || !user || !token) return;
            if (viewMode === 'friend') {
                console.warn('Cannot add events while viewing a friend calendar');
                return;
            }

            const start = selection.start < selection.end ? selection.start : selection.end;
            const end = selection.start < selection.end ? selection.end : selection.start;

            const days = eachDayOfInterval({ start, end });
            const newEvents: CalendarEvent[] = [];

            days.forEach((day, index) => {
                        const entry = titles[index];
                        if (entry && entry.title) {
                            const dateStr = formatDate(day);
                            const rawTime = entry.startTime ?? entry.time;
                            newEvents.push({
                                id: crypto.randomUUID(),
                                title: entry.title,
                                date: dateStr,
                                startTime: rawTime && rawTime.trim() ? rawTime.trim() : null,
                                priority: normalizePriority(entry.priority),
                                note: entry.note?.trim() ? entry.note.trim() : null,
                                link: entry.link?.trim() ? entry.link.trim() : null,
                                originDates: null
                            });
                        }
            });

            if (newEvents.length === 0) return;

            try {
                const response = await fetch(`${API_URL}/events`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        events: newEvents.map((event) => ({
                            ...event,
                            resources: null
                        }))
                    }),
                });

                if (response.status === 401 || response.status === 403) {
                    logoutAndReset();
                    return;
                }

                // Optimistically merge into state for immediate feedback
                set((state) => {
                    const merged = { ...state.events };
                    newEvents.forEach((ev) => {
                        if (!merged[ev.date]) merged[ev.date] = [];
                        merged[ev.date] = [...merged[ev.date], ev];
                        merged[ev.date].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title));
                    });
                    return { events: merged };
                });

                await fetchEvents();

            } catch (error) {
                console.error('Failed to save events:', error);
            }
        },

        addEventsBulk: async (entries) => {
            const { token, user, viewMode, fetchEvents } = get();
            if (!token || !user || viewMode === 'friend') return false;
            if (!entries || entries.length === 0) return false;

            const newEvents: CalendarEvent[] = entries
                .filter((entry) => entry && entry.title && entry.date)
                .map((entry) => ({
                    id: crypto.randomUUID(),
                    title: entry.title,
                    date: entry.date,
                    startTime: entry.startTime && entry.startTime.trim() ? entry.startTime.trim() : null,
                    priority: normalizePriority(entry.priority),
                    note: entry.note?.trim() ? entry.note.trim() : null,
                    link: entry.link?.trim() ? entry.link.trim() : null,
                    originDates: entry.originDates && entry.originDates.length > 0 ? entry.originDates : null,
                    wasPostponed: entry.wasPostponed ? true : null
                }));

            if (newEvents.length === 0) return false;

            try {
                const response = await fetch(`${API_URL}/events`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        events: newEvents.map((event) => ({
                            ...event,
                            resources: (event.originDates || event.wasPostponed)
                                ? { originDates: event.originDates, wasPostponed: event.wasPostponed ? true : undefined }
                                : null
                        }))
                    }),
                });

                if (response.status === 401 || response.status === 403) {
                    logoutAndReset();
                    return false;
                }

                if (!response.ok) {
                    console.error('Failed to save events:', response.statusText);
                    return false;
                }

                set((state) => {
                    const merged = { ...state.events };
                    newEvents.forEach((ev) => {
                        if (!merged[ev.date]) merged[ev.date] = [];
                        merged[ev.date] = [...merged[ev.date], ev];
                        merged[ev.date].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title));
                    });
                    return { events: merged };
                });

                await fetchEvents();
                return true;
            } catch (error) {
                console.error('Failed to save events:', error);
                return false;
            }
        },

        addEvent: async (date, entry) => {
            const { token, user, viewMode, fetchEvents } = get();
            if (!token || !user || viewMode === 'friend') return;
            if (!entry.title) return;
            const rawTime = entry.startTime ?? entry.time;
            const newEvent: CalendarEvent = {
                id: crypto.randomUUID(),
                title: entry.title,
                date: formatDate(date),
                startTime: rawTime && rawTime.trim() ? rawTime.trim() : null,
                priority: normalizePriority(entry.priority),
                note: entry.note?.trim() ? entry.note.trim() : null,
                link: entry.link?.trim() ? entry.link.trim() : null,
                originDates: null,
                wasPostponed: null
            };
            try {
                const res = await fetch(`${API_URL}/events`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ events: [{ ...newEvent, resources: null }] })
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }

                set((state) => {
                    const merged = { ...state.events };
                    if (!merged[newEvent.date]) merged[newEvent.date] = [];
                    merged[newEvent.date] = [...merged[newEvent.date], newEvent];
                    merged[newEvent.date].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title));
                    return { events: merged };
                });

                await fetchEvents();
            } catch (e) {
                console.error('Failed to add event', e);
            }
        },

        deleteEvent: async (id: string) => {
            const { token, fetchEvents, viewMode } = get();
            if (!token || viewMode === 'friend') return;
            try {
                const res = await fetch(`${API_URL}/events/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                set((state) => {
                    const merged = { ...state.events };
                    Object.keys(merged).forEach((dateKey) => {
                        merged[dateKey] = merged[dateKey].filter((ev) => ev.id !== id);
                        if (merged[dateKey].length === 0) {
                            delete merged[dateKey];
                        }
                    });
                    return { events: merged };
                });
                await fetchEvents();
            } catch (e) {
                console.error('Failed to delete event', e);
            }
        },

        editEvent: async (event) => {
            const { token, fetchEvents, viewMode } = get();
            if (!token || viewMode === 'friend') return;
            try {
                const res = await fetch(`${API_URL}/events/${event.id}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        title: event.title,
                        date: event.date,
                        startTime: event.startTime || null,
                        priority: normalizePriority(event.priority),
                        note: event.note || null,
                        link: event.link || null,
                        resources: (event.originDates || event.wasPostponed)
                            ? { originDates: event.originDates, wasPostponed: event.wasPostponed ? true : undefined }
                            : null
                    })
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                set((state) => {
                    const merged = { ...state.events };
                    Object.keys(merged).forEach((dateKey) => {
                        merged[dateKey] = merged[dateKey].map((ev) => ev.id === event.id ? { ...ev, ...event } : ev);
                        merged[dateKey].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title));
                    });
                    return { events: merged };
                });
                await fetchEvents();
            } catch (e) {
                console.error('Failed to edit event', e);
            }
        },

        setViewDate: (date) => set({ viewDate: date }),
        clearSelection: () => set({ selection: { start: null, end: null }, selectionActive: false }),

        addPostponedEventsBulk: async (entries) => {
            const { token, user, viewMode, fetchPostponedEvents } = get();
            if (!token || !user || viewMode === 'friend') return false;
            if (!entries || entries.length === 0) return false;

            const newEvents: CalendarEvent[] = entries
                .filter((entry) => entry && entry.title)
                .map((entry) => ({
                    id: crypto.randomUUID(),
                    title: entry.title,
                    date: '',
                    startTime: entry.startTime && entry.startTime.trim() ? entry.startTime.trim() : null,
                    priority: normalizePriority(entry.priority),
                    note: entry.note?.trim() ? entry.note.trim() : null,
                    link: entry.link?.trim() ? entry.link.trim() : null,
                    originDates: entry.originDates && entry.originDates.length > 0 ? entry.originDates : null,
                    wasPostponed: null,
                    postponedView: entry.postponedView ?? 'week'
                }));

            if (newEvents.length === 0) return false;

            try {
                const response = await fetch(`${API_URL}/postponed-events`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        events: newEvents.map((event) => ({
                            ...event,
                            resources: {
                                originDates: event.originDates || undefined,
                                postponedView: event.postponedView || undefined
                            }
                        }))
                    }),
                });

                if (response.status === 401 || response.status === 403) {
                    logoutAndReset();
                    return false;
                }

                if (!response.ok) {
                    console.error('Failed to save postponed events:', response.statusText);
                    return false;
                }

                set((state) => ({
                    postponedEvents: [...state.postponedEvents, ...newEvents].sort((a, b) => {
                        const tA = a.startTime || '';
                        const tB = b.startTime || '';
                        if (tA !== tB) return tA.localeCompare(tB);
                        return a.title.localeCompare(b.title);
                    })
                }));

                await fetchPostponedEvents();
                return true;
            } catch (error) {
                console.error('Failed to save postponed events:', error);
                return false;
            }
        },

        addPostponedEvent: async (entry) => {
            const { token, user, viewMode, fetchPostponedEvents } = get();
            if (!token || !user || viewMode === 'friend') return;
            if (!entry.title) return;
            const rawTime = entry.startTime ?? entry.time;
            const newEvent: CalendarEvent = {
                id: crypto.randomUUID(),
                title: entry.title,
                date: '',
                startTime: rawTime && rawTime.trim() ? rawTime.trim() : null,
                priority: normalizePriority(entry.priority),
                note: entry.note?.trim() ? entry.note.trim() : null,
                link: entry.link?.trim() ? entry.link.trim() : null,
                originDates: null,
                wasPostponed: null,
                postponedView: entry.postponedView ?? 'week'
            };
            try {
                const res = await fetch(`${API_URL}/postponed-events`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        events: [{
                            ...newEvent,
                            resources: { postponedView: newEvent.postponedView }
                        }]
                    })
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }

                set((state) => ({
                    postponedEvents: [...state.postponedEvents, newEvent].sort((a, b) => {
                        const tA = a.startTime || '';
                        const tB = b.startTime || '';
                        if (tA !== tB) return tA.localeCompare(tB);
                        return a.title.localeCompare(b.title);
                    })
                }));

                await fetchPostponedEvents();
            } catch (e) {
                console.error('Failed to add postponed event', e);
            }
        },

        deletePostponedEvent: async (id: string) => {
            const { token, fetchPostponedEvents, viewMode } = get();
            if (!token || viewMode === 'friend') return;
            try {
                const res = await fetch(`${API_URL}/postponed-events/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                set((state) => ({
                    postponedEvents: state.postponedEvents.filter((ev) => ev.id !== id)
                }));
                await fetchPostponedEvents();
            } catch (e) {
                console.error('Failed to delete postponed event', e);
            }
        },

        editPostponedEvent: async (event) => {
            const { token, fetchPostponedEvents, viewMode } = get();
            if (!token || viewMode === 'friend') return;
            try {
                const res = await fetch(`${API_URL}/postponed-events/${event.id}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        title: event.title,
                        date: event.date,
                        startTime: event.startTime || null,
                        priority: normalizePriority(event.priority),
                        note: event.note || null,
                        link: event.link || null,
                        resources: {
                            originDates: event.originDates || undefined,
                            postponedView: event.postponedView || undefined
                        }
                    })
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                set((state) => ({
                    postponedEvents: state.postponedEvents.map((ev) => ev.id === event.id ? { ...ev, ...event } : ev).sort((a, b) => {
                        const tA = a.startTime || '';
                        const tB = b.startTime || '';
                        if (tA !== tB) return tA.localeCompare(tB);
                        return a.title.localeCompare(b.title);
                    })
                }));
                await fetchPostponedEvents();
            } catch (e) {
                console.error('Failed to edit postponed event', e);
            }
        },

        fetchUsers: async () => {
            const { token, user } = get();
            if (!token || !user) return;
            try {
                const res = await fetch(`${API_URL}/users`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                const data = await res.json();
                if (data.message === 'success') {
                    set({ users: data.data.filter((u: User) => u.id !== user.id), socialError: null });
                } else {
                    set({ socialError: data.error || 'Failed to load users' });
                }
            } catch (e) {
                set({ socialError: 'Unable to load users' });
            }
        },

        fetchProfile: async () => {
            const { token } = get();
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/me`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                const data = await res.json();
                if (data.message === 'success') {
                    const nextProfile = {
                        ...data.data,
                        avatar_url: normalizeApiAssetUrl(data.data.avatar_url) || undefined
                    };
                    set((state) => {
                        const nextUser = {
                            id: nextProfile.id,
                            username: nextProfile.username,
                            avatar_url: nextProfile.avatar_url,
                            isAdmin: nextProfile.isAdmin
                        };
                        const nextState: Partial<CalendarState> = {
                            profile: nextProfile,
                            user: nextUser
                        };
                        if (state.viewMode === 'self') {
                            nextState.viewingUserId = nextProfile.id;
                            nextState.viewingUsername = nextProfile.username;
                            nextState.viewingPreferences = nextProfile.preferences || null;
                        }
                        return nextState;
                    });
                    storage.setItem('user', JSON.stringify({
                        id: nextProfile.id,
                        username: nextProfile.username,
                        avatar_url: nextProfile.avatar_url,
                        isAdmin: nextProfile.isAdmin
                    }));
                    storage.setItem('profile', JSON.stringify(nextProfile));
                }
            } catch (e) {
                console.error('Failed to fetch profile', e);
            }
        },

        updateProfile: async (prefs) => {
            const { token, user, fetchProfile } = get();
            if (!token || !user) return;
            try {
                const res = await fetch(`${API_URL}/me`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ avatar_url: prefs.avatar_url, preferences: prefs, username: prefs.username })
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                await fetchProfile();
                await get().viewOwnCalendar();
            } catch (e) {
                console.error('Failed to update profile', e);
            }
        },

        fetchFriends: async () => {
            const { token } = get();
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/friends`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                const data = await res.json();
                if (data.message === 'success') {
                    set({ friends: data.data, socialError: null });
                } else {
                    set({ socialError: data.error || 'Failed to load friends' });
                }
            } catch (e) {
                set({ socialError: 'Unable to load friends' });
            }
        },

        addFriend: async (id: string) => {
            const { token, fetchFriends } = get();
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/friends/${id}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                await fetchFriends();
            } catch (e) {
                set({ socialError: 'Unable to add friend' });
            }
        },

        removeFriend: async (id: string) => {
            const { token, fetchFriends } = get();
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/friends/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                await fetchFriends();
            } catch (e) {
                set({ socialError: 'Unable to remove friend' });
            }
        },
        fetchMonthVisuals: async (start, end) => {
            const { token } = get();
            if (!token) return;
            try {
                const [factsRes, bgRes] = await Promise.all([
                    fetch(`${API_URL}/daily-facts?start=${start}&end=${end}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }),
                    fetch(`${API_URL}/day-backgrounds?start=${start}&end=${end}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                ]);

                if (factsRes.status === 401 || factsRes.status === 403 || bgRes.status === 401 || bgRes.status === 403) {
                    logoutAndReset();
                    return;
                }

                const [factsData, bgData] = await Promise.all([factsRes.json(), bgRes.json()]);
                if (factsData.message === 'success') {
                    set({ dailyFacts: factsData.data || {} });
                }
                if (bgData.message === 'success') {
                    set({ dayBackgrounds: bgData.data || {} });
                }
            } catch (e) {
                console.error('Failed to fetch month visuals', e);
            }
        },
        saveDailyFact: async (date, content) => {
            const { token } = get();
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/daily-facts`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ date, content })
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                set((state) => ({
                    dailyFacts: { ...state.dailyFacts, [date]: content }
                }));
            } catch (e) {
                console.error('Failed to save daily fact', e);
            }
        },
        saveDayBackground: async (date, imageUrl) => {
            const { token } = get();
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/day-backgrounds`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ date, imageUrl })
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                set((state) => ({
                    dayBackgrounds: { ...state.dayBackgrounds, [date]: imageUrl }
                }));
            } catch (e) {
                console.error('Failed to save day background', e);
            }
        },
        fetchRoles: async () => {
            const { token } = get();
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/roles`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                const data = await res.json();
                if (data.message === 'success') {
                    set({ roles: data.data || [] });
                }
            } catch (e) {
                console.error('Failed to fetch roles', e);
            }
        },
        fetchSubroles: async () => {
            const { token } = get();
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/subroles`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                const data = await res.json();
                if (data.message === 'success') {
                    set({ subroles: data.data || [] });
                }
            } catch (e) {
                console.error('Failed to fetch subroles', e);
            }
        },
        manageRoles: async (action, payload) => {
            const { token } = get();
            if (!token) return;
            try {
                if (action === 'create') {
                    await fetch(`${API_URL}/roles`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ label: payload.label, color: payload.color })
                    });
                } else if (action === 'update' && payload.id) {
                    await fetch(`${API_URL}/roles/${payload.id}`, {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ label: payload.label, color: payload.color, is_enabled: 1 })
                    });
                } else if (action === 'delete' && payload.id) {
                    await fetch(`${API_URL}/roles/${payload.id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                }
                await get().fetchRoles();
                await get().fetchSubroles();
            } catch (e) {
                console.error('Failed to manage roles', e);
            }
        },
        manageSubroles: async (action, payload) => {
            const { token } = get();
            if (!token) return;
            try {
                if (action === 'create' && payload.roleId) {
                    await fetch(`${API_URL}/roles/${payload.roleId}/subroles`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ label: payload.label, color: payload.color })
                    });
                } else if (action === 'update' && payload.id) {
                    await fetch(`${API_URL}/subroles/${payload.id}`, {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ label: payload.label, color: payload.color, is_enabled: 1 })
                    });
                } else if (action === 'delete' && payload.id) {
                    await fetch(`${API_URL}/subroles/${payload.id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                }
                await get().fetchSubroles();
            } catch (e) {
                console.error('Failed to manage subroles', e);
            }
        },
        reorderRoles: async (orderedIds) => {
            const { token } = get();
            if (!token) return;
            try {
                await fetch(`${API_URL}/roles/reorder`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ orderedIds })
                });
                await get().fetchRoles();
            } catch (e) {
                console.error('Failed to reorder roles', e);
            }
        },
        fetchEventNotes: async (eventId) => {
            const { token } = get();
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/events/${eventId}/notes`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                const data = await res.json();
                if (data.message === 'success') {
                    const next: Record<string, string> = {};
                    (data.data || []).forEach((row: { role_id: string; content: string }) => {
                        next[row.role_id] = row.content || '';
                    });
                    set((state) => ({
                        eventNotes: { ...state.eventNotes, [eventId]: next }
                    }));
                }
            } catch (e) {
                console.error('Failed to fetch event notes', e);
            }
        },
        saveEventNote: async (eventId, roleId, content) => {
            const { token } = get();
            if (!token) return false;
            try {
                const res = await fetch(`${API_URL}/events/${eventId}/notes`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ roleId, content })
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return false;
                }
                if (res.ok) {
                    set((state) => ({
                        eventNotes: {
                            ...state.eventNotes,
                            [eventId]: { ...(state.eventNotes[eventId] || {}), [roleId]: content }
                        }
                    }));
                    return true;
                }
            } catch (e) {
                console.error('Failed to save event note', e);
            }
            return false;
        },
        uploadFile: async (file) => {
            const { token } = get();
            if (!token) return null;
            try {
                const form = new FormData();
                form.append('file', file);
                const res = await fetch(`${API_URL}/upload`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: form
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return null;
                }
                const data = await res.json();
                if (data.message === 'success' && data.url) {
                    return data.url as string;
                }
            } catch (e) {
                console.error('Failed to upload file', e);
            }
            return null;
        },
        toggleCompare: () => set((state) => ({ compareMode: !state.compareMode })),
        fetchAppConfig: async () => {
            try {
                const res = await fetch(`${API_URL}/config`);
                const data = await res.json();
                if (data.message === 'success') {
                    set({ appConfig: data.data || null });
                }
            } catch (e) {
                console.error('Failed to fetch app config', e);
            }
        },
        updateAppConfig: async (config) => {
            const { token } = get();
            if (!token) return false;
            try {
                const res = await fetch(`${API_URL}/admin/config`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ config })
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return false;
                }
                if (res.ok) {
                    const data = await res.json();
                    if (data.message === 'success') {
                        set({ appConfig: data.data || config });
                    }
                    return true;
                }
            } catch (e) {
                console.error('Failed to update app config', e);
            }
            return false;
        },
        bootstrap: async () => {
            await Promise.all([
                get().fetchEvents(),
                get().fetchPostponedEvents(),
                get().fetchFriends(),
                get().fetchUsers(),
                get().fetchProfile(),
                get().fetchRoles(),
                get().fetchSubroles(),
                get().fetchAppConfig()
            ]);
        },
        fetchAdminEvents: async (userId) => {
            const { token } = get();
            if (!token) return;
            const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
            try {
                const res = await fetch(`${API_URL}/admin/events${query}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                const data = await res.json();
                if (data.message === 'success') {
                    set({ adminEvents: data.data || [] });
                }
            } catch (e) {
                console.error('Failed to fetch admin events', e);
            }
        },
        adminDeleteEvents: async (ids) => {
            const { token } = get();
            if (!token) return false;
            try {
                const res = await fetch(`${API_URL}/admin/events/bulk`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ ids })
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return false;
                }
                return res.ok;
            } catch (e) {
                console.error('Failed to delete admin events', e);
            }
            return false;
        },
        fetchAdminUsers: async () => {
            const { token } = get();
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/admin/users`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return;
                }
                const data = await res.json();
                if (data.message === 'success') {
                    set({ adminUsers: data.data || [] });
                }
            } catch (e) {
                console.error('Failed to fetch admin users', e);
            }
        },
        adminDeleteUsers: async (ids) => {
            const { token } = get();
            if (!token) return false;
            try {
                const res = await fetch(`${API_URL}/admin/users/bulk`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ ids })
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return false;
                }
                return res.ok;
            } catch (e) {
                console.error('Failed to delete admin users', e);
            }
            return false;
        },
        fetchTableData: async (table) => {
            const { token } = get();
            if (!token) return [];
            try {
                const res = await fetch(`${API_URL}/admin/database/${table}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 401 || res.status === 403) {
                    logoutAndReset();
                    return [];
                }
                const data = await res.json();
                if (data.message === 'success') return data.data || [];
            } catch (e) {
                console.error('Failed to fetch table data', e);
            }
            return [];
        },
    };
});
export interface UserPreferences {
    backgroundUrl?: string;
    accentColor?: string;
    noiseOverlay?: boolean;
    theme?: 'light' | 'dark';
    _updatedAt?: number;
}
