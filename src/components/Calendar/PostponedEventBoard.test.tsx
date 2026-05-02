/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PostponedEventBoard } from './PostponedEventBoard';
import { useCalendarStore } from '../../store/calendarStore';

vi.mock('../../store/calendarStore', () => ({
    useCalendarStore: vi.fn()
}));

const mockedUseCalendarStore = useCalendarStore as unknown as Mock;

const buildState = (overrides: Record<string, unknown> = {}) => ({
    postponedEvents: [
        {
            id: 'today-1',
            title: 'Today follow-up',
            date: '',
            startTime: '09:00',
            priority: 1,
            note: null,
            link: null,
            completed: false,
            originDates: null,
            wasPostponed: null,
            postponedView: 'today'
        },
        {
            id: 'week-1',
            title: 'Weekly follow-up',
            date: '',
            startTime: '10:00',
            priority: 2,
            note: null,
            link: null,
            completed: false,
            originDates: null,
            wasPostponed: null,
            postponedView: 'week'
        },
        {
            id: 'all-1',
            title: 'Anytime follow-up',
            date: '',
            startTime: '11:00',
            priority: 3,
            note: null,
            link: null,
            completed: false,
            originDates: null,
            wasPostponed: null,
            postponedView: 'all'
        }
    ],
    viewMode: 'self',
    addPostponedEvent: vi.fn().mockResolvedValue(undefined),
    deletePostponedEvent: vi.fn().mockResolvedValue(undefined),
    editPostponedEvent: vi.fn().mockResolvedValue(true),
    actionError: null,
    clearActionError: vi.fn(),
    ...overrides
});

beforeEach(() => {
    mockedUseCalendarStore.mockReset();
});

afterEach(() => {
    cleanup();
});

describe('PostponedEventBoard', () => {
    it('renders and selects the Today postponed domain', async () => {
        const onViewChange = vi.fn();
        mockedUseCalendarStore.mockReturnValue(buildState());

        const user = userEvent.setup();
        render(<PostponedEventBoard postponedView="today" onViewChange={onViewChange} />);

        expect(screen.getByText('Today follow-up')).toBeTruthy();
        expect(screen.queryByText('Weekly follow-up')).toBeNull();
        expect(screen.queryByText('Anytime follow-up')).toBeNull();

        await user.click(screen.getByRole('button', { name: 'This week' }));

        expect(onViewChange).toHaveBeenCalledWith('week');
    });
});
