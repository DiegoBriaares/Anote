/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextInputDialog } from './TextInputDialog';

afterEach(cleanup);

describe('TextInputDialog', () => {
    it('focuses the input, submits a normalized value, and restores invoking focus', async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();

        const { rerender } = render(
            <TextInputDialog
                open
                title="Rename"
                label="Name"
                initialValue="Current"
                confirmLabel="Save"
                cancelLabel="Cancel"
                onConfirm={onConfirm}
                onCancel={() => {}}
            />
        );

        const input = screen.getByRole('textbox', { name: 'Name' });
        expect(document.activeElement).toBe(input);
        await user.clear(input);
        await user.type(input, '  Updated  ');
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(onConfirm).toHaveBeenCalledWith('Updated');

        rerender(
            <TextInputDialog
                open={false}
                title="Rename"
                label="Name"
                confirmLabel="Save"
                cancelLabel="Cancel"
                onConfirm={onConfirm}
                onCancel={() => {}}
            />
        );
        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });

    it('cancels with Escape', async () => {
        const onCancel = vi.fn();
        const user = userEvent.setup();
        render(
            <TextInputDialog
                open
                title="Create"
                label="Name"
                confirmLabel="Create"
                cancelLabel="Cancel"
                onConfirm={() => {}}
                onCancel={onCancel}
            />
        );
        await user.keyboard('{Escape}');
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
