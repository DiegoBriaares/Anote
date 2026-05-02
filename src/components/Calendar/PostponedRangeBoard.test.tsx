/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PostponedRangeBoard } from './PostponedRangeBoard';
import { useCalendarStore } from '../../store/calendarStore';

vi.mock('../../store/calendarStore', () => ({
    useCalendarStore: vi.fn()
}));

const mockedUseCalendarStore = useCalendarStore as unknown as Mock;

const buildPostponedState = (overrides: Record<string, unknown> = {}) => ({
    postponedEvents: [
        {
            id: 'postponed-1',
            title: 'Reschedule',
            date: '',
            startTime: '10:00',
            priority: 1,
            note: null,
            link: null,
            completed: true,
            originDates: null,
            wasPostponed: null,
            postponedView: 'all'
        }
    ],
    viewMode: 'self',
    addEventsBulk: vi.fn().mockResolvedValue(true),
    addPostponedEventsBulk: vi.fn().mockResolvedValue(true),
    deletePostponedEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides
});

beforeEach(() => {
    mockedUseCalendarStore.mockReset();
});

afterEach(() => {
    cleanup();
});

describe('PostponedRangeBoard', () => {
    it('does not delete postponed items when moving fails', async () => {
        const addEventsBulk = vi.fn().mockResolvedValue(false);
        const deletePostponedEvent = vi.fn().mockResolvedValue(undefined);
        mockedUseCalendarStore.mockReturnValue(
            buildPostponedState({
                addEventsBulk,
                deletePostponedEvent
            })
        );

        const user = userEvent.setup();
        const { container } = render(<PostponedRangeBoard />);
        const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;

        fireEvent.change(dateInput, { target: { value: '2026-01-02' } });
        await user.click(screen.getByRole('checkbox'));
        await user.selectOptions(screen.getByLabelText('Action'), 'move');
        await user.click(screen.getByRole('button', { name: 'Move Selected' }));

        expect(addEventsBulk).toHaveBeenCalled();
        expect(deletePostponedEvent).not.toHaveBeenCalled();
    });

    it('preserves completion when copying postponed events back to the calendar', async () => {
        const addEventsBulk = vi.fn().mockResolvedValue(true);
        mockedUseCalendarStore.mockReturnValue(
            buildPostponedState({
                addEventsBulk
            })
        );

        const user = userEvent.setup();
        const { container } = render(<PostponedRangeBoard />);
        const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;

        fireEvent.change(dateInput, { target: { value: '2026-01-02' } });
        await user.click(screen.getAllByRole('checkbox')[0]);
        await user.click(screen.getByRole('button', { name: 'Copy Selected' }));

        expect(addEventsBulk).toHaveBeenCalledTimes(1);
        expect(addEventsBulk.mock.calls[0][0][0].completed).toBe(true);
        expect(addEventsBulk.mock.calls[0][0][0].wasPostponed).toBe(true);
    });

    it('preserves completion when copying between postponed views', async () => {
        const addPostponedEventsBulk = vi.fn().mockResolvedValue(true);
        mockedUseCalendarStore.mockReturnValue(
            buildPostponedState({
                postponedEvents: [
                    {
                        id: 'postponed-1',
                        title: 'Reschedule',
                        date: '',
                        startTime: '10:00',
                        priority: 1,
                        note: null,
                        link: null,
                        completed: true,
                        originDates: null,
                        wasPostponed: null,
                        postponedView: 'week'
                    }
                ],
                addPostponedEventsBulk
            })
        );

        const user = userEvent.setup();
        render(<PostponedRangeBoard postponedView="week" />);

        await user.click(screen.getAllByRole('checkbox')[0]);
        await user.click(screen.getByRole('button', { name: 'Copy to Postponed' }));

        expect(addPostponedEventsBulk).toHaveBeenCalledTimes(1);
        expect(addPostponedEventsBulk.mock.calls[0][0][0].completed).toBe(true);
        expect(addPostponedEventsBulk.mock.calls[0][0][0].postponedView).toBe('all');
    });

    it('can copy postponed events into the Today domain', async () => {
        const addPostponedEventsBulk = vi.fn().mockResolvedValue(true);
        mockedUseCalendarStore.mockReturnValue(
            buildPostponedState({
                postponedEvents: [
                    {
                        id: 'postponed-1',
                        title: 'Reschedule',
                        date: '',
                        startTime: '10:00',
                        priority: 1,
                        note: null,
                        link: null,
                        completed: true,
                        originDates: null,
                        wasPostponed: null,
                        postponedView: 'week'
                    }
                ],
                addPostponedEventsBulk
            })
        );

        const user = userEvent.setup();
        render(<PostponedRangeBoard postponedView="week" />);

        await user.click(screen.getAllByRole('checkbox')[0]);
        await user.selectOptions(screen.getByLabelText('Postponed View'), 'today');
        await user.click(screen.getByRole('button', { name: 'Copy to Postponed' }));

        expect(addPostponedEventsBulk).toHaveBeenCalledTimes(1);
        expect(addPostponedEventsBulk.mock.calls[0][0][0].completed).toBe(true);
        expect(addPostponedEventsBulk.mock.calls[0][0][0].postponedView).toBe('today');
    });
});
