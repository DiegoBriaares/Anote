import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { LanguageProvider } from './i18n/LanguageProvider';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Anote root element is missing');

createRoot(root).render(
    <StrictMode>
        <LanguageProvider>
            <App />
        </LanguageProvider>
    </StrictMode>
);
