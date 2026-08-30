import React, { useEffect, useId, useRef } from 'react';
import { useCalendarStore, type Role } from '../../store/calendarStore';
import { X } from 'lucide-react';
import { useTranslation } from '../../i18n/languageContext';

interface RolesModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectRole: (role: Role) => void;
}

export const RolesModal: React.FC<RolesModalProps> = ({ isOpen, onClose, onSelectRole }) => {
    const { roles, fetchRoles, fetchSubroles } = useCalendarStore();
    const { text } = useTranslation();
    const titleId = useId();
    const closeRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            fetchRoles();
            fetchSubroles();
        }
    }, [isOpen, fetchRoles, fetchSubroles]);

    useEffect(() => {
        if (!isOpen) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeRef.current?.focus();
        return () => previous?.focus();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key !== 'Tab') return;
            const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
            if (!controls?.length) return;
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/20 backdrop-blur-[2px] animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col relative animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-4 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
                    <h3 id={titleId} className="text-sm font-semibold text-stone-700 uppercase tracking-widest">{text.roles.selectRole}</h3>
                    <button ref={closeRef} type="button" onClick={onClose} aria-label={text.common.close} className="p-1 rounded-full hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors">
                        <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                </div>
                <div className="p-2 flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
                    {roles.length === 0 && (
                        <div className="p-4 text-center text-xs text-stone-400 italic">{text.roles.noRolesAvailable}</div>
                    )}
                    {roles.map(role => (
                        <button
                            type="button"
                            key={role.id}
                            onClick={() => onSelectRole(role)}
                            className="flex items-center gap-3 p-3 rounded-lg hover:bg-orange-50 transition-colors text-left group"
                        >
                            <div className="w-2 h-2 rounded-full bg-orange-400 group-hover:bg-orange-600 transition-colors" aria-hidden="true" />
                            <span className="text-sm font-medium text-stone-700 group-hover:text-orange-700">{role.label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
