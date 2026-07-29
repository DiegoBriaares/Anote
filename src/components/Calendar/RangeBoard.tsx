import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCalendarStore } from '../../store/calendarStore';
import { getAppText } from '../../i18n/appText';
import { formatDate } from '../../utils/dateUtils';
import { eachDayOfInterval } from 'date-fns';
import { CalendarRange, CheckCircle2, CircleX } from 'lucide-react';
import clsx from 'clsx';
import { DEFAULT_POSTPONED_EVENT_DOMAIN, POSTPONED_EVENT_DOMAINS, type PostponedEventDomain } from '../../utils/postponedDomains';

interface RangeBoardProps {
    activeDate: Date | null;
}

export const RangeBoard: React.FC<RangeBoardProps> = ({ activeDate }) => {
    const { selection, events, viewMode, addEventsBulk, editEvent, addPostponedEventsBulk, deleteEvent } = useCalendarStore();
    const statusText = getAppText().eventStatus;
    const hasSelection = selection.start && selection.end;
    const [sortOrder, setSortOrder] = React.useState<'time' | 'priority'>('time');
    const [copySourceDate, setCopySourceDate] = useState('');
    const [selectedCopyIds, setSelectedCopyIds] = useState<string[]>([]);
    const [targetDates, setTargetDates] = useState<string[]>([]);
    const [targetDateInput, setTargetDateInput] = useState('');
    const [transferMode, setTransferMode] = useState<'copy' | 'move'>('copy');
    const [postponedView, setPostponedView] = useState<PostponedEventDomain>(DEFAULT_POSTPONED_EVENT_DOMAIN);
    const dateKey = activeDate ? formatDate(activeDate) : 'range-default';
    const stateByDateRef = useRef<Record<string, {
        sortOrder: 'time' | 'priority';
        copySourceDate: string;
        selectedCopyIds: string[];
        targetDates: string[];
        targetDateInput: string;
        transferMode: 'copy' | 'move';
        postponedView: PostponedEventDomain;
    }>>({});

    const days = useMemo(() => {
        if (!selection.start || !selection.end) return [];
        const start = selection.start < selection.end ? selection.start : selection.end;
        const end = selection.start < selection.end ? selection.end : selection.start;
        return eachDayOfInterval({ start, end });
    }, [selection.start, selection.end]);

    useEffect(() => {
        if (days.length === 0) return;
        const dayKeys = days.map((day) => formatDate(day));
        const activeKey = activeDate ? formatDate(activeDate) : '';
        const defaultSource = activeKey && dayKeys.includes(activeKey) ? activeKey : dayKeys[0];
        let didResetSource = false;
        setCopySourceDate((current) => {
            if (current && dayKeys.includes(current)) {
                return current;
            }
            didResetSource = true;
            return defaultSource;
        });
        if (didResetSource) {
            setSelectedCopyIds([]);
        }
        setPostponedView(DEFAULT_POSTPONED_EVENT_DOMAIN);
    }, [days, activeDate]);

    useEffect(() => {
        if (days.length === 0) return;
        const dayKeys = days.map((day) => formatDate(day));
        if (!copySourceDate || !dayKeys.includes(copySourceDate)) {
            const activeKey = activeDate ? formatDate(activeDate) : '';
            const nextSource = activeKey && dayKeys.includes(activeKey) ? activeKey : dayKeys[0];
            setCopySourceDate(nextSource);
            setSelectedCopyIds([]);
        }
    }, [days, activeDate, copySourceDate]);

    useEffect(() => {
        const saved = stateByDateRef.current[dateKey];
        if (!saved) return;
        const dayKeys = days.map((day) => formatDate(day));
        if (!saved.copySourceDate || !dayKeys.includes(saved.copySourceDate)) {
            return;
        }
        setSortOrder(saved.sortOrder);
        setCopySourceDate(saved.copySourceDate);
        setSelectedCopyIds(saved.selectedCopyIds);
        setTargetDates(saved.targetDates);
        setTargetDateInput(saved.targetDateInput);
        setTransferMode(saved.transferMode);
        setPostponedView(saved.postponedView);
    }, [dateKey, days]);

    useEffect(() => {
        stateByDateRef.current[dateKey] = {
            sortOrder,
            copySourceDate,
            selectedCopyIds,
            targetDates,
            targetDateInput,
            transferMode,
            postponedView
        };
    }, [dateKey, sortOrder, copySourceDate, selectedCopyIds, targetDates, targetDateInput, transferMode, postponedView]);

    useEffect(() => {
        if (days.length === 0 || !copySourceDate) return;
        const nextTargets = days
            .map((day) => formatDate(day))
            .filter((date) => date !== copySourceDate);
        const nextTarget = nextTargets[0] || '';
        setTargetDates(nextTarget ? [nextTarget] : []);
        setTargetDateInput(nextTarget);
    }, [days, copySourceDate]);

    const rangeLabel = selection.start && selection.end
        ? (() => {
            const start = selection.start < selection.end ? selection.start : selection.end;
            const end = selection.start < selection.end ? selection.end : selection.start;
            const startLabel = formatDate(start);
            const endLabel = formatDate(end);
            return startLabel === endLabel ? startLabel : `${startLabel} → ${endLabel}`;
        })()
        : '';

    const isReadOnly = viewMode === 'friend';
    const effectiveTargetDates = targetDates.length > 0
        ? targetDates
        : (targetDateInput && targetDateInput !== copySourceDate ? [targetDateInput] : []);
    const sourceEvents = useMemo(() => {
        if (!copySourceDate) return [];
        const list = events[copySourceDate] || [];
        return [...list].sort((a, b) => {
            const priorityValue = (value?: number | null) => {
                if (value === null || value === undefined) return Number.MAX_SAFE_INTEGER;
                return value;
            };
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
    }, [events, copySourceDate, sortOrder]);

    useEffect(() => {
        if (selectedCopyIds.length === 0) return;
        const validIds = new Set(sourceEvents.map((event) => event.id));
        setSelectedCopyIds((prev) => prev.filter((id) => validIds.has(id)));
    }, [sourceEvents, selectedCopyIds.length]);

    const allSelected = sourceEvents.length > 0 && selectedCopyIds.length === sourceEvents.length;
    const canTransfer = !isReadOnly && selectedCopyIds.length > 0 && effectiveTargetDates.length > 0;
    const canPostpone = !isReadOnly && selectedCopyIds.length > 0;

    const toggleCopySelection = (id: string) => {
        setSelectedCopyIds((prev) => (
            prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]
        ));
    };

    const handleCopySelectAll = () => {
        if (sourceEvents.length === 0) return;
        setSelectedCopyIds(allSelected ? [] : sourceEvents.map((event) => event.id));
    };

    const handleTransferEvents = async () => {
        if (!canTransfer || !copySourceDate) return;
        const selectedEvents = sourceEvents.filter((event) => selectedCopyIds.includes(event.id));
        if (selectedEvents.length === 0) return;
        if (effectiveTargetDates.length === 0) return;
        if (transferMode === 'move') {
            const targetDate = effectiveTargetDates[0];
            if (!targetDate) return;
            for (const event of selectedEvents) {
                const chain: string[] = [];
                (event.originDates || []).forEach((origin) => {
                    if (origin && !chain.includes(origin)) {
                        chain.push(origin);
                    }
                });
                if (copySourceDate && !chain.includes(copySourceDate)) {
                    chain.push(copySourceDate);
                }
                if (!chain.includes(targetDate)) {
                    chain.push(targetDate);
                }
                await editEvent({ ...event, date: targetDate, originDates: chain.length > 0 ? chain : null });
            }
            setSelectedCopyIds([]);
            return;
        }
        const payload = effectiveTargetDates.flatMap((date) => (
            selectedEvents.map((event) => {
                const chain: string[] = [];
                (event.originDates || []).forEach((origin) => {
                    if (origin && !chain.includes(origin)) {
                        chain.push(origin);
                    }
                });
                if (copySourceDate && !chain.includes(copySourceDate)) {
                    chain.push(copySourceDate);
                }
                if (!chain.includes(date)) {
                    chain.push(date);
                }
                return {
                    title: event.title,
                    date,
                    startTime: event.startTime ?? null,
                    priority: event.priority ?? null,
                    link: event.link ?? null,
                    note: event.note ?? null,
                    completed: event.completed ? true : false,
                    failed: event.failed ? true : false,
                    originDates: chain.length > 0 ? chain : null,
                    wasPostponed: event.wasPostponed ? true : null
                };
            })
        ));
        const wasSaved = await addEventsBulk(payload);
        if (!wasSaved) return;
        setSelectedCopyIds([]);
    };

    const handlePostponeEvents = async () => {
        if (!canPostpone || !copySourceDate) return;
        const selectedEvents = sourceEvents.filter((event) => selectedCopyIds.includes(event.id));
        if (selectedEvents.length === 0) return;
        const payload = selectedEvents.map((event) => {
            const chain: string[] = [];
            (event.originDates || []).forEach((origin) => {
                if (origin && !chain.includes(origin)) {
                    chain.push(origin);
                }
            });
            if (copySourceDate && !chain.includes(copySourceDate)) {
                chain.push(copySourceDate);
            }
            return {
                title: event.title,
                startTime: event.startTime ?? null,
                priority: event.priority ?? null,
                link: event.link ?? null,
                note: event.note ?? null,
                completed: event.completed ? true : false,
                failed: event.failed ? true : false,
                originDates: chain.length > 0 ? chain : null,
                postponedView
            };
        });
        const wasSaved = await addPostponedEventsBulk(payload);
        if (!wasSaved) return;
        if (transferMode === 'move') {
            for (const event of selectedEvents) {
                await deleteEvent(event.id);
            }
        }
        setSelectedCopyIds([]);
    };

    const handleTargetDateChange = (value: string) => {
        setTargetDateInput(value);
        if (!value || value === copySourceDate) {
            setTargetDates([]);
            return;
        }
        setTargetDates([value]);
    };

    if (!hasSelection) return null;

    return (
        <div className="w-full board-panel p-5 mt-6 rounded-2xl">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div className="flex items-center gap-2">
                    <CalendarRange className="w-4 h-4 text-orange-500" />
                    <div className="text-sm font-medium text-stone-800 tracking-[0.15em] uppercase">Day Events Management</div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-sm font-mono text-orange-600">Window: {rangeLabel}</div>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-stone-500 uppercase">
                        <label htmlFor="range-order" className="tracking-[0.2em]">Order</label>
                        <select
                            id="range-order"
                            value={sortOrder}
                            onChange={(e) => setSortOrder(e.target.value as 'time' | 'priority')}
                            className="border border-orange-200 rounded-lg px-2 py-1 text-[11px] text-stone-600 bg-white"
                        >
                            <option value="time">Hour</option>
                            <option value="priority">Priority</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-stone-500 uppercase">
                        <label htmlFor="range-transfer" className="tracking-[0.2em]">Action</label>
                        <select
                            id="range-transfer"
                            value={transferMode}
                            onChange={(e) => setTransferMode(e.target.value as 'copy' | 'move')}
                            className="border border-orange-200 rounded-lg px-2 py-1 text-[11px] text-stone-600 bg-white"
                        >
                            <option value="copy">Copy</option>
                            <option value="move">Move</option>
                        </select>
                    </div>
                </div>
            </div>
            <div className="mb-5 border border-orange-200 bg-white rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="text-[10px] font-mono text-stone-500 uppercase tracking-[0.3em]">Day Events Management</div>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-stone-500 uppercase">
                        <label htmlFor="range-copy-source" className="tracking-[0.2em]">Source</label>
                        <select
                            id="range-copy-source"
                            value={copySourceDate}
                            onChange={(e) => {
                                setCopySourceDate(e.target.value);
                                setSelectedCopyIds([]);
                            }}
                            disabled={isReadOnly}
                            className="border border-orange-200 rounded-lg px-2 py-1 text-[11px] text-stone-600 bg-white disabled:opacity-60"
                        >
                            {days.map((day) => {
                                const key = formatDate(day);
                                return (
                                    <option key={key} value={key}>
                                        {key}
                                    </option>
                                );
                            })}
                        </select>
                    </div>
                </div>
                <div className="mt-3 flex flex-col gap-2">
                    {sourceEvents.length === 0 ? (
                        <div className="text-xs text-stone-400 font-mono">
                            No events to manage for the selected day.
                        </div>
                    ) : (
                        sourceEvents.map((event) => (
                            <label
                                key={event.id}
                                className={clsx(
                                    'board-card flex items-center gap-3 px-3 py-2 rounded-xl transition-colors',
                                    event.completed && 'board-card-completed',
                                    event.failed && 'board-card-failed',
                                    !event.completed && !event.failed && 'hover:border-orange-300'
                                )}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedCopyIds.includes(event.id)}
                                    onChange={() => toggleCopySelection(event.id)}
                                    disabled={isReadOnly}
                                    className="h-4 w-4 accent-orange-500 disabled:opacity-60"
                                />
                                <div className="flex-1 min-w-0">
                                    <div
                                        className={clsx(
                                            'text-sm font-medium truncate',
                                            event.failed
                                                ? 'text-red-700 dark:text-red-300'
                                                : event.completed ? 'text-emerald-700 dark:text-emerald-300' : 'text-stone-700',
                                            (event.completed || event.failed) && 'opacity-90'
                                        )}
                                    >
                                        {event.title}
                                    </div>
                                    <div
                                        className={clsx(
                                            'text-[11px] font-mono truncate',
                                            event.failed
                                                ? 'text-red-700/80 dark:text-red-300/80'
                                                : event.completed ? 'text-emerald-700/80 dark:text-emerald-300/80' : 'text-stone-500'
                                        )}
                                    >
                                        {(event.startTime && event.startTime.trim() !== '' ? event.startTime : '--:--')} · {event.priority !== null && event.priority !== undefined ? `P${event.priority}` : '--'}
                                    </div>
                                </div>
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
                            </label>
                        ))
                    )}
                </div>
                <div className="mt-4 border-t border-orange-100 pt-4">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="text-[10px] font-mono text-stone-500 uppercase tracking-[0.3em]">Target</div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input
                            type="date"
                            value={targetDateInput}
                            onChange={(e) => handleTargetDateChange(e.target.value)}
                            disabled={isReadOnly}
                            className="border border-orange-200 rounded-lg px-3 py-2 text-sm text-stone-600 bg-white disabled:opacity-60"
                        />
                        <div className="flex items-center gap-2 text-[10px] font-mono text-stone-500 uppercase">
                            <label htmlFor="postponed-view" className="tracking-[0.2em]">Postponed View</label>
                            <select
                                id="postponed-view"
                                value={postponedView}
                                onChange={(e) => setPostponedView(e.target.value as PostponedEventDomain)}
                                disabled={isReadOnly}
                                className="border border-orange-200 rounded-lg px-2 py-1 text-[11px] text-stone-600 bg-white disabled:opacity-60"
                            >
                                {POSTPONED_EVENT_DOMAINS.map((domain) => (
                                    <option key={domain.value} value={domain.value}>{domain.selectLabel}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
                <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={handleCopySelectAll}
                        disabled={isReadOnly || sourceEvents.length === 0}
                        className="px-3 py-1.5 text-[11px] font-mono border border-orange-200 rounded-lg text-stone-500 hover:text-stone-700 hover:border-orange-400 disabled:opacity-50"
                    >
                        {allSelected ? 'None' : 'All'}
                    </button>
                    <div className="text-[10px] font-mono text-stone-500 uppercase tracking-widest">
                        Selected {selectedCopyIds.length}
                    </div>
                    <button
                        type="button"
                        onClick={handleTransferEvents}
                        disabled={!canTransfer}
                        className="px-4 py-2 bg-orange-400 text-white text-xs font-mono font-bold hover:bg-orange-500 transition-colors rounded-lg disabled:opacity-50"
                    >
                        {transferMode === 'move' ? 'Move Selected' : 'Copy Selected'}
                    </button>
                    <button
                        type="button"
                        onClick={handlePostponeEvents}
                        disabled={!canPostpone}
                        className="px-4 py-2 bg-stone-700 text-white text-xs font-mono font-bold hover:bg-stone-800 transition-colors rounded-lg disabled:opacity-50"
                    >
                        {transferMode === 'move' ? 'Move to Postponed' : 'Copy to Postponed'}
                    </button>
                </div>
            </div>
        </div>
    );
};
