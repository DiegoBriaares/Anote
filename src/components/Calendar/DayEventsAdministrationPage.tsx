import React, { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { useCalendarStore } from '../../store/calendarStore';
import { parseDateKey } from '../../utils/dateUtils';
import { DayAdministration } from './DayAdministration';
import { useTranslation } from '../../i18n/languageContext';

export const DayEventsAdministrationPage: React.FC = () => {
    const { language, text } = useTranslation();
    const {
        dayAdministrationDate,
        navigateToCalendar,
        fetchEvents,
        fetchFriendEvents,
        viewMode,
        viewingUserId,
        viewingUsername
    } = useCalendarStore(useShallow((state) => ({
        dayAdministrationDate: state.dayAdministrationDate,
        navigateToCalendar: state.navigateToCalendar,
        fetchEvents: state.fetchEvents,
        fetchFriendEvents: state.fetchFriendEvents,
        viewMode: state.viewMode,
        viewingUserId: state.viewingUserId,
        viewingUsername: state.viewingUsername
    })));

    const activeDate = useMemo(() => (
        dayAdministrationDate ? parseDateKey(dayAdministrationDate) : null
    ), [dayAdministrationDate]);

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

    return (
        <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8">
            <div className="console-banner border border-orange-200 bg-white/80 backdrop-blur-xl p-6 mb-8 relative overflow-hidden rounded-2xl shadow-xl shadow-orange-100/50">
                <div className="absolute top-0 left-0 w-20 h-20 border-r border-b border-orange-200"></div>
                <div className="absolute bottom-0 right-0 w-20 h-20 border-l border-t border-orange-200"></div>

                <div className="relative z-10 flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4">
                        <div className="p-3 border-2 border-orange-400 rounded-full bg-gradient-to-br from-orange-50 to-amber-50">
                            <CalendarDays className="w-7 h-7 text-orange-500" />
                        </div>
                        <div>
                            <div className="text-[10px] font-mono text-stone-500 tracking-[0.3em] mb-1 uppercase">
                                {text.calendar.eventsAdministration}
                            </div>
                            <h1 className="text-2xl sm:text-3xl text-stone-800 tracking-widest font-serif">
                                {activeDate ? new Intl.DateTimeFormat(language, { dateStyle: 'full' }).format(activeDate) : text.calendar.selectCalendarDay}
                            </h1>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={navigateToCalendar}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white/80 border border-orange-200 hover:bg-orange-50 hover:border-orange-400 transition-all rounded-xl shadow-sm text-sm font-medium text-stone-600 uppercase tracking-wider"
                    >
                        <ArrowLeft className="w-4 h-4 text-orange-500" aria-hidden="true" />
                        {text.common.backToCalendar}
                    </button>
                </div>
            </div>

            {activeDate ? (
                <DayAdministration activeDate={activeDate} />
            ) : (
                <div className="board-panel p-6 rounded-2xl text-sm font-mono text-stone-500">
                    {text.calendar.openDayHelp}
                </div>
            )}
        </div>
    );
};
