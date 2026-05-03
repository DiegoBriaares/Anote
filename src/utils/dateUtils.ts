import {
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    format,
    isSameDay,
    isWithinInterval,
    addMonths,
    subMonths
} from 'date-fns';

export const getMonthGrid = (year: number, month: number) => {
    const startDate = startOfMonth(new Date(year, month));
    const endDate = endOfMonth(new Date(year, month));

    const startGrid = startOfWeek(startDate);
    const endGrid = endOfWeek(endDate);

    return eachDayOfInterval({ start: startGrid, end: endGrid });
};

export const isDateInRange = (date: Date, start: Date | null, end: Date | null) => {
    if (!start) return false;
    if (!end) return isSameDay(date, start);

    // Ensure start is before end for interval check
    const intervalStart = start < end ? start : end;
    const intervalEnd = start < end ? end : start;

    return isWithinInterval(date, { start: intervalStart, end: intervalEnd });
};

export const formatDate = (date: Date) => format(date, 'yyyy-MM-dd');
export const parseDateKey = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
};
export const formatFullDate = (date: Date) => format(date, 'EEEE, MMMM do, yyyy');
export const formatMonthYear = (date: Date) => format(date, 'MMMM yyyy');

export const getNextMonth = (year: number, month: number) => {
    const date = addMonths(new Date(year, month), 1);
    return { year: date.getFullYear(), month: date.getMonth() };
};

export const getPrevMonth = (year: number, month: number) => {
    const date = subMonths(new Date(year, month), 1);
    return { year: date.getFullYear(), month: date.getMonth() };
};
