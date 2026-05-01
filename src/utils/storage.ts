type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'>;

const isStorageLike = (value: unknown): value is StorageLike => {
    return Boolean(
        value &&
        typeof (value as StorageLike).getItem === 'function' &&
        typeof (value as StorageLike).setItem === 'function' &&
        typeof (value as StorageLike).removeItem === 'function' &&
        typeof (value as StorageLike).clear === 'function'
    );
};

const createMemoryStorage = (): StorageLike => {
    const data = new Map<string, string>();

    return {
        getItem: (key) => data.get(String(key)) ?? null,
        setItem: (key, value) => {
            data.set(String(key), String(value));
        },
        removeItem: (key) => {
            data.delete(String(key));
        },
        clear: () => {
            data.clear();
        }
    };
};

const resolveStorage = (): StorageLike => {
    if (typeof window !== 'undefined' && isStorageLike(window.localStorage)) {
        if (!isStorageLike(globalThis.localStorage)) {
            Object.defineProperty(globalThis, 'localStorage', {
                configurable: true,
                value: window.localStorage
            });
        }
        return window.localStorage;
    }

    if (isStorageLike(globalThis.localStorage)) {
        return globalThis.localStorage;
    }

    const memoryStorage = createMemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: memoryStorage
    });
    return memoryStorage;
};

export const storage = resolveStorage();
