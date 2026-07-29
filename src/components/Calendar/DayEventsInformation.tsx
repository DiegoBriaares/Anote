import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCalendarStore } from '../../store/calendarStore';
import { getAppText } from '../../i18n/appText';
import { formatDate } from '../../utils/dateUtils';
import { Clock, History } from 'lucide-react';
import clsx from 'clsx';

interface DayEventsInformationProps {
    activeDate: Date;
}

export const DayEventsInformation: React.FC<DayEventsInformationProps> = ({ activeDate }) => {
    const { events } = useCalendarStore();
    const statusText = getAppText().eventStatus;
    const [expandedIds, setExpandedIds] = useState<string[]>([]);

    const dateStr = formatDate(activeDate);
    const expandedByDateRef = useRef<Record<string, string[]>>({});

    useEffect(() => {
        if (expandedByDateRef.current[dateStr]) {
            setExpandedIds(expandedByDateRef.current[dateStr]);
        } else {
            setExpandedIds([]);
        }
    }, [dateStr]);

    useEffect(() => {
        expandedByDateRef.current[dateStr] = expandedIds;
    }, [dateStr, expandedIds]);
    const dayEvents = useMemo(() => {
        const list = events[dateStr] || [];
        return [...list].sort((a, b) => {
            const tA = a.startTime || '';
            const tB = b.startTime || '';
            if (tA !== tB) return tA.localeCompare(tB);
            return a.title.localeCompare(b.title);
        });
    }, [events, dateStr]);

    const toggleExpanded = (id: string) => {
        setExpandedIds((prev) => (
            prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]
        ));
    };

    return (
        <div className="w-full board-panel p-4 rounded-2xl mt-6">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                <div>
                    <div className="text-[10px] font-mono text-stone-500 tracking-[0.25em] uppercase">Day Events Information</div>
                    <div className="text-xl text-stone-800 tracking-[0.2em]">{dateStr}</div>
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
                        const wasPostponed = event.wasPostponed;
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
                                    <div
                                        className={clsx(
                                            'text-sm font-mono truncate',
                                            event.failed
                                                ? 'text-red-700 dark:text-red-300'
                                                : event.completed ? 'text-emerald-700 dark:text-emerald-300' : 'text-stone-800',
                                            (event.completed || event.failed) && 'opacity-90'
                                        )}
                                    >
                                        {event.title}
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px] text-stone-500">
                                        <span className={clsx(
                                            'flex items-center gap-1',
                                            event.completed && 'text-emerald-700/80 dark:text-emerald-300/80',
                                            event.failed && 'text-red-700/80 dark:text-red-300/80'
                                        )}>
                                            <Clock className="w-3 h-3" />
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
                                            <History className="w-3 h-3" /> Track Record
                                        </button>
                                    </div>
                                </div>
                                {isExpanded && (
                                    <div className="text-[11px] text-stone-500 font-mono">
                                        {wasPostponed && (
                                            <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-amber-600">
                                                Previously Postponed
                                            </div>
                                        )}
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
