import { useMemo, useState, type ReactNode } from 'react';

import {
    getAppText,
    LANGUAGE_STORAGE_KEY,
    resolveAnoteLanguage,
    setRuntimeLanguage,
    type AnoteLanguage
} from './appText';
import { LanguageContext, type LanguageContextValue } from './languageContext';

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
            setRuntimeLanguage(nextLanguage);
            setLanguageState(nextLanguage);
        },
        text: getAppText(language)
    }), [language]);

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};
