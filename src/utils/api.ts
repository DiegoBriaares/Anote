const DEFAULT_API_PORT = import.meta.env.VITE_API_PORT?.trim() || (import.meta.env.DEV ? '3002' : '3001');
const configuredApiUrl = (import.meta.env.VITE_API_URL?.trim() || '').replace(/\/+$/, '');
const HAS_SCHEME_PATTERN = /^[a-z][a-z\d+\-.]*:/i;

export const API_URL = (() => {
    if (configuredApiUrl) {
        return configuredApiUrl;
    }

    if (typeof window === 'undefined') {
        return `http://localhost:${DEFAULT_API_PORT}`;
    }

    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const hostname = window.location.hostname || 'localhost';
    const normalizedHostname = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
    return `${protocol}//${normalizedHostname}:${DEFAULT_API_PORT}`;
})();

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
