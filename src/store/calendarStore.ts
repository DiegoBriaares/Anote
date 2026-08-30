import { create } from 'zustand';

import { invalidateSessionRequests } from '../api/client';
import { formatDate } from '../utils/dateUtils';
import type { EventStatus } from '../utils/eventStatus';
import { storage } from '../utils/storage';
import type { PostponedEventDomain } from '../utils/postponedDomains';
import type { ProgramInput } from '../api/programs';
import type { CalendarEvent, Program, ProgramRun, User, UserPreferences } from '../api/contracts';
import { createSessionOwner } from './owners/sessionOwner';
import { createProgramsOwner } from './owners/programsOwner';
import { createSocialOwner } from './owners/socialOwner';
import { createConfigurationOwner } from './owners/configurationOwner';
import { createResourcesOwner } from './owners/resourcesOwner';
import { createEventsOwner } from './owners/eventsOwner';

export type { CalendarEvent, Program, UserPreferences } from '../api/contracts';

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
    registration_enabled?: boolean | string;
    [key: string]: string | boolean | undefined;
}

export interface AdminEvent {
    id: string;
    revision: number;
    title: string;
    date: string;
    startTime?: string | null;
    completed?: boolean | null;
    failed?: boolean | null;
    userId?: string;
    username?: string;
}

export interface AdminUser {
    id: string;
    username: string;
    isAdmin?: boolean;
    avatarUrl?: string | null;
    eventCount?: number;
}

export interface AdminRoleRecord {
    id: string;
    label: string;
    color: string | null;
    isEnabled: boolean;
    orderIndex: number;
    username: string;
}

interface Selection {
    start: Date | null;
    end: Date | null;
}

export interface CalendarState {
    // Auth State
    user: User | null;
    sessionStatus: 'loading' | 'authenticated' | 'anonymous';
    isLoading: boolean;
    error: string | null;
    actionError: string | null;
    restoreSession: () => Promise<void>;
    login: (u: string, p: string) => Promise<void>;
    register: (u: string, p: string) => Promise<void>;
    logout: () => Promise<void>;
    clearActionError: () => void;

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
    currentView: 'calendar' | 'day-administration' | 'postponed' | 'profile' | 'friends' | 'roles' | 'programs' | 'admin';
    dayAdministrationDate: string | null;
    programs: Program[];
    lastProgramRun: ProgramRun | null;

    setSelection: (start: Date | null, end: Date | null) => void;
    setSelectionActive: (active: boolean) => void;
    fetchEvents: () => Promise<void>;
    fetchPostponedEvents: () => Promise<void>;
    fetchFriendEvents: (friendId: string, friendName: string) => Promise<void>;
    viewOwnCalendar: () => Promise<void>;
    addEvent: (date: Date, entry: { title: string; time?: string; startTime?: string; link?: string; note?: string; priority?: number | string | null }) => Promise<boolean>;
    addEventsToRange: (entries: Array<{ title: string; time?: string; startTime?: string; link?: string; note?: string; priority?: number | string | null }>) => Promise<void>;
    addEventsBulk: (entries: Array<{ title: string; date: string; startTime?: string | null; priority?: number | string | null; link?: string | null; note?: string | null; completed?: boolean | null; failed?: boolean | null; originDates?: string[] | null; wasPostponed?: boolean | null }>) => Promise<boolean>;
    shareEventsToFriends: (friendIds: string[], dateKeys: string[], eventIds?: string[]) => Promise<boolean>;
    deleteEvent: (id: string) => Promise<void>;
    editEvent: (event: CalendarEvent, options?: { recordClockCheck?: boolean }) => Promise<boolean>;
    setEventStatus: (event: CalendarEvent, status: EventStatus) => Promise<boolean>;
    setEventCompleted: (event: CalendarEvent, completed: boolean) => Promise<boolean>;
    addPostponedEvent: (entry: { title: string; time?: string; startTime?: string; link?: string; note?: string; priority?: number | string | null; completed?: boolean | null; failed?: boolean | null; postponedView?: PostponedEventDomain }) => Promise<void>;
    addPostponedEventsBulk: (entries: Array<{ title: string; startTime?: string | null; priority?: number | string | null; link?: string | null; note?: string | null; completed?: boolean | null; failed?: boolean | null; originDates?: string[] | null; postponedView?: PostponedEventDomain }>) => Promise<boolean>;
    deletePostponedEvent: (id: string) => Promise<void>;
    editPostponedEvent: (event: CalendarEvent) => Promise<boolean>;
    setViewDate: (date: Date) => void;
    clearSelection: () => void;
    setLocalPreferences: (prefs: Partial<UserPreferences> & { _updatedAt?: number }) => void;
    navigateToProfile: () => void;
    navigateToFriends: () => void;
    navigateToRoles: () => void;
    navigateToPrograms: () => void;
    navigateToCalendar: () => void;
    navigateToDayAdministration: (date: Date | string) => void;
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
    updateProfile: (prefs: Partial<UserPreferences> & { avatar_url?: string | null; username?: string }) => Promise<boolean>;
    fetchPrograms: () => Promise<void>;
    savePrograms: (programs: Program[]) => Promise<boolean>;
    createProgram: (program: ProgramInput) => Promise<Program | null>;
    updateProgram: (id: string, revision: number, patch: Partial<ProgramInput>) => Promise<Program | null>;
    deleteProgram: (id: string, revision: number) => Promise<boolean>;
    runProgram: (id: string, revision: number) => Promise<ProgramRun | null>;
    moveIncompleteEventsToDate: (sourceDateKeys: string[], targetDateKey: string, options?: { recordClockCheck?: boolean }) => Promise<boolean>;
    pollProgramRunNotifications: () => Promise<void>;

    // Visuals
    dailyFacts: Record<string, string>;
    dayBackgrounds: Record<string, string>;
    fetchMonthVisuals: (start: string, end: string) => Promise<void>;
    saveDaySettings: (date: string, changes: { content?: string; imageUrl?: string }) => Promise<boolean>;

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
    uploadFile: (file: File, purpose?: 'avatar' | 'note', eventId?: string) => Promise<string | null>;

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
    adminRoles: AdminRoleRecord[];
    fetchAdminRoles: () => Promise<void>;
}

export const useCalendarStore = create<CalendarState>((set, get) => {
    const logoutAndReset = (message?: unknown) => {
        invalidateSessionRequests();
        storage.removeItem('token');
        storage.removeItem('user');
        storage.removeItem('profile');
        set({
            user: null,
            sessionStatus: 'anonymous',
            error: typeof message === 'string' ? message : null,
            actionError: null,
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
            dayAdministrationDate: null,
            programs: [],
            lastProgramRun: null,
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
            adminRoles: []
        });
    };

    return {
        // Auth Initial State
        user: null,
        sessionStatus: 'loading',
        isLoading: false,
        error: null,
        actionError: null,

        // Calendar Initial State
        events: {},
        postponedEvents: [],
        selection: { start: null, end: null },
        selectionActive: false,
        viewDate: new Date(),
        viewMode: 'self',
        viewingUserId: null,
        viewingUsername: null,
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
        dayAdministrationDate: null,
        programs: [],
        lastProgramRun: null,
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
        adminRoles: [],
        ...createSessionOwner({ set, get, logoutAndReset }),

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
        navigateToPrograms: () => set({ currentView: 'programs' }),
        navigateToCalendar: () => set({ currentView: 'calendar' }),
        navigateToDayAdministration: (date) => set({
            currentView: 'day-administration',
            dayAdministrationDate: typeof date === 'string' ? date : formatDate(date)
        }),
        navigateToAdmin: () => set({ currentView: 'admin' }),
        navigateToPostponed: () => set({ currentView: 'postponed' }),

        ...createEventsOwner({ set, get, logoutAndReset }),

        ...createSocialOwner({ set, get, logoutAndReset }),

        ...createProgramsOwner({ set, get, logoutAndReset }),

        ...createResourcesOwner({ set, get, logoutAndReset }),
        ...createConfigurationOwner({ set, get, logoutAndReset }),
        bootstrap: async () => {
            await Promise.all([
                get().fetchEvents(),
                get().fetchPostponedEvents(),
                get().fetchFriends(),
                get().fetchUsers(),
                get().fetchProfile(),
                get().fetchPrograms(),
                get().fetchRoles(),
                get().fetchSubroles(),
                get().fetchAppConfig()
            ]);
        },
    };
});
