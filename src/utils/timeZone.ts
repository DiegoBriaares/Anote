const FIXED_OFFSET_PATTERN = /^(?:GMT|UTC)\s*([+-])?\s*(\d{1,2})?(?::?([0-5]\d))?$/i;

export const normalizeTimeZone = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128) return null;
    const match = trimmed.match(FIXED_OFFSET_PATTERN);
    if (match) {
        if (!match[1]) return match[2] || match[3] ? null : 'GMT';
        if (!match[2]) return null;
        const hours = Number(match[2]);
        const minutes = Number(match[3] || 0);
        const maximumHours = match[1] === '-' ? 12 : 14;
        if (hours > maximumHours || (hours === maximumHours && minutes !== 0)) return null;
        const sign = match[1];
        return `GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
    }
    try {
        new Intl.DateTimeFormat('en', { timeZone: trimmed }).format(new Date(0));
        return trimmed;
    } catch {
        return null;
    }
};

export const COMMON_TIME_ZONES = [
    ...Array.from({ length: 27 }, (_, index) => `GMT${index - 12 >= 0 ? '+' : ''}${index - 12}`),
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/Mexico_City',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Paris',
    'Africa/Johannesburg',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland'
] as const;
