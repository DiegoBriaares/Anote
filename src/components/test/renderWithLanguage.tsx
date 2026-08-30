import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { LanguageProvider } from '../../i18n/LanguageProvider';

export const renderWithLanguage = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
    render(ui, { wrapper: LanguageProvider, ...options });
