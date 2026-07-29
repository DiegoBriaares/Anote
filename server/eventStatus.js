const EVENT_STATUSES = new Set(['pending', 'completed', 'failed']);

const normalizeBooleanValue = (value) => (
    value === true || value === 1 || value === '1' || value === 'true'
);

const readEventStatus = ({ completed, failed }) => {
    if (normalizeBooleanValue(failed)) return 'failed';
    if (normalizeBooleanValue(completed)) return 'completed';
    return 'pending';
};

const eventStatusFields = (status) => ({
    completed: status === 'completed' ? 1 : 0,
    failed: status === 'failed' ? 1 : 0
});

const normalizeEventStatusFields = (event) => eventStatusFields(readEventStatus(event));

const isEventStatus = (value) => typeof value === 'string' && EVENT_STATUSES.has(value);

module.exports = {
    eventStatusFields,
    isEventStatus,
    normalizeBooleanValue,
    normalizeEventStatusFields,
    readEventStatus
};
