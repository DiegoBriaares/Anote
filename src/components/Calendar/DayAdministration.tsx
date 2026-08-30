import React from 'react';
import { EventBoard } from './EventBoard';
import { RangeBoard } from './RangeBoard';
import { DayEventsInformation } from './DayEventsInformation';
import { useTranslation } from '../../i18n/languageContext';

interface DayAdministrationProps {
    activeDate: Date | null;
}

export const DayAdministration: React.FC<DayAdministrationProps> = ({ activeDate }) => {
    const { text } = useTranslation();

    if (!activeDate) return null;

    return (
        <div className="mt-8">
            <div className="mb-6">
                <div className="text-2xl text-stone-800 tracking-[0.2em]">{text.calendar.dayAdministration}</div>
            </div>
            <EventBoard selectedDate={activeDate} />
            <DayEventsInformation activeDate={activeDate} />
            <RangeBoard key={activeDate.toISOString()} activeDate={activeDate} />
        </div>
    );
};
