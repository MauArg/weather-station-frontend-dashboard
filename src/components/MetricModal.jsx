import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';

/**
 * The expanded view of a single headline reading.
 *
 * The split it enforces: a card on the dashboard carries what has to be legible
 * at a glance and nothing else, and everything that explains that number — the
 * extremes, the comparisons, the shape of the last week — lives in here, where
 * there is room for it. A card that grows a third footer is a card asking for
 * one of these.
 *
 * Built on the native <dialog>, the same choice ConfirmDialog made and for the
 * same reasons: focus trapping, Escape-to-dismiss and an inert background come
 * with the element instead of being re-implemented, and it never blocks the
 * event loop the way confirm() does — which matters here because the dashboard
 * behind it is still polling every 3 s.
 *
 * `children` is not rendered while closed, and that is load-bearing rather than
 * an optimisation. A closed <dialog> is display:none, and a Recharts
 * ResponsiveContainer inside a display:none parent measures zero — it would open
 * at whatever width it last saw, or at nothing on the first open. The service
 * tabs hit this exact wall and solved it the same way. It also means no detail
 * view computes anything until someone asks to see it.
 */
const MetricModal = ({ open, onClose, title, icon: Icon, color, toolbar, loading, children }) => {
    const { t } = useTranslation();
    const ref = useRef(null);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        // showModal() throws if the dialog is already open, and close() on a
        // closed one fires an extra event.
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    return (
        <dialog
            ref={ref}
            className="metric-modal"
            aria-labelledby="metric-modal-title"
            // Escape and the backdrop both emit `cancel`; without this the
            // parent's state would still believe the dialog is open.
            onCancel={(e) => { e.preventDefault(); onClose?.(); }}
            // Clicking the backdrop lands on the <dialog> itself rather than on
            // any of its children, which is the whole test. Dismissing on it is
            // safe here in a way it is not for ConfirmDialog: nothing in this
            // view destroys anything, so a stray click costs a reopen.
            onClick={(e) => { if (e.target === ref.current) onClose?.(); }}
        >
            <div className="metric-modal-head">
                <h2 id="metric-modal-title" className="metric-modal-title">
                    {Icon && <Icon size={20} color={color} aria-hidden="true" />}
                    {title}
                </h2>
                <button
                    type="button"
                    className="metric-modal-close"
                    onClick={onClose}
                    aria-label={t('metricModal.close')}
                >
                    <X size={18} aria-hidden="true" />
                </button>
            </div>
            {/*
              The toolbar sits outside the scrolling body rather than at the top
              of it. Sticky inside the body put it on a layer above content that
              slid underneath, and the stat row surfaced in the strip above it —
              it read as two rows overlapping. Out here it is simply always
              visible, which is what "sticky" was reaching for, with no stacking
              context to get wrong.
            */}
            {open && toolbar && (
                <div className="metric-modal-toolbar">
                    {toolbar}
                    {/*
                      The wait lives in the toolbar rather than as an overlay over
                      the content, because the toolbar is the only part of this
                      view guaranteed to be on screen: the body scrolls, and a
                      spinner pinned inside it disappears the moment the reader is
                      looking at the second chart. It also sits where the click
                      that started the wait landed.

                      A longer range is 3-5 s against the Pi, so without this the
                      range button latches and nothing else happens — which reads
                      as a dead control rather than as a fetch.
                    */}
                    {loading && (
                        <div className="metric-modal-wait" role="status" aria-label={t('loadingData')}>
                            <Loader2 className="animate-spin" size={16} aria-hidden="true" />
                        </div>
                    )}
                </div>
            )}
            {/*
              The content stays put and dims rather than being replaced by a
              placeholder. Everything on screen is still true — it is the previous
              window, drawn from data that really arrived — and swapping it for an
              empty frame would throw away a correct answer to show nothing. It is
              the same choice the charts below the dashboard make.
            */}
            <div className={`metric-modal-body${loading ? ' is-loading' : ''}`}>
                {open && children}
            </div>
        </dialog>
    );
};

export default MetricModal;
