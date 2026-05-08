/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CalendarView } from './CalendarView';
import { useCalendarStore } from '../../store/calendarStore';
import { formatDate } from '../../utils/dateUtils';

describe('CalendarView range selection', () => {
    beforeEach(() => {
        useCalendarStore.setState({
            viewDate: new Date(2026, 3, 1),
            events: {},
            selection: { start: null, end: null },
            selectionActive: false,
            viewMode: 'self',
            viewingUserId: null,
            viewingUsername: null,
            actionError: null,
            compareMode: false,
            compareEvents: {},
            dailyFacts: {},
            dayBackgrounds: {},
            fetchEvents: vi.fn().mockResolvedValue(undefined),
            fetchFriendEvents: vi.fn().mockResolvedValue(undefined),
            fetchMonthVisuals: vi.fn().mockResolvedValue(undefined),
            addEventsBulk: vi.fn().mockResolvedValue(true)
        } as never);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('keeps a dragged multi-day selection on the calendar after mouseup', () => {
        render(<CalendarView />);

        const day23 = screen.getAllByText('23')[0].closest('.calendar-cell');
        const day25 = screen.getAllByText('25')[0].closest('.calendar-cell');

        expect(day23).not.toBeNull();
        expect(day25).not.toBeNull();

        fireEvent.mouseDown(day23!);
        fireEvent.mouseEnter(day25!);
        fireEvent.mouseUp(window);

        const { selection, selectionActive } = useCalendarStore.getState();
        expect(selection.start ? formatDate(selection.start) : null).toBe('2026-04-23');
        expect(selection.end ? formatDate(selection.end) : null).toBe('2026-04-25');
        expect(selectionActive).toBe(false);
        expect(screen.queryByText('SEQUENCE_INPUT_CONSOLE')).toBeNull();
    });

    it('marks every day in a continuous drag while selecting group event days', () => {
        render(<CalendarView />);

        fireEvent.click(screen.getByRole('button', { name: /select days/i }));

        const day23 = screen.getAllByText('23')[0].closest('.calendar-cell');
        const day25 = screen.getAllByText('25')[0].closest('.calendar-cell');

        expect(day23).not.toBeNull();
        expect(day25).not.toBeNull();

        fireEvent.mouseDown(day23!);
        fireEvent.mouseEnter(day25!);
        fireEvent.mouseUp(window);

        expect(screen.getByText('Mark Days (3)')).toBeTruthy();
        expect(screen.getAllByText('MARKED')).toHaveLength(3);
    });

    it('opens a read view for marked days without leaving the calendar', () => {
        useCalendarStore.setState({
            events: {
                '2026-04-23': [
                    {
                        id: 'event-1',
                        title: 'Planning review',
                        date: '2026-04-23',
                        startTime: '09:30',
                        priority: 2,
                        note: null,
                        link: null,
                        completed: false
                    }
                ],
                '2026-04-24': [
                    {
                        id: 'event-2',
                        title: 'Launch readout',
                        date: '2026-04-24',
                        startTime: '11:00',
                        priority: 1,
                        note: null,
                        link: null,
                        completed: false
                    }
                ]
            }
        } as never);

        render(<CalendarView />);

        fireEvent.click(screen.getByRole('button', { name: /select days/i }));

        const day23 = screen.getAllByText('23')[0].closest('.calendar-cell');
        const day24 = screen.getAllByText('24')[0].closest('.calendar-cell');

        fireEvent.mouseDown(day23!);
        fireEvent.mouseEnter(day24!);
        fireEvent.mouseUp(window);
        fireEvent.click(screen.getByRole('button', { name: /read events/i }));

        expect(screen.getByRole('region', { name: 'Events for 2026-04-23' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Events for 2026-04-24' })).toBeTruthy();
        expect(screen.getByText('Planning review')).toBeTruthy();
        expect(screen.getByText('Launch readout')).toBeTruthy();
        expect(useCalendarStore.getState().selection.start).toBeNull();
    });

    it('cancels an in-progress marked-day operation with the X action', () => {
        render(<CalendarView />);

        fireEvent.click(screen.getByRole('button', { name: /select days/i }));

        const day23 = screen.getAllByText('23')[0].closest('.calendar-cell');
        const day25 = screen.getAllByText('25')[0].closest('.calendar-cell');

        fireEvent.mouseDown(day23!);
        fireEvent.mouseEnter(day25!);
        fireEvent.mouseUp(window);
        fireEvent.click(screen.getByRole('button', { name: /read events/i }));

        expect(screen.getByRole('region', { name: 'Events for 2026-04-23' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /cancel group event operation/i }));

        expect(screen.queryByRole('region', { name: 'Events for 2026-04-23' })).toBeNull();
        expect(screen.queryAllByText('MARKED')).toHaveLength(0);
        expect(screen.getByRole('button', { name: /select days/i })).toBeTruthy();
    });
});
