import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCalendarStore, type CalendarEvent } from '../../store/calendarStore';
import { formatDate } from '../../utils/dateUtils';
import { CheckCircle2, Clock, Link as LinkIcon, StickyNote, Trash2, Edit3, Plus } from 'lucide-react';
import clsx from 'clsx';

interface EventBoardProps {
    selectedDate: Date | null;
}

export const EventBoard: React.FC<EventBoardProps> = ({ selectedDate }) => {
    const { events, viewMode, addEvent, deleteEvent, editEvent, setEventCompleted, actionError, clearActionError } = useCalendarStore();
    const [draft, setDraft] = useState({ title: '', time: '', link: '', note: '', priority: '' });
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
    const [sortOrder, setSortOrder] = useState<'time' | 'priority'>('time');
    const [pendingEventId, setPendingEventId] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const dateStr = selectedDate ? formatDate(selectedDate) : 'event-board-empty';
    const stateByDateRef = useRef<Record<string, {
        draft: typeof draft;
        editingId: string | null;
        editingEvent: CalendarEvent | null;
        sortOrder: 'time' | 'priority';
    }>>({});

    useEffect(() => {
        const saved = stateByDateRef.current[dateStr];
        if (saved) {
            setDraft(saved.draft);
            setEditingId(saved.editingId);
            setEditingEvent(saved.editingEvent);
            setSortOrder(saved.sortOrder);
        }
    }, [dateStr]);

    useEffect(() => {
        stateByDateRef.current[dateStr] = {
            draft,
            editingId,
            editingEvent,
            sortOrder
        };
    }, [dateStr, draft, editingId, editingEvent, sortOrder]);
    const dayEvents = useMemo(() => {
        const list = events[dateStr] || [];
        const priorityValue = (value?: number | null) => {
            if (value === null || value === undefined) return Number.MAX_SAFE_INTEGER;
            return value;
        };
        return [...list].sort((a, b) => {
            if (sortOrder === 'priority') {
                const pA = priorityValue(a.priority);
                const pB = priorityValue(b.priority);
                if (pA !== pB) return pA - pB;
            }
            const tA = a.startTime || '';
            const tB = b.startTime || '';
            if (tA !== tB) return tA.localeCompare(tB);
            if (sortOrder !== 'priority') {
                const pA = priorityValue(a.priority);
                const pB = priorityValue(b.priority);
                if (pA !== pB) return pA - pB;
            }
            return a.title.localeCompare(b.title);
        });
    }, [events, dateStr, sortOrder]);

    const getMetaLabel = (event: CalendarEvent) => {
        const timeLabel = event.startTime && event.startTime.trim() !== '' ? event.startTime : '--:--';
        const priorityLabel = event.priority !== null && event.priority !== undefined ? `P${event.priority}` : '--';
        return `${timeLabel} · ${priorityLabel}`;
    };

    const parsePriority = (value: string) => {
        if (!value) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    };

    if (!selectedDate) return null;

    return (
        <div className="w-full board-panel p-4 rounded-2xl">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                <div>
                    <div className="text-[11px] font-mono text-stone-500 tracking-[0.25em] uppercase">Day Events Administration</div>
                    <div className="text-xl text-stone-800 tracking-[0.2em]">{dateStr}</div>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-mono text-stone-500 uppercase">
                    <label className="tracking-[0.2em]" htmlFor="event-order">Order</label>
                    <select
                        id="event-order"
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value as 'time' | 'priority')}
                        className="bg-white border border-orange-200 text-[11px] text-stone-700 px-2 py-1 focus:outline-none focus:border-orange-400 rounded-lg"
                    >
                        <option value="time">Hour</option>
                        <option value="priority">Priority</option>
                    </select>
                </div>
                {viewMode === 'friend' && (
                    <span className="text-[10px] font-mono text-orange-500 uppercase">Read-only</span>
                )}
            </div>

            {actionError && (
                <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-mono text-red-600">
                    {actionError}
                </div>
            )}

            {dayEvents.length === 0 ? (
                <div className="text-xs text-stone-500 font-mono">No entries. Add one below.</div>
            ) : (
                <div className="flex flex-col gap-3">
                    {dayEvents.map((event: CalendarEvent) => (
                        <div
                            key={event.id}
                            className={clsx(
                                'board-card flex flex-col gap-2',
                                event.completed && 'board-card-completed'
                            )}
                        >
                            <div className="flex items-center justify-between">
                                <div
                                    className={clsx(
                                        'text-sm font-mono',
                                        event.completed ? 'text-emerald-700 dark:text-emerald-300' : 'text-stone-800',
                                        event.completed && 'opacity-90'
                                    )}
                                >
                                    {event.title}
                                </div>
                                <div className="flex items-center gap-2 text-[11px] text-stone-500">
                                    <span className={clsx('flex items-center gap-1', event.completed && 'text-emerald-700/80 dark:text-emerald-300/80')}>
                                        <Clock className="w-3 h-3" /> {getMetaLabel(event)}
                                    </span>
                                    {viewMode !== 'friend' && (
                                        <>
                                            {event.completed ? (
                                                <>
                                                    <span className={clsx(
                                                        'pill-soft status-pill-completed flex items-center gap-1 text-[10px] uppercase tracking-[0.2em]',
                                                        pendingEventId === event.id && 'opacity-80'
                                                    )}>
                                                        <CheckCircle2 className="w-3 h-3" /> {pendingEventId === event.id ? 'Saving...' : 'Completed'}
                                                    </span>
                                                    {pendingEventId !== event.id && (
                                                        <button
                                                            type="button"
                                                            onClick={async () => {
                                                                clearActionError();
                                                                setPendingEventId(event.id);
                                                                try {
                                                                    await setEventCompleted(event, false);
                                                                } finally {
                                                                    setPendingEventId(null);
                                                                }
                                                            }}
                                                            disabled={isSubmitting}
                                                            className="flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-700"
                                                        >
                                                            <CheckCircle2 className="w-3 h-3" /> Unmark
                                                        </button>
                                                    )}
                                                </>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        clearActionError();
                                                        setPendingEventId(event.id);
                                                        try {
                                                            await setEventCompleted(event, true);
                                                        } finally {
                                                            setPendingEventId(null);
                                                        }
                                                    }}
                                                    disabled={pendingEventId === event.id || isSubmitting}
                                                    className={clsx(
                                                        'flex items-center gap-1 text-[11px] text-orange-600 hover:text-orange-700',
                                                        (pendingEventId === event.id || isSubmitting) && 'cursor-not-allowed opacity-60'
                                                    )}
                                                >
                                                    <CheckCircle2 className="w-3 h-3" /> {pendingEventId === event.id ? 'Saving...' : 'Mark complete'}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    clearActionError();
                                                    setEditingId(event.id);
                                                    setEditingEvent(event);
                                                    setDraft({
                                                        title: event.title || '',
                                                        time: event.startTime || '',
                                                        priority: event.priority !== null && event.priority !== undefined ? String(event.priority) : '',
                                                        link: event.link || '',
                                                        note: event.note || ''
                                                    });
                                                }}
                                                disabled={pendingEventId === event.id}
                                                className="text-emerald-600 hover:text-emerald-700 flex items-center gap-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <Edit3 className="w-3 h-3" /> Edit
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => deleteEvent(event.id)}
                                                disabled={pendingEventId === event.id}
                                                className="text-red-500 hover:text-red-600 flex items-center gap-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <Trash2 className="w-3 h-3" /> Delete
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                            {event.note && (
                                <div className="flex items-center gap-2 text-[11px] text-stone-500">
                                    <StickyNote className="w-3 h-3" /> {event.note}
                                </div>
                            )}
                            {event.link && (
                                <a href={event.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-blue-600 underline">
                                    <LinkIcon className="w-3 h-3" /> {event.link}
                                </a>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {viewMode !== 'friend' && (
                <div className="mt-4 border-t border-orange-100 pt-4">
                    <div className="text-[10px] font-mono text-stone-500 uppercase tracking-[0.25em] mb-2">Create / Update</div>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                        <input
                            type="text"
                            value={draft.title}
                            onChange={(e) => {
                                clearActionError();
                                setDraft({ ...draft, title: e.target.value });
                            }}
                            placeholder="Title"
                            className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400"
                        />
                        <input
                            type="time"
                            value={draft.time}
                            onChange={(e) => {
                                clearActionError();
                                setDraft({ ...draft, time: e.target.value });
                            }}
                            className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400"
                        />
                        <input
                            type="number"
                            step="1"
                            value={draft.priority}
                            onChange={(e) => {
                                clearActionError();
                                setDraft({ ...draft, priority: e.target.value });
                            }}
                            placeholder="Priority"
                            className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400"
                        />
                        <input
                            type="url"
                            value={draft.link}
                            onChange={(e) => {
                                clearActionError();
                                setDraft({ ...draft, link: e.target.value });
                            }}
                            placeholder="Link"
                            className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400"
                        />
                        <input
                            type="text"
                            value={draft.note}
                            onChange={(e) => {
                                clearActionError();
                                setDraft({ ...draft, note: e.target.value });
                            }}
                            placeholder="Note"
                            className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400"
                        />
                    </div>
                    <div className="flex gap-2 justify-end mt-3">
                        {editingId && (
                            <button
                                type="button"
                                onClick={() => {
                                    clearActionError();
                                    setEditingId(null);
                                    setEditingEvent(null);
                                    setDraft({ title: '', time: '', link: '', note: '', priority: '' });
                                }}
                                disabled={isSubmitting}
                                className="px-3 py-2 text-xs font-mono text-stone-500 hover:text-stone-800 border border-orange-200 hover:border-orange-300"
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={async () => {
                                if (!draft.title || isSubmitting) return;
                                clearActionError();
                                setIsSubmitting(true);
                                try {
                                    let didSave = false;
                                    if (editingId) {
                                        didSave = await editEvent({
                                            id: editingId,
                                            title: draft.title,
                                            date: dateStr,
                                            startTime: draft.time,
                                            priority: parsePriority(draft.priority),
                                            link: draft.link,
                                            note: draft.note,
                                            completed: editingEvent?.completed ?? false,
                                            version: editingEvent?.version ?? null,
                                            unlockDate: editingEvent?.unlockDate ?? null,
                                            originDates: editingEvent?.originDates || null,
                                            wasPostponed: editingEvent?.wasPostponed || null
                                        } as CalendarEvent);
                                    } else {
                                        await addEvent(selectedDate, { ...draft, priority: parsePriority(draft.priority) });
                                        didSave = true;
                                    }

                                    if (!didSave) return;

                                    setEditingId(null);
                                    setEditingEvent(null);
                                    setDraft({ title: '', time: '', link: '', note: '', priority: '' });
                                } finally {
                                    setIsSubmitting(false);
                                }
                            }}
                            disabled={isSubmitting}
                            className="px-4 py-2 bg-orange-400 text-white text-xs font-mono font-bold hover:bg-orange-500 transition-colors flex items-center gap-2 rounded-lg"
                        >
                            <Plus className="w-4 h-4" /> {isSubmitting ? 'Saving...' : editingId ? 'Save Changes' : 'Add Entry'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
