import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { canonicalHttpOrigin, createSameOriginMutations, readExpectedOrigin } = require('./http');

const request = (origin: string | undefined, protocol = 'https', host = 'anote.example.test:11443') => ({
    method: 'POST',
    protocol,
    get: (name: string) => name.toLowerCase() === 'origin' ? origin : name.toLowerCase() === 'host' ? host : undefined
});

describe('same-origin mutation boundary', () => {
    it('canonicalizes direct and TLS-terminated HTTP origins', () => {
        expect(canonicalHttpOrigin('https://anote.example.test:11443')).toBe('https://anote.example.test:11443');
        expect(readExpectedOrigin(request(undefined))).toBe('https://anote.example.test:11443');
        expect(readExpectedOrigin(request(undefined, 'http', '100.85.234.17:15173'))).toBe('http://100.85.234.17:15173');
    });

    it.each([
        undefined,
        'null',
        'https://one.example, https://two.example',
        'javascript://anote.example.test',
        'https://user@anote.example.test',
        'https://anote.example.test/path'
    ])('rejects malformed origin %s before the command', (origin) => {
        const middleware = createSameOriginMutations();
        let commandReached = false;
        middleware(request(origin), {}, (error?: { code?: string }) => {
            if (!error) commandReached = true;
            expect(error?.code).toBe('ORIGIN_NOT_ALLOWED');
        });
        expect(commandReached).toBe(false);
    });

    it('accepts the exact effective origin and rejects a different origin', () => {
        const middleware = createSameOriginMutations();
        let accepted = false;
        middleware(request('https://anote.example.test:11443'), {}, (error?: unknown) => {
            expect(error).toBeUndefined();
            accepted = true;
        });
        expect(accepted).toBe(true);

        middleware(request('https://other.example.test'), {}, (error?: { code?: string }) => {
            expect(error?.code).toBe('ORIGIN_NOT_ALLOWED');
        });
    });
});
