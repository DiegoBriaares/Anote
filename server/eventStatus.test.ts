import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { eventStatusFields, isEventStatus, normalizeEventStatusFields } = require('./eventStatus');

describe('server event status', () => {
    it('accepts only supported status commands', () => {
        expect(isEventStatus('pending')).toBe(true);
        expect(isEventStatus('completed')).toBe(true);
        expect(isEventStatus('failed')).toBe(true);
        expect(isEventStatus('cancelled')).toBe(false);
    });

    it('writes mutually exclusive database flags', () => {
        expect(eventStatusFields('completed')).toEqual({ completed: 1, failed: 0 });
        expect(eventStatusFields('failed')).toEqual({ completed: 0, failed: 1 });
        expect(normalizeEventStatusFields({ completed: true, failed: true })).toEqual({ completed: 0, failed: 1 });
    });
});
