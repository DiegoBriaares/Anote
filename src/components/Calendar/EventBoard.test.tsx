/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventBoard } from './EventBoard';
import { formatDate } from '../../utils/dateUtils';
import { useCalendarStore } from '../../store/calendarStore';

vi.mock('../../store/calendarStore', () => ({
    useCalendarStore: vi.fn()
}));

const mockedUseCalendarStore = useCalendarStore as unknown as Mock;

const buildState = (overrides: Record<string, unknown> = {}) => {
    const selectedDate = new Date(2026, 3, 23);
    const dateKey = formatDate(selectedDate);

    return {
        events: {
            [dateKey]: [
                {
                    id: 'event-1',
                    title: 'Close monthly report',
                    date: dateKey,
                    startTime: '09:00',
                    priority: 1,
                    note: 'Send to finance',
                    link: null,
                    completed: false,
                    originDates: null,
                    wasPostponed: null
                }
            ]
        },
        viewMode: 'self',
        addEvent: vi.fn().mockResolvedValue(undefined),
        deleteEvent: vi.fn().mockResolvedValue(undefined),
        editEvent: vi.fn().mockResolvedValue(true),
        setEventCompleted: vi.fn().mockResolvedValue(true),
        actionError: null,
        clearActionError: vi.fn(),
        ...overrides
    };
};

beforeEach(() => {
    mockedUseCalendarStore.mockReset();
});

afterEach(() => {
    cleanup();
});

describe('EventBoard', () => {
    it('marks a selected-day event as completed', async () => {
        const setEventCompleted = vi.fn().mockResolvedValue(true);
        mockedUseCalendarStore.mockReturnValue(buildState({ setEventCompleted }));

        const user = userEvent.setup();
        render(<EventBoard selectedDate={new Date(2026, 3, 23)} />);

        await user.click(screen.getByRole('button', { name: 'Mark complete' }));

        expect(setEventCompleted).toHaveBeenCalledTimes(1);
        expect(setEventCompleted).toHaveBeenCalledWith(expect.objectContaining({ id: 'event-1' }), true);
    });

    it('renders the action error when the update fails', () => {
        mockedUseCalendarStore.mockReturnValue(buildState({
            actionError: 'Failed to update event'
        }));

        render(<EventBoard selectedDate={new Date(2026, 3, 23)} />);

        expect(screen.getByText('Failed to update event')).toBeTruthy();
    });

    it('renders completed events with the muted completed styling', () => {
        mockedUseCalendarStore.mockReturnValue(buildState({
            events: {
                [formatDate(new Date(2026, 3, 23))]: [
                    {
                        id: 'event-1',
                        title: 'Close monthly report',
                        date: formatDate(new Date(2026, 3, 23)),
                        startTime: '09:00',
                        priority: 1,
                        note: 'Send to finance',
                        link: null,
                        completed: true,
                        originDates: null,
                        wasPostponed: null
                    }
                ]
            }
        }));

        render(<EventBoard selectedDate={new Date(2026, 3, 23)} />);

        expect(screen.getByText('Close monthly report').closest('.board-card-completed')).not.toBeNull();
        expect(screen.getByText('Completed')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Unmark' })).toBeTruthy();
    });
});
