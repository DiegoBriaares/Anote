import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useCalendarStore, type Role, type Subrole } from '../../store/calendarStore';
import { interpolateText } from '../../i18n/appText';
import { X, Clock, StickyNote, Link as LinkIcon, Settings, CheckCircle2, CircleX } from 'lucide-react';
import type { CalendarEvent } from '../../store/calendarStore';
import { RolesModal } from './RolesModal';
import { SubrolesModal } from './SubrolesModal';
import clsx from 'clsx';
import { useTranslation } from '../../i18n/languageContext';

const NoteEnvironment = React.lazy(() => import('./NoteEnvironment').then((module) => ({ default: module.NoteEnvironment })));

interface DayModalProps {
    date: Date;
    events: CalendarEvent[];
    onClose: () => void;
    onUpdateEvent: (event: CalendarEvent) => void;
    onConfigure: () => void;
    onAdminister: () => void;
}

const DayEventsAdministrationIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
    >
        <rect x="3.5" y="4.25" width="17" height="4.25" rx="1.1" />
        <rect x="3.5" y="9.9" width="17" height="4.25" rx="1.1" />
        <rect x="3.5" y="15.55" width="17" height="4.25" rx="1.1" />
        <circle cx="7" cy="6.35" r="0.7" fill="currentColor" stroke="none" />
        <path d="M6.4 12.05h1.2M7 11.45v1.2" />
        <path d="M6.25 17.7l0.55 0.55l1.05-1.2" />
        <path d="M10 6.35h6.6M10 12.05h6.6M10 17.65h6.6" />
    </svg>
);

export const DayModal: React.FC<DayModalProps> = ({ date, events, onClose, onConfigure, onAdminister }) => {
    const { viewMode, subroles, fetchSubroles } = useCalendarStore();
    const { language, text } = useTranslation();
    const statusText = text.eventStatus;
    const [sortOrder, setSortOrder] = useState<'time' | 'priority'>('time');

    // State for Note/Roles Flow
    const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
    const [selectedRole, setSelectedRole] = useState<Role | null>(null);
    const [selectedSubrole, setSelectedSubrole] = useState<Subrole | null>(null);
    const [showRolesModal, setShowRolesModal] = useState(false);
    const [showSubrolesModal, setShowSubrolesModal] = useState(false);
    const [showNoteEnv, setShowNoteEnv] = useState(false);
    const titleId = useId();
    const closeRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeRef.current?.focus();
        return () => previous?.focus();
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (showRolesModal || showSubrolesModal || showNoteEnv) return;
            if (event.key === 'Escape') onClose();
            if (event.key !== 'Tab') return;
            const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
            );
            if (!controls?.length) return;
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose, showNoteEnv, showRolesModal, showSubrolesModal]);

    const dayEvents = useMemo(() => {
        const priorityValue = (value?: number | null) => {
            if (value === null || value === undefined) return Number.MAX_SAFE_INTEGER;
            return value;
        };
        return [...events].sort((a, b) => {
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
    }, [events, sortOrder]);

    const getMetaLabel = (event: CalendarEvent) => {
        const timeLabel = event.startTime && event.startTime.trim() !== '' ? event.startTime : '--:--';
        const priorityLabel = event.priority !== null && event.priority !== undefined ? `P${event.priority}` : '--';
        return `${timeLabel} · ${priorityLabel}`;
    };

    const handleEventClick = (event: CalendarEvent) => {
        if (viewMode === 'friend') return; // Read-only for friends
        setSelectedEvent(event);
        setShowRolesModal(true);
    };

    const handleRoleSelect = async (role: Role) => {
        setSelectedRole(role);
        setShowRolesModal(false);
        let roleSubroles = subroles.filter(sub => sub.role_id === role.id);
        if (roleSubroles.length === 0) {
            await fetchSubroles();
            roleSubroles = useCalendarStore.getState().subroles.filter(sub => sub.role_id === role.id);
        }
        if (roleSubroles.length > 0) {
            setShowSubrolesModal(true);
            return;
        }
        setSelectedSubrole(null);
        setShowNoteEnv(true);
    };

    const handleSubroleSelect = (subrole: Subrole) => {
        setSelectedSubrole(subrole);
        setShowSubrolesModal(false);
        setShowNoteEnv(true);
    };

    const activeRole = selectedSubrole ?? selectedRole;

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                <div
                    ref={dialogRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                    className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col relative"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="p-6 pb-4 border-b border-orange-100 bg-orange-50/30 flex justify-between items-start gap-3 flex-wrap">
                        <div>
                            <div className="text-xs font-mono text-orange-500 uppercase tracking-widest mb-1">{text.calendar.selectedDayLabel}</div>
                            <h2 id={titleId} className="text-3xl font-bold text-stone-800 font-display">
                                {new Intl.DateTimeFormat(language, { dateStyle: 'full' }).format(date)}
                            </h2>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-mono text-stone-400 uppercase">
                            <label htmlFor="day-modal-order" className="tracking-[0.2em]">{text.common.order}</label>
                            <select
                                id="day-modal-order"
                                value={sortOrder}
                                onChange={(e) => setSortOrder(e.target.value as 'time' | 'priority')}
                                className="border border-orange-200 rounded-lg px-2 py-1 text-[11px] text-stone-600 bg-white"
                            >
                                <option value="time">{text.common.hour}</option>
                                <option value="priority">{text.common.priority}</option>
                            </select>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={onAdminister}
                                className="p-2 text-stone-400 hover:text-orange-500 hover:bg-orange-100 rounded-full transition-all"
                                title={interpolateText(text.calendar.openDayAdministration, { date: new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(date) })}
                                aria-label={interpolateText(text.calendar.openDayAdministration, { date: new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(date) })}
                            >
                                <DayEventsAdministrationIcon className="w-5 h-5" />
                            </button>
                            <button
                                type="button"
                                onClick={onConfigure}
                                className="p-2 text-stone-400 hover:text-orange-500 hover:bg-orange-100 rounded-full transition-all"
                                title={interpolateText(text.calendar.configureDay, { date: new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(date) })}
                                aria-label={interpolateText(text.calendar.configureDay, { date: new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(date) })}
                            >
                                <Settings className="w-5 h-5" />
                            </button>
                            <button
                                ref={closeRef}
                                type="button"
                                onClick={onClose}
                                aria-label={text.calendar.closeDay}
                                className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-all"
                            >
                                <X className="w-6 h-6" aria-hidden="true" />
                            </button>
                        </div>
                    </div>

                    <div className="max-h-[50vh] overflow-y-auto p-4 flex flex-col gap-3">
                        {dayEvents.length === 0 && (
                            <div className="text-sm font-mono text-stone-500 p-4 text-center">{text.common.noEvents}</div>
                        )}
                        {dayEvents.map((ev) => (
                            <div
                                key={ev.id}
                                className={clsx(
                                    'board-card flex flex-col gap-2',
                                    ev.completed && 'board-card-completed',
                                    ev.failed && 'board-card-failed',
                                    viewMode !== 'friend' && 'cursor-pointer hover:border-orange-300 hover:shadow-md transition-all'
                                )}
                                onClick={() => handleEventClick(ev)}
                                onKeyDown={(event) => {
                                    if (viewMode === 'friend' || (event.key !== 'Enter' && event.key !== ' ')) return;
                                    event.preventDefault();
                                    handleEventClick(ev);
                                }}
                                role={viewMode === 'friend' ? undefined : 'button'}
                                tabIndex={viewMode === 'friend' ? undefined : 0}
                                aria-label={viewMode === 'friend' ? undefined : interpolateText(text.calendar.editEvent, { name: ev.title })}
                            >
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <div
                                        className={clsx(
                                            'text-sm font-medium',
                                            ev.failed
                                                ? 'text-red-700 dark:text-red-300'
                                                : ev.completed ? 'text-emerald-700 dark:text-emerald-300' : 'text-stone-800 dark:text-slate-100',
                                            (ev.completed || ev.failed) && 'opacity-90'
                                        )}
                                    >
                                        {ev.title}
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px] text-stone-500">
                                        <span className={clsx(
                                            'pill-soft flex items-center gap-1',
                                            ev.completed && 'text-emerald-700/80 dark:text-emerald-300/80',
                                            ev.failed && 'text-red-700/80 dark:text-red-300/80'
                                        )}>
                                            <Clock className="w-3 h-3 text-orange-600" aria-hidden="true" /> {getMetaLabel(ev)}
                                        </span>
                                        {ev.completed && (
                                            <span className="pill-soft status-pill-completed flex items-center gap-1 text-[10px] uppercase tracking-[0.2em]">
                                                <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> {statusText.completed}
                                            </span>
                                        )}
                                        {ev.failed && (
                                            <span className="pill-soft status-pill-failed flex items-center gap-1 text-[10px] uppercase tracking-[0.2em]">
                                                <CircleX className="w-3 h-3" aria-hidden="true" /> {statusText.failed}
                                            </span>
                                        )}
                                        {viewMode === 'friend' && (
                                            <span className="pill-soft text-[10px] uppercase">{text.common.readOnly}</span>
                                        )}
                                    </div>
                                </div>
                                {ev.note && (
                                    <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-slate-300">
                                        <StickyNote className="w-3 h-3 text-amber-500" aria-hidden="true" /> {ev.note}
                                    </div>
                                )}
                                {ev.link && (
                                    <a href={ev.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 underline">
                                        <LinkIcon className="w-3 h-3" aria-hidden="true" /> {ev.link}
                                    </a>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Modals */}
            <RolesModal
                isOpen={showRolesModal}
                onClose={() => setShowRolesModal(false)}
                onSelectRole={handleRoleSelect}
            />

            <SubrolesModal
                isOpen={showSubrolesModal}
                role={selectedRole}
                subroles={subroles.filter(sub => sub.role_id === selectedRole?.id)}
                onClose={() => setShowSubrolesModal(false)}
                onBack={() => {
                    setShowSubrolesModal(false);
                    setShowRolesModal(true);
                }}
                onSelectSubrole={handleSubroleSelect}
            />

            {selectedEvent && activeRole && (
                <React.Suspense fallback={showNoteEnv ? <div role="status" className="fixed inset-0 z-[70] flex items-center justify-center bg-white text-sm text-stone-600">{text.notes.loadingEditor}</div> : null}>
                    <NoteEnvironment
                        isOpen={showNoteEnv}
                        onClose={() => setShowNoteEnv(false)}
                        event={selectedEvent}
                        role={activeRole}
                    />
                </React.Suspense>
            )}
        </>
    );
};
