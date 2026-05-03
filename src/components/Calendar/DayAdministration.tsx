import React from 'react';
import { EventBoard } from './EventBoard';
import { RangeBoard } from './RangeBoard';
import { DayEventsInformation } from './DayEventsInformation';

interface DayAdministrationProps {
    activeDate: Date | null;
}

export const DayAdministration: React.FC<DayAdministrationProps> = ({ activeDate }) => {
    const [showManagement, setShowManagement] = React.useState(false);

    React.useEffect(() => {
        setShowManagement(false);
        const timeoutId = window.setTimeout(() => setShowManagement(true), 0);
        return () => window.clearTimeout(timeoutId);
    }, [activeDate]);

    if (!activeDate) return null;

    return (
        <div className="mt-8">
            <div className="mb-6">
                <div className="text-2xl text-stone-800 tracking-[0.2em]">Administration</div>
            </div>
            <EventBoard selectedDate={activeDate} />
            <DayEventsInformation activeDate={activeDate} />
            {showManagement ? <RangeBoard activeDate={activeDate} /> : null}
        </div>
    );
};
