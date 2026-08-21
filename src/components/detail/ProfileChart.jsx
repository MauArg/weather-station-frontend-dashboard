import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { formatFixed } from '../../utils/timezone';
import { PROFILE_MIN_HOURS } from './seriesStats';

const TOOLTIP = {
    contentStyle: { backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px' },
    itemStyle: { color: '#e4e4e7' },
    labelStyle: { color: '#a1a1aa' },
};

/**
 * The average day: each local hour averaged across the window, with a band
 * showing how far that hour has ranged.
 *
 * This is the chart that justifies the detail view existing. The raw series
 * answers "what happened"; this one answers "what usually happens, and how
 * reliably" — and the width of the band is often the more interesting half. A
 * narrow dawn and a wide afternoon says the mornings here are predictable and
 * the afternoons are at the mercy of the sun.
 *
 * Shared across the readings because the question is the same for all of them
 * and only the units change.
 */
const ProfileChart = ({ profile, hours, color, unit, digits = 1, domain }) => {
    const { t } = useTranslation('dashboard');

    if (hours < PROFILE_MIN_HOURS) {
        return <p className="metric-note">{t('detail.profileNeedsRange')}</p>;
    }

    return (
        <>
            <p className="metric-note">{t('detail.profileIntro')}</p>
            <div className="metric-chart metric-chart-short">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={profile} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff14" />
                        {/* Every third hour, fixed. A gap-based rule on a category
                            axis lets recharts pick whichever labels happen to fit,
                            and it produced 00-02-04 then 10-11-12-13 — an axis whose
                            spacing changes halfway across reads as missing data. */}
                        <XAxis dataKey="label" stroke="#ffffff66" tick={{ fontSize: 11 }} interval={2} />
                        <YAxis
                            stroke="#ffffff66" tick={{ fontSize: 11 }} width={52} domain={domain}
                            tickFormatter={(v) => `${formatFixed(v, 0)}${unit}`}
                        />
                        <Tooltip
                            {...TOOLTIP}
                            formatter={(value, name) => [
                                Array.isArray(value)
                                    ? `${formatFixed(value[0], digits)} – ${formatFixed(value[1], digits)} ${unit}`
                                    : `${formatFixed(value, digits)} ${unit}`,
                                name,
                            ]}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
                        {/* legendType, because the default draws this band as a line
                            with a dot — the same mark the mean gets, in the same hue.
                            Two identical swatches label two things that look nothing
                            alike on the chart. */}
                        <Area
                            type="monotone" dataKey="envelope" name={t('detail.profileRange')}
                            stroke="none" fill={color} fillOpacity={0.18}
                            legendType="rect" isAnimationActive={false}
                        />
                        <Line
                            type="monotone" dataKey="mean" name={t('detail.profileMean')}
                            stroke={color} strokeWidth={2.2} dot={false}
                            isAnimationActive={false}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </>
    );
};

export default ProfileChart;
