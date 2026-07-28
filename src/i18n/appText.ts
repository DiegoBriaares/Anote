export type AnoteLanguage = 'en' | 'es';

const messages = {
    en: {
        serviceUnavailable: 'Anote is unavailable right now. Check your connection and try again.',
        shareUnavailable: 'Events could not be shared. Check your connection and try again.',
        addEventUnavailable: 'The event could not be added. Check your connection and try again.',
        updateEventUnavailable: 'The event could not be updated. Check your connection and try again.',
        completionUnavailable: 'The event status could not be updated. Check your connection and try again.'
    },
    es: {
        serviceUnavailable: 'Anote no está disponible en este momento. Revisa tu conexión e inténtalo de nuevo.',
        shareUnavailable: 'No se pudieron compartir los eventos. Revisa tu conexión e inténtalo de nuevo.',
        addEventUnavailable: 'No se pudo agregar el evento. Revisa tu conexión e inténtalo de nuevo.',
        updateEventUnavailable: 'No se pudo actualizar el evento. Revisa tu conexión e inténtalo de nuevo.',
        completionUnavailable: 'No se pudo actualizar el estado del evento. Revisa tu conexión e inténtalo de nuevo.'
    }
} as const;

export const resolveAnoteLanguage = (language?: string): AnoteLanguage => {
    const runtimeLanguage = language
        ?? (typeof navigator === 'undefined' ? 'en' : navigator.language);
    return runtimeLanguage.toLowerCase().startsWith('es') ? 'es' : 'en';
};

export const getAppText = (language?: string) => messages[resolveAnoteLanguage(language)];
