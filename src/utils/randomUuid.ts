const UUID_BYTES = 16;

const hex = (bytes: Uint8Array) => Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');

export const createRandomUuid = (): string | null => {
    const cryptoOwner = globalThis.crypto;
    if (!cryptoOwner) return null;
    if (typeof cryptoOwner.randomUUID === 'function') {
        try {
            return cryptoOwner.randomUUID();
        } catch {
            // Some browser embeddings expose the member but reject it outside
            // a secure context. Random bytes remain widely available.
        }
    }
    if (typeof cryptoOwner.getRandomValues !== 'function') return null;

    let bytes: Uint8Array;
    try {
        bytes = cryptoOwner.getRandomValues(new Uint8Array(UUID_BYTES));
    } catch {
        return null;
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const value = hex(bytes);
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};
