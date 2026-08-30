/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderWithLanguage } from '../test/renderWithLanguage';
import userEvent from '@testing-library/user-event';
import { RangeBoard } from './RangeBoard';
import { formatDate } from '../../utils/dateUtils';
import { useCalendarStore } from '../../store/calendarStore';

vi.mock('../../store/calendarStore', () => ({
    useCalendarStore: vi.fn()
}));

const mockedUseCalendarStore = useCalendarStore as unknown as Mock;

const buildRangeState = (overrides: Record<string, unknown> = {}) => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 0, 2);
    const sourceDate = formatDate(start);
    return {
        selection: { start, end },
        events: {
            [sourceDate]: [
                {
                    id: 'event-1',
                    title: 'Draft itinerary',
                    date: sourceDate,
                    startTime: '09:00',
                    priority: 2,
                    note: null,
                    link: null,
                    completed: true,
                    originDates: null,
                    wasPostponed: true
                }
            ]
        },
        viewMode: 'self',
        addEventsBulk: vi.fn().mockResolvedValue(true),
        editEvent: vi.fn().mockResolvedValue(undefined),
        addPostponedEventsBulk: vi.fn().mockResolvedValue(true),
        deleteEvent: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
};

beforeEach(() => {
    mockedUseCalendarStore.mockReset();
});

afterEach(() => {
    cleanup();
});

describe('RangeBoard', () => {
    it('does not delete events when postponing a move fails', async () => {
        const addPostponedEventsBulk = vi.fn().mockResolvedValue(false);
        const deleteEvent = vi.fn().mockResolvedValue(undefined);
        mockedUseCalendarStore.mockReturnValue(
            buildRangeState({
                addPostponedEventsBulk,
                deleteEvent
            })
        );

        const user = userEvent.setup();
        renderWithLanguage(<RangeBoard activeDate={new Date(2026, 0, 1)} />);

        await user.click(screen.getAllByRole('checkbox')[0]);
        await user.selectOptions(screen.getByLabelText('Action'), 'move');
        await user.click(screen.getByRole('button', { name: /Move to postponed/i }));

        expect(addPostponedEventsBulk).toHaveBeenCalled();
        expect(addPostponedEventsBulk.mock.calls[0][0][0].completed).toBe(true);
        expect(deleteEvent).not.toHaveBeenCalled();
    });

    it('preserves completion and postponement history when copying across dates', async () => {
        const addEventsBulk = vi.fn().mockResolvedValue(true);
        mockedUseCalendarStore.mockReturnValue(
            buildRangeState({
                addEventsBulk
            })
        );

        const targetDate = formatDate(new Date(2026, 0, 2));
        const user = userEvent.setup();
        renderWithLanguage(<RangeBoard activeDate={new Date(2026, 0, 1)} />);

        await screen.findByDisplayValue(targetDate);
        await user.click(screen.getAllByRole('checkbox')[0]);
        await user.click(screen.getByRole('button', { name: /Copy selected/i }));

        expect(addEventsBulk).toHaveBeenCalledTimes(1);
        const payload = addEventsBulk.mock.calls[0][0];
        expect(payload[0].completed).toBe(true);
        expect(payload[0].wasPostponed).toBe(true);
    });

    it('renders completed management rows with the completed styling', () => {
        mockedUseCalendarStore.mockReturnValue(buildRangeState());

        renderWithLanguage(<RangeBoard activeDate={new Date(2026, 0, 1)} />);

        expect(screen.getByText('Draft itinerary').closest('.board-card-completed')).not.toBeNull();
        expect(screen.getByText('Completed')).toBeTruthy();
    });

    it('can postpone selected calendar events into the Today domain', async () => {
        const addPostponedEventsBulk = vi.fn().mockResolvedValue(true);
        mockedUseCalendarStore.mockReturnValue(
            buildRangeState({
                addPostponedEventsBulk
            })
        );

        const user = userEvent.setup();
        renderWithLanguage(<RangeBoard activeDate={new Date(2026, 0, 1)} />);

        await user.click(screen.getAllByRole('checkbox')[0]);
        await user.selectOptions(screen.getByLabelText('Postponed list'), 'today');
        await user.click(screen.getByRole('button', { name: /Copy to postponed/i }));

        expect(addPostponedEventsBulk).toHaveBeenCalledTimes(1);
        expect(addPostponedEventsBulk.mock.calls[0][0][0].postponedView).toBe('today');
    });
});
