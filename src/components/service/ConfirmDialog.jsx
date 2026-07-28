import React, { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Modal confirmation for a destructive action.
 *
 * Built on the native <dialog> element rather than window.confirm(): confirm()
 * blocks the JavaScript event loop, which freezes the SSE stream feeding the rest
 * of this view for as long as the prompt is up. <dialog> is a normal DOM node, and
 * it brings focus trapping, Escape-to-dismiss and inertness of the background for
 * free.
 *
 * Cancel is the autofocused button on purpose. These dialogs guard actions that
 * destroy data, so the key a user mashes without reading should be the safe one.
 */
const ConfirmDialog = ({
    open,
    title,
    children,
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    onConfirm,
    onCancel,
}) => {
    const ref = useRef(null);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        // showModal() lanza si el diálogo ya está abierto, y close() sobre uno
        // cerrado dispara un evento de más.
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    return (
        <dialog
            ref={ref}
            className="svc-dialog"
            // Escape y el click en el backdrop emiten `cancel`. Sin esto el estado
            // de React quedaría creyendo que el diálogo sigue abierto.
            onCancel={(e) => { e.preventDefault(); onCancel?.(); }}
        >
            <div className="svc-dialog-head">
                <AlertTriangle size={18} aria-hidden="true" />
                <strong>{title}</strong>
            </div>
            <div className="svc-dialog-body svc-small">{children}</div>
            <div className="svc-btn-row svc-dialog-actions">
                <button className="svc-btn" autoFocus onClick={onCancel}>
                    {cancelLabel}
                </button>
                <button className="svc-btn svc-btn-danger" onClick={onConfirm}>
                    {confirmLabel}
                </button>
            </div>
        </dialog>
    );
};

export default ConfirmDialog;
