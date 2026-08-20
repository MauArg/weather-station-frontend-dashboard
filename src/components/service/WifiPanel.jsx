import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ComposedChart, Area, Line, XAxis, YAxis,
    CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Wifi } from 'lucide-react';
import { getWifiTrend } from '../../services/ServiceApi';
import { formatDayTime, formatFixed } from '../../utils/timezone';
import { useTrend } from '../../hooks/useTrend';
import TrendRange from './TrendRange';
import Tip from './Tip';

// Violet, because red, blue and yellow already mean temperature, humidity and
// daylight across this dashboard and signal strength is none of those. Its
// lightness sits at 0.709 against their 0.712 and 0.718, so the three read as one
// family; separation is comfortable (worst pair ΔE 24.0 normal vision, 20.6 under
// protanopia) and it clears 3:1 on the dark surface.
const SIGNAL = '#a78bfa';

// The usual dBm bands for 2.4 GHz. -70 is where a link stops being comfortable
// and -80 is where publishes start failing outright. Ours has lived between them:
// mean -67.7 dBm over a week, 5th percentile -73, worst sample -82.
const WEAK_DBM = -70;
const MARGINAL_DBM = -80;

const WifiPanel = ({ node, active = true }) => {
    const { t } = useTranslation('service');
    const [hours, setHours] = useState(72);

    const { points, error } = useTrend(getWifiTrend, hours, node?.lastSeenAt);

    // Recharts draws a range area from a single key holding [low, high], so the
    // pair is folded here rather than in the API shape — the endpoint serves three
    // honest scalars and the chart's needs stay the chart's business.
    const data = useMemo(
        () => points.map((p) => ({ ...p, band: [p.minDbm, p.maxDbm] })),
        [points],
    );

    // Padded so the threshold lines stay on screen even during a week when the
    // link never came near them, which is most weeks.
    const lows = points.map((p) => p.minDbm);
    const highs = points.map((p) => p.maxDbm);
    const domain = points.length
        ? [Math.min(...lows, WEAK_DBM) - 3, Math.max(...highs, WEAK_DBM) + 3]
        : [-90, -50];

    return (
        <div className="svc-card">
            <div className="svc-card-head">
                <h3 className="svc-h4"><Wifi size={18} aria-hidden="true" /> {t('wifi.title')}</h3>
                <TrendRange hours={hours} onChange={setHours} label={t('wifi.rangeAria')} />
            </div>

            {/* Why a band and not just a line, said once here rather than left for
                the reader to infer: the mean alone is nearly flat — 14 days of
                daily means span 4.5 dB — and it is the bad moments that drop a
                publish, not the average. */}
            <Tip text={t('wifi.bandTip')}>
                <p className="svc-small svc-muted">{t('wifi.intro')}</p>
            </Tip>

            {error ? (
                <p className="svc-muted svc-small">{t('wifi.error', { error })}</p>
            ) : !active ? (
                // Same hidden-tab gate as the other two charts. See BatteryPanel.
                <div className="svc-spark" />
            ) : (
                <div className="svc-spark">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff14" />
                            <XAxis
                                dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                                stroke="#ffffff66" tick={{ fontSize: 11 }} minTickGap={40}
                                tickFormatter={formatDayTime}
                            />
                            <YAxis
                                domain={domain} stroke="#ffffff66" tick={{ fontSize: 11 }} width={52}
                                tickFormatter={(v) => `${formatFixed(v, 0)}`}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px' }}
                                itemStyle={{ color: '#e4e4e7' }}
                                labelStyle={{ color: '#a1a1aa' }}
                                cursor={{ stroke: 'rgba(255,255,255,0.4)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                labelFormatter={formatDayTime}
                                formatter={(value, name) => (
                                    Array.isArray(value)
                                        ? [`${formatFixed(value[0], 0)} … ${formatFixed(value[1], 0)} dBm`, t('wifi.series.band')]
                                        : [`${formatFixed(value, 1)} dBm`, name]
                                )}
                            />
                            <ReferenceLine
                                y={WEAK_DBM} stroke="#facc15" strokeDasharray="5 5"
                                label={{ value: t('wifi.refWeak', { dbm: WEAK_DBM }), position: 'insideTopRight', fill: '#a1a1aa', fontSize: 11 }}
                            />
                            <ReferenceLine
                                y={MARGINAL_DBM} stroke="#f87171" strokeDasharray="5 5"
                                label={{ value: t('wifi.refMarginal', { dbm: MARGINAL_DBM }), position: 'insideBottomRight', fill: '#a1a1aa', fontSize: 11 }}
                            />
                            <Area
                                dataKey="band" name={t('wifi.series.band')}
                                stroke="none" fill={SIGNAL} fillOpacity={0.18} isAnimationActive={false}
                            />
                            <Line
                                type="monotone" dataKey="meanDbm" name={t('wifi.series.mean')}
                                stroke={SIGNAL} strokeWidth={2} dot={false}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
};

export default WifiPanel;
