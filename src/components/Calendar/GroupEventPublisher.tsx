import React from 'react';
import { Clock, Link as LinkIcon, Plus, StickyNote, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { GroupEventDraft, QueuedGroupEvent } from './groupEventUtils';

interface GroupEventPublisherProps {
    selectedDateKeys: string[];
    draft: GroupEventDraft;
    queuedEvents: QueuedGroupEvent[];
    isSubmitting: boolean;
    onDraftChange: (draft: GroupEventDraft) => void;
    onAddQueuedEvent: () => void;
    onRemoveQueuedEvent: (id: string) => void;
}

export const GroupEventPublisher: React.FC<GroupEventPublisherProps> = ({
    selectedDateKeys,
    draft,
    queuedEvents,
    isSubmitting,
    onDraftChange,
    onAddQueuedEvent,
    onRemoveQueuedEvent
}) => {
    const updateDraft = (key: keyof GroupEventDraft, value: string) => {
        onDraftChange({ ...draft, [key]: value });
    };

    return (
        <div className="mb-8 board-panel rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
                <div>
                    <div className="text-[10px] font-mono text-stone-500 uppercase tracking-[0.25em]">Event Administration</div>
                    <div className="text-lg text-stone-800 tracking-[0.16em]">Group Event Input</div>
                </div>
                <div className="text-[10px] font-mono text-orange-600 uppercase tracking-[0.2em]">
                    {selectedDateKeys.length} marked day{selectedDateKeys.length === 1 ? '' : 's'}
                </div>
            </div>

            {queuedEvents.length > 0 && (
                <div className="mb-4 flex flex-col gap-2">
                    {queuedEvents.map((event) => (
                        <div key={event.id} className="board-card flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-sm font-mono text-stone-800 truncate">{event.title}</div>
                                <div className="mt-1 flex items-center gap-3 text-[11px] font-mono text-stone-500 flex-wrap">
                                    <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {event.startTime || '--:--'} · {event.priority !== null ? `P${event.priority}` : '--'}
                                    </span>
                                    {event.link && (
                                        <span className="flex items-center gap-1 truncate max-w-[220px]">
                                            <LinkIcon className="w-3 h-3" />
                                            {event.link}
                                        </span>
                                    )}
                                    {event.note && (
                                        <span className="flex items-center gap-1 truncate max-w-[220px]">
                                            <StickyNote className="w-3 h-3" />
                                            {event.note}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onRemoveQueuedEvent(event.id)}
                                disabled={isSubmitting}
                                className="p-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                                aria-label={`Remove ${event.title}`}
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="border-t border-orange-100 pt-4">
                <div className="text-[10px] font-mono text-stone-500 uppercase tracking-[0.25em] mb-2">Create Event</div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <input
                        type="text"
                        value={draft.title}
                        onChange={(e) => updateDraft('title', e.target.value)}
                        placeholder="Title"
                        disabled={isSubmitting}
                        className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400 disabled:opacity-50"
                    />
                    <input
                        type="time"
                        value={draft.startTime}
                        onChange={(e) => updateDraft('startTime', e.target.value)}
                        disabled={isSubmitting}
                        className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400 disabled:opacity-50"
                    />
                    <input
                        type="number"
                        step="1"
                        value={draft.priority}
                        onChange={(e) => updateDraft('priority', e.target.value)}
                        placeholder="Priority"
                        disabled={isSubmitting}
                        className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400 disabled:opacity-50"
                    />
                    <input
                        type="url"
                        value={draft.link}
                        onChange={(e) => updateDraft('link', e.target.value)}
                        placeholder="Link"
                        disabled={isSubmitting}
                        className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400 disabled:opacity-50"
                    />
                    <input
                        type="text"
                        value={draft.note}
                        onChange={(e) => updateDraft('note', e.target.value)}
                        placeholder="Note"
                        disabled={isSubmitting}
                        className="bg-white border border-orange-200 text-sm text-stone-800 px-3 py-2 focus:outline-none focus:border-orange-400 disabled:opacity-50"
                    />
                </div>
                <div className="mt-3 flex justify-end">
                    <button
                        type="button"
                        onClick={onAddQueuedEvent}
                        disabled={isSubmitting || !draft.title.trim()}
                        className={clsx(
                            'px-4 py-2 bg-orange-400 text-white text-xs font-mono font-bold hover:bg-orange-500 transition-colors flex items-center gap-2 rounded-lg',
                            (isSubmitting || !draft.title.trim()) && 'opacity-50 cursor-not-allowed'
                        )}
                    >
                        <Plus className="w-4 h-4" />
                        Add Event
                    </button>
                </div>
            </div>
        </div>
    );
};
