import React from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2 } from 'lucide-react';

/**
 * A single headline reading on the dashboard.
 *
 * The card carries what has to be legible at a glance and nothing else: the
 * figure, what it is, and — through `note` — where it is heading. Everything
 * that asks the reader to compare two numbers lives in the detail view behind
 * `onOpenDetail`, which is what emptied these cards of their footers.
 *
 * `caption` is a quiet label under the figure, for a number that cannot be read
 * without knowing which of two things it is. Only pressure needs one: 923 hPa
 * and 1014 hPa are both plausible barometric pressures, so a reader who glances
 * at the figure without noticing whether it is the station reading or QNH has no
 * way to tell them apart. `captionTip` explains what the number *is*, and rides
 * on the caption because that is the element already claiming to describe it.
 *
 * This used to host a `variants` mechanism that let the pressure card cycle
 * between those two readings in place. It was the card's only user, and the
 * switch has moved into the detail view where a real control fits — so the
 * mechanism went with it rather than staying as an unused parameter. That also
 * left every card with exactly one thing a click can mean, which is what makes
 * the whole-card target below safe.
 *
 * `note` and `footer` are open slots for context about the same quantity. They
 * take nodes rather than a fixed shape because the card has no business knowing
 * what a trend band is; it only knows there is a line right under the headline
 * and a quieter block below a rule.
 */
const StatCard = ({ title, value, unit, icon: Icon, color = 'blue', note, footer, caption, captionTip, onOpenDetail }) => {
    const { t } = useTranslation();

    return (
        <div className={`stat-card${onOpenDetail ? ' is-expandable' : ''}`}>
            {/*
              The whole card opens the detail view, and it does it through an
              absolutely-positioned button behind the content rather than by
              wrapping the card in one. A button inside a button is invalid HTML
              that screen readers resolve inconsistently, and this way nothing
              ever nests even if a card grows a control of its own later.

              It is left empty and labelled instead of holding the card's text,
              or the accessible name would be the whole card read aloud.
            */}
            {onOpenDetail && (
                <button
                    type="button"
                    className="stat-card-open"
                    onClick={onOpenDetail}
                    aria-label={t('statCard.openDetail', { title })}
                />
            )}
            <div className="stat-header">
                <span className="stat-title">{title}</span>
                <div className="stat-header-right">
                    {/* Decorative: the overlay button above already carries the
                        name and the focus. This is the affordance that says the
                        card does something, nothing more. */}
                    {onOpenDetail && <Maximize2 className="stat-expand-hint" size={13} aria-hidden="true" />}
                    {Icon && <Icon size={20} color={color} />}
                </div>
            </div>
            {/*
              The note shares the headline's line rather than taking one of its
              own. A row of its own pushed everything below it down, so the rule
              above the footer stopped lining up with the same rule on the card
              next door — and four cards whose rules sit at four heights read as
              a broken grid, whatever each card says on its own.
            */}
            <div className="stat-headline">
                <div className="stat-value">
                    {value} <span className="stat-unit">{unit}</span>
                </div>
                {note && <div className="stat-note">{note}</div>}
            </div>
            {caption && (
                <div className="stat-caption" title={captionTip || undefined}>
                    {caption}
                </div>
            )}
            {footer && <div className="stat-footer">{footer}</div>}
        </div>
    );
};

export default StatCard;
