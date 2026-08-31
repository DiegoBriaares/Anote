import { createRandomUuid } from '../utils/randomUuid';

let fallbackSequence = 0;

export const createRequestId = (): string => {
    const secureId = createRandomUuid();
    if (secureId) return secureId;

    // Request IDs are correlation labels, never credentials. This fallback
    // keeps plain-HTTP LAN browsers operable when secure-context crypto is absent.
    fallbackSequence = (fallbackSequence + 1) % Number.MAX_SAFE_INTEGER;
    return `browser-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
};
