import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { BatteryCharging, Battery, ShieldCheck, AlertTriangle, ShieldX, Sun } from 'lucide-react';
import { getBatteryTrend } from '../../services/ServiceApi';
import { formatDayTime } from '../../utils/timezone';
import { apiText } from '../../i18n/apiText';
import Tip from './Tip';

// Flash-risk presentation. Colour alone never carries the meaning: every state
// ships an icon and a text label. That is a hard requirement here rather than a
// nicety — under protanopia the green and amber used by this dashboard separate
// by only ΔE 6.8, which is below the level where hue is legible on its own.
//
// The label and the tip live in the dictionary now, keyed by the same
// flashRisk value the backend already sends.
const RISK_UI = {
    safe: { color: '#4ade80', Icon: ShieldCheck },
    caution: { color: '#facc15', Icon: AlertTriangle },
    unsafe: { color: '#f87171', Icon: ShieldX },
};

// Matches models.FlashRiskSafeMinV / FlashRiskCautionMinV in the backend.
const THRESHOLD_SAFE = 4.0;
const THRESHOLD_CAUTION = 3.85;

const BatteryPanel = ({ battery }) => {
    const { t } = useTranslation('service');
    const [trend, setTrend] = useState([]);
    const [hours, setHours] = useState(72);
    const [trendError, setTrendError] = useState(null);

    // Re-queried on every new reading, not just on mount. It used to be frozen
    // at the moment the view was opened. And during service mode InfluxDB
    // receives nothing —the node doesn't publish telemetry— so fresh points
    // come from the backend's in-memory ring, which the endpoint appends to
    // the end of the historical series.
    const measuredAt = battery?.measuredAt;

    useEffect(() => {
        let isMounted = true;
        getBatteryTrend(hours)
            .then((points) => {
                if (!isMounted) return;
                setTrend(points.map((p) => ({ ...p, t: new Date(p.time).getTime() })));
                setTrendError(null);
            })
            .catch((err) => isMounted && setTrendError(err.message));
        return () => { isMounted = false; };
    }, [hours, measuredAt]);

    if (!battery) {
        return (
            <div className="svc-card">
                <h3>{t('battery.title')}</h3>
                <p className="svc-muted">{t('battery.noReading')}</p>
            </div>
        );
    }

    const riskKey = RISK_UI[battery.flashRisk] ? battery.flashRisk : 'unsafe';
    const risk = RISK_UI[riskKey];
    const RiskIcon = risk.Icon;
    const ChargeIcon = battery.charging ? BatteryCharging : Battery;
    const fromHeartbeat = battery.source === 'service_heartbeat';

    // Domain padded around the data so the threshold lines stay visible even when
    // the pack has been sitting flat near the top of its range.
    const values = trend.map((p) => p.volts);
    const dataMin = values.length ? Math.min(...values) : THRESHOLD_CAUTION;
    const dataMax = values.length ? Math.max(...values) : 4.2;
    const domain = [Math.min(dataMin, THRESHOLD_CAUTION) - 0.05, Math.max(dataMax, THRESHOLD_SAFE) + 0.05];

    return (
        <div className="svc-card">
            <div className="svc-card-head">
                <h3>{t('battery.title')}</h3>
                <span className="svc-muted svc-small">
                    {fromHeartbeat ? t('battery.sourceHeartbeat') : t('battery.sourceTelemetry')}
                </span>
            </div>

            <div className="svc-batt-top">
                <div className="svc-batt-reading">
                    <Tip
                        className="svc-tip-left"
                        text={fromHeartbeat ? t('battery.voltsTipHeartbeat') : t('battery.voltsTipTelemetry')}
                    >
                        <div className="svc-batt-volts">
                            <ChargeIcon size={28} color={battery.charging ? '#4ade80' : '#a1a1aa'} aria-hidden="true" />
                            <span>{battery.volts.toFixed(3)}</span>
                            <span className="svc-batt-unit">V</span>
                        </div>
                    </Tip>
                    <Tip
                        className="svc-tip-left"
                        text={t('battery.socTip')}
                    >
                        {/* The tier label is derived from `tier`, which the API
                            already sends, rather than from `tierLabel`, which is a
                            sentence the backend wrote and the language switch could
                            never reach. `tierLabel` stays as the fallback. */}
                        <div className="svc-muted svc-small">
                            {t('battery.socLine', {
                                soc: battery.socPct.toFixed(0),
                                tier: battery.tier,
                                label: apiText(t, 'tier', String(battery.tier), battery.tierLabel),
                            })}
                        </div>
                    </Tip>
                    {battery.solarMa != null && (
                        <Tip
                            className="svc-tip-left"
                            text={t('battery.panelTip')}
                        >
                            <div className="svc-muted svc-small svc-inline">
                                <Sun size={14} aria-hidden="true" />
                                {t('battery.panelLine', {
                                    volts: battery.solarV?.toFixed(2),
                                    ma: battery.solarMa.toFixed(1),
                                })}
                                {battery.charging ? t('battery.charging') : t('battery.noSignificantCharge')}
                            </div>
                        </Tip>
                    )}
                </div>

                <Tip text={t(`battery.risk.${riskKey}Tip`)}>
                    <div className="svc-risk" style={{ borderColor: risk.color }}>
                        <RiskIcon size={22} color={risk.color} aria-hidden="true" />
                        <div>
                            <div className="svc-risk-label" style={{ color: risk.color }}>
                                {t(`battery.risk.${riskKey}`)}
                            </div>
                            {/* Same rule as the tier label: derived from
                                `flashRisk`, with the backend's `riskNote` as the
                                fallback. */}
                            <div className="svc-muted svc-small">
                                {apiText(t, 'riskNote', riskKey, battery.riskNote)}
                            </div>
                        </div>
                    </div>
                </Tip>
            </div>

            <div className="svc-card-head" style={{ marginTop: '1rem' }}>
                <h4 className="svc-h4">{t('battery.trendTitle')}</h4>
                <div className="svc-range">
                    {[24, 72, 168].map((h) => (
                        <button
                            key={h}
                            onClick={() => setHours(h)}
                            className={`svc-range-btn ${hours === h ? 'active' : ''}`}
                        >
                            {h === 168 ? '7d' : `${h}h`}
                        </button>
                    ))}
                </div>
            </div>

            {trendError ? (
                <p className="svc-muted svc-small">{t('battery.trendError', { error: trendError })}</p>
            ) : (
                <div className="svc-spark">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="battFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#4dabf7" stopOpacity={0.5} />
                                    <stop offset="95%" stopColor="#4dabf7" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff14" />
                            <XAxis
                                dataKey="t"
                                type="number"
                                scale="time"
                                domain={['dataMin', 'dataMax']}
                                stroke="#ffffff66"
                                tick={{ fontSize: 11 }}
                                minTickGap={40}
                                tickFormatter={formatDayTime}
                            />
                            <YAxis
                                domain={domain}
                                stroke="#ffffff66"
                                tick={{ fontSize: 11 }}
                                width={52}
                                tickFormatter={(v) => `${v.toFixed(2)}V`}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px' }}
                                itemStyle={{ color: '#e4e4e7' }}
                                labelStyle={{ color: '#a1a1aa' }}
                                cursor={{ stroke: 'rgba(255,255,255,0.4)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                formatter={(value) => [`${value.toFixed(3)} V`, t('battery.series')]}
                                labelFormatter={formatDayTime}
                            />
                            <ReferenceLine
                                y={THRESHOLD_SAFE}
                                stroke="#4ade80"
                                strokeDasharray="5 5"
                                label={{ value: t('battery.refSafe'), position: 'insideTopRight', fill: '#a1a1aa', fontSize: 11 }}
                            />
                            <ReferenceLine
                                y={THRESHOLD_CAUTION}
                                stroke="#f87171"
                                strokeDasharray="5 5"
                                label={{ value: t('battery.refRisk'), position: 'insideBottomRight', fill: '#a1a1aa', fontSize: 11 }}
                            />
                            <Area
                                type="monotone"
                                dataKey="volts"
                                name={t('battery.series')}
                                stroke="#4dabf7"
                                strokeWidth={2}
                                fill="url(#battFill)"
                                dot={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
};

export default BatteryPanel;
