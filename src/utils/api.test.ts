import { describe, expect, it } from 'vitest';

import { API_URL, normalizeApiAssetUrl, toApiUrl } from './api';

describe('API URL ownership', () => {
    it('keeps browser requests on the same origin through the gateway', () => {
        expect(API_URL).toBe('/api');
        expect(toApiUrl('/login')).toBe('/api/login');
        expect(toApiUrl('events')).toBe('/api/events');
    });

    it('routes backend-owned assets through the same gateway', () => {
        expect(normalizeApiAssetUrl('/uploads/avatar.png')).toBe('/api/uploads/avatar.png');
    });

    it('preserves external and document-local URLs', () => {
        expect(toApiUrl('https://example.test/file.png')).toBe('https://example.test/file.png');
        expect(toApiUrl('//cdn.example.test/file.png')).toBe('//cdn.example.test/file.png');
        expect(toApiUrl('#section')).toBe('#section');
    });
});
