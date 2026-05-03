import React, { useState, useEffect } from 'react';
import { MonthGrid } from './MonthGrid';
import { useCalendarStore } from '../../store/calendarStore';
import { getNextMonth, getPrevMonth, formatDate } from '../../utils/dateUtils';
import { ChevronLeft, ChevronRight, Compass } from 'lucide-react';
import { DayModal } from './DayModal';
import { DayConfigModal } from './DayConfigModal';

export const CalendarView: React.FC = () => {
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
        navigateToDayAdministration
    } = useCalendarStore();
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionStart, setSelectionStart] = useState<Date | null>(null);
    const [isConfigOpen, setIsConfigOpen] = useState(false); // New state
    const [hoverDate, setHoverDate] = useState<Date | null>(null);
    const [modalDate, setModalDate] = useState<Date | null>(null);

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
            setSelectionActive(false);
            setIsSelecting(false);
            setSelectionStart(null);
            setHoverDate(null);
        };
        window.addEventListener('mouseup', handleMouseUp);
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, [isSelecting, selectionStart, hoverDate, setSelection, setSelectionActive]);

    const handleDateClick = (date: Date) => {
        setIsSelecting(true);
        setSelectionActive(true);
        setSelectionStart(date);
        setHoverDate(date);
        setSelection(date, date);
    };

    const handleDateEnter = (date: Date) => {
        if (isSelecting && selectionStart) {
            setHoverDate(date);
            setSelection(selectionStart, date);
        }
    };

    const handleDateDoubleClick = (date: Date) => {
        setModalDate(date);
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

    return (
        <div className="flex flex-col w-full max-w-[1600px] mx-auto p-4 sm:p-8">
            {/* Technical Header Block */}
            <div className="console-banner border border-orange-200 bg-white/80 backdrop-blur-xl p-6 mb-8 relative overflow-hidden rounded-2xl shadow-xl shadow-orange-100/50">
                <div className="absolute top-0 left-0 w-20 h-20 border-r border-b border-orange-200"></div>
                <div className="absolute bottom-0 right-0 w-20 h-20 border-l border-t border-orange-200"></div>

                <div className="flex items-center justify-between relative z-10 flex-wrap gap-4">
                    <div className="flex items-center gap-6">
                        <div className="p-4 border-2 border-orange-400 rounded-full bg-gradient-to-br from-orange-50 to-amber-50">
                            <Compass className="w-8 h-8 text-orange-500" />
                        </div>
                        <div>
                            <div className="text-[10px] font-mono text-stone-500 tracking-[0.3em] mb-1">SYSTEM: CHRONOS</div>
                            <h1 className="text-3xl sm:text-4xl text-stone-800 tracking-widest font-serif">
                                TEMPORAL <span className="text-orange-500">MATRIX</span>
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
                                {useCalendarStore.getState().compareMode ? 'Matches' : 'Compare'}
                            </button>
                        )}

                        <div className="hidden md:block text-right mr-4">
                            <div className="text-[10px] font-mono text-stone-500">COORDINATES</div>
                            <div className="text-sm font-mono text-orange-600 font-medium">
                                {viewDate.getFullYear()}.{String(viewDate.getMonth() + 1).padStart(2, '0')}
                            </div>
                        </div>

                        <div className="flex border-2 border-orange-300 rounded-xl overflow-hidden bg-white shadow-sm">
                            <button onClick={handlePrev} className="p-3 hover:bg-orange-50 border-r border-orange-200 transition-colors">
                                <ChevronLeft className="w-5 h-5 text-orange-500" />
                            </button>
                            <button onClick={handleNext} className="p-3 hover:bg-orange-50 transition-colors">
                                <ChevronRight className="w-5 h-5 text-orange-500" />
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
                        Postponed events
                    </button>
                </div>
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
                    />
                ))}
            </div>

            {/* Day Detail Modal */}
            {modalDate && (
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
            // AWAITING INPUT VECTOR // INITIATE DRAG SEQUENCE
                    </span>
                </div>
            )}

        </div>
    );
};
