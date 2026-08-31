import { getAppText } from '../i18n/appText';
import { ApiError, apiData, apiRequest, jsonBody } from './client';

export type WireRecord = Record<string, unknown>;
export type MessageEnvelope<T> = {
    message?: string;
    data: T;
    friend?: WireRecord;
    version?: number;
    revision?: number;
};

const invalidResponse = () => new ApiError({
    code: 'INVALID_RESPONSE',
    message: getAppText().serviceUnavailable,
    status: 502
});

const record = (value: unknown): WireRecord => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse();
    return value as WireRecord;
};

const eventRecord = (value: unknown): WireRecord => {
    const event = record(value);
    if (
        typeof event.id !== 'string'
        || !event.id
        || typeof event.title !== 'string'
        || typeof event.date !== 'string'
        || (event.revision !== undefined && (!Number.isInteger(event.revision) || Number(event.revision) < 1))
    ) throw invalidResponse();
    return event;
};

const eventListEnvelope = (value: unknown): MessageEnvelope<WireRecord[]> => {
    const envelope = record(value);
    if (!Array.isArray(envelope.data)) throw invalidResponse();
    return {
        ...envelope,
        data: envelope.data.map(eventRecord),
        friend: envelope.friend === undefined ? undefined : record(envelope.friend)
    };
};

const revisionEnvelope = (value: unknown): MessageEnvelope<WireRecord> & WireRecord => {
    const envelope = record(value);
    const revision = envelope.revision ?? envelope.version;
    if (!Number.isInteger(revision) || Number(revision) < 1) throw invalidResponse();
    return envelope as MessageEnvelope<WireRecord> & WireRecord;
};

const statusEnvelope = (value: unknown): MessageEnvelope<WireRecord> => {
    const envelope = record(value);
    const data = record(envelope.data);
    const revision = data.revision ?? data.version;
    if (typeof data.id !== 'string' || !Number.isInteger(revision) || Number(revision) < 1) throw invalidResponse();
    return { ...envelope, data } as MessageEnvelope<WireRecord>;
};

export const eventsApi = {
    list: async () => eventListEnvelope(await apiRequest<unknown>('/events')),
    listPostponed: async () => eventListEnvelope(await apiRequest<unknown>('/postponed-events')),
    listFriend: async (friendId: string) => eventListEnvelope(await apiRequest<unknown>(`/friends/${encodeURIComponent(friendId)}/events`)),
    create: async (events: WireRecord[]) => eventListEnvelope(await apiRequest<unknown>('/events', {
        method: 'POST', body: jsonBody({ events })
    })),
    share: (friendIds: string[], dateKeys: string[], eventIds?: string[]) => apiRequest<{ message: string }>('/friends/share-events', {
        method: 'POST', body: jsonBody({ friendIds, dateKeys, eventIds })
    }),
    remove: (id: string, revision: number | null | undefined) => apiRequest<{ message: string }>(`/events/${encodeURIComponent(id)}`, {
        method: 'DELETE', body: jsonBody({ revision })
    }),
    update: async (id: string, event: WireRecord) => revisionEnvelope(await apiRequest<unknown>(`/events/${encodeURIComponent(id)}`, {
        method: 'PUT', body: jsonBody(event)
    })),
    setStatus: async (id: string, status: string, revision: number | null | undefined) => statusEnvelope(await apiRequest<unknown>(`/events/${encodeURIComponent(id)}/status`, {
        method: 'PATCH', body: jsonBody({ status, revision })
    })),
    createPostponed: async (events: WireRecord[]) => eventListEnvelope(await apiRequest<unknown>('/postponed-events', {
        method: 'POST', body: jsonBody({ events })
    })),
    removePostponed: (id: string, revision: number | null | undefined) => apiRequest<{ message: string }>(`/postponed-events/${encodeURIComponent(id)}`, {
        method: 'DELETE', body: jsonBody({ revision })
    }),
    updatePostponed: async (id: string, event: WireRecord) => revisionEnvelope(await apiRequest<unknown>(`/postponed-events/${encodeURIComponent(id)}`, {
        method: 'PUT', body: jsonBody(event)
    })),
    moveIncomplete: (sourceDateKeys: string[], targetDateKey: string) => apiData<{
        movedEventCount: number;
        events: WireRecord[];
    }>('/events/move-incomplete', {
        method: 'POST',
        body: jsonBody({ sourceDateKeys, targetDateKey })
    })
};
