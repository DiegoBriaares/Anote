import { describe, expect, it } from 'vitest';

import { eventStatusFields, isEventPending, normalizeEventStatusFields, readEventStatus } from './eventStatus';

describe('event status', () => {
    it.each([
        [{ completed: false, failed: false }, 'pending'],
        [{ completed: true, failed: false }, 'completed'],
        [{ completed: false, failed: true }, 'failed']
    ] as const)('reads %o as %s', (fields, expected) => {
        expect(readEventStatus(fields)).toBe(expected);
        expect(isEventPending(fields)).toBe(expected === 'pending');
    });

    it('normalizes conflicting terminal flags to failed', () => {
        expect(normalizeEventStatusFields({ completed: true, failed: true })).toEqual({
            completed: false,
            failed: true
        });
    });

    it('maps every status to mutually exclusive persisted fields', () => {
        expect(eventStatusFields('pending')).toEqual({ completed: false, failed: false });
        expect(eventStatusFields('completed')).toEqual({ completed: true, failed: false });
        expect(eventStatusFields('failed')).toEqual({ completed: false, failed: true });
    });
});
