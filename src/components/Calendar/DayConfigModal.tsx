import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '../../i18n/languageContext';
import { useCalendarStore } from '../../store/calendarStore';

interface DayConfigModalProps {
    date: Date;
    isOpen: boolean;
    onClose: () => void;
}

type DayConfigFormProps = DayConfigModalProps & {
    dateKey: string;
    initialFact: string;
    initialBackground: string;
};

const DayConfigForm = ({ date, dateKey, initialFact, initialBackground, onClose }: DayConfigFormProps) => {
    const saveDaySettings = useCalendarStore((state) => state.saveDaySettings);
    const { language, text } = useTranslation();
    const [factDraft, setFactDraft] = useState(initialFact);
    const [backgroundDraft, setBackgroundDraft] = useState(initialBackground);
    const [isSaving, setIsSaving] = useState(false);
    const titleId = useId();
    const closeRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeRef.current?.focus();
        return () => previouslyFocused?.focus();
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isSaving) onClose();
            if (event.key !== 'Tab') return;
            const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (!controls?.length) return;
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isSaving, onClose]);

    const handleSave = async () => {
        if (isSaving) return;
        setIsSaving(true);
        const changes = {
            ...(factDraft !== initialFact ? { content: factDraft } : {}),
            ...(backgroundDraft !== initialBackground ? { imageUrl: backgroundDraft } : {})
        };
        const saved = Object.keys(changes).length === 0 || await saveDaySettings(dateKey, changes);
        setIsSaving(false);
        if (saved) onClose();
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-orange-100 flex justify-between items-center bg-orange-50/50">
                    <h3 id={titleId} className="text-lg font-bold text-orange-900">
                        {text.calendar.daySettings}
                        <span className="ml-2 text-sm font-normal text-orange-600/70 font-mono">
                            {new Intl.DateTimeFormat(language, { weekday: 'short', month: 'short', day: 'numeric' }).format(date)}
                        </span>
                    </h3>
                    <button ref={closeRef} type="button" onClick={onClose} disabled={isSaving} aria-label={text.common.close} className="p-1 hover:bg-orange-200/50 rounded-full transition-colors disabled:opacity-50">
                        <X className="w-5 h-5 text-orange-500" aria-hidden="true" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="space-y-2">
                        <label htmlFor="day-context" className="text-xs font-mono text-stone-500 uppercase tracking-widest block">{text.calendar.dayContextLabel}</label>
                        <textarea id="day-context" value={factDraft} onChange={(event) => setFactDraft(event.target.value)} className="w-full h-24 p-3 rounded-xl border border-orange-200 focus:border-orange-400 focus:ring-0 text-sm resize-none bg-stone-50/50" placeholder={text.calendar.dayContextPlaceholder} />
                        <p className="text-[10px] text-stone-500">{text.calendar.dayContextHelp}</p>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="day-background" className="text-xs font-mono text-stone-500 uppercase tracking-widest block">{text.calendar.backgroundImage}</label>
                        <input id="day-background" type="url" value={backgroundDraft} onChange={(event) => setBackgroundDraft(event.target.value)} className="w-full p-2 rounded-lg border border-orange-200 text-sm focus:border-orange-400 outline-none" placeholder={text.calendar.backgroundUrlPlaceholder} />
                        <div className="mt-2 h-32 w-full rounded-xl border border-stone-100 bg-stone-50 overflow-hidden relative group">
                            {backgroundDraft ? (
                                <>
                                    <div className="absolute inset-0 bg-cover bg-center transition-opacity duration-300" style={{ backgroundImage: `url(${backgroundDraft})` }} />
                                    <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                                        <span className="text-xs font-bold text-stone-800 bg-white/80 px-2 py-1 rounded shadow">{text.calendar.backgroundPreviewOpacity}</span>
                                    </div>
                                </>
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-stone-400 text-xs italic">{text.calendar.noBackground}</div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-stone-50 border-t border-stone-100 flex justify-end gap-2">
                    <button type="button" onClick={onClose} disabled={isSaving} className="px-4 py-2 text-sm font-medium text-stone-600 hover:text-stone-800 disabled:opacity-50">{text.common.cancel}</button>
                    <button type="button" onClick={() => { void handleSave(); }} disabled={isSaving} className="px-4 py-2 text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-lg shadow-sm active:scale-95 transition-all disabled:opacity-50">
                        {isSaving ? text.common.saving : text.calendar.saveDaySettings}
                    </button>
                </div>
            </div>
        </div>
    );
};

export const DayConfigModal: React.FC<DayConfigModalProps> = ({ date, isOpen, onClose }) => {
    const dailyFacts = useCalendarStore((state) => state.dailyFacts);
    const dayBackgrounds = useCalendarStore((state) => state.dayBackgrounds);
    if (!isOpen) return null;
    const dateKey = date.toISOString().split('T')[0];
    return (
        <DayConfigForm
            key={dateKey}
            date={date}
            dateKey={dateKey}
            isOpen
            initialFact={dailyFacts[dateKey] || ''}
            initialBackground={dayBackgrounds[dateKey] || ''}
            onClose={onClose}
        />
    );
};
