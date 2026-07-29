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
        setEventStatus: vi.fn().mockResolvedValue(true),
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
        const setEventStatus = vi.fn().mockResolvedValue(true);
        mockedUseCalendarStore.mockReturnValue(buildState({ setEventStatus }));

        const user = userEvent.setup();
        render(<EventBoard selectedDate={new Date(2026, 3, 23)} />);

        await user.click(screen.getByRole('button', { name: 'Mark complete' }));

        expect(setEventStatus).toHaveBeenCalledTimes(1);
        expect(setEventStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'event-1' }), 'completed');
    });

    it('marks a selected-day event as failed', async () => {
        const setEventStatus = vi.fn().mockResolvedValue(true);
        mockedUseCalendarStore.mockReturnValue(buildState({ setEventStatus }));

        const user = userEvent.setup();
        render(<EventBoard selectedDate={new Date(2026, 3, 23)} />);

        await user.click(screen.getByRole('button', { name: 'Mark failed' }));

        expect(setEventStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'event-1' }), 'failed');
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

    it('keeps the create draft when adding an event fails', async () => {
        const addEvent = vi.fn().mockResolvedValue(false);
        mockedUseCalendarStore.mockReturnValue(buildState({ addEvent }));

        const user = userEvent.setup();
        render(<EventBoard selectedDate={new Date(2026, 3, 23)} />);

        const titleInput = screen.getByPlaceholderText('Title');
        await user.type(titleInput, 'New planning block');
        await user.click(screen.getByRole('button', { name: 'Add Entry' }));

        expect(addEvent).toHaveBeenCalledTimes(1);
        expect((titleInput as HTMLInputElement).value).toBe('New planning block');
    });

    it('renders failed events with the red failed styling', () => {
        mockedUseCalendarStore.mockReturnValue(buildState({
            events: {
                [formatDate(new Date(2026, 3, 23))]: [{
                    id: 'event-1',
                    title: 'Production rollout',
                    date: formatDate(new Date(2026, 3, 23)),
                    failed: true,
                    completed: false
                }]
            }
        }));

        render(<EventBoard selectedDate={new Date(2026, 3, 23)} />);

        expect(screen.getByText('Production rollout').closest('.board-card-failed')).not.toBeNull();
        expect(screen.getByText('Failed').closest('.status-pill-failed')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Unmark' })).toBeTruthy();
    });
});
