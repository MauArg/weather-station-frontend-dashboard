import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { BatteryCharging, Battery, ShieldCheck, AlertTriangle, ShieldX, Sun } from 'lucide-react';
import { getBatteryTrend } from '../../services/ServiceApi';

// Flash-risk presentation. Colour alone never carries the meaning: every state
// ships an icon and a text label. That is a hard requirement here rather than a
// nicety — under protanopia the green and amber used by this dashboard separate
// by only ΔE 6.8, which is below the level where hue is legible on its own.
const RISK_UI = {
    safe: { label: 'Seguro para flashear', color: '#4ade80', Icon: ShieldCheck },
    caution: { label: 'Precaución', color: '#facc15', Icon: AlertTriangle },
    unsafe: { label: 'No flashear', color: '#f87171', Icon: ShieldX },
};

// Matches models.FlashRiskSafeMinV / FlashRiskCautionMinV in the backend.
const THRESHOLD_SAFE = 4.0;
const THRESHOLD_CAUTION = 3.85;

const BatteryPanel = ({ battery }) => {
    const [trend, setTrend] = useState([]);
    const [hours, setHours] = useState(72);
    const [trendError, setTrendError] = useState(null);

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
    }, [hours]);

    if (!battery) {
        return (
            <div className="svc-card">
                <h3>Batería</h3>
                <p className="svc-muted">Sin lectura todavía — esperando el primer ciclo de telemetría.</p>
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
                <h3>Batería</h3>
                <span className="svc-muted svc-small">
                    {fromHeartbeat ? 'medida bajo carga de service mode' : 'último ciclo de telemetría'}
                </span>
            </div>

            <div className="svc-batt-top">
                <div className="svc-batt-reading">
                    <div className="svc-batt-volts">
                        <ChargeIcon size={28} color={battery.charging ? '#4ade80' : '#a1a1aa'} aria-hidden="true" />
                        <span>{battery.volts.toFixed(3)}</span>
                        <span className="svc-batt-unit">V</span>
                    </div>
                    <div className="svc-muted svc-small">
                        {battery.socPct.toFixed(0)}% SoC · Tier {battery.tier} — {battery.tierLabel}
                    </div>
                    {battery.solarMa != null && (
                        <div className="svc-muted svc-small svc-inline">
                            <Sun size={14} aria-hidden="true" />
                            Panel {battery.solarV?.toFixed(2)} V · {battery.solarMa.toFixed(1)} mA
                            {battery.charging ? ' · cargando' : ' · sin carga significativa'}
                        </div>
                    )}
                </div>

                <div className="svc-risk" style={{ borderColor: risk.color }}>
                    <RiskIcon size={22} color={risk.color} aria-hidden="true" />
                    <div>
                        <div className="svc-risk-label" style={{ color: risk.color }}>{risk.label}</div>
                        <div className="svc-muted svc-small">{battery.riskNote}</div>
                    </div>
                </div>
            </div>

            <div className="svc-card-head" style={{ marginTop: '1rem' }}>
                <h4 className="svc-h4">Tendencia — un número instantáneo no distingue "se está recuperando" de "viene bajando hace tres días"</h4>
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
                <p className="svc-muted svc-small">No se pudo leer el histórico: {trendError}</p>
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
                                tickFormatter={(v) => new Date(v).toLocaleString('es-AR', {
                                    timeZone: 'America/Argentina/Buenos_Aires',
                                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                                })}
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
                                formatter={(value) => [`${value.toFixed(3)} V`, 'Batería']}
                                labelFormatter={(v) => new Date(v).toLocaleString('es-AR', {
                                    timeZone: 'America/Argentina/Buenos_Aires',
                                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                                })}
                            />
                            <ReferenceLine
                                y={THRESHOLD_SAFE}
                                stroke="#4ade80"
                                strokeDasharray="5 5"
                                label={{ value: 'seguro 4.00V', position: 'insideTopRight', fill: '#a1a1aa', fontSize: 11 }}
                            />
                            <ReferenceLine
                                y={THRESHOLD_CAUTION}
                                stroke="#f87171"
                                strokeDasharray="5 5"
                                label={{ value: 'riesgo 3.85V', position: 'insideBottomRight', fill: '#a1a1aa', fontSize: 11 }}
                            />
                            <Area
                                type="monotone"
                                dataKey="volts"
                                name="Batería"
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
