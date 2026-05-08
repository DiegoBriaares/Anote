import type { UserPreferences } from '../store/calendarStore';

export const resolveOwnPreferences = (
    profilePreferences: UserPreferences | null | undefined,
    storedPreferences: UserPreferences | null | undefined,
    localPreferences: UserPreferences | null | undefined
): UserPreferences => ({
    ...(storedPreferences || {}),
    ...(profilePreferences || {}),
    ...(localPreferences || {})
});
