import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCalendarStore } from '../../store/calendarStore';
import { Clock, History } from 'lucide-react';
import { FALLBACK_POSTPONED_EVENT_DOMAIN, normalizePostponedEventDomain, type PostponedEventDomain } from '../../utils/postponedDomains';

interface PostponedEventsInformationProps {
    postponedView?: PostponedEventDomain;
}

export const PostponedEventsInformation: React.FC<PostponedEventsInformationProps> = ({ postponedView }) => {
    const { postponedEvents } = useCalendarStore();
    const [expandedIds, setExpandedIds] = useState<string[]>([]);
    const activeView = postponedView ?? FALLBACK_POSTPONED_EVENT_DOMAIN;
    const expandedByViewRef = useRef<Record<PostponedEventDomain, string[]>>({
        today: [],
        week: [],
        all: []
    });

    useEffect(() => {
        setExpandedIds(expandedByViewRef.current[activeView] || []);
    }, [activeView]);

    useEffect(() => {
        expandedByViewRef.current[activeView] = expandedIds;
    }, [activeView, expandedIds]);

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
        setExpandedIds((prev) => (
            prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]
        ));
    };

    return (
        <div className="w-full board-panel p-4 rounded-2xl mt-6">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                <div>
                    <div className="text-[10px] font-mono text-stone-500 tracking-[0.25em] uppercase">Events Information</div>
                    <div className="text-xl text-stone-800 tracking-[0.2em]">Postponed Events</div>
                </div>
            </div>

            {dayEvents.length === 0 ? (
                <div className="text-xs text-stone-500 font-mono">No events available.</div>
            ) : (
                <div className="flex flex-col gap-3">
                    {dayEvents.map((event) => {
                        const isExpanded = expandedIds.includes(event.id);
                        const originDates = event.originDates && event.originDates.length > 0
                            ? event.originDates
                            : [];
                        return (
                            <div key={event.id} className="board-card flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm text-stone-800 font-mono truncate">{event.title}</div>
                                    <div className="flex items-center gap-2 text-[11px] text-stone-500">
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {event.startTime && event.startTime.trim() !== '' ? event.startTime : '--:--'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => toggleExpanded(event.id)}
                                            className="text-orange-600 hover:text-orange-700 flex items-center gap-1 text-[11px]"
                                        >
                                            <History className="w-3 h-3" /> Track Record
                                        </button>
                                    </div>
                                </div>
                                {isExpanded && (
                                    <div className="text-[11px] text-stone-500 font-mono">
                                        {originDates.length === 0 ? (
                                            <span>Original entry.</span>
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
