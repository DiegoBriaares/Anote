import { useMemo, useState, type ReactNode } from 'react';

import { getAppText, resolveAnoteLanguage, type AnoteLanguage } from './appText';
import { LanguageContext, type LanguageContextValue } from './languageContext';

const LANGUAGE_STORAGE_KEY = 'anote-language';

const readInitialLanguage = () => {
    try {
        return resolveAnoteLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY) || undefined);
    } catch {
        return resolveAnoteLanguage();
    }
};

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
    const [language, setLanguageState] = useState<AnoteLanguage>(readInitialLanguage);
    const value = useMemo<LanguageContextValue>(() => ({
        language,
        setLanguage: (nextLanguage) => {
            try {
                localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
            } catch {
                // The current session can still switch languages when storage is unavailable.
            }
            setLanguageState(nextLanguage);
        },
        text: getAppText(language)
    }), [language]);

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};
