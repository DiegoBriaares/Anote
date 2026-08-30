/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderWithLanguage } from '../test/renderWithLanguage';
import userEvent from '@testing-library/user-event';
import { DayEventsAdministrationPage } from './DayEventsAdministrationPage';
import { useCalendarStore } from '../../store/calendarStore';

vi.mock('../../store/calendarStore', () => ({
    useCalendarStore: vi.fn()
}));

const mockedUseCalendarStore = useCalendarStore as unknown as Mock;

const buildState = (overrides: Record<string, unknown> = {}) => ({
    dayAdministrationDate: '2026-04-23',
    navigateToCalendar: vi.fn(),
    events: {
        '2026-04-23': [
            {
                id: 'event-1',
                title: 'Review launch checklist',
                date: '2026-04-23',
                startTime: '09:00',
                priority: 1,
                note: null,
                link: null,
                completed: false,
                originDates: null,
                wasPostponed: null
            }
        ]
    },
    selection: {
        start: new Date(2026, 3, 23),
        end: new Date(2026, 3, 23)
    },
    viewMode: 'self',
    viewingUserId: 'user-1',
    viewingUsername: 'mira',
    fetchEvents: vi.fn().mockResolvedValue(undefined),
    fetchFriendEvents: vi.fn().mockResolvedValue(undefined),
    addEvent: vi.fn().mockResolvedValue(undefined),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
    editEvent: vi.fn().mockResolvedValue(true),
    setEventStatus: vi.fn().mockResolvedValue(true),
    addEventsBulk: vi.fn().mockResolvedValue(true),
    addPostponedEventsBulk: vi.fn().mockResolvedValue(true),
    actionError: null,
    clearActionError: vi.fn(),
    ...overrides
});

beforeEach(() => {
    mockedUseCalendarStore.mockReturnValue(buildState());
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('DayEventsAdministrationPage', () => {
    it('renders the selected day and all administration sections', async () => {
        renderWithLanguage(<DayEventsAdministrationPage />);

        expect(screen.getByText('Thursday, April 23, 2026')).toBeTruthy();
        expect(screen.getAllByText('Events administration').length).toBeGreaterThan(0);
        expect(screen.getByText('Event information')).toBeTruthy();
        expect((await screen.findAllByText('Event management')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('Review launch checklist').length).toBeGreaterThan(0);
    });

    it('returns to the calendar through the page API', async () => {
        const navigateToCalendar = vi.fn();
        mockedUseCalendarStore.mockReturnValue(buildState({ navigateToCalendar }));
        const user = userEvent.setup();

        renderWithLanguage(<DayEventsAdministrationPage />);

        await user.click(screen.getByRole('button', { name: /Back to Calendar/i }));

        expect(navigateToCalendar).toHaveBeenCalledTimes(1);
    });
});
