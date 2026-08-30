import React from 'react';
import { getMonthGrid, isDateInRange, formatDate } from '../../utils/dateUtils';
import { useCalendarStore } from '../../store/calendarStore';
import { isSameMonth, isToday } from 'date-fns';
import clsx from 'clsx';
import { useTranslation } from '../../i18n/languageContext';

interface MonthGridProps {
    year: number;
    month: number;
    onDateClick: (date: Date) => void;
    onDateDoubleClick?: (date: Date) => void;
    onDateEnter: (date: Date) => void;
    isSelecting: boolean;
    markedDateKeys?: string[];
    isDayMarkingActive?: boolean;
}

export const MonthGrid: React.FC<MonthGridProps> = ({
    year,
    month,
    onDateClick,
    onDateDoubleClick,
    onDateEnter,
    isSelecting,
    markedDateKeys = [],
    isDayMarkingActive = false
}) => {
    const days = getMonthGrid(year, month);
    const { events, selection, compareMode, compareEvents } = useCalendarStore();
    const { language, text } = useTranslation();
    const currentMonthDate = new Date(year, month);
    const markedDates = new Set(markedDateKeys);

    return (
        <div className="relative flex flex-col calendar-panel p-4 rounded-2xl">
            {/* Technical Header */}
            <div className="calendar-panel__head pb-4 mb-4 px-2">
                <div>
                    <div className="text-[10px] text-stone-500 font-mono tracking-widest mb-1">{text.calendar.sector} {month + 1}</div>
                    <h3 className="text-2xl text-orange-600 uppercase tracking-widest">
                        {new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' }).format(currentMonthDate)}
                    </h3>
                </div>
                <div className="flex gap-1">
                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                    <div className="w-2 h-2 border border-orange-400 rounded-full"></div>
                </div>
            </div>

            {/* Grid Header */}
            <div className="grid grid-cols-7 calendar-panel__rowhead mb-1">
                {Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(language, { weekday: 'short' }).format(new Date(2024, 0, 7 + index))).map((day, index) => (
                    <div key={index} className="text-center text-[10px] text-stone-500 font-mono uppercase py-2 border-r border-orange-100 last:border-r-0 font-medium">
                        {day.replace('.', '')}
                    </div>
                ))}
            </div>

            {/* Grid Body */}
            <div className="grid grid-cols-7 auto-rows-fr gap-[1px] calendar-grid rounded-lg overflow-hidden">
                {days.map((date) => {
                    const dateStr = formatDate(date);
                    // Normalize to unique events (id) and sort by time then title to keep preview aligned with actual day data.
                    const dayEvents = (() => {
                        const raw = events[dateStr] || [];
                        const deduped = raw.filter((ev, idx, arr) => arr.findIndex((e) => e.id === ev.id) === idx);
                        return deduped.sort((a, b) => {
                            const hasTimeA = !!(a.startTime && a.startTime.trim() !== '');
                            const hasTimeB = !!(b.startTime && b.startTime.trim() !== '');
                            if (hasTimeA && hasTimeB) {
                                const tA = a.startTime || '';
                                const tB = b.startTime || '';
                                if (tA !== tB) return tA.localeCompare(tB);
                                return a.title.localeCompare(b.title);
                            }
                            if (hasTimeA !== hasTimeB) return hasTimeA ? -1 : 1;
                            const pA = a.priority ?? Number.MAX_SAFE_INTEGER;
                            const pB = b.priority ?? Number.MAX_SAFE_INTEGER;
                            if (pA !== pB) return pA - pB;
                            return a.title.localeCompare(b.title);
                        });
                    })();
                    const ghostEvents = compareMode ? (compareEvents[dateStr] || []) : [];
                    const isRangeSelected = isDateInRange(date, selection.start, selection.end);
                    const isMarked = markedDates.has(dateStr);
                    const isSelected = isRangeSelected || isMarked;
                    const isCurrentMonth = isSameMonth(date, currentMonthDate);
                    const isDayToday = isToday(date);

                    const bgUrl = useCalendarStore.getState().dayBackgrounds[dateStr];
                    const dailyFact = useCalendarStore.getState().dailyFacts[dateStr];

                    return (
                        <button
                            type="button"
                            key={date.toISOString()}
                            onMouseDown={() => onDateClick(date)}
                            onKeyDown={(event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                event.preventDefault();
                                if (event.key === 'Enter' && !isDayMarkingActive && onDateDoubleClick) {
                                    onDateDoubleClick(date);
                                } else {
                                    onDateClick(date);
                                }
                            }}
                            onDoubleClick={() => onDateDoubleClick?.(date)}
                            onMouseEnter={() => (isSelecting || isDayMarkingActive) && onDateEnter(date)}
                            aria-label={new Intl.DateTimeFormat(language, { dateStyle: 'full' }).format(date)}
                            aria-pressed={isSelected}
                            className={clsx(
                                "calendar-cell min-h-[120px] relative p-2 transition-all duration-200 group",
                                !isCurrentMonth && "cell-faded",
                                isSelected ? "cell-selected" : "cell-default",
                                isDayToday && !isSelected && "cell-today"
                            )}
                            style={bgUrl ? {
                                backgroundImage: `linear-gradient(rgba(255,255,255,0.5), rgba(255,255,255,0.5)), url(${bgUrl})`,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center'
                            } : undefined}
                        >
                            {/* Crosshairs for precision */}
                            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-orange-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-orange-300 opacity-0 group-hover:opacity-100 transition-opacity" />

                            {/* Date Number */}
                            <div className="flex justify-between items-start mb-2">
                                <span className={clsx(
                                    "text-xs font-mono",
                                    isDayToday ? "text-orange-600 font-bold" : "text-stone-600",
                                    isSelected && "text-orange-700 font-semibold"
                                )}>
                                    {String(date.getDate()).padStart(2, '0')}
                                </span>
                                <div className="flex gap-1">
                                    {isMarked && (
                                        <span className="text-[9px] text-orange-600 font-mono bg-orange-100 px-1 rounded event-count">
                                            {text.calendar.marked}
                                        </span>
                                    )}
                                    {dayEvents.length > 0 && (
                                        <span className="text-[9px] text-stone-500 font-mono bg-stone-100 px-1 rounded event-count">
                                            [{dayEvents.length}]
                                        </span>
                                    )}
                                    {ghostEvents.length > 0 && (
                                        <span className="text-[9px] text-orange-400 font-mono border border-orange-200 px-1 rounded">
                                            +{ghostEvents.length}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Events - Colorful Blocks */}
                            <div className="flex flex-col gap-1">
                                {dayEvents.map((event, idx) => (
                                    <div
                                        key={event.id}
                                        className={clsx(
                                            "event-chip text-[10px] font-mono px-1.5 py-1 rounded transition-all w-fit",
                                            idx % 3 === 0 && "event-chip-cyan",
                                            idx % 3 === 1 && "event-chip-purple",
                                            idx % 3 === 2 && "event-chip-emerald",
                                            event.completed && "event-chip-completed",
                                            event.failed && "event-chip-failed",
                                        )}
                                    >
                                        <span className={clsx(
                                            'text-[9px] bg-white/80 px-2 rounded shadow-sm time-pill block',
                                            event.completed && 'time-pill-completed',
                                            event.failed && 'time-pill-failed'
                                        )}>
                                            {(event.startTime && event.startTime.trim() !== '' ? event.startTime : '--:--')} · {event.priority !== null && event.priority !== undefined ? `P${event.priority}` : '--'}
                                        </span>
                                    </div>
                                ))}

                                {/* Ghost Events (My Events) for Comparison */}
                                {ghostEvents.map((event) => (
                                    <div
                                        key={`ghost-${event.id}`}
                                        className="text-[10px] font-mono truncate px-1.5 py-1 rounded-r border border-orange-200/50 text-stone-400 bg-white/40"
                                        title={text.calendar.ghostDay}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="truncate opacity-60">{event.title}</span>
                                            <span className="text-[9px] bg-stone-50/50 px-1 rounded time-pill opacity-60">
                                                {(event.startTime && event.startTime.trim() !== '' ? event.startTime : '--:--')} · {event.priority !== null && event.priority !== undefined ? `P${event.priority}` : '--'}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Selection Overlay */}
                            {isSelected && (
                                <div className="absolute inset-0 border-2 border-orange-400 pointer-events-none rounded selection-overlay">
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[1px] bg-orange-300/50" />
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-full w-[1px] bg-orange-300/50" />
                                    {isMarked && isDayMarkingActive && (
                                        <div className="absolute bottom-2 left-2 rounded-full bg-orange-500 px-2 py-0.5 text-[9px] font-mono text-white shadow-sm">
                                            {text.calendar.selectedDayLabel}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Daily Fact Snippet */}
                            {dailyFact && (
                                <div className="absolute bottom-1 right-1 max-w-[90%] flex justify-end">
                                    <div className="text-[8px] text-stone-500 bg-white/60 p-0.5 px-1.5 rounded-full border border-stone-200/50 truncate italic shadow-sm hover:max-w-none hover:w-auto hover:z-10 cursor-help" title={dailyFact}>
                                        {dailyFact}
                                    </div>
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
