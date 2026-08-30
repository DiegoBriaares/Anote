import { getAppText } from '../i18n/appText';
import { ApiError, apiData, apiText } from './client';

export type AttachmentPurpose = 'avatar' | 'note';

export type Attachment = {
    id: string;
    url: string;
    filename: string;
    mimeType: string;
    size: number;
};

const parseAttachment = (value: unknown): Attachment => {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
    if (
        !record
        || typeof record.id !== 'string'
        || typeof record.url !== 'string'
        || typeof record.filename !== 'string'
        || typeof record.mimeType !== 'string'
        || !Number.isInteger(record.size)
        || Number(record.size) < 0
    ) {
        throw new ApiError({
            code: 'INVALID_RESPONSE',
            message: getAppText().serviceUnavailable,
            status: 502
        });
    }
    return record as Attachment;
};

export const attachmentsApi = {
    upload: async (file: File, purpose: AttachmentPurpose, eventId?: string) => {
        const body = new FormData();
        body.append('file', file);
        body.append('purpose', purpose);
        if (eventId) body.append('eventId', eventId);
        return parseAttachment(await apiData<unknown>('/attachments', { method: 'POST', body }));
    },
    readText: (url: string, signal?: AbortSignal) => apiText(url, { signal })
};
