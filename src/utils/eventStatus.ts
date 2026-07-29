export type EventStatus = 'pending' | 'completed' | 'failed';

export interface EventStatusFields {
    completed?: boolean | null;
    failed?: boolean | null;
}

export const readEventStatus = ({ completed, failed }: EventStatusFields): EventStatus => {
    if (failed) return 'failed';
    if (completed) return 'completed';
    return 'pending';
};

export const eventStatusFields = (status: EventStatus) => ({
    completed: status === 'completed',
    failed: status === 'failed'
});

export const normalizeEventStatusFields = (event: EventStatusFields) => (
    eventStatusFields(readEventStatus(event))
);

export const isEventPending = (event: EventStatusFields) => readEventStatus(event) === 'pending';
