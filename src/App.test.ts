import { describe, expect, it } from 'vitest';
import { resolveOwnPreferences } from './utils/preferences';

describe('resolveOwnPreferences', () => {
    it('keeps saved profile backgrounds when local preferences are partial', () => {
        const prefs = resolveOwnPreferences(
            {
                backgroundUrl: 'https://images.example.com/profile.jpg',
                accentColor: '#f97316',
                noiseOverlay: true,
                theme: 'light'
            },
            null,
            {
                accentColor: '#2563eb'
            }
        );

        expect(prefs.backgroundUrl).toBe('https://images.example.com/profile.jpg');
        expect(prefs.accentColor).toBe('#2563eb');
        expect(prefs.noiseOverlay).toBe(true);
        expect(prefs.theme).toBe('light');
    });
});
