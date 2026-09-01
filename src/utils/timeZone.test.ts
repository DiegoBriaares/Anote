import { describe, expect, it } from 'vitest';

import { normalizeTimeZone } from './timeZone';

describe('editable program time zones', () => {
    it.each([
        ['GMT-6', 'GMT-6'],
        ['GMT-12', 'GMT-12'],
        ['GMT+14', 'GMT+14'],
        ['UTC + 5:30', 'GMT+5:30'],
        ['GMT+0530', 'GMT+5:30'],
        ['America/Mexico_City', 'America/Mexico_City']
    ])('normalizes %s', (input, expected) => {
        expect(normalizeTimeZone(input)).toBe(expected);
    });

    it.each(['GMT-12:01', 'GMT-13', 'GMT-14', 'GMT+14:01', 'GMT-15', 'GMT+', 'Not/AZone'])('rejects %s', (input) => {
        expect(normalizeTimeZone(input)).toBeNull();
    });
});
