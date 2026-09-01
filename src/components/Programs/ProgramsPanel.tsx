import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock3, Play, Plus, Save, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { Program } from '../../api/contracts';
import type { ProgramInput } from '../../api/programs';
import { interpolateText } from '../../i18n/appText';
import { useTranslation } from '../../i18n/languageContext';
import { useCalendarStore } from '../../store/calendarStore';
import { COMMON_TIME_ZONES, normalizeTimeZone } from '../../utils/timeZone';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ProgramsPanel = () => {
    const {
        programs,
        actionError,
        savePrograms,
        createProgram,
        deleteProgram,
        runProgram,
        navigateToCalendar
    } = useCalendarStore(useShallow((state) => ({
        programs: state.programs,
        actionError: state.actionError,
        savePrograms: state.savePrograms,
        createProgram: state.createProgram,
        deleteProgram: state.deleteProgram,
        runProgram: state.runProgram,
        navigateToCalendar: state.navigateToCalendar
    })));
    const { text } = useTranslation();
    const [edits, setEdits] = useState<Record<string, Partial<ProgramInput>>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [runProgramId, setRunProgramId] = useState('');
    const [deleteCandidate, setDeleteCandidate] = useState<Program | null>(null);
    const cancelDeleteRef = useRef<HTMLButtonElement>(null);

    const drafts = useMemo(() => programs.map((program) => ({
        ...program,
        ...edits[program.id]
    })), [edits, programs]);
    const selectedProgram = drafts.find((program) => program.id === runProgramId) || drafts[0] || null;
    const selectedProgramId = selectedProgram?.id || '';
    const hasInvalidTime = drafts.some((program) => !TIME_PATTERN.test(program.activationTime));
    const hasInvalidTimeZone = drafts.some((program) => normalizeTimeZone(program.timeZone) === null);

    const updateDraft = (id: string, patch: Partial<ProgramInput>) => {
        setEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
        setMessage(null);
    };

    const handleAdd = async () => {
        const created = await createProgram({
            name: text.programs.defaultName,
            enabled: false,
            activationTime: '00:00',
            targetDayOffset: 1,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        });
        if (created) setRunProgramId(created.id);
    };

    const handleSave = async () => {
        if (hasInvalidTime) {
            setMessage(text.programs.invalidTime);
            return;
        }
        if (hasInvalidTimeZone) {
            setMessage(text.programs.invalidTimeZone);
            return;
        }
        setIsSaving(true);
        const succeeded = await savePrograms(drafts.map((program) => ({
            ...program,
            timeZone: normalizeTimeZone(program.timeZone) || program.timeZone
        })));
        if (succeeded) {
            setEdits({});
            setMessage(text.programs.saved);
        }
        setIsSaving(false);
    };

    const handleDelete = async () => {
        if (!deleteCandidate) return;
        const deleted = await deleteProgram(deleteCandidate.id, deleteCandidate.revision);
        if (deleted) {
            setEdits((current) => {
                const next = { ...current };
                delete next[deleteCandidate.id];
                return next;
            });
            setMessage(text.programs.deleted);
        }
        setDeleteCandidate(null);
    };

    const handleRun = async () => {
        if (!selectedProgram) return;
        setIsRunning(true);
        setMessage(interpolateText(text.programs.runStarted, { name: selectedProgram.name }));
        const run = await runProgram(selectedProgram.id, selectedProgram.revision);
        setMessage(run
            ? interpolateText(text.programs.runCompleted, { name: selectedProgram.name, count: run.movedEventCount })
            : interpolateText(text.programs.runFailed, { name: selectedProgram.name }));
        setIsRunning(false);
    };

    return (
        <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 mb-8">
            <button type="button" onClick={navigateToCalendar} className="mb-6 flex items-center gap-2 text-sm font-medium text-orange-600 hover:text-orange-700 transition-colors">
                <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {text.shell.backToCalendar}
            </button>

            <section className="border border-orange-200 bg-white/80 backdrop-blur-xl p-6 relative overflow-hidden rounded-2xl shadow-xl shadow-orange-100/50" aria-labelledby="programs-title">
                <div className="flex items-start justify-between gap-8 flex-col lg:flex-row">
                    <div className="flex items-center gap-4">
                        <div className="p-3 border-2 border-orange-400 rounded-full bg-gradient-to-br from-orange-50 to-amber-50">
                            <Clock3 className="w-6 h-6 text-orange-500" aria-hidden="true" />
                        </div>
                        <div>
                            <div className="text-[10px] font-mono text-stone-500 tracking-[0.3em] mb-1">{text.programs.eyebrow}</div>
                            <h2 id="programs-title" className="text-2xl text-stone-800 tracking-widest">{text.programs.title}</h2>
                            <p className="mt-1 text-sm text-stone-500">{text.programs.description}</p>
                        </div>
                    </div>
                    <button id="programs-add" type="button" onClick={() => { void handleAdd(); }} className="px-4 py-2 bg-orange-100 text-orange-700 text-xs font-bold rounded-lg hover:bg-orange-200 transition-colors uppercase tracking-wider flex items-center gap-2">
                        <Plus className="w-4 h-4" aria-hidden="true" /> {text.programs.add}
                    </button>
                </div>

                <div className="mt-10 border-y border-orange-100 bg-white/60 px-4 py-6 rounded-xl shadow-inner shadow-orange-50/70">
                    <div className="mb-4 flex items-center gap-3">
                        <Play className="h-5 w-5 text-orange-500" aria-hidden="true" />
                        <div>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-orange-600">{text.programs.manualEyebrow}</div>
                            <h3 className="text-lg font-medium text-stone-800">{text.programs.manualTitle}</h3>
                        </div>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                        <label className="flex flex-col gap-1 text-xs text-stone-600">
                            {text.programs.program}
                            <select id="programs-run-select" value={selectedProgramId} onChange={(event) => setRunProgramId(event.target.value)} className="h-10 rounded-lg border border-orange-200 bg-white px-3 text-sm">
                                {drafts.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
                            </select>
                        </label>
                        <button id="programs-run" type="button" disabled={!selectedProgram || isRunning} onClick={() => { void handleRun(); }} className="h-10 rounded-lg bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
                            {isRunning ? text.programs.running : text.programs.run}
                        </button>
                    </div>
                </div>

                <div className="mt-8 overflow-x-auto">
                    {drafts.length === 0 ? <p className="py-8 text-center text-stone-500">{text.programs.noPrograms}</p> : (
                        <table className="w-full border-separate border-spacing-y-2">
                            <thead><tr className="text-left text-xs uppercase text-orange-600">
                                <th className="px-3">{text.programs.name}</th><th className="px-3">{text.programs.activationTime}</th><th className="px-3">{text.programs.targetOffset}</th><th className="px-3">{text.programs.timeZone}</th><th className="px-3">{text.common.enabled}</th><th className="px-3 text-right">{text.programs.actions}</th>
                            </tr></thead>
                            <tbody>{drafts.map((program) => (
                                <tr key={program.id} className="bg-white/60">
                                    <td className="p-3"><input aria-label={text.programs.name} value={program.name} onChange={(event) => updateDraft(program.id, { name: event.target.value })} className="w-full rounded border border-orange-100 px-2 py-1" /></td>
                                    <td className="p-3"><input aria-label={text.programs.activationTime} value={program.activationTime} onChange={(event) => updateDraft(program.id, { activationTime: event.target.value })} className="w-24 rounded border border-orange-100 px-2 py-1" /></td>
                                    <td className="p-3"><input aria-label={text.programs.targetOffset} type="number" min={0} max={365} value={program.targetDayOffset} onChange={(event) => updateDraft(program.id, { targetDayOffset: Number(event.target.value) })} className="w-20 rounded border border-orange-100 px-2 py-1" /></td>
                                    <td className="p-3"><input aria-label={text.programs.timeZone} aria-invalid={normalizeTimeZone(program.timeZone) === null} list="program-time-zones" placeholder={text.programs.timeZonePlaceholder} value={program.timeZone} onChange={(event) => updateDraft(program.id, { timeZone: event.target.value })} className="w-44 rounded border border-orange-100 px-2 py-1 aria-[invalid=true]:border-red-400" /></td>
                                    <td className="p-3"><input aria-label={text.common.enabled} type="checkbox" checked={program.enabled} onChange={(event) => updateDraft(program.id, { enabled: event.target.checked })} /></td>
                                    <td className="p-3 text-right"><button type="button" aria-label={`${text.common.delete}: ${program.name}`} onClick={() => { setDeleteCandidate(program); queueMicrotask(() => cancelDeleteRef.current?.focus()); }} className="rounded p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" aria-hidden="true" /></button></td>
                                </tr>
                            ))}</tbody>
                        </table>
                    )}
                    <datalist id="program-time-zones">
                        {COMMON_TIME_ZONES.map((timeZone) => <option key={timeZone} value={timeZone} />)}
                    </datalist>
                    <p className="mt-2 text-xs text-stone-500">{text.programs.timeZoneHelp}</p>
                </div>

                {(message || actionError) && <p className="mt-4 text-sm text-stone-600" role="status">{message || actionError}</p>}
                <div className="mt-6 flex justify-end">
                    <button id="programs-save" type="button" disabled={isSaving || Object.keys(edits).length === 0} onClick={() => { void handleSave(); }} className="flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
                        <Save className="h-4 w-4" aria-hidden="true" /> {isSaving ? text.common.saving : text.programs.save}
                    </button>
                </div>
            </section>

            {deleteCandidate && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-stone-950/40 p-4" role="presentation">
                    <div role="alertdialog" aria-modal="true" aria-labelledby="delete-program-title" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
                        <h3 id="delete-program-title" className="text-lg font-semibold text-stone-800">{text.programs.deleteConfirm}</h3>
                        <p className="mt-2 text-sm text-stone-600">{deleteCandidate.name}</p>
                        <div className="mt-6 flex justify-end gap-3">
                            <button ref={cancelDeleteRef} type="button" onClick={() => setDeleteCandidate(null)} className="rounded-lg border border-stone-200 px-4 py-2 text-sm">{text.common.cancel}</button>
                            <button id="programs-confirm-delete" type="button" onClick={() => { void handleDelete(); }} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">{text.common.delete}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
