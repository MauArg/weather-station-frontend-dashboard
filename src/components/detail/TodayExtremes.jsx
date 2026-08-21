import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { formatFixed } from '../../utils/timezone';

/**
 * Today's high and low, from local midnight.
 *
 * These came off the cards when the detail views took over, and they are not the
 * same figures as the window extremes above: a window runs back N hours from
 * now, while these run from midnight. At the 24 h range they are close and never
 * equal; at 7 d they are unrelated. Keeping both is the point — "how hot did it
 * get today" is the question people actually arrive with, and the window
 * extremes cannot answer it.
 *
 * A line rather than two more tiles, though, and that is the second thing this
 * component is for. As tiles they read as more of the same row while saying
 * something with a different scope, and "High" sitting next to "High today" made
 * the reader work out the difference from two words. On their own line, under a
 * label that names the period once, the distinction is structural instead of
 * textual.
 *
 * The backend leaves the pair out of the payload when the sensor said nothing
 * all day, and half a comparison is worse than none, so both appear or neither
 * does.
 *
 * The times arrive already localised — ApiService pastes today's date onto the
 * clock-only value the endpoint sends, which is correct for these two precisely
 * because they are always from today.
 */
const TodayExtremes = ({ max, min, unit, digits = 1 }) => {
    const { t } = useTranslation('dashboard');
    if (!max || !min) return null;

    const part = (Icon, label, entry) => (
        <span className="metric-today-part">
            <Icon size={13} aria-hidden="true" />
            <span className="metric-today-label">{label}</span>
            <strong>{formatFixed(entry.value, digits)} {unit}</strong>
            {entry.time && <span className="metric-today-at">{t('extremes.at', { time: entry.time })}</span>}
        </span>
    );

    return (
        <div className="metric-today">
            {/* The scope is stated once, on the left, and the two parts then use
                the plain words. Labelled "High today" and "Low today" inside a
                block already headed "Today", the row said it three times. */}
            <span className="metric-today-scope">{t('detail.today')}</span>
            {part(ArrowUp, t('detail.max'), max)}
            {part(ArrowDown, t('detail.min'), min)}
        </div>
    );
};

export default TodayExtremes;
