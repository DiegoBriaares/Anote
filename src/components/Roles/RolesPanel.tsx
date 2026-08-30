import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, PlusSquare, Shield, Trash2 } from 'lucide-react';
import { useCalendarStore } from '../../store/calendarStore';
import { useTranslation } from '../../i18n/languageContext';
import { interpolateText } from '../../i18n/appText';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { TextInputDialog } from '../Common/TextInputDialog';

type TextAction =
    | { kind: 'create-role' }
    | { kind: 'rename-role'; id: string; label: string }
    | { kind: 'create-subrole'; roleId: string; roleLabel: string; color: string }
    | { kind: 'rename-subrole'; id: string; label: string };

type DeleteAction =
    | { kind: 'role'; id: string; label: string }
    | { kind: 'subrole'; id: string; label: string };

export const RolesPanel: React.FC = () => {
    const {
        roles,
        subroles,
        fetchRoles,
        fetchSubroles,
        manageRoles,
        manageSubroles,
        reorderRoles,
        navigateToCalendar
    } = useCalendarStore();
    const { text } = useTranslation();
    const [textAction, setTextAction] = useState<TextAction | null>(null);
    const [deleteAction, setDeleteAction] = useState<DeleteAction | null>(null);

    useEffect(() => {
        fetchRoles();
        fetchSubroles();
    }, [fetchRoles, fetchSubroles]);

    const submitTextAction = async (label: string) => {
        if (!textAction) return;
        if (textAction.kind === 'create-role') {
            await manageRoles('create', { label, color: '#f97316' });
        } else if (textAction.kind === 'rename-role') {
            if (label !== textAction.label) await manageRoles('update', { id: textAction.id, label });
        } else if (textAction.kind === 'create-subrole') {
            await manageSubroles('create', { roleId: textAction.roleId, label, color: textAction.color });
        } else if (label !== textAction.label) {
            await manageSubroles('update', { id: textAction.id, label });
        }
        setTextAction(null);
    };

    const confirmDelete = async () => {
        if (!deleteAction) return;
        if (deleteAction.kind === 'role') {
            await manageRoles('delete', { id: deleteAction.id });
        } else {
            await manageSubroles('delete', { id: deleteAction.id });
        }
        setDeleteAction(null);
    };

    const textDialog = (() => {
        if (!textAction) return null;
        if (textAction.kind === 'create-role') {
            return { title: text.roles.createRoleTitle, label: text.roles.roleName, initialValue: '', placeholder: text.roles.roleNameExample };
        }
        if (textAction.kind === 'rename-role') {
            return { title: text.roles.renameRoleTitle, label: text.roles.roleName, initialValue: textAction.label };
        }
        if (textAction.kind === 'create-subrole') {
            return { title: interpolateText(text.roles.createSubroleTitle, { name: textAction.roleLabel }), label: text.roles.subroleName, initialValue: '' };
        }
        return { title: text.roles.renameSubroleTitle, label: text.roles.subroleName, initialValue: textAction.label };
    })();

    return (
        <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 mb-8">
            <button type="button" onClick={navigateToCalendar} className="mb-6 flex items-center gap-2 text-sm font-medium text-orange-600 hover:text-orange-700 transition-colors">
                <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {text.common.backToCalendar}
            </button>

            <div className="border border-orange-200 bg-white/80 backdrop-blur-xl p-6 relative overflow-hidden rounded-2xl shadow-xl shadow-orange-100/50">
                <div className="absolute top-0 left-0 w-20 h-20 border-r border-b border-orange-200 pointer-events-none" />
                <div className="absolute bottom-0 right-0 w-20 h-20 border-l border-t border-orange-200 pointer-events-none" />

                <div className="flex items-start justify-between gap-8 relative z-10 flex-col lg:flex-row">
                    <div className="flex items-center gap-4">
                        <div className="p-3 border-2 border-orange-400 rounded-full bg-gradient-to-br from-orange-50 to-amber-50">
                            <Shield className="w-6 h-6 text-orange-500" aria-hidden="true" />
                        </div>
                        <div>
                            <div className="text-[10px] font-mono text-stone-500 tracking-[0.3em] mb-1">{text.roles.eyebrow}</div>
                            <h2 className="text-2xl text-stone-800 tracking-widest">{text.roles.title}</h2>
                        </div>
                    </div>
                    <p className="text-sm text-stone-500 max-w-xl">{text.roles.description}</p>
                </div>

                <div className="mt-6">
                    <div className="flex items-center justify-between mb-4 gap-4">
                        <div>
                            <h3 className="text-xs font-mono text-orange-600 tracking-[0.2em] uppercase font-medium">{text.roles.roles}</h3>
                            <p className="text-sm text-stone-500 mt-1">{text.roles.rolesHelp}</p>
                        </div>
                        <button type="button" onClick={() => setTextAction({ kind: 'create-role' })} className="px-4 py-2 bg-orange-100 text-orange-700 text-xs font-bold rounded-lg hover:bg-orange-200 transition-colors uppercase tracking-wider">
                            {text.roles.addRole}
                        </button>
                    </div>

                    <div className="bg-orange-50/50 rounded-xl border border-orange-100 overflow-hidden">
                        {roles.length === 0 ? (
                            <p className="p-4 text-sm text-stone-500 italic">{text.roles.noRoles}</p>
                        ) : (
                            <ul className="divide-y divide-orange-100">
                                {roles.map((role, index) => {
                                    const roleSubroles = subroles.filter((subrole) => subrole.role_id === role.id);
                                    return (
                                        <li key={role.id} className="p-3 hover:bg-orange-100 transition-colors">
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="flex flex-col gap-1">
                                                        <button type="button" aria-label={interpolateText(text.roles.moveRoleUp, { name: role.label })} disabled={index === 0} onClick={() => {
                                                            const next = [...roles];
                                                            [next[index], next[index - 1]] = [next[index - 1], next[index]];
                                                            void reorderRoles(next.map((item) => item.id));
                                                        }} className="text-stone-400 hover:text-orange-600 disabled:invisible">
                                                            <ChevronUp className="w-4 h-4" aria-hidden="true" />
                                                        </button>
                                                        <button type="button" aria-label={interpolateText(text.roles.moveRoleDown, { name: role.label })} disabled={index === roles.length - 1} onClick={() => {
                                                            const next = [...roles];
                                                            [next[index], next[index + 1]] = [next[index + 1], next[index]];
                                                            void reorderRoles(next.map((item) => item.id));
                                                        }} className="text-stone-400 hover:text-orange-600 disabled:invisible">
                                                            <ChevronDown className="w-4 h-4" aria-hidden="true" />
                                                        </button>
                                                    </div>
                                                    <span className="w-3 h-3 rounded-full shrink-0" aria-hidden="true" style={{ backgroundColor: role.color || '#ccc' }} />
                                                    <button type="button" aria-label={interpolateText(text.roles.renameRole, { name: role.label })} onClick={() => setTextAction({ kind: 'rename-role', id: role.id, label: role.label })} className="font-medium text-stone-700 truncate hover:underline decoration-orange-300 underline-offset-2">
                                                        {role.label}
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-3 shrink-0">
                                                    <button type="button" onClick={() => setTextAction({ kind: 'create-subrole', roleId: role.id, roleLabel: role.label, color: role.color || '#f97316' })} className="rounded p-1 text-stone-500 hover:text-orange-600 focus-visible:ring-2 focus-visible:ring-orange-400" aria-label={interpolateText(text.roles.addSubrole, { name: role.label })}>
                                                        <PlusSquare className="w-4 h-4" aria-hidden="true" />
                                                    </button>
                                                    <button type="button" onClick={() => setDeleteAction({ kind: 'role', id: role.id, label: role.label })} className="rounded p-1 text-stone-500 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-400" aria-label={interpolateText(text.roles.deleteRole, { name: role.label })}>
                                                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                                                    </button>
                                                </div>
                                            </div>
                                            {roleSubroles.length > 0 && (
                                                <ul className="mt-2 ml-10 space-y-1">
                                                    {roleSubroles.map((subrole) => (
                                                        <li key={subrole.id} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-orange-50 gap-4">
                                                            <button type="button" aria-label={interpolateText(text.roles.renameSubrole, { name: subrole.label })} onClick={() => setTextAction({ kind: 'rename-subrole', id: subrole.id, label: subrole.label })} className="flex min-w-0 items-center gap-2 text-sm text-stone-600 hover:underline decoration-orange-300 underline-offset-2">
                                                                <span className="text-xs text-stone-400" aria-hidden="true">→</span>
                                                                <span className="truncate">{subrole.label}</span>
                                                            </button>
                                                            <button type="button" onClick={() => setDeleteAction({ kind: 'subrole', id: subrole.id, label: subrole.label })} className="rounded p-1 text-stone-400 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-400" aria-label={interpolateText(text.roles.deleteSubrole, { name: subrole.label })}>
                                                                <Trash2 className="w-3 h-3" aria-hidden="true" />
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            <TextInputDialog
                open={Boolean(textDialog)}
                title={textDialog?.title || ''}
                label={textDialog?.label || ''}
                initialValue={textDialog?.initialValue}
                placeholder={textDialog?.placeholder}
                confirmLabel={textAction?.kind.startsWith('create') ? text.common.create : text.common.save}
                cancelLabel={text.common.cancel}
                onCancel={() => setTextAction(null)}
                onConfirm={submitTextAction}
                interactionId="roles-text-action"
            />
            <ConfirmDialog
                open={Boolean(deleteAction)}
                title={deleteAction?.kind === 'subrole' ? text.roles.deleteSubroleTitle : text.roles.deleteRoleTitle}
                description={deleteAction ? interpolateText(deleteAction.kind === 'subrole' ? text.roles.deleteSubroleDescription : text.roles.deleteRoleDescription, { name: deleteAction.label }) : undefined}
                confirmLabel={text.common.delete}
                cancelLabel={text.common.cancel}
                onCancel={() => setDeleteAction(null)}
                onConfirm={() => { void confirmDelete(); }}
                interactionId="roles-confirm-delete"
            />
        </div>
    );
};
