import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Program } from '../api/contracts';
import { useCalendarStore } from './calendarStore';

const program: Program = {
    id: 'program-1',
    name: 'Move unfinished events',
    enabled: true,
    activationTime: '06:30',
    targetDayOffset: 1,
    timeZone: 'America/Mexico_City',
    revision: 3,
    nextRunAt: '2026-06-20T12:30:00.000Z',
    lastRunAt: null
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
});

const authenticatedState = {
    user: { id: 'user-1', username: 'diego' },
    sessionStatus: 'authenticated' as const,
    programs: [] as Program[],
    events: {},
    postponedEvents: [],
    programExecutionNotice: null,
    programPageReloadRequested: false
};

describe('server-owned programs', () => {
    beforeEach(() => {
        localStorage.clear();
        useCalendarStore.setState(authenticatedState);
        vi.restoreAllMocks();
    });

    it('loads normalized programs from the server instead of profile preferences', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'success', data: [program] }));

        await useCalendarStore.getState().fetchPrograms();

        expect(fetchMock).toHaveBeenCalledWith('/api/programs', expect.objectContaining({ credentials: 'same-origin' }));
        expect(useCalendarStore.getState().programs).toEqual([program]);
        expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))).not.toContain(expect.stringContaining('program-run:'));
    });

    it('sends the expected revision when updating a program', async () => {
        useCalendarStore.setState({ programs: [program] });
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
            message: 'success',
            data: { ...program, name: 'Next day', revision: 4 }
        }));

        const updated = await useCalendarStore.getState().updateProgram(program.id, program.revision, { name: 'Next day' });

        const request = fetchMock.mock.calls[0];
        expect(request[0]).toBe('/api/programs/program-1');
        expect(JSON.parse(String((request[1] as RequestInit).body))).toMatchObject({ name: 'Next day', revision: 3 });
        expect(updated?.revision).toBe(4);
    });

    it('runs a program through one atomic backend command and refreshes read models', async () => {
        useCalendarStore.setState({ programs: [program] });
        const run = {
            id: 'run-1', programId: program.id, sourceDate: '2026-06-20', targetDate: '2026-06-21',
            movedEventCount: 2, executedAt: '2026-06-20T12:30:00.000Z', automatic: false
        };
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.endsWith('/run') && init?.method === 'POST') return jsonResponse({ message: 'success', data: run });
            if (url === '/api/events') return jsonResponse({ message: 'success', data: [] });
            if (url === '/api/programs') return jsonResponse({ message: 'success', data: [program] });
            throw new Error(`Unexpected request: ${url}`);
        });

        const result = await useCalendarStore.getState().runProgram(program.id, program.revision);

        expect(result).toEqual(run);
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/run'))).toHaveLength(1);
        const runRequest = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/run'));
        expect(JSON.parse(String(runRequest?.[1]?.body))).toEqual({ revision: program.revision });
        expect(useCalendarStore.getState().lastProgramRun).toEqual(run);
        expect(useCalendarStore.getState()).toMatchObject({
            programExecutionNotice: { name: program.name, movedEventCount: 2 },
            programPageReloadRequested: true
        });
    });

    it('saves all edited definitions through one atomic backend command', async () => {
        useCalendarStore.setState({ programs: [program] });
        const changed = { ...program, name: 'Next morning' };
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
            message: 'success',
            data: [{ ...changed, revision: 4 }]
        }));

        const saved = await useCalendarStore.getState().savePrograms([changed]);

        expect(saved).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/programs');
        expect(fetchMock.mock.calls[0][1]?.method).toBe('PUT');
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
            programs: [{
                id: changed.id,
                revision: changed.revision,
                name: changed.name,
                enabled: changed.enabled,
                activationTime: changed.activationTime,
                targetDayOffset: changed.targetDayOffset,
                timeZone: changed.timeZone
            }]
        });
        expect(useCalendarStore.getState().programs[0]?.revision).toBe(4);
    });

    it.each([
        ['bulk save', () => useCalendarStore.getState().savePrograms([program])],
        ['create', () => useCalendarStore.getState().createProgram({
            name: program.name,
            enabled: program.enabled,
            activationTime: program.activationTime,
            targetDayOffset: program.targetDayOffset,
            timeZone: program.timeZone
        })],
        ['update', () => useCalendarStore.getState().updateProgram(program.id, program.revision, { name: 'Changed' })],
        ['delete', () => useCalendarStore.getState().deleteProgram(program.id, program.revision)],
        ['manual run', () => useCalendarStore.getState().runProgram(program.id, program.revision)]
    ])('resets the expired session after a 401 from %s', async (_name, command) => {
        useCalendarStore.setState({ ...authenticatedState, programs: [program] });
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
            error: { code: 'AUTHENTICATION_REQUIRED' },
            requestId: 'expired-session'
        }, 401));

        await command();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(useCalendarStore.getState()).toMatchObject({
            user: null,
            sessionStatus: 'anonymous',
            programs: [],
            actionError: null
        });
    });

    it('acknowledges an automatic run and requests a reload without closing the session', async () => {
        const automaticRun = {
            id: 'run-2', programId: program.id, sourceDate: '2026-06-20', targetDate: '2026-06-21',
            movedEventCount: 1, executedAt: '2026-06-20T12:30:00.000Z', automatic: true
        };
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.startsWith('/api/programs/run-notifications')) {
                if (url.endsWith('/complete') && init?.method === 'POST') return jsonResponse({ message: 'success' });
                return jsonResponse({ message: 'success', data: [automaticRun], cursor: automaticRun.executedAt });
            }
            throw new Error(`Unexpected request: ${url}`);
        });

        await useCalendarStore.getState().pollProgramRunNotifications();

        expect(useCalendarStore.getState()).toMatchObject({
            user: authenticatedState.user,
            sessionStatus: 'authenticated',
            programExecutionNotice: { name: program.name, movedEventCount: 1 },
            programPageReloadRequested: true
        });
        expect(globalThis.fetch).toHaveBeenCalledWith(
            '/api/programs/run-notifications/complete',
            expect.objectContaining({ method: 'POST', credentials: 'same-origin' })
        );
        const completion = vi.mocked(globalThis.fetch).mock.calls.find(([url]) => String(url).endsWith('/complete'));
        expect(JSON.parse(String(completion?.[1]?.body))).toEqual({ runIds: ['run-2'] });
        expect(JSON.parse(localStorage.getItem('program-execution-notice') || 'null')).toEqual({
            name: program.name,
            movedEventCount: 1
        });
    });
});
