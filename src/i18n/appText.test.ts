import { describe, expect, it } from 'vitest';

import { getAppText, resolveAnoteLanguage } from './appText';

describe('user-facing connection messages', () => {
    it('selects Spanish for Spanish browser locales', () => {
        expect(resolveAnoteLanguage('es-MX')).toBe('es');
        expect(getAppText('es-MX').serviceUnavailable).toContain('Revisa tu conexión');
    });

    it('defaults other browser locales to English', () => {
        expect(resolveAnoteLanguage('en-US')).toBe('en');
        expect(getAppText('fr-FR').serviceUnavailable).toContain('Check your connection');
    });

    it('does not expose internal API or port instructions', () => {
        for (const language of ['en', 'es']) {
            const text = Object.values(getAppText(language)).join(' ');
            expect(text).not.toMatch(/API|3001|backend|frontend/i);
        }
    });
});
