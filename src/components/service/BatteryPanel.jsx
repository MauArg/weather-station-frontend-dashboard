import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { BatteryCharging, Battery, ShieldCheck, AlertTriangle, ShieldX, Sun } from 'lucide-react';
import { getBatteryTrend } from '../../services/ServiceApi';
import { formatDayTime } from '../../utils/timezone';
import Tip from './Tip';

// Flash-risk presentation. Colour alone never carries the meaning: every state
// ships an icon and a text label. That is a hard requirement here rather than a
// nicety — under protanopia the green and amber used by this dashboard separate
// by only ΔE 6.8, which is below the level where hue is legible on its own.
const RISK_UI = {
    safe: {
        label: 'Safe to flash', color: '#4ade80', Icon: ShieldCheck,
        tip: 'Above 4.00 V. The threshold is deliberately stricter than the power tiers: during service mode the node stays awake with no deep sleep to let the voltage recover.',
    },
    caution: {
        label: 'Caution', color: '#facc15', Icon: AlertTriangle,
        tip: 'Between 3.85 and 4.00 V. Enough for a short session, but avoid repeated flashes: each one keeps the node awake at 50-140 mA and sags the voltage a bit further.',
    },
    unsafe: {
        label: 'Do not flash', color: '#f87171', Icon: ShieldX,
        tip: "Below 3.85 V. The risk isn't running out of capacity —15 min at ~100 mA is ~25 mAh out of 1500— it's sag under load: the boost converter pulls more input current as Vin falls, which feeds back into the drop until a brownout mid-write.",
    },
};

// Matches models.FlashRiskSafeMinV / FlashRiskCautionMinV in the backend.
const THRESHOLD_SAFE = 4.0;
const THRESHOLD_CAUTION = 3.85;

const BatteryPanel = ({ battery }) => {
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
                <h3>Battery</h3>
                <p className="svc-muted">No reading yet — waiting for the first telemetry cycle.</p>
            </div>
        );
    }

    const risk = RISK_UI[battery.flashRisk] ?? RISK_UI.unsafe;
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
                <h3>Battery</h3>
                <span className="svc-muted svc-small">
                    {fromHeartbeat ? 'measured under service mode load' : 'latest telemetry cycle'}
                </span>
            </div>

            <div className="svc-batt-top">
                <div className="svc-batt-reading">
                    <Tip
                        className="svc-tip-left"
                        text={fromHeartbeat
                            ? 'Measured with the node awake in service mode, i.e. under load. This is the number that matters for deciding whether to start a flash.'
                            : 'Measured on the latest telemetry cycle, with WiFi active. It reads a bit below resting voltage, which is the safe side to be wrong on.'}
                    >
                        <div className="svc-batt-volts">
                            <ChargeIcon size={28} color={battery.charging ? '#4ade80' : '#a1a1aa'} aria-hidden="true" />
                            <span>{battery.volts.toFixed(3)}</span>
                            <span className="svc-batt-unit">V</span>
                        </div>
                    </Tip>
                    <Tip
                        className="svc-tip-left"
                        text="SoC comes from a piecewise Li-ion curve, not a straight line: the discharge is very flat between 3.7 and 4.0 V. The tiers come from componentes_y_conexiones.md and describe which rails the firmware should shed — not implemented yet, so here they are just a label."
                    >
                        <div className="svc-muted svc-small">
                            {battery.socPct.toFixed(0)}% SoC · Tier {battery.tier} — {battery.tierLabel}
                        </div>
                    </Tip>
                    {battery.solarMa != null && (
                        <Tip
                            className="svc-tip-left"
                            text="Reading from the panel's INA219. Below 20 mA is considered no significant charge: a few mA is leakage or the MPPT clipping on a nearly full battery, not real charging."
                        >
                            <div className="svc-muted svc-small svc-inline">
                                <Sun size={14} aria-hidden="true" />
                                Panel {battery.solarV?.toFixed(2)} V · {battery.solarMa.toFixed(1)} mA
                                {battery.charging ? ' · charging' : ' · no significant charge'}
                            </div>
                        </Tip>
                    )}
                </div>

                <Tip text={risk.tip}>
                    <div className="svc-risk" style={{ borderColor: risk.color }}>
                        <RiskIcon size={22} color={risk.color} aria-hidden="true" />
                        <div>
                            <div className="svc-risk-label" style={{ color: risk.color }}>{risk.label}</div>
                            <div className="svc-muted svc-small">{battery.riskNote}</div>
                        </div>
                    </div>
                </Tip>
            </div>

            <div className="svc-card-head" style={{ marginTop: '1rem' }}>
                <h4 className="svc-h4">Trend — a single instantaneous reading can't tell "it's recovering" from "it's been dropping for three days"</h4>
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
                <p className="svc-muted svc-small">Couldn't load the history: {trendError}</p>
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
                                formatter={(value) => [`${value.toFixed(3)} V`, 'Battery']}
                                labelFormatter={formatDayTime}
                            />
                            <ReferenceLine
                                y={THRESHOLD_SAFE}
                                stroke="#4ade80"
                                strokeDasharray="5 5"
                                label={{ value: 'safe 4.00V', position: 'insideTopRight', fill: '#a1a1aa', fontSize: 11 }}
                            />
                            <ReferenceLine
                                y={THRESHOLD_CAUTION}
                                stroke="#f87171"
                                strokeDasharray="5 5"
                                label={{ value: 'risk 3.85V', position: 'insideBottomRight', fill: '#a1a1aa', fontSize: 11 }}
                            />
                            <Area
                                type="monotone"
                                dataKey="volts"
                                name="Battery"
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
