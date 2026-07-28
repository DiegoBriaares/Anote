const HAS_SCHEME_PATTERN = /^[a-z][a-z\d+\-.]*:/i;

// The browser knows one public origin. Development and production gateways own
// the internal API location so hostnames such as `anote` never leak port 3001.
export const API_URL = '/api';

export const toApiUrl = (value: string) => {
    if (!value) {
        return API_URL;
    }

    if (HAS_SCHEME_PATTERN.test(value) || value.startsWith('//') || value.startsWith('#')) {
        return value;
    }

    const normalizedValue = value.startsWith('/') ? value : `/${value}`;
    return `${API_URL}${normalizedValue}`;
};

export const normalizeApiAssetUrl = (value?: string | null) => {
    if (!value) {
        return value ?? null;
    }

    return toApiUrl(value);
};
