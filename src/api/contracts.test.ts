import { describe, expect, it } from 'vitest';

import { ApiError } from './client';
import { parseProgram, parseProgramRun, parseSessionResponse } from './contracts';

describe('API runtime contracts', () => {
    it('normalizes a valid session without accepting an untyped credential field', () => {
        const session = parseSessionResponse({
            user: {
                id: 'user-1',
                username: 'mira',
                avatarUrl: '/api/attachments/avatar-1',
                isAdmin: false
            },
            token: 'must-not-cross-the-contract'
        });

        expect(session).toEqual({
            user: {
                id: 'user-1',
                username: 'mira',
                avatarUrl: '/api/attachments/avatar-1',
                avatar_url: '/api/attachments/avatar-1',
                preferences: undefined,
                isAdmin: false
            }
        });
        expect(session).not.toHaveProperty('token');
    });

    it('rejects malformed program revisions before state ownership', () => {
        try {
            parseProgram({
                id: 'program-1',
                name: 'Move unfinished events',
                enabled: true,
                activationTime: '06:30',
                targetDayOffset: 1,
                timeZone: 'America/Mexico_City',
                revision: '3'
            });
            throw new Error('Expected the contract to reject the response.');
        } catch (error) {
            expect(error).toBeInstanceOf(ApiError);
            expect(error).toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
        }
    });

    it('rejects negative committed move counts', () => {
        try {
            parseProgramRun({
                id: 'run-1',
                programId: 'program-1',
                sourceDate: '2026-06-20',
                targetDate: '2026-06-21',
                movedEventCount: -1,
                executedAt: '2026-06-20T12:30:00.000Z',
                automatic: true
            });
            throw new Error('Expected the contract to reject the response.');
        } catch (error) {
            expect(error).toBeInstanceOf(ApiError);
            expect(error).toMatchObject({ code: 'INVALID_RESPONSE' });
        }
    });
});
