import { useEffect, useRef } from 'react';

type ConfirmDialogProps = {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
    interactionId?: string;
};

export const ConfirmDialog = ({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
    interactionId
}: ConfirmDialogProps) => {
    const cancelButtonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        cancelButtonRef.current?.focus();
        return () => previouslyFocused?.focus();
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onCancel();
            if (event.key !== 'Tab') return;
            const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
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
    }, [onCancel, open]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/45 p-4" role="presentation">
            <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={`${interactionId || 'confirm'}-title`} aria-describedby={description ? `${interactionId || 'confirm'}-description` : undefined} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
                <h2 id={`${interactionId || 'confirm'}-title`} className="text-lg font-semibold text-stone-800">{title}</h2>
                {description && <p id={`${interactionId || 'confirm'}-description`} className="mt-2 text-sm text-stone-600">{description}</p>}
                <div className="mt-6 flex justify-end gap-3">
                    <button ref={cancelButtonRef} type="button" onClick={onCancel} className="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">{cancelLabel}</button>
                    <button id={interactionId} type="button" onClick={onConfirm} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">{confirmLabel}</button>
                </div>
            </div>
        </div>
    );
};
