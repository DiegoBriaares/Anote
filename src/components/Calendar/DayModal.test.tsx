/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DayModal } from './DayModal';
import { useCalendarStore } from '../../store/calendarStore';

vi.mock('../../store/calendarStore', () => ({
    useCalendarStore: vi.fn()
}));

const mockedUseCalendarStore = useCalendarStore as unknown as Mock;

beforeEach(() => {
    mockedUseCalendarStore.mockReturnValue({
        viewMode: 'self',
        subroles: [],
        roles: [],
        fetchRoles: vi.fn().mockResolvedValue(undefined),
        fetchSubroles: vi.fn().mockResolvedValue(undefined)
    });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('DayModal', () => {
    it('opens the dedicated administration page from the administration icon', async () => {
        const onAdminister = vi.fn();
        const user = userEvent.setup();

        render(
            <DayModal
                date={new Date(2026, 3, 23)}
                events={[]}
                onClose={vi.fn()}
                onUpdateEvent={vi.fn()}
                onConfigure={vi.fn()}
                onAdminister={onAdminister}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Open Day Events Administration' }));

        expect(onAdminister).toHaveBeenCalledTimes(1);
    });
});
