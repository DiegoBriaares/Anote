import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCalendarStore, type CalendarEvent } from '../../store/calendarStore';
import { interpolateText } from '../../i18n/appText';
import { CheckCircle2, CircleX, Clock, Link as LinkIcon, StickyNote, Trash2, Edit3, Plus } from 'lucide-react';
import clsx from 'clsx';
import { FALLBACK_POSTPONED_EVENT_DOMAIN, POSTPONED_EVENT_DOMAINS, normalizePostponedEventDomain, type PostponedEventDomain } from '../../utils/postponedDomains';
import { useTranslation } from '../../i18n/languageContext';

interface PostponedEventBoardProps {
    postponedView?: PostponedEventDomain;
    onViewChange?: (view: PostponedEventDomain) => void;
}

export const PostponedEventBoard: React.FC<PostponedEventBoardProps> = ({ postponedView, onViewChange }) => {
    const { postponedEvents, viewMode, addPostponedEvent, deletePostponedEvent, editPostponedEvent, actionError, clearActionError } = useCalendarStore();
    const { text } = useTranslation();
    const statusText = text.eventStatus;
    const [draft, setDraft] = useState({ title: '', time: '', link: '', note: '', priority: '' });
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
    const [sortOrder, setSortOrder] = useState<'time' | 'priority'>('time');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const activeView = postponedView ?? FALLBACK_POSTPONED_EVENT_DOMAIN;
    const stateByViewRef = useRef<Record<PostponedEventDomain, {
        draft: typeof draft;
        editingId: string | null;
        editingEvent: CalendarEvent | null;
        sortOrder: 'time' | 'priority';
    }>>({
        today: { draft: { title: '', time: '', link: '', note: '', priority: '' }, editingId: null, editingEvent: null, sortOrder: 'time' },
        week: { draft: { title: '', time: '', link: '', note: '', priority: '' }, editingId: null, editingEvent: null, sortOrder: 'time' },
        all: { draft: { title: '', time: '', link: '', note: '', priority: '' }, editingId: null, editingEvent: null, sortOrder: 'time' }
    });

    useEffect(() => {
        const saved = stateByViewRef.current[activeView];
        if (saved) {
            setDraft(saved.draft);
            setEditingId(saved.editingId);
            setEditingEvent(saved.editingEvent);
            setSortOrder(saved.sortOrder);
        }
    }, [activeView]);

    useEffect(() => {
        stateByViewRef.current[activeView] = {
            draft,
            editingId,
            editingEvent,
            sortOrder
        };
    }, [activeView, draft, editingId, editingEvent, sortOrder]);

    const dayEvents = useMemo(() => {
        const list = (postponedEvents || []).filter((event) => normalizePostponedEventDomain(event.postponedView) === activeView);
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
    }, [postponedEvents, sortOrder, activeView]);

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

    return (
        <div className="w-full board-panel p-4 rounded-2xl">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                <div>
                    <div className="text-[11px] font-mono text-stone-500 tracking-[0.25em] uppercase">{text.calendar.eventsAdministration}</div>
                    <div className="text-xl text-stone-800 tracking-[0.2em]">{text.calendar.postponedEvents}</div>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-mono text-stone-500 uppercase">
                    <div className="flex items-center gap-1 rounded-full border border-orange-200 bg-white p-1">
                        {POSTPONED_EVENT_DOMAINS.map((domain) => (
                            <button
                                key={domain.value}
                                type="button"
                                onClick={() => onViewChange?.(domain.value)}
                                className={`px-2 py-1 rounded-full text-[10px] font-mono uppercase tracking-[0.2em] transition-colors ${activeView === domain.value ? 'bg-orange-200 text-orange-700' : 'text-stone-500 hover:text-stone-700'}`}
                            >
                                {domain.value === 'today' ? text.calendar.todayView : domain.value === 'week' ? text.calendar.weekView : text.calendar.allView}
                            </button>
                        ))}
                    </div>
                    <label className="tracking-[0.2em]" htmlFor="postponed-event-order">{text.common.order}</label>
                    <select
                        id="postponed-event-order"
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value as 'time' | 'priority')}
                        className="bg-white border border-orange-200 text-[11px] text-stone-700 px-2 py-1 focus:outline-none focus:border-orange-400 rounded-lg"
                    >
                        <option value="time">{text.common.hour}</option>
                        <option value="priority">{text.common.priority}</option>
                    </select>
                </div>
                {viewMode === 'friend' && (
                    <span className="text-[10px] font-mono text-orange-500 uppercase">{text.common.readOnly}</span>
                )}
            </div>

            {actionError && (
                <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-mono text-red-600">
                    {text.errors.REQUEST_FAILED}
                </div>
            )}

            {dayEvents.length === 0 ? (
                <div className="text-xs text-stone-500 font-mono">{text.calendar.noEventsForDay}</div>
            ) : (
                <div className="flex flex-col gap-3">
                    {dayEvents.map((event: CalendarEvent) => (
                        <div
                            key={event.id}
                            className={clsx(
                                'board-card flex flex-col gap-2',
                                event.completed && 'board-card-completed',
                                event.failed && 'board-card-failed'
                            )}
                        >
                            <div className="flex items-center justify-between">
                                <div className="text-sm text-stone-800 font-mono">{event.title}</div>
                                <div className="flex items-center gap-2 text-[11px] text-stone-500">
                                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {getMetaLabel(event)}</span>
                                    {event.completed && (
                                        <span className="pill-soft status-pill-completed flex items-center gap-1 text-[10px] uppercase tracking-[0.2em]">
                                            <CheckCircle2 className="w-3 h-3" /> {statusText.completed}
                                        </span>
                                    )}
                                    {event.failed && (
                                        <span className="pill-soft status-pill-failed flex items-center gap-1 text-[10px] uppercase tracking-[0.2em]">
                                            <CircleX className="w-3 h-3" /> {statusText.failed}
                                        </span>
                                    )}
                                    {viewMode !== 'friend' && (
                                        <>
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
                                                className="text-emerald-600 hover:text-emerald-700 flex items-center gap-1 text-[11px]"
                                            >
                                                <Edit3 className="w-3 h-3" aria-hidden="true" /> {text.common.edit}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { void deletePostponedEvent(event.id); }}
                                                aria-label={interpolateText(text.calendar.deleteEvent, { name: event.title })}
                                                className="text-red-500 hover:text-red-600 flex items-center gap-1 text-[11px]"
                                            >
                                                <Trash2 className="w-3 h-3" aria-hidden="true" /> {text.common.delete}
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
                    <div className="text-[10px] font-mono text-stone-500 uppercase tracking-[0.25em] mb-2">{editingId ? text.calendar.updateEvent : text.calendar.createEvent}</div>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                        <input
                            type="text"
                            aria-label={text.common.title}
                            value={draft.title}
                            onChange={(e) => {
                                clearActionError();
                                setDraft({ ...draft, title: e.target.value });
                            }}
                            placeholder={text.calendar.eventTitlePlaceholder}
                            className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400"
                        />
                        <input
                            type="time"
                            aria-label={text.common.time}
                            value={draft.time}
                            onChange={(e) => {
                                clearActionError();
                                setDraft({ ...draft, time: e.target.value });
                            }}
                            className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400"
                        />
                        <input
                            type="number"
                            aria-label={text.common.priority}
                            step="1"
                            value={draft.priority}
                            onChange={(e) => {
                                clearActionError();
                                setDraft({ ...draft, priority: e.target.value });
                            }}
                            placeholder={text.calendar.priorityPlaceholder}
                            className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400"
                        />
                        <input
                            type="url"
                            aria-label={text.common.link}
                            value={draft.link}
                            onChange={(e) => {
                                clearActionError();
                                setDraft({ ...draft, link: e.target.value });
                            }}
                            placeholder={text.calendar.linkPlaceholder}
                            className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400"
                        />
                        <input
                            type="text"
                            aria-label={text.common.note}
                            value={draft.note}
                            onChange={(e) => {
                                clearActionError();
                                setDraft({ ...draft, note: e.target.value });
                            }}
                            placeholder={text.calendar.notePlaceholder}
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
                                {text.common.cancel}
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
                                        didSave = await editPostponedEvent({
                                            id: editingId,
                                            title: draft.title,
                                            date: editingEvent?.date || '',
                                            startTime: draft.time,
                                            priority: parsePriority(draft.priority),
                                            link: draft.link,
                                            note: draft.note,
                                            completed: editingEvent?.completed ?? false,
                                            failed: editingEvent?.failed ?? false,
                                            originDates: editingEvent?.originDates || null,
                                            wasPostponed: null,
                                            postponedView: editingEvent?.postponedView ?? activeView
                                        } as CalendarEvent);
                                    } else {
                                        await addPostponedEvent({ ...draft, priority: parsePriority(draft.priority), postponedView: activeView });
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
                            <Plus className="w-4 h-4" aria-hidden="true" /> {isSubmitting ? text.common.saving : editingId ? text.common.saveChanges : text.calendar.addEvent}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
