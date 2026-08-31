import React, { useMemo, useState } from 'react';
import { useCalendarStore } from '../../store/calendarStore';
import { useTranslation } from '../../i18n/languageContext';
import { Clock, History } from 'lucide-react';
import clsx from 'clsx';
import { FALLBACK_POSTPONED_EVENT_DOMAIN, normalizePostponedEventDomain, type PostponedEventDomain } from '../../utils/postponedDomains';

interface PostponedEventsInformationProps {
    postponedView?: PostponedEventDomain;
}

export const PostponedEventsInformation: React.FC<PostponedEventsInformationProps> = ({ postponedView }) => {
    const postponedEvents = useCalendarStore((state) => state.postponedEvents);
    const { text } = useTranslation();
    const statusText = text.eventStatus;
    const [expandedByView, setExpandedByView] = useState<Record<PostponedEventDomain, string[]>>({ today: [], week: [], all: [] });
    const activeView = postponedView ?? FALLBACK_POSTPONED_EVENT_DOMAIN;
    const expandedIds = expandedByView[activeView];

    const dayEvents = useMemo(() => {
        const list = (postponedEvents || []).filter((event) => normalizePostponedEventDomain(event.postponedView) === activeView);
        return [...list].sort((a, b) => {
            const tA = a.startTime || '';
            const tB = b.startTime || '';
            if (tA !== tB) return tA.localeCompare(tB);
            return a.title.localeCompare(b.title);
        });
    }, [postponedEvents, activeView]);

    const toggleExpanded = (id: string) => {
        setExpandedByView((current) => {
            const currentIds = current[activeView];
            const nextIds = currentIds.includes(id) ? currentIds.filter((entry) => entry !== id) : [...currentIds, id];
            return { ...current, [activeView]: nextIds };
        });
    };

    return (
        <div className="w-full board-panel p-4 rounded-2xl mt-6">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                <div>
                    <div className="text-[10px] font-mono text-stone-500 tracking-[0.25em] uppercase">{text.calendar.eventInformation}</div>
                    <div className="text-xl text-stone-800 tracking-[0.2em]">{text.calendar.postponedEvents}</div>
                </div>
            </div>

            {dayEvents.length === 0 ? (
                <div className="text-xs text-stone-500 font-mono">{text.calendar.noEventsForDay}</div>
            ) : (
                <div className="flex flex-col gap-3">
                    {dayEvents.map((event) => {
                        const isExpanded = expandedIds.includes(event.id);
                        const originDates = event.originDates && event.originDates.length > 0
                            ? event.originDates
                            : [];
                        return (
                            <div
                                key={event.id}
                                className={clsx(
                                    'board-card flex flex-col gap-2',
                                    event.completed && 'board-card-completed',
                                    event.failed && 'board-card-failed'
                                )}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="text-sm text-stone-800 font-mono truncate">{event.title}</div>
                                    <div className="flex items-center gap-2 text-[11px] text-stone-500">
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-3 h-3" aria-hidden="true" />
                                            {event.startTime && event.startTime.trim() !== '' ? event.startTime : '--:--'}
                                        </span>
                                        {event.completed && (
                                            <span className="pill-soft status-pill-completed text-[10px] uppercase tracking-[0.2em]">
                                                {statusText.completed}
                                            </span>
                                        )}
                                        {event.failed && (
                                            <span className="pill-soft status-pill-failed text-[10px] uppercase tracking-[0.2em]">
                                                {statusText.failed}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => toggleExpanded(event.id)}
                                            className="text-orange-600 hover:text-orange-700 flex items-center gap-1 text-[11px]"
                                        >
                                            <History className="w-3 h-3" aria-hidden="true" /> {text.calendar.trackRecord}
                                        </button>
                                    </div>
                                </div>
                                {isExpanded && (
                                    <div className="text-[11px] text-stone-500 font-mono">
                                        {originDates.length === 0 ? (
                                            <span>{text.calendar.originalEntry.replace(': {date}', '')}</span>
                                        ) : (
                                            <div className="flex flex-wrap gap-2">
                                                {originDates.map((origin) => (
                                                    <span key={origin} className="px-2 py-1 rounded-full bg-stone-100 text-stone-600">
                                                        {origin}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
