import React from 'react';

// The three ranges the service sparklines offer. 24 h is "since yesterday", 72 h
// is the default because it is long enough to show a run of overcast days, and
// 7 d is where the backend's 150-point budget starts visibly coarsening — past
// that the chart stops resolving a night.
const RANGES = [24, 72, 168];

/**
 * Range picker shared by the service history charts.
 *
 * Extracted so the three charts cannot drift apart: they sit in the same tab,
 * often two at a time, and a row of buttons that reads 24h/72h/7d on one card
 * and 1d/3d/7d on the next is the kind of difference nobody reports and everyone
 * notices.
 */
const TrendRange = ({ hours, onChange, label }) => (
    <div className="svc-range" role="group" aria-label={label}>
        {RANGES.map((h) => (
            <button
                key={h}
                onClick={() => onChange(h)}
                className={`svc-range-btn ${hours === h ? 'active' : ''}`}
                aria-pressed={hours === h}
            >
                {h === 168 ? '7d' : `${h}h`}
            </button>
        ))}
    </div>
);

export default TrendRange;
