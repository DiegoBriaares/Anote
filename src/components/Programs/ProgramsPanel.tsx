import React, { useEffect, useMemo, useState } from 'react';
import { addDays } from 'date-fns';
import { ArrowLeft, Clock3, GitBranch, Play, Plus, Save, Trash2 } from 'lucide-react';
import { useCalendarStore, type Program } from '../../store/calendarStore';
import { formatDate, parseDateKey } from '../../utils/dateUtils';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type ProgramDraft = Program & {
    isDirty?: boolean;
};

const toDraft = (program: Program): ProgramDraft => ({ ...program, isDirty: false });

export const ProgramsPanel: React.FC = () => {
    const {
        programs,
        fetchProfile,
        savePrograms,
        setTomorrowProgramParameter,
        navigateToCalendar
    } = useCalendarStore();
    const [drafts, setDrafts] = useState<ProgramDraft[]>([]);
    const [message, setMessage] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [runProgramId, setRunProgramId] = useState('');
    const [runSourceDateKey, setRunSourceDateKey] = useState(() => formatDate(new Date()));
    const [runTargetDateKey, setRunTargetDateKey] = useState(() => formatDate(addDays(new Date(), 1)));
    const [runUsesCascadeOffset, setRunUsesCascadeOffset] = useState(false);

    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

    useEffect(() => {
        queueMicrotask(() => {
            setDrafts((current) => (
                current.some((program) => program.isDirty)
                    ? current
                    : programs.map(toDraft)
            ));
        });
    }, [programs]);

    useEffect(() => {
        if (drafts.length === 0) {
            setRunProgramId('');
            return;
        }

        if (!drafts.some((program) => program.id === runProgramId)) {
            setRunProgramId(drafts[0].id);
        }
    }, [drafts, runProgramId]);

    const hasInvalidTime = useMemo(() => (
        drafts.some((program) => !TIME_PATTERN.test(program.activationTime))
    ), [drafts]);

    const selectedRunProgram = useMemo(() => (
        drafts.find((program) => program.id === runProgramId) || drafts[0] || null
    ), [drafts, runProgramId]);

    const resolvedRunTargetDateKey = useMemo(() => {
        if (!runUsesCascadeOffset) return runTargetDateKey;
        const sourceDate = parseDateKey(runSourceDateKey);
        if (!sourceDate) return '';
        return formatDate(addDays(sourceDate, selectedRunProgram?.targetOffsetDays ?? 1));
    }, [runSourceDateKey, runTargetDateKey, runUsesCascadeOffset, selectedRunProgram]);

    const updateDraft = (id: string, patch: Partial<Program>) => {
        setDrafts((current) => current.map((program) => (
            program.id === id
                ? { ...program, ...patch, isDirty: true }
                : program
        )));
        setMessage(null);
    };

    const handleSave = async () => {
        if (hasInvalidTime) {
            setMessage('Use a valid 24-hour time between 00:00 and 23:59.');
            return;
        }

        setIsSaving(true);
        const nextPrograms = drafts.map((program) => ({
            id: program.id,
            name: program.name,
            activationTime: program.activationTime,
            isEnabled: program.isEnabled,
            tomorrowProgramParameter: program.tomorrowProgramParameter,
            targetOffsetDays: program.targetOffsetDays ?? 1
        }));
        await savePrograms(nextPrograms);
        setDrafts(nextPrograms.map(toDraft));
        setIsSaving(false);
        setMessage('Programs saved.');
    };

    const handleAdd = () => {
        setDrafts((current) => [
            ...current,
            {
                id: crypto.randomUUID(),
                name: 'To Tomorrow Program',
                activationTime: '00:00',
                isEnabled: false,
                tomorrowProgramParameter: false,
                targetOffsetDays: 1,
                isDirty: true
            }
        ]);
        setMessage(null);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this program?')) return;
        const nextPrograms = drafts
            .filter((program) => program.id !== id)
            .map((program) => ({
                id: program.id,
                name: program.name,
                activationTime: program.activationTime,
                isEnabled: program.isEnabled,
                tomorrowProgramParameter: program.tomorrowProgramParameter,
                targetOffsetDays: program.targetOffsetDays ?? 1
            }));
        await savePrograms(nextPrograms);
        setDrafts(nextPrograms.map(toDraft));
        setMessage('Program deleted.');
    };

    const handleRunNow = async () => {
        if (!runSourceDateKey || !resolvedRunTargetDateKey) return;
        setMessage(`Running ${selectedRunProgram?.name || 'program'}...`);
        const didRun = await setTomorrowProgramParameter(true, {
            sourceDateKeys: [runSourceDateKey],
            targetDateKey: resolvedRunTargetDateKey
        });
        setMessage(didRun ? `${selectedRunProgram?.name || 'Program'} completed.` : `${selectedRunProgram?.name || 'Program'} could not complete.`);
    };

    return (
        <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 mb-8">
            <button
                onClick={navigateToCalendar}
                className="mb-6 flex items-center gap-2 text-sm font-medium text-orange-600 hover:text-orange-700 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" /> BACK TO CALENDAR
            </button>

            <div className="border border-orange-200 bg-white/80 backdrop-blur-xl p-6 relative overflow-hidden rounded-2xl shadow-xl shadow-orange-100/50">
                <div className="absolute top-0 left-0 w-20 h-20 border-r border-b border-orange-200 pointer-events-none" />
                <div className="absolute bottom-0 right-0 w-20 h-20 border-l border-t border-orange-200 pointer-events-none" />

                <div className="flex items-start justify-between gap-8 relative z-10 flex-col lg:flex-row">
                    <div className="flex items-center gap-4">
                        <div className="p-3 border-2 border-orange-400 rounded-full bg-gradient-to-br from-orange-50 to-amber-50">
                            <Clock3 className="w-6 h-6 text-orange-500" />
                        </div>
                        <div>
                            <div className="text-[10px] font-mono text-stone-500 tracking-[0.3em] mb-1">PROGRAM CONTROL</div>
                            <h2 className="text-2xl text-stone-800 tracking-widest">PROGRAMS</h2>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                        <button
                            onClick={handleAdd}
                            className="px-4 py-2 bg-orange-100 text-orange-700 text-xs font-bold rounded-lg hover:bg-orange-200 transition-colors uppercase tracking-wider flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" /> Add Program
                        </button>
                    </div>
                </div>

                <div className="mt-10 border-y border-orange-100 bg-white/60 px-4 py-6 relative z-10 rounded-xl shadow-inner shadow-orange-50/70">
                    <div className="mb-4 flex items-center gap-3">
                        <div className="rounded-full border border-orange-200 bg-white p-2 text-orange-500">
                            <Play className="h-4 w-4" />
                        </div>
                        <div>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-orange-600">Manual Execution</div>
                            <h3 className="text-lg font-medium tracking-[0.08em] text-stone-800">Run Program Now</h3>
                        </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.2fr)_minmax(150px,0.8fr)_minmax(220px,1fr)_auto] lg:items-end">
                        <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-[0.18em] text-stone-500">
                            Program
                            <select
                                value={runProgramId}
                                onChange={(event) => setRunProgramId(event.target.value)}
                                className="h-10 rounded-lg border border-orange-200 bg-white px-3 text-sm font-sans normal-case tracking-normal text-stone-700 focus:border-orange-400 focus:outline-none"
                            >
                                {drafts.map((program) => (
                                    <option key={program.id} value={program.id}>{program.name}</option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-[0.18em] text-stone-500">
                            Run date
                            <input
                                type="date"
                                value={runSourceDateKey}
                                onChange={(event) => setRunSourceDateKey(event.target.value)}
                                className="h-10 rounded-lg border border-orange-200 bg-white px-3 text-sm font-sans normal-case tracking-normal text-stone-700 focus:border-orange-400 focus:outline-none"
                            />
                        </label>

                        <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-stone-500">
                                <input
                                    type="checkbox"
                                    checked={runUsesCascadeOffset}
                                    onChange={(event) => setRunUsesCascadeOffset(event.target.checked)}
                                    className="h-4 w-4 accent-orange-500"
                                />
                                <GitBranch className="h-3.5 w-3.5 text-orange-500" />
                                Cascade program offset
                            </label>
                            <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-[0.18em] text-stone-500">
                                {runUsesCascadeOffset ? 'Resolved target day' : 'Manual target day'}
                                <input
                                    type="date"
                                    value={resolvedRunTargetDateKey}
                                    onChange={(event) => setRunTargetDateKey(event.target.value)}
                                    disabled={runUsesCascadeOffset}
                                    className="h-10 rounded-lg border border-orange-200 bg-white px-3 text-sm font-sans normal-case tracking-normal text-stone-700 focus:border-orange-400 focus:outline-none disabled:bg-orange-50 disabled:text-stone-500"
                                />
                            </label>
                        </div>

                        <button
                            onClick={handleRunNow}
                            disabled={!runSourceDateKey || !resolvedRunTargetDateKey || !selectedRunProgram}
                            className="h-10 px-4 bg-white border border-orange-200 text-orange-700 text-xs font-bold rounded-lg hover:bg-orange-50 transition-colors uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Play className="w-4 h-4" /> Run Now
                        </button>
                    </div>
                </div>

                <div className="mt-12 relative z-10">
                    <div className="mb-4 flex items-center gap-3">
                        <div className="rounded-full border border-orange-200 bg-white p-2 text-orange-500">
                            <Clock3 className="h-4 w-4" />
                        </div>
                        <div>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-orange-600">Scheduled Automation</div>
                            <h3 className="text-lg font-medium tracking-[0.08em] text-stone-800">Program Definitions</h3>
                        </div>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-orange-100 bg-orange-50/40">
                    <table className="w-full min-w-[860px] text-left">
                        <thead className="bg-white/80 border-b border-orange-100">
                            <tr>
                                <th className="px-4 py-3 text-[10px] font-mono text-orange-600 tracking-[0.2em] uppercase">Name</th>
                                <th className="px-4 py-3 text-[10px] font-mono text-orange-600 tracking-[0.2em] uppercase">Activation Time</th>
                                <th className="px-4 py-3 text-[10px] font-mono text-orange-600 tracking-[0.2em] uppercase">Target Offset</th>
                                <th className="px-4 py-3 text-[10px] font-mono text-orange-600 tracking-[0.2em] uppercase">Enabled</th>
                                <th className="px-4 py-3 text-[10px] font-mono text-orange-600 tracking-[0.2em] uppercase text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-orange-100">
                            {drafts.map((program) => (
                                <tr key={program.id} className="bg-white/40 hover:bg-white/70 transition-colors">
                                    <td className="px-4 py-3">
                                        <input
                                            type="text"
                                            value={program.name}
                                            onChange={(event) => updateDraft(program.id, { name: event.target.value })}
                                            className="w-full bg-white border-2 border-orange-100 text-sm text-stone-800 px-3 py-2 rounded-lg focus:outline-none focus:border-orange-400"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            placeholder="00:00"
                                            maxLength={5}
                                            pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                                            value={program.activationTime}
                                            onChange={(event) => updateDraft(program.id, { activationTime: event.target.value })}
                                            className="w-36 bg-white border-2 border-orange-100 text-sm text-stone-800 px-3 py-2 rounded-lg focus:outline-none focus:border-orange-400"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <label className="inline-flex items-center gap-2 text-sm text-stone-600">
                                            <input
                                                type="number"
                                                min={0}
                                                max={365}
                                                value={program.targetOffsetDays ?? 1}
                                                onChange={(event) => updateDraft(program.id, { targetOffsetDays: Number(event.target.value) })}
                                                className="w-24 bg-white border-2 border-orange-100 text-sm text-stone-800 px-3 py-2 rounded-lg focus:outline-none focus:border-orange-400"
                                            />
                                            days after today
                                        </label>
                                    </td>
                                    <td className="px-4 py-3">
                                        <label className="inline-flex items-center gap-2 text-sm text-stone-600">
                                            <input
                                                type="checkbox"
                                                checked={program.isEnabled}
                                                onChange={(event) => updateDraft(program.id, { isEnabled: event.target.checked })}
                                                className="accent-orange-500 w-4 h-4 rounded"
                                            />
                                            Active
                                        </label>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => handleDelete(program.id)}
                                                className="p-2 text-stone-400 hover:text-red-500 transition-colors"
                                                title="Delete program"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>

                <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className={`text-sm ${message?.includes('valid') || message?.includes('could not') ? 'text-red-600' : 'text-stone-500'}`}>
                        {message || 'Enabled programs run when the connected session clock reaches the activation time.'}
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || hasInvalidTime}
                        className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-sm font-medium hover:from-orange-600 hover:to-amber-600 transition-all rounded-xl shadow-lg shadow-orange-300/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        <Save className="w-4 h-4" /> {isSaving ? 'Saving...' : 'Save Programs'}
                    </button>
                </div>
            </div>
        </div>
    );
};
