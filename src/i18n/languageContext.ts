import { createContext, useContext } from 'react';
import type { AnoteLanguage, getAppText } from './appText';

export type LanguageContextValue = {
    language: AnoteLanguage;
    setLanguage: (language: AnoteLanguage) => void;
    text: ReturnType<typeof getAppText>;
};

export const LanguageContext = createContext<LanguageContextValue | null>(null);

export const useTranslation = () => {
    const value = useContext(LanguageContext);
    if (!value) throw new Error('useTranslation must be used inside LanguageProvider');
    return value;
};
