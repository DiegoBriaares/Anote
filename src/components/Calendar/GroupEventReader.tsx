import React from 'react';
import { CalendarRange, CheckCircle2, CircleX, Clock, ExternalLink } from 'lucide-react';
import type { CalendarEvent } from '../../store/calendarStore';
import { interpolateText } from '../../i18n/appText';
import clsx from 'clsx';
import { useTranslation } from '../../i18n/languageContext';

interface GroupEventReaderProps {
    selectedDateKeys: string[];
    eventsByDate: Record<string, CalendarEvent[]>;
}

const sortReadableEvents = (events: CalendarEvent[]) => (
    [...events].sort((a, b) => {
        const timeCompare = (a.startTime || '').localeCompare(b.startTime || '');
        if (timeCompare !== 0) return timeCompare;
        const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
        const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.title.localeCompare(b.title);
    })
);

export const GroupEventReader: React.FC<GroupEventReaderProps> = ({
    selectedDateKeys,
    eventsByDate
}) => {
    const { text } = useTranslation();
    const statusText = text.eventStatus;
    const totalEvents = selectedDateKeys.reduce((count, dateKey) => count + (eventsByDate[dateKey]?.length || 0), 0);

    return (
        <div className="mb-8 board-panel rounded-2xl p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <div className="text-[10px] font-mono text-stone-500 uppercase tracking-[0.25em]">{text.calendar.eventDistribution}</div>
                    <div className="text-lg text-stone-800 tracking-[0.16em]">{text.calendar.readEvents}</div>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-mono text-orange-600 uppercase tracking-[0.2em] flex-wrap">
                    <span>{interpolateText(selectedDateKeys.length === 1 ? text.calendar.selectedDay : text.calendar.selectedDays, { count: selectedDateKeys.length })}</span>
                    <span>{interpolateText(totalEvents === 1 ? text.calendar.selectedEvent : text.calendar.selectedEvents, { count: totalEvents })}</span>
                </div>
            </div>

            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
                {selectedDateKeys.map((dateKey) => {
                    const dayEvents = sortReadableEvents(eventsByDate[dateKey] || []);

                    return (
                        <section
                            key={dateKey}
                            className="min-w-0 rounded-xl border border-orange-100 bg-white/75 p-3 shadow-sm"
                            aria-label={interpolateText(text.calendar.eventsFor, { date: dateKey })}
                        >
                            <div className="mb-3 flex items-center justify-between gap-2 border-b border-orange-100 pb-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <CalendarRange className="h-4 w-4 shrink-0 text-orange-500" />
                                    <div className="truncate text-xs font-mono font-bold text-stone-700">{dateKey}</div>
                                </div>
                                <div className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-mono text-orange-600">
                                    {dayEvents.length}
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                {dayEvents.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-orange-100 px-3 py-6 text-center text-[11px] font-mono text-stone-400">
                                        {text.common.noEvents}
                                    </div>
                                ) : (
                                    dayEvents.map((event) => (
                                        <article
                                            key={event.id}
                                            className={clsx(
                                                'rounded-lg border px-3 py-2 transition-colors',
                                                event.failed
                                                    ? 'border-red-200 bg-red-50/80 text-red-800'
                                                    : event.completed
                                                        ? 'border-emerald-100 bg-emerald-50/70 text-stone-500'
                                                        : 'border-stone-100 bg-white text-stone-700'
                                            )}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className={clsx('truncate text-sm font-medium', event.completed && 'line-through decoration-emerald-500/60')}>
                                                        {event.title}
                                                    </div>
                                                    <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-stone-500 flex-wrap">
                                                        <span className="flex items-center gap-1">
                                                            <Clock className="h-3 w-3" />
                                                            {(event.startTime && event.startTime.trim() !== '' ? event.startTime : '--:--')} · {event.priority !== null && event.priority !== undefined ? `P${event.priority}` : '--'}
                                                        </span>
                                                        {event.completed && (
                                                            <span className="flex items-center gap-1 text-emerald-600">
                                                                <CheckCircle2 className="h-3 w-3" />
                                                                {statusText.done}
                                                            </span>
                                                        )}
                                                        {event.failed && (
                                                            <span className="flex items-center gap-1 text-red-600">
                                                                <CircleX className="h-3 w-3" />
                                                                {statusText.failed}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                {event.link && (
                                                    <a
                                                        href={event.link}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="rounded-full p-1 text-blue-500 hover:bg-blue-50 hover:text-blue-600"
                                                        aria-label={interpolateText(text.calendar.openEventLink, { name: event.title })}
                                                    >
                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                    </a>
                                                )}
                                            </div>
                                            {event.note && (
                                                <div className="mt-2 line-clamp-3 text-xs leading-5 text-stone-500">
                                                    {event.note}
                                                </div>
                                            )}
                                        </article>
                                    ))
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>
        </div>
    );
};
