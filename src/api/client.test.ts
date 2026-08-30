import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiRequest, apiText, beginSessionRequestGeneration, jsonBody } from './client';

describe('same-origin API client', () => {
    it('aborts protected requests when the session generation changes', async () => {
        vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })));
        const pending = apiRequest('/events');
        beginSessionRequestGeneration();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('uses cookie credentials and assigns one request identifier', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'success' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        }));
        vi.stubGlobal('fetch', fetchMock);

        await apiRequest('/logout', { method: 'POST', body: jsonBody({}) });

        expect(fetchMock).toHaveBeenCalledWith('/api/logout', expect.objectContaining({
            method: 'POST',
            credentials: 'same-origin'
        }));
        const headers = fetchMock.mock.calls[0][1].headers as Headers;
        expect(headers.get('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/i);
        expect(headers.has('Authorization')).toBe(false);
    });

    it('preserves stable error codes and server request identifiers', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            error: { code: 'REVISION_CONFLICT', details: { resource: 'event' } },
            requestId: 'request-42'
        }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' }
        })));

        try {
            await apiRequest('/events/event-1');
            throw new Error('Expected the request to fail.');
        } catch (error) {
            expect(error).toBeInstanceOf(ApiError);
            expect(error).toMatchObject({
                code: 'REVISION_CONFLICT',
                status: 409,
                requestId: 'request-42',
                details: { resource: 'event' }
            });
        }
    });

    it('loads protected text content through the same request boundary', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('notes', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(apiText('/attachments/file-1')).resolves.toBe('notes');
        expect(fetchMock).toHaveBeenCalledWith('/api/attachments/file-1', expect.objectContaining({
            credentials: 'same-origin'
        }));
    });
});
