import { getAppText } from '../i18n/appText';

const HAS_SCHEME_PATTERN = /^[a-z][a-z\d+\-.]*:/i;

export const API_ROOT = '/api';

export type ApiErrorBody = {
    code: string;
    details?: Record<string, unknown>;
};

type ErrorEnvelope = {
    error?: ApiErrorBody | string;
    message?: string;
    requestId?: string;
};

export class ApiError extends Error {
    readonly code: string;
    readonly status: number;
    readonly requestId: string | null;
    readonly details: Record<string, unknown> | null;

    constructor(options: {
        code: string;
        message: string;
        status: number;
        requestId?: string | null;
        details?: Record<string, unknown> | null;
    }) {
        super(options.message);
        this.name = 'ApiError';
        this.code = options.code;
        this.status = options.status;
        this.requestId = options.requestId ?? null;
        this.details = options.details ?? null;
    }
}

export const toApiUrl = (value: string) => {
    if (!value) return API_ROOT;
    if (HAS_SCHEME_PATTERN.test(value) || value.startsWith('//') || value.startsWith('#')) return value;
    return `${API_ROOT}${value.startsWith('/') ? value : `/${value}`}`;
};

export const normalizeApiAssetUrl = (value?: string | null) => value ? toApiUrl(value) : value ?? null;

const sendRequest = async (path: string, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    if (!headers.has('X-Request-ID')) headers.set('X-Request-ID', crypto.randomUUID());
    try {
        return await fetch(toApiUrl(path), { ...init, credentials: 'same-origin', headers });
    } catch {
        throw new ApiError({ code: 'SERVICE_UNAVAILABLE', message: getAppText().serviceUnavailable, status: 0 });
    }
};

const parseBody = async (response: Response): Promise<unknown> => {
    if (!(response.headers.get('content-type') || '').includes('application/json')) return null;
    try {
        return await response.json();
    } catch {
        return null;
    }
};

const readError = (body: unknown, response: Response): ApiError => {
    const envelope = body && typeof body === 'object' ? body as ErrorEnvelope : {};
    const structuredError = envelope.error && typeof envelope.error === 'object' ? envelope.error : null;
    const legacyMessage = typeof envelope.error === 'string'
        ? envelope.error
        : typeof envelope.message === 'string' && envelope.message !== 'success' ? envelope.message : null;
    return new ApiError({
        code: structuredError?.code || (response.status === 401 ? 'SESSION_REQUIRED' : 'REQUEST_FAILED'),
        message: legacyMessage || getAppText().serviceUnavailable,
        status: response.status,
        requestId: envelope.requestId || response.headers.get('x-request-id'),
        details: structuredError?.details || null
    });
};

export const apiRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await sendRequest(path, init);
    const body = await parseBody(response);
    if (!response.ok) throw readError(body, response);
    return body as T;
};

export const apiText = async (path: string, init: RequestInit = {}): Promise<string> => {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'text/plain');
    const response = await sendRequest(path, { ...init, headers });
    if (!response.ok) throw readError(await parseBody(response), response);
    return response.text();
};

export const apiData = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await apiRequest<{ data?: T } & T>(path, init);
    return response && typeof response === 'object' && 'data' in response ? response.data as T : response as T;
};

export const jsonBody = (value: unknown) => JSON.stringify(value);

export const isSessionError = (error: unknown) => error instanceof ApiError && error.status === 401;
