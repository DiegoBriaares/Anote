import { ApiError } from '../../api/client';
import { programsApi } from '../../api/programs';
import { getApiErrorText, getAppText } from '../../i18n/appText';
import { storage } from '../../utils/storage';

import type { CalendarState } from '../calendarStore';
import type { OwnerContext } from './types';

type ProgramsOwner = Pick<CalendarState,
    'fetchPrograms' | 'savePrograms' | 'createProgram' | 'updateProgram' | 'deleteProgram' |
    'runProgram' | 'pollProgramRunNotifications' | 'clearProgramExecutionNotice'
>;

const publishExecutionNotice = (
    set: OwnerContext['set'],
    name: string,
    movedEventCount: number
) => {
    const notice = { name, movedEventCount };
    let reloadRequested = false;
    try {
        storage.setItem('program-execution-notice', JSON.stringify(notice));
        reloadRequested = true;
    } catch {
        // Keep the committed result visible in memory when persistence is unavailable.
    }
    set({ programExecutionNotice: notice, programPageReloadRequested: reloadRequested });
};

const actionError = (error: unknown) => error instanceof ApiError
    ? getApiErrorText(error.code)
    : getAppText().serviceUnavailable;

const handleSessionError = (error: unknown, logoutAndReset: OwnerContext['logoutAndReset']) => {
    if (error instanceof ApiError && error.status === 401) {
        logoutAndReset();
        return true;
    }
    return false;
};

export const createProgramsOwner = ({ set, get, logoutAndReset }: OwnerContext): ProgramsOwner => ({
    fetchPrograms: async () => {
        if (!get().user) return;
        try {
            set({ programs: await programsApi.list() });
        } catch (error) {
            if (!handleSessionError(error, logoutAndReset)) set({ actionError: actionError(error) });
        }
    },

    savePrograms: async (programs) => {
        if (programs.length === 0) return true;
        try {
            const updated = await programsApi.updateMany(programs.map((program) => ({
                id: program.id,
                revision: program.revision,
                name: program.name,
                enabled: program.enabled,
                activationTime: program.activationTime,
                targetDayOffset: program.targetDayOffset,
                timeZone: program.timeZone
            })));
            set({ programs: updated, actionError: null });
            return true;
        } catch (error) {
            if (handleSessionError(error, logoutAndReset)) return false;
            set({ actionError: actionError(error) });
            await get().fetchPrograms();
            return false;
        }
    },

    createProgram: async (program) => {
        try {
            const created = await programsApi.create(program);
            set((state) => ({ programs: [...state.programs, created] }));
            return created;
        } catch (error) {
            if (!handleSessionError(error, logoutAndReset)) set({ actionError: actionError(error) });
            return null;
        }
    },

    updateProgram: async (id, revision, patch) => {
        try {
            const updated = await programsApi.update(id, revision, patch);
            set((state) => ({
                programs: state.programs.map((program) => program.id === id ? updated : program)
            }));
            return updated;
        } catch (error) {
            if (!handleSessionError(error, logoutAndReset)) set({ actionError: actionError(error) });
            return null;
        }
    },

    deleteProgram: async (id, revision) => {
        try {
            await programsApi.remove(id, revision);
            set((state) => ({ programs: state.programs.filter((program) => program.id !== id) }));
            return true;
        } catch (error) {
            if (!handleSessionError(error, logoutAndReset)) set({ actionError: actionError(error) });
            return false;
        }
    },

    runProgram: async (id, revision) => {
        try {
            const programName = get().programs.find((program) => program.id === id)?.name
                || getAppText().programs.defaultName;
            const run = await programsApi.run(id, revision);
            set({ lastProgramRun: run });
            await Promise.all([get().fetchEvents(), get().fetchPrograms()]);
            publishExecutionNotice(set, programName, run.movedEventCount);
            return run;
        } catch (error) {
            if (!handleSessionError(error, logoutAndReset)) set({ actionError: actionError(error) });
            return null;
        }
    },

    pollProgramRunNotifications: async () => {
        if (!get().user) return;
        try {
            const page = await programsApi.notifications();
            const automaticRuns = page.data.filter((run) => run.automatic);
            if (automaticRuns.length === 0) return;
            const latestRun = automaticRuns[automaticRuns.length - 1];
            const programName = get().programs.find((program) => program.id === latestRun.programId)?.name
                || getAppText().programs.defaultName;
            await programsApi.completeNotifications(automaticRuns.map((run) => run.id));
            publishExecutionNotice(set, programName, latestRun.movedEventCount);
        } catch (error) {
            handleSessionError(error, logoutAndReset);
        }
    },

    clearProgramExecutionNotice: () => {
        try {
            storage.removeItem('program-execution-notice');
        } catch {
            // The in-memory notice is still cleared.
        }
        set({ programExecutionNotice: null, programPageReloadRequested: false });
    }
});
