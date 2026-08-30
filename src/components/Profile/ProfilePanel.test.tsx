/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLanguage } from '../test/renderWithLanguage';
import { useCalendarStore } from '../../store/calendarStore';
import { ProfilePanel } from './ProfilePanel';

vi.mock('../../store/calendarStore', () => ({
    useCalendarStore: vi.fn()
}));

const mockedUseCalendarStore = useCalendarStore as unknown as Mock;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ProfilePanel', () => {
    it('preserves a rejected draft and does not navigate or persist it', async () => {
        const updateProfile = vi.fn().mockResolvedValue(false);
        const setLocalPreferences = vi.fn();
        const navigateToCalendar = vi.fn();
        mockedUseCalendarStore.mockReturnValue({
            profile: {
                id: 'user-1',
                username: 'original-user',
                preferences: { accentColor: '#d4af37', noiseOverlay: true, theme: 'light' }
            },
            fetchProfile: vi.fn().mockResolvedValue(undefined),
            updateProfile,
            setLocalPreferences,
            navigateToCalendar
        });
        const user = userEvent.setup();
        renderWithLanguage(<ProfilePanel />);

        const username = screen.getByRole('textbox', { name: 'Username' });
        await user.clear(username);
        await user.type(username, 'rejected-user');
        await user.click(screen.getByRole('button', { name: 'Save preferences' }));

        expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ username: 'rejected-user' }));
        expect((username as HTMLInputElement).value).toBe('rejected-user');
        expect(setLocalPreferences).not.toHaveBeenCalled();
        expect(navigateToCalendar).not.toHaveBeenCalled();
    });
});
