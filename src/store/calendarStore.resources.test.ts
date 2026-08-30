import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCalendarStore } from './calendarStore';

const failedResponse = () => new Response(JSON.stringify({
    error: { code: 'INVALID_REQUEST' },
    requestId: 'day-setting-rejected'
}), {
    status: 422,
    headers: { 'Content-Type': 'application/json' }
});

describe('calendar resource writes', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        useCalendarStore.setState({
            user: null,
            dailyFacts: {},
            dayBackgrounds: {},
            actionError: null
        });
    });

    it('returns failure and a localized error for rejected day settings', async () => {
        useCalendarStore.setState({
            user: { id: 'user-1', username: 'example-user', isAdmin: false }
        });
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(failedResponse());

        expect(await useCalendarStore.getState().saveDailyFact('2026-08-30', 'Context')).toBe(false);
        expect(await useCalendarStore.getState().saveDayBackground('2026-08-30', 'https://example.test/image.png'))
            .toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(useCalendarStore.getState()).toMatchObject({
            dailyFacts: {},
            dayBackgrounds: {}
        });
        expect(useCalendarStore.getState().actionError).toBeTruthy();
    });
});
