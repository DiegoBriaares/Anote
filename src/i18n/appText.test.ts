import { describe, expect, it } from 'vitest';

import { getApiErrorText, getAppText, resolveAnoteLanguage, setRuntimeLanguage } from './appText';

describe('user-facing connection messages', () => {
    it('selects Spanish for Spanish browser locales', () => {
        expect(resolveAnoteLanguage('es-MX')).toBe('es');
        expect(getAppText('es-MX').serviceUnavailable).toContain('Revisa tu conexión');
    });

    it('defaults other browser locales to English', () => {
        expect(resolveAnoteLanguage('en-US')).toBe('en');
        expect(getAppText('fr-FR').serviceUnavailable).toContain('Check your connection');
    });

    it('provides complete and failed event actions in both languages', () => {
        expect(getAppText('en').eventStatus).toMatchObject({
            markComplete: 'Mark complete',
            markFailed: 'Mark failed'
        });
        expect(getAppText('es-MX').eventStatus).toMatchObject({
            markComplete: 'Marcar como completado',
            markFailed: 'Marcar como fallido'
        });
    });

    it('shares the selected runtime language with stores and API errors', () => {
        setRuntimeLanguage('es');
        expect(getAppText().serviceUnavailable).toContain('Revisa tu conexión');
        expect(getApiErrorText('SESSION_REQUIRED')).toContain('Tu sesión terminó');
        setRuntimeLanguage('en');
        expect(getApiErrorText('SESSION_REQUIRED')).toContain('Your session ended');
    });

    it('localizes proxy-origin recovery and permanent registration policy', () => {
        expect(getApiErrorText('ORIGIN_NOT_ALLOWED', 'en')).toContain('Tailscale Serve');
        expect(getApiErrorText('ORIGIN_NOT_ALLOWED', 'es')).toContain('Tailscale Serve');
        expect(getApiErrorText('IMMUTABLE_CONFIG_KEY', 'en')).toContain('always available');
        expect(getApiErrorText('IMMUTABLE_CONFIG_KEY', 'es')).toContain('siempre está disponible');
    });

    it('does not expose internal API or port instructions', () => {
        for (const language of ['en', 'es']) {
            const text = Object.values(getAppText(language)).join(' ');
            expect(text).not.toMatch(/API|3001|backend|frontend/i);
        }
    });
});
