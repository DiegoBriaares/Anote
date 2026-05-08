/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { GroupEventReader } from './GroupEventReader';

describe('GroupEventReader', () => {
    it('renders selected days as independent event columns', () => {
        render(
            <GroupEventReader
                selectedDateKeys={['2026-04-23', '2026-04-24']}
                eventsByDate={{
                    '2026-04-23': [
                        {
                            id: 'event-1',
                            title: 'Planning review',
                            date: '2026-04-23',
                            startTime: '09:30',
                            priority: 2,
                            note: 'Bring notes',
                            link: null,
                            completed: false
                        }
                    ],
                    '2026-04-24': [
                        {
                            id: 'event-2',
                            title: 'Completed audit',
                            date: '2026-04-24',
                            startTime: null,
                            priority: null,
                            note: null,
                            link: 'https://example.com',
                            completed: true
                        }
                    ]
                }}
            />
        );

        const firstDay = screen.getByRole('region', { name: 'Events for 2026-04-23' });
        const secondDay = screen.getByRole('region', { name: 'Events for 2026-04-24' });

        expect(within(firstDay).getByText('Planning review')).toBeTruthy();
        expect(within(firstDay).getByText('09:30 · P2')).toBeTruthy();
        expect(within(secondDay).getByText('Completed audit')).toBeTruthy();
        expect(within(secondDay).getByText('Done')).toBeTruthy();
    });
});
