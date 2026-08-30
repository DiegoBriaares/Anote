import React, { useState, useEffect } from 'react';
import { MonthGrid } from './MonthGrid';
import { useCalendarStore } from '../../store/calendarStore';
import { getNextMonth, getPrevMonth, formatDate } from '../../utils/dateUtils';
import { isEventPending } from '../../utils/eventStatus';
import { addDays, eachDayOfInterval } from 'date-fns';
import { BookOpenText, CalendarCheck, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Compass, ListChecks, Send, Share2, X } from 'lucide-react';
import { DayModal } from './DayModal';
import { DayConfigModal } from './DayConfigModal';
import { GroupEventPublisher } from './GroupEventPublisher';
import { GroupEventReader } from './GroupEventReader';
import { GroupEventSharer } from './GroupEventSharer';
import { buildGroupEventPublishEntries, buildQueuedGroupEvent, hasPublishableGroupDraft, type GroupEventDraft, type QueuedGroupEvent } from './groupEventUtils';
import clsx from 'clsx';
import { useTranslation } from '../../i18n/languageContext';
import { interpolateText } from '../../i18n/appText';

type GroupEventStep = 'idle' | 'select-days' | 'share-events' | 'sharing' | 'read-events' | 'input-events' | 'ready-to-publish' | 'publishing' | 'move-events' | 'moving-events';

const emptyGroupDraft: GroupEventDraft = {
    title: '',
    startTime: '',
    priority: '',
    link: '',
    note: ''
};

const getDateKeysBetween = (start: Date, end: Date) => {
    const intervalStart = start < end ? start : end;
    const intervalEnd = start < end ? end : start;
    return eachDayOfInterval({ start: intervalStart, end: intervalEnd }).map(formatDate);
};

export const CalendarView: React.FC = () => {
    const { text } = useTranslation();
    const {
        viewDate,
        setViewDate,
        setSelection,
        setSelectionActive,
        selection,
        fetchEvents,
        fetchFriendEvents,
        fetchMonthVisuals,
        events,
        viewMode,
        viewingUserId,
        viewingUsername,
        navigateToPostponed,
        navigateToDayAdministration,
        clearSelection,
        addEventsBulk,
        moveIncompleteEventsToDate,
        shareEventsToFriends,
        friends,
        actionError,
        clearActionError
    } = useCalendarStore();
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionStart, setSelectionStart] = useState<Date | null>(null);
    const [isMarkingDays, setIsMarkingDays] = useState(false);
    const [markingStart, setMarkingStart] = useState<Date | null>(null);
    const [isConfigOpen, setIsConfigOpen] = useState(false); // New state
    const [hoverDate, setHoverDate] = useState<Date | null>(null);
    const [modalDate, setModalDate] = useState<Date | null>(null);
    const [groupStep, setGroupStep] = useState<GroupEventStep>('idle');
    const [markedDateKeys, setMarkedDateKeys] = useState<string[]>([]);
    const [groupDraft, setGroupDraft] = useState<GroupEventDraft>(emptyGroupDraft);
    const [queuedGroupEvents, setQueuedGroupEvents] = useState<QueuedGroupEvent[]>([]);
    const [selectedShareFriendIds, setSelectedShareFriendIds] = useState<string[]>([]);
    const [isShareEventSelectionEnabled, setIsShareEventSelectionEnabled] = useState(false);
    const [selectedShareEventIds, setSelectedShareEventIds] = useState<string[]>([]);
    const [moveTargetDateKey, setMoveTargetDateKey] = useState(() => formatDate(addDays(new Date(), 1)));

    // Concurrency: Auto-refresh data every 10 seconds
    useEffect(() => {
        if (viewMode === 'friend' && viewingUserId) {
            fetchFriendEvents(viewingUserId, viewingUsername || '');
        } else {
            fetchEvents();
        }
        const interval = setInterval(() => {
            if (viewMode === 'friend' && viewingUserId) {
                fetchFriendEvents(viewingUserId, viewingUsername || '');
            } else {
                fetchEvents();
            }
        }, 10000);
        return () => clearInterval(interval);
    }, [fetchEvents, fetchFriendEvents, viewMode, viewingUserId, viewingUsername]);

    // Fetch visuals when date changes
    useEffect(() => {
        const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
        const end = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
        // Format YYYY-MM-DD
        const s = start.toISOString().split('T')[0];
        const e = end.toISOString().split('T')[0];
        fetchMonthVisuals(s, e);
    }, [viewDate, fetchMonthVisuals]);

    useEffect(() => {
        const handleMouseUp = () => {
            if (isSelecting && selectionStart && hoverDate) {
                setSelection(selectionStart, hoverDate);
            }
            setIsMarkingDays(false);
            setMarkingStart(null);
            setSelectionActive(false);
            setIsSelecting(false);
            setSelectionStart(null);
            setHoverDate(null);
        };
        window.addEventListener('mouseup', handleMouseUp);
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, [isSelecting, selectionStart, hoverDate, setSelection, setSelectionActive]);

    const handleDateClick = (date: Date) => {
        if (groupStep === 'select-days') {
            const dateKey = formatDate(date);
            setMarkedDateKeys((current) => (
                current.includes(dateKey)
                    ? current.filter((key) => key !== dateKey)
                    : [...current, dateKey].sort()
            ));
            setIsMarkingDays(true);
            setMarkingStart(date);
            return;
        }

        setIsSelecting(true);
        setSelectionActive(true);
        setSelectionStart(date);
        setHoverDate(date);
        setSelection(date, date);
    };

    const handleDateEnter = (date: Date) => {
        if (groupStep === 'select-days') {
            if (isMarkingDays && markingStart) {
                const dateKeys = getDateKeysBetween(markingStart, date);
                setMarkedDateKeys((current) => Array.from(new Set([...current, ...dateKeys])).sort());
            }
            return;
        }
        if (isSelecting && selectionStart) {
            setHoverDate(date);
            setSelection(selectionStart, date);
        }
    };

    const handleDateDoubleClick = (date: Date) => {
        if (groupStep === 'select-days') return;
        setModalDate(date);
    };

    const resetGroupPublishing = () => {
        clearActionError();
        setGroupStep('idle');
        setMarkedDateKeys([]);
        setQueuedGroupEvents([]);
        setSelectedShareFriendIds([]);
        setIsShareEventSelectionEnabled(false);
        setSelectedShareEventIds([]);
        setGroupDraft(emptyGroupDraft);
        setMoveTargetDateKey(formatDate(addDays(new Date(), 1)));
        setIsMarkingDays(false);
        setMarkingStart(null);
        setHoverDate(null);
    };

    const handleStartGroupSelection = () => {
        clearActionError();
        clearSelection();
        setIsSelecting(false);
        setSelectionStart(null);
        setIsMarkingDays(false);
        setMarkingStart(null);
        setHoverDate(null);
        setMarkedDateKeys([]);
        setQueuedGroupEvents([]);
        setSelectedShareFriendIds([]);
        setIsShareEventSelectionEnabled(false);
        setSelectedShareEventIds([]);
        setGroupDraft(emptyGroupDraft);
        setMoveTargetDateKey(formatDate(addDays(new Date(), 1)));
        setGroupStep('select-days');
    };

    const handleMarkDays = () => {
        if (markedDateKeys.length === 0) return;
        clearActionError();
        setGroupStep('input-events');
    };

    const handleReadGroupEvents = () => {
        if (markedDateKeys.length === 0 || groupStep === 'publishing' || groupStep === 'sharing') return;
        clearActionError();
        setGroupStep('read-events');
    };

    const handleOpenGroupShare = () => {
        if (markedDateKeys.length === 0 || groupStep === 'publishing' || groupStep === 'sharing') return;
        clearActionError();
        setGroupStep('share-events');
    };

    const handleOpenGroupMove = () => {
        if (markedDateKeys.length === 0 || groupStep === 'publishing' || groupStep === 'sharing' || groupStep === 'moving-events') return;
        clearActionError();
        setGroupStep('move-events');
    };

    const handleOpenGroupInput = () => {
        if (markedDateKeys.length === 0 || groupStep === 'publishing' || groupStep === 'sharing') return;
        clearActionError();
        setGroupStep(queuedGroupEvents.length > 0 ? 'ready-to-publish' : 'input-events');
    };

    const handleToggleShareFriend = (friendId: string) => {
        setSelectedShareFriendIds((current) => (
            current.includes(friendId)
                ? current.filter((id) => id !== friendId)
                : [...current, friendId]
        ));
    };

    const getShareableEventIds = () => (
        markedDateKeys.flatMap((dateKey) => events[dateKey] || []).map((event) => event.id)
    );

    const handleToggleShareEventSelection = () => {
        const next = !isShareEventSelectionEnabled;
        setIsShareEventSelectionEnabled(next);
        setSelectedShareEventIds(next ? getShareableEventIds() : []);
    };

    const handleToggleShareEvent = (eventId: string) => {
        setSelectedShareEventIds((current) => (
            current.includes(eventId)
                ? current.filter((id) => id !== eventId)
                : [...current, eventId]
        ));
    };

    const handleSelectAllShareEvents = () => {
        setSelectedShareEventIds(getShareableEventIds());
    };

    const handleUnselectAllShareEvents = () => {
        setSelectedShareEventIds([]);
    };

    const handleSelectIncompleteShareEvents = () => {
        setSelectedShareEventIds(
            markedDateKeys
                .flatMap((dateKey) => events[dateKey] || [])
                .filter(isEventPending)
                .map((event) => event.id)
        );
    };

    const handleShareGroupEvents = async () => {
        if (markedDateKeys.length === 0 || selectedShareFriendIds.length === 0 || groupStep === 'sharing') return;
        if (isShareEventSelectionEnabled && selectedShareEventIds.length === 0) return;
        clearActionError();
        setGroupStep('sharing');
        const wasShared = isShareEventSelectionEnabled
            ? await shareEventsToFriends(selectedShareFriendIds, markedDateKeys, selectedShareEventIds)
            : await shareEventsToFriends(selectedShareFriendIds, markedDateKeys);
        if (!wasShared) {
            setGroupStep('share-events');
            return;
        }
        resetGroupPublishing();
    };

    const handleMoveGroupEvents = async () => {
        if (markedDateKeys.length === 0 || !moveTargetDateKey || groupStep === 'moving-events') return;
        clearActionError();
        setGroupStep('moving-events');
        const didMove = await moveIncompleteEventsToDate(markedDateKeys, moveTargetDateKey);
        if (!didMove) {
            setGroupStep('move-events');
            return;
        }
        resetGroupPublishing();
    };

    const handleAddQueuedEvent = () => {
        clearActionError();
        const event = buildQueuedGroupEvent(groupDraft);
        if (!event) return;
        setQueuedGroupEvents((current) => [...current, event]);
        setGroupDraft(emptyGroupDraft);
        setGroupStep('ready-to-publish');
    };

    const handleRemoveQueuedEvent = (id: string) => {
        const willRemoveLastEvent = queuedGroupEvents.length === 1 && queuedGroupEvents[0]?.id === id;
        setQueuedGroupEvents((current) => current.filter((event) => event.id !== id));
        if (willRemoveLastEvent && groupStep === 'ready-to-publish') {
            setGroupStep('input-events');
        }
    };

    const handlePublishGroupEvents = async () => {
        const hasActiveDraft = hasPublishableGroupDraft(groupDraft);
        if ((queuedGroupEvents.length === 0 && !hasActiveDraft) || markedDateKeys.length === 0 || groupStep === 'publishing') return;
        clearActionError();
        setGroupStep('publishing');
        const payload = buildGroupEventPublishEntries(markedDateKeys, queuedGroupEvents, groupDraft);
        const wasPublished = await addEventsBulk(payload);
        if (!wasPublished) {
            setGroupStep(queuedGroupEvents.length > 0 || hasActiveDraft ? 'ready-to-publish' : 'input-events');
            return;
        }
        resetGroupPublishing();
    };

    const handleOpenDayAdministration = (date: Date) => {
        setModalDate(null);
        navigateToDayAdministration(date);
    };

    const handlePrev = () => {
        const { year, month } = getPrevMonth(viewDate.getFullYear(), viewDate.getMonth());
        setViewDate(new Date(year, month));
    };

    const handleNext = () => {
        const { year, month } = getNextMonth(viewDate.getFullYear(), viewDate.getMonth());
        setViewDate(new Date(year, month));
    };

    const monthsToDisplay = [];
    let current = { year: viewDate.getFullYear(), month: viewDate.getMonth() };
    for (let i = 0; i < 2; i++) {
        monthsToDisplay.push({ ...current });
        current = getNextMonth(current.year, current.month);
    }

    const isGroupSelecting = groupStep === 'select-days';
    const isGroupSharing = groupStep === 'share-events' || groupStep === 'sharing';
    const isGroupReading = groupStep === 'read-events';
    const isGroupMoving = groupStep === 'move-events' || groupStep === 'moving-events';
    const isGroupInputActive = groupStep === 'input-events';
    const isGroupPublishReady = groupStep === 'ready-to-publish';
    const isGroupPublishing = groupStep === 'publishing';
    const isBusySharing = groupStep === 'sharing';
    const isBusyMoving = groupStep === 'moving-events';
    const hasActiveGroupDraft = hasPublishableGroupDraft(groupDraft);
    const totalPublishableGroupEvents = queuedGroupEvents.length + (hasActiveGroupDraft ? 1 : 0);
    const canMarkDays = isGroupSelecting && markedDateKeys.length > 0;
    const canShareGroupEvents = markedDateKeys.length > 0 && !isGroupPublishing && !isBusySharing && !isBusyMoving;
    const canReadGroupEvents = markedDateKeys.length > 0 && !isGroupPublishing && !isBusySharing && !isBusyMoving;
    const canMoveGroupEvents = markedDateKeys.length > 0 && !isGroupPublishing && !isBusySharing && !isBusyMoving;
    const canOpenGroupInput = markedDateKeys.length > 0 && !isGroupPublishing && !isBusySharing && !isBusyMoving;
    const canPublishGroupEvents = (isGroupInputActive || isGroupPublishReady || isGroupPublishing) && totalPublishableGroupEvents > 0 && markedDateKeys.length > 0;

    const stepButtonClass = (isActive: boolean, isComplete: boolean, isDisabled = false) => clsx(
        'min-h-[44px] px-4 py-2 rounded-xl border text-xs font-mono font-bold uppercase tracking-[0.18em] transition-all flex items-center gap-2',
        isActive && 'bg-orange-500 text-white border-orange-500 shadow-lg shadow-orange-300/40',
        isComplete && !isActive && 'bg-stone-100 text-stone-500 border-stone-200',
        !isActive && !isComplete && 'bg-white/85 text-stone-500 border-orange-200 hover:border-orange-400 hover:text-orange-600',
        isDisabled && 'opacity-50 cursor-not-allowed hover:border-orange-200 hover:text-stone-500'
    );

    return (
        <div className="flex flex-col w-full max-w-[1600px] mx-auto p-4 sm:p-8">
            {/* Technical Header Block */}
            <div className="console-banner border border-orange-200 bg-white/80 backdrop-blur-xl p-6 mb-8 relative overflow-hidden rounded-2xl shadow-xl shadow-orange-100/50">
                <div className="absolute top-0 left-0 w-20 h-20 border-r border-b border-orange-200"></div>
                <div className="absolute bottom-0 right-0 w-20 h-20 border-l border-t border-orange-200"></div>

                <div className="flex items-center justify-between relative z-10 flex-wrap gap-4">
                    <div className="flex items-center gap-6">
                        <div className="p-4 border-2 border-orange-400 rounded-full bg-gradient-to-br from-orange-50 to-amber-50">
                            <Compass className="w-8 h-8 text-orange-500" aria-hidden="true" />
                        </div>
                        <div>
                            <div className="text-[10px] font-mono text-stone-500 tracking-[0.3em] mb-1">{text.calendar.system}</div>
                            <h1 className="text-3xl sm:text-4xl text-stone-800 tracking-widest font-serif">
                                {text.calendar.monthView}
                            </h1>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Compare Toggle (Only in Friend View) */}
                        {useCalendarStore.getState().viewMode === 'friend' && (
                            <button
                                onClick={() => useCalendarStore.getState().toggleCompare()}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${useCalendarStore.getState().compareMode
                                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                                    : 'bg-white border border-stone-200 text-stone-600 hover:border-orange-300'
                                    }`}
                            >
                                {useCalendarStore.getState().compareMode ? text.calendar.matches : text.calendar.compare}
                            </button>
                        )}

                        <div className="hidden md:block text-right mr-4">
                            <div className="text-[10px] font-mono text-stone-500">{text.calendar.monthCoordinates}</div>
                            <div className="text-sm font-mono text-orange-600 font-medium">
                                {viewDate.getFullYear()}.{String(viewDate.getMonth() + 1).padStart(2, '0')}
                            </div>
                        </div>

                        <div className="flex border-2 border-orange-300 rounded-xl overflow-hidden bg-white shadow-sm">
                            <button type="button" onClick={handlePrev} aria-label={text.common.previous} className="p-3 hover:bg-orange-50 border-r border-orange-200 transition-colors">
                                <ChevronLeft className="w-5 h-5 text-orange-500" aria-hidden="true" />
                            </button>
                            <button type="button" onClick={handleNext} aria-label={text.common.next} className="p-3 hover:bg-orange-50 transition-colors">
                                <ChevronRight className="w-5 h-5 text-orange-500" aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {viewMode !== 'friend' && (
                <div className="flex justify-end mb-6">
                    <button
                        type="button"
                        onClick={navigateToPostponed}
                        className="px-5 py-2.5 bg-white/80 border border-orange-200 hover:bg-orange-50 hover:border-orange-400 transition-all rounded-xl shadow-sm text-sm font-medium text-stone-600 uppercase tracking-wider"
                    >
                        {text.calendar.postponedEvents}
                    </button>
                </div>
            )}

            {viewMode !== 'friend' && (
                <div className="mb-6 flex flex-col items-center gap-3">
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={groupStep === 'idle' ? handleStartGroupSelection : handleMarkDays}
                            disabled={(groupStep !== 'idle' && !isGroupSelecting) || (isGroupSelecting && !canMarkDays) || isGroupPublishing}
                            className={stepButtonClass(isGroupSelecting || groupStep === 'idle', groupStep !== 'idle' && !isGroupSelecting, isGroupSelecting && !canMarkDays)}
                        >
                            {groupStep !== 'idle' && !isGroupSelecting ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <CalendarDays className="w-4 h-4" aria-hidden="true" />}
                            {isGroupSelecting ? interpolateText(text.calendar.markDays, { count: markedDateKeys.length }) : text.calendar.selectDays}
                        </button>
                        <button
                            type="button"
                            onClick={handleReadGroupEvents}
                            disabled={!canReadGroupEvents}
                            className={stepButtonClass(isGroupReading, false, !canReadGroupEvents)}
                        >
                            <BookOpenText className="w-4 h-4" aria-hidden="true" />
                            {text.calendar.readEvents}
                        </button>
                        <button
                            type="button"
                            onClick={handleOpenGroupInput}
                            disabled={!canOpenGroupInput}
                            className={stepButtonClass(isGroupInputActive, isGroupPublishReady || isGroupPublishing, !canOpenGroupInput)}
                        >
                            {isGroupPublishReady || isGroupPublishing ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <ListChecks className="w-4 h-4" aria-hidden="true" />}
                            {text.calendar.inputEvents}
                        </button>
                        <button
                            type="button"
                            onClick={handlePublishGroupEvents}
                            disabled={!canPublishGroupEvents || isGroupPublishing}
                            className={stepButtonClass(isGroupPublishReady || isGroupPublishing, false, !canPublishGroupEvents || isGroupPublishing)}
                        >
                            <Send className="w-4 h-4" aria-hidden="true" />
                            {isGroupPublishing ? text.calendar.publishing : `${text.calendar.publishEvents}${totalPublishableGroupEvents > 0 ? ` (${totalPublishableGroupEvents})` : ''}`}
                        </button>
                        <button
                            type="button"
                            onClick={handleOpenGroupShare}
                            disabled={!canShareGroupEvents}
                            className={stepButtonClass(isGroupSharing, false, !canShareGroupEvents)}
                        >
                            <Share2 className="w-4 h-4" aria-hidden="true" />
                            {text.calendar.shareEvents}
                        </button>
                        <button
                            type="button"
                            onClick={handleOpenGroupMove}
                            disabled={!canMoveGroupEvents}
                            className={stepButtonClass(isGroupMoving, false, !canMoveGroupEvents)}
                        >
                            <CalendarCheck className="w-4 h-4" aria-hidden="true" />
                            {text.calendar.moveEvents}
                        </button>
                    </div>

                    {groupStep !== 'idle' && (
                        <div className="flex items-center gap-3 text-[10px] font-mono text-stone-500 uppercase tracking-[0.2em] flex-wrap justify-center">
                            <span>{interpolateText(markedDateKeys.length === 1 ? text.calendar.selectedDay : text.calendar.selectedDays, { count: markedDateKeys.length })}</span>
                            <span>{interpolateText(queuedGroupEvents.length === 1 ? text.calendar.queuedEvent : text.calendar.queuedEvents, { count: queuedGroupEvents.length })}</span>
                            {selectedShareFriendIds.length > 0 && (
                                <span>{interpolateText(selectedShareFriendIds.length === 1 ? text.calendar.selectedFriend : text.calendar.selectedFriends, { count: selectedShareFriendIds.length })}</span>
                            )}
                            {isGroupMoving && (
                                <span>{text.calendar.target}: {moveTargetDateKey}</span>
                            )}
                            <button
                                type="button"
                                onClick={resetGroupPublishing}
                                disabled={isGroupPublishing || isBusySharing}
                                aria-label={text.calendar.cancelOperation}
                                title={text.calendar.cancelOperation}
                                className="rounded-full border border-orange-100 bg-white/80 p-1.5 text-stone-400 hover:border-orange-300 hover:text-stone-700 disabled:opacity-50"
                            >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                        </div>
                    )}
                </div>
            )}

            {isGroupReading && (
                <GroupEventReader
                    selectedDateKeys={markedDateKeys}
                    eventsByDate={events}
                />
            )}

            {isGroupSharing && (
                <>
                    {actionError && (
                        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-mono text-red-600">
                            {text.errors.REQUEST_FAILED}
                        </div>
                    )}
                    <GroupEventSharer
                        selectedDateKeys={markedDateKeys}
                        eventsByDate={events}
                        friends={friends}
                        selectedFriendIds={selectedShareFriendIds}
                        isEventSelectionEnabled={isShareEventSelectionEnabled}
                        selectedEventIds={selectedShareEventIds}
                        isSubmitting={isBusySharing}
                        onToggleFriend={handleToggleShareFriend}
                        onToggleEventSelection={handleToggleShareEventSelection}
                        onToggleEvent={handleToggleShareEvent}
                        onSelectAllEvents={handleSelectAllShareEvents}
                        onUnselectAllEvents={handleUnselectAllShareEvents}
                        onSelectIncompleteEvents={handleSelectIncompleteShareEvents}
                        onShare={handleShareGroupEvents}
                    />
                </>
            )}

            {isGroupMoving && (
                <div className="mb-6 rounded-xl border border-orange-100 bg-white/85 px-4 py-4 shadow-sm">
                    {actionError && (
                        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-mono text-red-600">
                            {text.errors.REQUEST_FAILED}
                        </div>
                    )}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-center">
                        <label className="flex flex-col gap-1 text-xs font-mono uppercase tracking-[0.18em] text-stone-500">
                            {text.calendar.moveIncompleteTo.replace(' {date}', '')}
                            <input
                                type="date"
                                value={moveTargetDateKey}
                                onChange={(event) => setMoveTargetDateKey(event.target.value)}
                                className="min-h-[42px] rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm font-sans normal-case tracking-normal text-stone-700 focus:border-orange-400 focus:outline-none"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={handleMoveGroupEvents}
                            disabled={!moveTargetDateKey || isBusyMoving}
                            className="min-h-[42px] rounded-lg bg-orange-500 px-4 py-2 text-xs font-mono font-bold uppercase tracking-[0.18em] text-white shadow-lg shadow-orange-300/40 transition-all hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isBusyMoving ? text.calendar.moving : interpolateText(markedDateKeys.length === 1 ? text.calendar.moveFromDay : text.calendar.moveFromDays, { count: markedDateKeys.length })}
                        </button>
                    </div>
                </div>
            )}

            {(isGroupInputActive || isGroupPublishReady || isGroupPublishing) && (
                <>
                    {actionError && (
                        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-mono text-red-600">
                            {text.errors.REQUEST_FAILED}
                        </div>
                    )}
                    <GroupEventPublisher
                        selectedDateKeys={markedDateKeys}
                        draft={groupDraft}
                        queuedEvents={queuedGroupEvents}
                        isSubmitting={isGroupPublishing}
                        onDraftChange={setGroupDraft}
                        onAddQueuedEvent={handleAddQueuedEvent}
                        onRemoveQueuedEvent={handleRemoveQueuedEvent}
                    />
                </>
            )}

            {/* Main Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 select-none">
                {monthsToDisplay.map((m) => (
                    <MonthGrid
                        key={`${m.year}-${m.month}`}
                        year={m.year}
                        month={m.month}
                        onDateClick={handleDateClick}
                        onDateDoubleClick={handleDateDoubleClick}
                        onDateEnter={handleDateEnter}
                        isSelecting={isSelecting}
                        markedDateKeys={markedDateKeys}
                        isDayMarkingActive={isGroupSelecting}
                    />
                ))}
            </div>

            {/* Day Detail Modal */}
            {modalDate && !isConfigOpen && (
                <DayModal
                    date={modalDate}
                    events={events[formatDate(modalDate)] || []}
                    onClose={() => setModalDate(null)}
                    onUpdateEvent={() => fetchEvents()}
                    onConfigure={() => setIsConfigOpen(true)}
                    onAdminister={() => handleOpenDayAdministration(modalDate)}
                />
            )}

            {/* Day Config Modal (Pop-up from DayModal) */}
            {modalDate && (
                <DayConfigModal
                    date={modalDate}
                    isOpen={isConfigOpen}
                    onClose={() => setIsConfigOpen(false)}
                />
            )}

            {!selection.start && (
                <div className="mt-8 border-t border-orange-200 pt-4 text-center">
                    <span className="text-[10px] font-mono text-stone-500 tracking-widest">
                        {text.calendar.awaitingSelection}
                    </span>
                </div>
            )}

        </div>
    );
};
