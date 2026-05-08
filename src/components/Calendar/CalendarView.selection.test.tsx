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
});
