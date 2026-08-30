import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';

type TextInputDialogProps = {
    open: boolean;
    title: string;
    label: string;
    initialValue?: string;
    placeholder?: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: (value: string) => void | Promise<void>;
    onCancel: () => void;
    interactionId?: string;
};

const TextInputDialogForm = ({
    title,
    label,
    initialValue = '',
    placeholder,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
    interactionId
}: Omit<TextInputDialogProps, 'open'>) => {
    const [value, setValue] = useState(initialValue);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const generatedId = useId();
    const id = interactionId || generatedId;
    const inputRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        inputRef.current?.focus();
        inputRef.current?.select();
        return () => previouslyFocused?.focus();
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isSubmitting) onCancel();
            if (event.key !== 'Tab') return;
            const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
    }, [isSubmitting, onCancel]);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const normalizedValue = value.trim();
        if (!normalizedValue || isSubmitting) return;
        setIsSubmitting(true);
        await onConfirm(normalizedValue);
        setIsSubmitting(false);
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/45 p-4" role="presentation">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
                <h2 id={`${id}-title`} className="text-lg font-semibold text-stone-800">{title}</h2>
                <form className="mt-5" onSubmit={(event) => { void handleSubmit(event); }}>
                    <label htmlFor={`${id}-input`} className="text-sm font-medium text-stone-700">{label}</label>
                    <input
                        ref={inputRef}
                        id={`${id}-input`}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        placeholder={placeholder}
                        disabled={isSubmitting}
                        className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                    />
                    <div className="mt-6 flex justify-end gap-3">
                        <button type="button" onClick={onCancel} disabled={isSubmitting} className="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50">{cancelLabel}</button>
                        <button id={interactionId} type="submit" disabled={!value.trim() || isSubmitting} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">{confirmLabel}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export const TextInputDialog = ({ open, ...props }: TextInputDialogProps) => {
    if (!open) return null;
    return <TextInputDialogForm key={`${props.interactionId || 'text-input'}-${props.initialValue || ''}`} {...props} />;
};
