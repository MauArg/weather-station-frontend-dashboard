import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';

/**
 * A single headline reading.
 *
 * `variants` turns the card into a switchable one: pass a list of
 * `{ key, value, unit, caption }` and the card renders one of them plus an
 * affordance to cycle to the next. Left out, the card behaves exactly as before
 * — the other three on the dashboard never pass it.
 *
 * The switch is deliberately quiet. Only pressure needs it, and only rarely:
 * the sea-level figure is the one anybody reads, and the station reading is for
 * the odd occasion someone wants to see what the sensor actually measured. So
 * it earns a caption and a small chevron, not a segmented control that would
 * imply the two are equally likely choices.
 *
 * The caption carries the meaning, not the position of a switch: 923 hPa and
 * 1014 hPa are both plausible-looking pressures, so a reader who glances at the
 * number without noticing which mode is active would have no way to tell them
 * apart. That is the same rule the service view follows for colour — the state
 * always says what it is in words.
 *
 * `note` and `footer` are open slots for context about the same quantity — the
 * temperature card puts its trend in one and today's extremes in the other. They
 * take nodes rather than a fixed shape because the card has no business knowing
 * what a daily extreme or a trend band is; it only knows there is a line right
 * under the headline and a quieter block below a rule.
 */
const StatCard = ({ title, value, unit, icon: Icon, color = 'blue', variants, activeVariant, onCycleVariant, note, footer }) => {
    const { t } = useTranslation();
    const switchable = Array.isArray(variants) && variants.length > 1;
    const current = switchable
        ? variants.find((v) => v.key === activeVariant) ?? variants[0]
        : null;

    const shown = current ?? { value, unit, caption: null };
    const next = switchable
        ? variants[(variants.findIndex((v) => v.key === shown.key) + 1) % variants.length]
        : null;

    return (
        <div className="stat-card">
            <div className="stat-header">
                <span className="stat-title">{title}</span>
                <div className="stat-header-right">
                    {switchable && (
                        <button
                            type="button"
                            className="stat-variant-btn"
                            onClick={() => onCycleVariant?.(next.key)}
                            title={t('statCard.view', { caption: next.caption })}
                            aria-label={t('statCard.switchTo', { next: next.caption, current: shown.caption })}
                        >
                            <ChevronDown size={14} aria-hidden="true" />
                        </button>
                    )}
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
                    {shown.value} <span className="stat-unit">{shown.unit}</span>
                </div>
                {note && <div className="stat-note">{note}</div>}
            </div>
            {shown.caption && (
                <button
                    type="button"
                    className="stat-caption"
                    onClick={() => onCycleVariant?.(next.key)}
                    title={t('statCard.view', { caption: next.caption })}
                >
                    {shown.caption}
                </button>
            )}
            {footer && <div className="stat-footer">{footer}</div>}
        </div>
    );
};

export default StatCard;
