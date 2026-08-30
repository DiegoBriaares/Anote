import { apiData, apiRequest, jsonBody } from './client';
import { parseList, parseProgram, parseProgramRun, type ProgramRun } from './contracts';

export type ProgramInput = {
    name: string;
    enabled: boolean;
    activationTime: string;
    targetDayOffset: number;
    timeZone: string;
};

export type ProgramNotificationPage = {
    message?: 'success';
    data: ProgramRun[];
};

export const programsApi = {
    list: async () => parseList(await apiData<unknown>('/programs'), parseProgram),
    create: async (program: ProgramInput) => parseProgram(await apiData<unknown>('/programs', {
        method: 'POST',
        body: jsonBody(program)
    })),
    update: async (id: string, revision: number, patch: Partial<ProgramInput>) => parseProgram(await apiData<unknown>(`/programs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: jsonBody({ ...patch, revision })
    })),
    updateMany: async (programs: Array<ProgramInput & { id: string; revision: number }>) => parseList(await apiData<unknown>('/programs', {
        method: 'PUT',
        body: jsonBody({ programs })
    }), parseProgram),
    remove: (id: string, revision: number) => apiRequest<{ message: 'success' }>(`/programs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: jsonBody({ revision })
    }),
    run: async (id: string, revision: number) => parseProgramRun(await apiData<unknown>(`/programs/${encodeURIComponent(id)}/run`, {
        method: 'POST',
        body: jsonBody({ revision })
    })),
    notifications: async () => {
        const response = await apiRequest<ProgramNotificationPage>('/programs/run-notifications');
        return { ...response, data: parseList(response.data, parseProgramRun) };
    },
    completeNotifications: (runIds: string[]) => apiRequest<{ message: 'success' }>('/programs/run-notifications/complete', {
        method: 'POST',
        body: jsonBody({ runIds })
    })
};
