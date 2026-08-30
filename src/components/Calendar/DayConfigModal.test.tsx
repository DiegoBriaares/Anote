/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLanguage } from '../test/renderWithLanguage';
import { useCalendarStore } from '../../store/calendarStore';
import { DayConfigModal } from './DayConfigModal';

vi.mock('../../store/calendarStore', () => ({
    useCalendarStore: vi.fn()
}));

const mockedUseCalendarStore = useCalendarStore as unknown as Mock;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('DayConfigModal', () => {
    it('keeps a rejected day-setting draft open for correction or retry', async () => {
        const saveDaySettings = vi.fn().mockResolvedValue(false);
        const onClose = vi.fn();
        mockedUseCalendarStore.mockReturnValue({
            dailyFacts: {},
            dayBackgrounds: {},
            saveDaySettings
        });
        const user = userEvent.setup();
        renderWithLanguage(<DayConfigModal date={new Date('2026-08-30T12:00:00Z')} isOpen onClose={onClose} />);

        const fact = screen.getByRole('textbox', { name: 'Day label' });
        await user.type(fact, 'Important context');
        await user.click(screen.getByRole('button', { name: 'Save day settings' }));

        expect(saveDaySettings).toHaveBeenCalledWith('2026-08-30', { content: 'Important context' });
        expect((fact as HTMLTextAreaElement).value).toBe('Important context');
        expect(onClose).not.toHaveBeenCalled();
    });
});
