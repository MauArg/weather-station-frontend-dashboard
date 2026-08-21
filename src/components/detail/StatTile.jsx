import React from 'react';

/**
 * One figure in a detail view's stat row.
 *
 * `when` is the quiet line under the value, and it carries whatever the number
 * needs in order not to be misread — the instant an extreme happened, or what a
 * mean was averaged over. Every figure in these views is over a window the
 * reader chose, so a bare number is almost always an incomplete claim.
 */
const StatTile = ({ label, value, unit, when, icon: Icon, color }) => (
    <div className="metric-stat">
        <div className="metric-stat-label">
            {Icon && <Icon size={13} aria-hidden="true" />}
            {label}
        </div>
        <div className="metric-stat-value" style={color ? { color } : undefined}>
            {value}{unit && <span className="metric-stat-unit">{unit}</span>}
        </div>
        {when && <div className="metric-stat-when">{when}</div>}
    </div>
);

export default StatTile;
