import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ComposedChart, AreaChart, Area, Line, XAxis, YAxis,
    CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Thermometer, Droplets, ShieldCheck, AlertTriangle, ShieldX } from 'lucide-react';
import { getEnclosureTrend } from '../../services/ServiceApi';
import { formatDayTime, formatFixed } from '../../utils/timezone';
import { useTrend } from '../../hooks/useTrend';
import TrendRange from './TrendRange';
import Tip from './Tip';

// Both probes read the same air, so they share the temperature hue the whole app
// already uses (#ff6b6b on every chart) and separate by weight instead: solid and
// full for the DS18B20, dashed and tinted for the DHT22. Two different hues would
// claim they measure different things.
//
// Which one leads is not a coin toss. The DS18B20 is a bare TO-92 with almost no
// thermal mass and it tracks the air fastest; the DHT22 sits inside a vented
// plastic housing and lags. Measured over 7 days: at night the two agree to
// 0.09–0.19 °C, but at 10:00 local — when the sun first loads the box — they part
// by 1.12 °C on average, with 62 % of minutes past 0.4 °C. So the gap between the
// two lines is not disagreement to be averaged away, it is how hard the enclosure
// is being driven at that moment.
//
// The trade the probe makes for that speed: sensors.cpp sets it to 9-bit, which
// quantises to 0.5 °C — the raw series contains nothing but multiples of a half
// degree. It does not show here because the backend averages minutes into
// windows, but it is why the panel's instantaneous reading steps coarsely.
const PROBE = '#ff6b6b';
const PROBE_LAGGING = '#ff9d9d';

// Outdoors is a reference, not a fourth reading, so it wears the muted ink the
// reference lines on the battery chart already use rather than a series hue.
const AMBIENT = '#a1a1aa';

// Humidity is #4dabf7 everywhere in this dashboard. Kept.
const HUMIDITY = '#4dabf7';

// How much room is left before the air inside the box starts condensing on the
// electronics. Chosen, not measured — over the week this was written the margin
// ran 5.8–8.0 °C, so nothing here has ever fired. That is the point: the number
// is worth a line in the header precisely because it is the one that would matter
// enormously on the day it changed.
const MARGIN_TIGHT_C = 5;
const MARGIN_CRITICAL_C = 2;

const marginUi = (margin) => {
    if (margin == null) return null;
    if (margin < MARGIN_CRITICAL_C) return { key: 'critical', color: '#f87171', Icon: ShieldX };
    if (margin < MARGIN_TIGHT_C) return { key: 'tight', color: '#facc15', Icon: AlertTriangle };
    return { key: 'clear', color: '#4ade80', Icon: ShieldCheck };
};

const axis = { stroke: '#ffffff66', tick: { fontSize: 11 } };
const grid = <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff14" />;
const tooltipStyle = {
    contentStyle: { backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px' },
    itemStyle: { color: '#e4e4e7' },
    labelStyle: { color: '#a1a1aa' },
    cursor: { stroke: 'rgba(255,255,255,0.4)', strokeWidth: 1, strokeDasharray: '4 4' },
    labelFormatter: formatDayTime,
};

const EnclosurePanel = ({ node, active = true }) => {
    const { t } = useTranslation('service');
    const [hours, setHours] = useState(72);

    // Follows the node's clock, not the page load: same reason the battery series
    // refetches on every new reading. lastSeenAt moves once per duty cycle.
    const { points, error } = useTrend(getEnclosureTrend, hours, node?.lastSeenAt);

    const latest = points.length ? points[points.length - 1] : null;
    const margin = latest?.tempC != null && latest?.dewPointC != null
        ? latest.tempC - latest.dewPointC
        : null;
    const ui = marginUi(margin);

    // One shared time domain so the two charts stack as small multiples rather
    // than as two unrelated pictures: a feature at 09:00 has to sit at the same x
    // in both or reading them together is guesswork.
    const xAxis = (
        <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            {...axis}
            minTickGap={40}
            tickFormatter={formatDayTime}
        />
    );

    return (
        <div className="svc-card">
            <div className="svc-card-head">
                <h3 className="svc-h4"><Thermometer size={18} aria-hidden="true" /> {t('enclosure.title')}</h3>
                <TrendRange hours={hours} onChange={setHours} label={t('enclosure.rangeAria')} />
            </div>

            <p className="svc-small svc-muted">{t('enclosure.intro')}</p>

            {ui && (
                // Icon, colour and words all carry the state, never colour alone —
                // the green and amber of this dashboard separate by only ΔE 6.8
                // under protanopia.
                <Tip text={t('enclosure.marginTip', { tight: MARGIN_TIGHT_C, critical: MARGIN_CRITICAL_C })}>
                    <div className="svc-inline svc-small" style={{ color: ui.color }}>
                        <ui.Icon size={16} aria-hidden="true" />
                        {t(`enclosure.margin.${ui.key}`, { margin: formatFixed(margin, 1) })}
                    </div>
                </Tip>
            )}

            {/* Gated on `active` for the reason BatteryPanel documents: a
                ResponsiveContainer inside a display:none tab measures nothing, so a
                window resized while this tab was away leaves the chart frozen at
                the width it last saw. The series lives in the hook above, so
                nothing refetches when the tab comes back. */}
            {error ? (
                <p className="svc-muted svc-small">{t('enclosure.error', { error })}</p>
            ) : !active ? (
                <div className="svc-spark" />
            ) : (
                <>
                    <div className="svc-spark">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                {grid}
                                {xAxis}
                                <YAxis {...axis} width={52} tickFormatter={(v) => `${formatFixed(v, 0)}°`} />
                                <Tooltip
                                    {...tooltipStyle}
                                    formatter={(value, name) => [`${formatFixed(value, 2)} °C`, name]}
                                />
                                <Legend wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
                                <Line
                                    type="monotone" dataKey="ambientC" name={t('enclosure.series.ambient')}
                                    stroke={AMBIENT} strokeWidth={1.5} strokeDasharray="2 3" dot={false} connectNulls
                                />
                                <Line
                                    type="monotone" dataKey="dhtTempC" name={t('enclosure.series.dht')}
                                    stroke={PROBE_LAGGING} strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls
                                />
                                <Line
                                    type="monotone" dataKey="tempC" name={t('enclosure.series.probe')}
                                    stroke={PROBE} strokeWidth={2} dot={false} connectNulls
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>

                    {/* A second chart rather than a second axis on the first. Two
                        y-scales on one plot let the reader infer a crossing that is
                        an artefact of where the scales were pinned; stacked on a
                        shared time axis, the same comparison is honest. */}
                    <div className="svc-card-head" style={{ marginTop: '0.75rem' }}>
                        <h4 className="svc-h4"><Droplets size={16} aria-hidden="true" /> {t('enclosure.humidityTitle')}</h4>
                    </div>
                    <div className="svc-spark svc-spark-short">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="encHumFill" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={HUMIDITY} stopOpacity={0.45} />
                                        <stop offset="95%" stopColor={HUMIDITY} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                {grid}
                                {xAxis}
                                <YAxis {...axis} width={52} tickFormatter={(v) => `${formatFixed(v, 0)}%`} />
                                <Tooltip
                                    {...tooltipStyle}
                                    formatter={(value) => [`${formatFixed(value, 1)} %`, t('enclosure.series.humidity')]}
                                />
                                <Area
                                    type="monotone" dataKey="humPct" name={t('enclosure.series.humidity')}
                                    stroke={HUMIDITY} strokeWidth={2} fill="url(#encHumFill)" dot={false} connectNulls
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </>
            )}
        </div>
    );
};

export default EnclosurePanel;
