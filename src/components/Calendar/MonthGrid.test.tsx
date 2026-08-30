/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderWithLanguage } from '../test/renderWithLanguage';
import { MonthGrid } from './MonthGrid';
import { useCalendarStore } from '../../store/calendarStore';
import { formatDate } from '../../utils/dateUtils';

describe('MonthGrid', () => {
    beforeEach(() => {
        useCalendarStore.setState({
            events: {},
            selection: { start: null, end: null },
            compareMode: false,
            compareEvents: {},
            dailyFacts: {},
            dayBackgrounds: {}
        } as never);
    });

    afterEach(() => {
        cleanup();
    });

    it('renders completed events with the shadowed completed chip styling', () => {
        const completedDate = new Date(2026, 3, 23);
        const dateKey = formatDate(completedDate);

        useCalendarStore.setState({
            events: {
                [dateKey]: [
                    {
                        id: 'event-1',
                        title: 'Complete payroll',
                        date: dateKey,
                        startTime: '09:00',
                        priority: 2,
                        note: null,
                        link: null,
                        completed: true,
                        originDates: null,
                        wasPostponed: null
                    }
                ]
            }
        } as never);

        renderWithLanguage(
            <MonthGrid
                year={2026}
                month={3}
                onDateClick={() => {}}
                onDateEnter={() => {}}
                isSelecting={false}
            />
        );

        const timeChip = screen.getByText('09:00 · P2');
        expect(timeChip.closest('.time-pill-completed')).not.toBeNull();
        expect(timeChip.closest('.event-chip-completed')).not.toBeNull();
    });

    it('renders failed events with red calendar chip styling', () => {
        const failedDate = new Date(2026, 3, 23);
        const dateKey = formatDate(failedDate);
        useCalendarStore.setState({
            events: {
                [dateKey]: [{
                    id: 'event-1',
                    title: 'Failed rollout',
                    date: dateKey,
                    startTime: '09:00',
                    priority: 2,
                    completed: false,
                    failed: true
                }]
            }
        } as never);

        renderWithLanguage(
            <MonthGrid
                year={2026}
                month={3}
                onDateClick={() => {}}
                onDateEnter={() => {}}
                isSelecting={false}
            />
        );

        const timeChip = screen.getByText('09:00 · P2');
        expect(timeChip.closest('.time-pill-failed')).not.toBeNull();
        expect(timeChip.closest('.event-chip-failed')).not.toBeNull();
    });

    it('marks explicitly selected group-event days outside the drag range selection', () => {
        const markedDate = new Date(2026, 3, 23);
        const dateKey = formatDate(markedDate);

        renderWithLanguage(
            <MonthGrid
                year={2026}
                month={3}
                onDateClick={() => {}}
                onDateEnter={() => {}}
                isSelecting={false}
                markedDateKeys={[dateKey]}
                isDayMarkingActive
            />
        );

        expect(screen.getByText('SELECTED')).toBeTruthy();
        expect(screen.getByText('Selected day')).toBeTruthy();
        expect(screen.getByText('23').closest('.cell-selected')).not.toBeNull();
    });
});
