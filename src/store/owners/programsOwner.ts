import { ApiError } from '../../api/client';
import { programsApi } from '../../api/programs';
import { getApiErrorText, getAppText, interpolateText } from '../../i18n/appText';

import type { CalendarState } from '../calendarStore';
import type { OwnerContext } from './types';

type ProgramsOwner = Pick<CalendarState,
    'fetchPrograms' | 'savePrograms' | 'createProgram' | 'updateProgram' | 'deleteProgram' |
    'runProgram' | 'pollProgramRunNotifications'
>;

const actionError = (error: unknown) => error instanceof ApiError
    ? getApiErrorText(error.code)
    : getAppText().serviceUnavailable;

export const createProgramsOwner = ({ set, get, logoutAndReset }: OwnerContext): ProgramsOwner => ({
    fetchPrograms: async () => {
        if (!get().user) return;
        try {
            set({ programs: await programsApi.list() });
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
            else set({ actionError: actionError(error) });
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
            set({ actionError: actionError(error) });
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
            set({ actionError: actionError(error) });
            return null;
        }
    },

    deleteProgram: async (id, revision) => {
        try {
            await programsApi.remove(id, revision);
            set((state) => ({ programs: state.programs.filter((program) => program.id !== id) }));
            return true;
        } catch (error) {
            set({ actionError: actionError(error) });
            return false;
        }
    },

    runProgram: async (id, revision) => {
        try {
            const run = await programsApi.run(id, revision);
            set({ lastProgramRun: run });
            await Promise.all([get().fetchEvents(), get().fetchPrograms()]);
            return run;
        } catch (error) {
            set({ actionError: actionError(error) });
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
            logoutAndReset(interpolateText(getAppText().programs.runCompleted, {
                name: programName,
                count: latestRun.movedEventCount
            }));
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) logoutAndReset();
        }
    }
});
