import type { PostponedEventDomain } from '../utils/postponedDomains';
import { getAppText } from '../i18n/appText';
import { ApiError } from './client';

export type UserPreferences = {
    backgroundUrl?: string;
    accentColor?: string;
    noiseOverlay?: boolean;
    theme?: 'light' | 'dark';
    language?: 'en' | 'es';
    _updatedAt?: number;
};

export type User = {
    id: string;
    username: string;
    avatarUrl?: string | null;
    avatar_url?: string | null;
    preferences?: UserPreferences;
    isAdmin?: boolean;
};

export type CalendarEvent = {
    id: string;
    title: string;
    date: string;
    startTime?: string | null;
    priority?: number | null;
    note?: string | null;
    link?: string | null;
    completed?: boolean | null;
    failed?: boolean | null;
    revision?: number | null;
    version?: number | null;
    unlockDate?: string | null;
    originDates?: string[] | null;
    wasPostponed?: boolean | null;
    postponedView?: PostponedEventDomain | null;
};

export type Program = {
    id: string;
    name: string;
    enabled: boolean;
    activationTime: string;
    targetDayOffset: number;
    timeZone: string;
    revision: number;
    nextRunAt?: string | null;
    lastRunAt?: string | null;
};

export type ProgramRun = {
    id: string;
    programId: string;
    sourceDate: string;
    targetDate: string;
    movedEventCount: number;
    executedAt: string;
    automatic: boolean;
};

export type SuccessEnvelope<T> = {
    message?: 'success';
    data: T;
    requestId?: string;
};

export type SessionResponse = {
    user: User;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : null
);

const contractError = () => new ApiError({
        code: 'INVALID_RESPONSE',
        message: getAppText().serviceUnavailable,
        status: 502
    });

const requireRecord = (value: unknown): UnknownRecord => {
    const record = asRecord(value);
    if (!record) throw contractError();
    return record;
};

const requiredString = (record: UnknownRecord, key: string): string => {
    const value = record[key];
    if (typeof value !== 'string' || value.trim() === '') throw contractError();
    return value;
};

const optionalString = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw contractError();
    return value;
};

const requiredInteger = (record: UnknownRecord, key: string) => {
    const value = record[key];
    if (!Number.isInteger(value)) throw contractError();
    return value as number;
};

const requiredBoolean = (record: UnknownRecord, key: string): boolean => {
    const value = record[key];
    if (typeof value !== 'boolean') throw contractError();
    return value;
};

export const parseUser = (value: unknown): User => {
    const record = requireRecord(value);
    const preferencesValue = record.preferences;
    if (preferencesValue !== undefined && preferencesValue !== null && !asRecord(preferencesValue)) throw contractError();
    const adminValue = record.isAdmin ?? record.is_admin;
    if (adminValue !== undefined && typeof adminValue !== 'boolean' && adminValue !== 0 && adminValue !== 1) throw contractError();
    return {
        id: requiredString(record, 'id'),
        username: requiredString(record, 'username'),
        avatarUrl: optionalString(record.avatarUrl ?? record.avatar_url),
        avatar_url: optionalString(record.avatar_url ?? record.avatarUrl),
        preferences: (preferencesValue || undefined) as UserPreferences | undefined,
        isAdmin: adminValue === undefined ? undefined : adminValue === true || adminValue === 1
    };
};

export const parseProgram = (value: unknown): Program => {
    const record = requireRecord(value);
    const activationTime = requiredString(record, 'activationTime');
    const timeZone = requiredString(record, 'timeZone');
    const targetDayOffset = requiredInteger(record, 'targetDayOffset');
    const revision = requiredInteger(record, 'revision');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(activationTime) || targetDayOffset < 0 || targetDayOffset > 365 || revision < 1) {
        throw contractError();
    }
    return {
        id: requiredString(record, 'id'),
        name: requiredString(record, 'name'),
        enabled: requiredBoolean(record, 'enabled'),
        activationTime,
        targetDayOffset,
        timeZone,
        revision,
        nextRunAt: optionalString(record.nextRunAt),
        lastRunAt: optionalString(record.lastRunAt)
    };
};

export const parseProgramRun = (value: unknown): ProgramRun => {
    const record = requireRecord(value);
    const movedEventCount = requiredInteger(record, 'movedEventCount');
    if (movedEventCount < 0) throw contractError();
    return {
        id: requiredString(record, 'id'),
        programId: requiredString(record, 'programId'),
        sourceDate: requiredString(record, 'sourceDate'),
        targetDate: requiredString(record, 'targetDate'),
        movedEventCount,
        executedAt: requiredString(record, 'executedAt'),
        automatic: requiredBoolean(record, 'automatic')
    };
};

export const parseList = <T>(value: unknown, parser: (entry: unknown) => T): T[] => {
    if (!Array.isArray(value)) throw contractError();
    return value.map(parser);
};

export const parseSessionResponse = (value: unknown): SessionResponse => {
    const record = requireRecord(value);
    return { user: parseUser(record.user) };
};
