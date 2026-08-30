import type { StoreApi } from 'zustand';

import type { CalendarState } from '../calendarStore';

export type OwnerContext = {
    set: StoreApi<CalendarState>['setState'];
    get: StoreApi<CalendarState>['getState'];
    logoutAndReset: (message?: unknown) => void;
};
