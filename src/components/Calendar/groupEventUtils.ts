import { createRequestId } from '../../api/requestId';

export interface GroupEventDraft {
    title: string;
    startTime: string;
    priority: string;
    link: string;
    note: string;
}

export interface QueuedGroupEvent {
    id: string;
    title: string;
    startTime: string | null;
    priority: number | null;
    link: string | null;
    note: string | null;
}

export interface GroupEventPublishEntry {
    title: string;
    date: string;
    startTime: string | null;
    priority: number | null;
    link: string | null;
    note: string | null;
    completed: false;
}

export const parseGroupEventPriority = (value: string) => {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

export const hasPublishableGroupDraft = (draft: GroupEventDraft) => draft.title.trim().length > 0;

export const buildQueuedGroupEvent = (draft: GroupEventDraft): QueuedGroupEvent | null => {
    const title = draft.title.trim();
    if (!title) return null;

    return {
        // Queue identity is tab-local UI state and is never sent as event ID.
        id: createRequestId(),
        title,
        startTime: draft.startTime.trim() ? draft.startTime.trim() : null,
        priority: parseGroupEventPriority(draft.priority),
        link: draft.link.trim() ? draft.link.trim() : null,
        note: draft.note.trim() ? draft.note.trim() : null
    };
};

export const buildGroupEventPublishEntries = (
    dateKeys: string[],
    queuedEvents: QueuedGroupEvent[],
    activeDraft?: GroupEventDraft
): GroupEventPublishEntry[] => {
    const activeEvent = activeDraft && hasPublishableGroupDraft(activeDraft)
        ? buildQueuedGroupEvent(activeDraft)
        : null;
    const eventsToPublish = activeEvent ? [...queuedEvents, activeEvent] : queuedEvents;

    return dateKeys.flatMap((date) => (
        eventsToPublish.map((event) => ({
            title: event.title,
            date,
            startTime: event.startTime,
            priority: event.priority,
            link: event.link,
            note: event.note,
            completed: false
        }))
    ));
};
