import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRequestId } from './requestId';

describe('browser request identifiers', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('uses randomUUID when the browser provides it', () => {
        vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });

        expect(createRequestId()).toBe('00000000-0000-4000-8000-000000000001');
    });

    it('uses random bytes when randomUUID requires a secure context', () => {
        vi.stubGlobal('crypto', {
            randomUUID: () => {
                throw new DOMException('A secure context is required.', 'SecurityError');
            },
            getRandomValues: (bytes: Uint8Array) => {
                bytes.fill(0xab);
                return bytes;
            }
        });

        expect(createRequestId()).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('keeps plain-HTTP browsers operable without a crypto global', () => {
        vi.stubGlobal('crypto', undefined);
        vi.spyOn(Date, 'now').mockReturnValue(1_788_113_369_000);

        const first = createRequestId();
        const second = createRequestId();

        expect(first).toMatch(/^browser-[a-z0-9]+-[a-z0-9]+$/);
        expect(second).not.toBe(first);
    });
});
