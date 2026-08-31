import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CalendarRange, CornerDownLeft } from 'lucide-react';
import { useCalendarStore } from '../../store/calendarStore';
import { PostponedEventBoard } from './PostponedEventBoard';
import { PostponedEventsInformation } from './PostponedEventsInformation';
import { PostponedRangeBoard } from './PostponedRangeBoard';
import { DEFAULT_POSTPONED_EVENT_DOMAIN, type PostponedEventDomain } from '../../utils/postponedDomains';
import { useTranslation } from '../../i18n/languageContext';

export const PostponedEventsView: React.FC = () => {
    const { fetchPostponedEvents, navigateToCalendar } = useCalendarStore(useShallow((state) => ({
        fetchPostponedEvents: state.fetchPostponedEvents,
        navigateToCalendar: state.navigateToCalendar
    })));
    const [postponedView, setPostponedView] = useState<PostponedEventDomain>(DEFAULT_POSTPONED_EVENT_DOMAIN);
    const { text } = useTranslation();

    useEffect(() => {
        fetchPostponedEvents();
    }, [fetchPostponedEvents]);

    return (
        <div className="flex flex-col w-full max-w-[1600px] mx-auto p-4 sm:p-8">
            <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
                <div>
                    <div className="text-[10px] font-mono text-stone-500 tracking-[0.3em] uppercase mb-2">{text.calendar.postponedEvents}</div>
                    <div className="text-2xl text-stone-800 tracking-[0.2em]">{text.common.administration}</div>
                </div>
                <button
                    type="button"
                    onClick={navigateToCalendar}
                    className="flex items-center gap-2 px-4 py-2 bg-white/80 border border-orange-200 hover:bg-orange-50 hover:border-orange-400 transition-all rounded-xl shadow-sm text-sm font-medium text-stone-600"
                >
                    <CornerDownLeft className="w-4 h-4 text-orange-500" aria-hidden="true" />
                    {text.common.backToCalendar}
                </button>
            </div>

            <div className="w-full board-panel p-4 rounded-2xl mb-6">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                        <CalendarRange className="w-4 h-4 text-orange-500" aria-hidden="true" />
                        <span className="text-[11px] font-mono text-stone-500 uppercase tracking-[0.25em]">{text.calendar.postponedVault}</span>
                    </div>
                </div>
            </div>

            <PostponedEventBoard postponedView={postponedView} onViewChange={setPostponedView} />
            <PostponedEventsInformation postponedView={postponedView} />
            <PostponedRangeBoard postponedView={postponedView} />
        </div>
    );
};
