/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithLanguage } from '../test/renderWithLanguage';
import { GroupEventPublisher } from './GroupEventPublisher';
import { buildGroupEventPublishEntries, buildQueuedGroupEvent } from './groupEventUtils';

describe('GroupEventPublisher', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds a trimmed queued event for publishing across marked days', () => {
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');

        const event = buildQueuedGroupEvent({
            title: '  Planning review  ',
            startTime: '09:30',
            priority: '2.8',
            link: '  https://example.com  ',
            note: '  Bring notes  '
        });

        expect(event).toEqual({
            id: '00000000-0000-4000-8000-000000000001',
            title: 'Planning review',
            startTime: '09:30',
            priority: 2,
            link: 'https://example.com',
            note: 'Bring notes'
        });
    });

    it('renders queued events and the selected day count in the mini administration section', () => {
        renderWithLanguage(
            <GroupEventPublisher
                selectedDateKeys={['2026-04-23', '2026-04-24']}
                draft={{ title: '', startTime: '', priority: '', link: '', note: '' }}
                queuedEvents={[
                    {
                        id: 'queued-event-1',
                        title: 'Planning review',
                        startTime: '09:30',
                        priority: 2,
                        link: null,
                        note: null
                    }
                ]}
                isSubmitting={false}
                onDraftChange={() => {}}
                onAddQueuedEvent={() => {}}
                onRemoveQueuedEvent={() => {}}
            />
        );

        expect(screen.getByText('2 selected days')).toBeTruthy();
        expect(screen.getByText('Planning review')).toBeTruthy();
        expect(screen.getByText('09:30 · P2')).toBeTruthy();
    });

    it('includes an active draft when building publish entries', () => {
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000002');

        const entries = buildGroupEventPublishEntries(
            ['2026-04-23', '2026-04-24'],
            [],
            {
                title: '  Publish me  ',
                startTime: '10:15',
                priority: '3',
                link: '',
                note: '  Draft note  '
            }
        );

        expect(entries).toEqual([
            {
                title: 'Publish me',
                date: '2026-04-23',
                startTime: '10:15',
                priority: 3,
                link: null,
                note: 'Draft note',
                completed: false
            },
            {
                title: 'Publish me',
                date: '2026-04-24',
                startTime: '10:15',
                priority: 3,
                link: null,
                note: 'Draft note',
                completed: false
            }
        ]);
    });
});
