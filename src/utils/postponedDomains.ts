export const POSTPONED_EVENT_DOMAINS = [
    {
        value: 'week',
        label: 'This week',
        selectLabel: 'This week events'
    },
    {
        value: 'all',
        label: 'All events',
        selectLabel: 'All events'
    },
    {
        value: 'today',
        label: 'Today',
        selectLabel: 'Today events'
    }
] as const;

export type PostponedEventDomain = typeof POSTPONED_EVENT_DOMAINS[number]['value'];

export const DEFAULT_POSTPONED_EVENT_DOMAIN: PostponedEventDomain = 'week';
export const FALLBACK_POSTPONED_EVENT_DOMAIN: PostponedEventDomain = 'all';

export const isPostponedEventDomain = (value: unknown): value is PostponedEventDomain => (
    typeof value === 'string' && POSTPONED_EVENT_DOMAINS.some((domain) => domain.value === value)
);

export const normalizePostponedEventDomain = (
    value: unknown,
    fallback: PostponedEventDomain = FALLBACK_POSTPONED_EVENT_DOMAIN
): PostponedEventDomain => (
    isPostponedEventDomain(value) ? value : fallback
);

export const readPostponedEventDomain = (value: unknown): PostponedEventDomain | null => (
    isPostponedEventDomain(value) ? value : null
);

export const getDefaultTargetPostponedEventDomain = (
    current: PostponedEventDomain
): PostponedEventDomain => (
    current === FALLBACK_POSTPONED_EVENT_DOMAIN
        ? DEFAULT_POSTPONED_EVENT_DOMAIN
        : FALLBACK_POSTPONED_EVENT_DOMAIN
);
