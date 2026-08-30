import React from 'react';
import { CalendarRange, CheckCircle2, CircleX, Clock, Send, Users } from 'lucide-react';
import type { CalendarEvent } from '../../store/calendarStore';
import { interpolateText } from '../../i18n/appText';
import clsx from 'clsx';
import { useTranslation } from '../../i18n/languageContext';

interface ShareFriend {
    id: string;
    username: string;
}

interface GroupEventSharerProps {
    selectedDateKeys: string[];
    eventsByDate: Record<string, CalendarEvent[]>;
    friends: ShareFriend[];
    selectedFriendIds: string[];
    isEventSelectionEnabled: boolean;
    selectedEventIds: string[];
    isSubmitting: boolean;
    onToggleFriend: (friendId: string) => void;
    onToggleEventSelection: () => void;
    onToggleEvent: (eventId: string) => void;
    onSelectAllEvents: () => void;
    onUnselectAllEvents: () => void;
    onSelectIncompleteEvents: () => void;
    onShare: () => void;
}

const sortShareableEvents = (events: CalendarEvent[]) => (
    [...events].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const timeCompare = (a.startTime || '').localeCompare(b.startTime || '');
        if (timeCompare !== 0) return timeCompare;
        const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
        const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.title.localeCompare(b.title);
    })
);

export const GroupEventSharer: React.FC<GroupEventSharerProps> = ({
    selectedDateKeys,
    eventsByDate,
    friends,
    selectedFriendIds,
    isEventSelectionEnabled,
    selectedEventIds,
    isSubmitting,
    onToggleFriend,
    onToggleEventSelection,
    onToggleEvent,
    onSelectAllEvents,
    onUnselectAllEvents,
    onSelectIncompleteEvents,
    onShare
}) => {
    const { text } = useTranslation();
    const statusText = text.eventStatus;
    const shareableEvents = sortShareableEvents(selectedDateKeys.flatMap((dateKey) => eventsByDate[dateKey] || []));
    const totalEvents = shareableEvents.length;
    const canShare = selectedFriendIds.length > 0
        && selectedDateKeys.length > 0
        && totalEvents > 0
        && (!isEventSelectionEnabled || selectedEventIds.length > 0)
        && !isSubmitting;

    return (
        <div className="mb-8 board-panel rounded-2xl p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <div className="text-[10px] font-mono text-stone-500 uppercase tracking-[0.25em]">{text.calendar.eventDistribution}</div>
                    <div className="text-lg text-stone-800 tracking-[0.16em]">{text.calendar.shareEvents}</div>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-mono text-orange-600 uppercase tracking-[0.2em] flex-wrap">
                    <span>{interpolateText(selectedDateKeys.length === 1 ? text.calendar.selectedDay : text.calendar.selectedDays, { count: selectedDateKeys.length })}</span>
                    <span>{interpolateText(totalEvents === 1 ? text.calendar.selectedEvent : text.calendar.selectedEvents, { count: totalEvents })}</span>
                    <span>{interpolateText(selectedFriendIds.length === 1 ? text.calendar.selectedFriend : text.calendar.selectedFriends, { count: selectedFriendIds.length })}</span>
                </div>
            </div>

            {totalEvents === 0 && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-mono text-amber-700">
                    {text.calendar.noShareableEvents}
                </div>
            )}

            <div className="rounded-xl border border-orange-100 bg-white/75 p-3">
                <div className="mb-3 flex items-center gap-2 border-b border-orange-100 pb-2">
                    <Users className="h-4 w-4 text-orange-500" />
                    <div className="text-xs font-mono font-bold uppercase tracking-[0.18em] text-stone-700">{text.calendar.selectFriends}</div>
                </div>

                {friends.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-orange-100 px-3 py-6 text-center text-[11px] font-mono text-stone-400">
                        {text.calendar.noFriends}
                    </div>
                ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {friends.map((friend) => {
                            const isSelected = selectedFriendIds.includes(friend.id);

                            return (
                                <label
                                    key={friend.id}
                                    className={clsx(
                                        'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors',
                                        isSelected
                                            ? 'border-orange-300 bg-orange-50 text-orange-700'
                                            : 'border-stone-100 bg-white text-stone-700 hover:border-orange-200 hover:bg-orange-50/60',
                                        isSubmitting && 'cursor-not-allowed opacity-60'
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        disabled={isSubmitting}
                                        onChange={() => onToggleFriend(friend.id)}
                                        className="h-4 w-4 accent-orange-500"
                                    />
                                    <span className="min-w-0 truncate font-medium">{friend.username}</span>
                                </label>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="mt-4 rounded-xl border border-orange-100 bg-white/75 p-3">
                <label className={clsx(
                    'mb-3 flex min-h-[44px] cursor-pointer items-center gap-3 border-b border-orange-100 pb-3 text-sm font-medium text-stone-700',
                    isSubmitting && 'cursor-not-allowed opacity-60'
                )}>
                    <input
                        type="checkbox"
                        checked={isEventSelectionEnabled}
                        disabled={isSubmitting || totalEvents === 0}
                        onChange={onToggleEventSelection}
                        className="h-4 w-4 accent-orange-500"
                    />
                    <span className="text-xs font-mono font-bold uppercase tracking-[0.18em]">{text.calendar.selectEvents}</span>
                    {isEventSelectionEnabled && (
                        <span className="ml-auto rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-mono text-orange-600">
                            {selectedEventIds.length}/{totalEvents}
                        </span>
                    )}
                </label>

                {isEventSelectionEnabled && (
                    <>
                        <div className="mb-3 flex items-center gap-2 flex-wrap">
                            <button
                                type="button"
                                onClick={onSelectAllEvents}
                                disabled={isSubmitting || totalEvents === 0}
                                className="rounded-lg border border-orange-100 bg-white px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-orange-600 hover:border-orange-300 disabled:opacity-50"
                            >
                                {text.common.selectAll}
                            </button>
                            <button
                                type="button"
                                onClick={onUnselectAllEvents}
                                disabled={isSubmitting || selectedEventIds.length === 0}
                                className="rounded-lg border border-orange-100 bg-white px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-stone-500 hover:border-orange-300 disabled:opacity-50"
                            >
                                {text.calendar.unselectAll}
                            </button>
                            <button
                                type="button"
                                onClick={onSelectIncompleteEvents}
                                disabled={isSubmitting || totalEvents === 0}
                                className="rounded-lg border border-orange-100 bg-white px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-stone-500 hover:border-orange-300 disabled:opacity-50"
                            >
                                {text.calendar.selectIncomplete}
                            </button>
                        </div>

                        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
                            {selectedDateKeys.map((dateKey) => {
                                const dayEvents = sortShareableEvents(eventsByDate[dateKey] || []);

                                return (
                                    <section
                                        key={dateKey}
                                        className="min-w-0 rounded-xl border border-orange-100 bg-white/80 p-3 shadow-sm"
                                        aria-label={interpolateText(text.calendar.shareEventsFor, { date: dateKey })}
                                    >
                                        <div className="mb-3 flex items-center justify-between gap-2 border-b border-orange-100 pb-2">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <CalendarRange className="h-4 w-4 shrink-0 text-orange-500" />
                                                <div className="truncate text-xs font-mono font-bold text-stone-700">{dateKey}</div>
                                            </div>
                                            <div className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-mono text-orange-600">
                                                {dayEvents.filter((event) => selectedEventIds.includes(event.id)).length}/{dayEvents.length}
                                            </div>
                                        </div>

                                        <div className="flex flex-col gap-2">
                                            {dayEvents.length === 0 ? (
                                                <div className="rounded-lg border border-dashed border-orange-100 px-3 py-6 text-center text-[11px] font-mono text-stone-400">
                                                    {text.common.noEvents}
                                                </div>
                                            ) : (
                                                dayEvents.map((event) => {
                                                    const isSelected = selectedEventIds.includes(event.id);

                                                    return (
                                                        <label
                                                            key={event.id}
                                                            className={clsx(
                                                                'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors',
                                                                isSelected
                                                                    ? 'border-orange-300 bg-orange-50/80 text-stone-800'
                                                                    : 'border-stone-100 bg-white text-stone-500 hover:border-orange-200',
                                                                isSubmitting && 'cursor-not-allowed opacity-60'
                                                            )}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                disabled={isSubmitting}
                                                                onChange={() => onToggleEvent(event.id)}
                                                                className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
                                                            />
                                                            <span className="min-w-0 flex-1">
                                                                <span className={clsx('block truncate text-sm font-medium', event.completed && 'line-through decoration-emerald-500/60')}>
                                                                    {event.title}
                                                                </span>
                                                                <span className="mt-1 flex items-center gap-2 text-[11px] font-mono text-stone-500 flex-wrap">
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
                                                                </span>
                                                            </span>
                                                        </label>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            <div className="mt-4 flex justify-end">
                <button
                    type="button"
                    onClick={onShare}
                    disabled={!canShare}
                    className={clsx(
                        'min-h-[42px] rounded-xl bg-orange-500 px-5 py-2 text-xs font-mono font-bold uppercase tracking-[0.18em] text-white shadow-lg shadow-orange-300/40 transition-colors hover:bg-orange-600 flex items-center gap-2',
                        !canShare && 'cursor-not-allowed opacity-50 hover:bg-orange-500'
                    )}
                >
                    <Send className="h-4 w-4" />
                    {isSubmitting ? text.calendar.sharing : text.calendar.shareEvents}
                </button>
            </div>
        </div>
    );
};
