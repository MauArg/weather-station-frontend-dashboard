import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle, Cpu, Wifi, AlertTriangle, Bug, HardDrive, Info, Eye, EyeOff } from 'lucide-react';
import { formatClock, formatAge } from '../../utils/timezone';
import { apiText } from '../../i18n/apiText';
import { useNow } from '../../hooks/useNow';
import Tip from './Tip';

const NodeHealthPanel = ({ state }) => {
    const { t } = useTranslation('service');
    const { node, telemetry, battery, payloadBudget } = state;

    // dht11_ok earns its own sentence: the physical sensor has been a DHT22
    // since 2026-07-25 and the field name was kept to avoid splitting the
    // InfluxDB series, which is worth explaining wherever the name shows up.
    const sensorTip = (key) =>
        key === 'dht11_ok' ? t('health.sensorTipDht') : t('health.sensorTipGeneric', { key });
    // Coalesce rather than destructure with defaults: Go marshals an empty slice
    // as null, and a default parameter only fires on undefined.
    const sensorCatalog = state.sensorCatalog ?? [];
    const bootAnomalies = state.bootAnomalies ?? [];

    // `expected` was only recently added by the backend; against an old one it
    // arrives as undefined and everything counts as unexplained. That's the
    // correct degradation —the frontend has no way to claim otherwise— and it
    // corrects itself on redeploy.
    const expectedCount = bootAnomalies.filter((a) => a.expected).length;
    const unexplained = bootAnomalies.length - expectedCount;
    const [onlyUnexplained, setOnlyUnexplained] = useState(false);
    const visibleAnomalies = bootAnomalies
        .filter((a) => !onlyUnexplained || !a.expected)
        .reverse();

    // The one-second clock left with the countdown; what is still time-sensitive
    // here is the age on each boot_count anomaly. Every 15 s is enough for those,
    // the same call PayloadViewer makes for the same reason: ages are read in
    // minutes and hours, and ticking every second would re-render the sensor and
    // anomaly lists sixty times a minute to change nothing.
    const now = useNow(15000);

    const sizeBytes = telemetry?.sizeBytes ?? 0;
    const usedPct = payloadBudget ? Math.min(100, (sizeBytes / payloadBudget) * 100) : 0;
    // The firmware drops the whole publish silently when the payload does not fit,
    // so the interesting question is how much headroom is left, not the raw size.
    const headroom = payloadBudget - sizeBytes;
    const budgetColor = headroom < 30 ? '#f87171' : headroom < 80 ? '#facc15' : '#4ade80';

    return (
        <div className="svc-card">
            {/* The state pill and the last-seen/next-expected pair used to open this
                card. They moved to the strip pinned above the tabs — they are the
                context every tab needs, and behind one they would be the thing you
                leave what you are doing to go check. Repeating them here would just
                be the same fact twice on the same screen. */}
            <div className="svc-card-head">
                <h3>{t('health.title')}</h3>
            </div>

            <div className="svc-kv-grid">
                <div className="svc-kv">
                    <span className="svc-kv-label"><Cpu size={13} aria-hidden="true" /> {t('health.firmware')}</span>
                    <span className="svc-kv-value">
                        {telemetry?.firmware || '—'}
                        {node?.firmwareIsDebug && (
                            <Tip text={t('health.debugTip')}>
                                <span className="svc-badge svc-badge-warn">
                                    <Bug size={12} aria-hidden="true" /> {t('health.debugBuild')}
                                </span>
                            </Tip>
                        )}
                    </span>
                </div>
                <div className="svc-kv">
                    <Tip className="svc-tip-right" text={t('health.bootCountTip')}>
                        <span className="svc-kv-label"><HardDrive size={13} aria-hidden="true" /> boot_count</span>
                    </Tip>
                    <span className="svc-kv-value">{telemetry?.bootCount ?? '—'}</span>
                </div>
                <div className="svc-kv">
                    <Tip className="svc-tip-right" text={t('health.rssiTip')}>
                        <span className="svc-kv-label"><Wifi size={13} aria-hidden="true" /> RSSI</span>
                    </Tip>
                    <span className="svc-kv-value">{telemetry?.rssiDbm != null ? `${telemetry.rssiDbm} dBm` : '—'}</span>
                </div>
            </div>

            {/* Payload budget */}
            <div className="svc-budget">
                <div className="svc-budget-head">
                    <Tip className="svc-tip-left" text={t('health.payloadTip')}>
                        <span className="svc-kv-label">{t('health.payloadLabel')}</span>
                    </Tip>
                    <span className="svc-kv-value">
                        {sizeBytes} B / {payloadBudget} B
                        <span className="svc-muted svc-small">{t('health.headroom', { bytes: headroom })}</span>
                    </span>
                </div>
                <div className="svc-budget-bar" role="img" aria-label={t('health.payloadAria', { used: sizeBytes, total: payloadBudget })}>
                    <div className="svc-budget-fill" style={{ width: `${usedPct}%`, background: budgetColor }} />
                </div>
            </div>

            {/* Sensor chips */}
            <h4 className="svc-h4">{t('health.sensors')}</h4>
            <div className="svc-chips">
                {/* The catalogue still comes from the backend — it is the authority
                    on which sensors exist — but the label is translated by key,
                    with the backend's own label as the fallback so a sensor added
                    there still renders before it is translated here. */}
                {sensorCatalog.map(({ key, label }) => {
                    const value = telemetry?.sensors?.[key];
                    const present = value === true;
                    const missing = value === undefined;
                    const Icon = present ? CheckCircle2 : XCircle;
                    const color = present ? '#4ade80' : missing ? '#a1a1aa' : '#f87171';
                    return (
                        <Tip key={key} text={sensorTip(key)}>
                            <span className="svc-chip" style={{ borderColor: `${color}55` }}>
                                <Icon size={14} color={color} aria-hidden="true" />
                                <span>{apiText(t, 'sensor', key, label)}</span>
                                <span className="svc-muted svc-small">
                                    {present ? t('health.sensorOk') : missing ? t('health.sensorMissing') : t('health.sensorFailed')}
                                </span>
                            </span>
                        </Tip>
                    );
                })}
            </div>

            {/* Boot anomalies */}
            {bootAnomalies.length > 0 && (
                <>
                    {/* The "unexplained" count is what makes the list readable at a
                        glance. It keeps the last 20 with no time limit, and most of
                        them are routine gaps or reboots someone asked for: without
                        this number you have to scan the whole list to know if
                        something happened. */}
                    <div className="svc-card-head" style={{ marginBottom: '0.4rem' }}>
                        <h4 className="svc-h4">
                            {t('health.anomaliesTitle', { count: bootAnomalies.length })}
                            {unexplained > 0
                                ? <span style={{ color: '#facc15' }}>{t('health.unexplained', { count: unexplained })}</span>
                                : <span className="svc-muted">{t('health.allExplained')}</span>}
                        </h4>
                        {expectedCount > 0 && (
                            <button
                                className="svc-icon-btn svc-tip"
                                data-tip={t('health.hideExpectedTip')}
                                onClick={() => setOnlyUnexplained((v) => !v)}
                            >
                                {onlyUnexplained ? <Eye size={14} /> : <EyeOff size={14} />}
                                {onlyUnexplained
                                    ? t('health.showExpected', { count: expectedCount })
                                    : t('health.hideExpected')}
                            </button>
                        )}
                    </div>
                    <ul className="svc-anomalies">
                        {visibleAnomalies.length === 0 && (
                            <li className="svc-muted svc-small">{t('health.noneUnexplained')}</li>
                        )}
                        {visibleAnomalies.map((a, i) => {
                            // Expected ones —a reboot you requested, a reflash— are
                            // still listed because they explain a break in the
                            // series, but not as a warning: if the alarm goes off for
                            // an action you just took on purpose, you learn to ignore
                            // it. The icon changes along with the color, which alone
                            // is not enough.
                            const Icon = a.expected ? Info : AlertTriangle;
                            const color = a.expected ? '#a1a1aa' : a.kind === 'gap' ? '#facc15' : '#f87171';
                            // Age is essential here: the list keeps the last 20 with
                            // no time limit and the backend runs 24/7, so coming back
                            // after a night away it's full of old events whose
                            // HH:MM:SS does not say which day they are from.
                            const age = formatAge(a.at, now);
                            return (
                                <li key={`${a.at}-${i}`} style={a.expected ? { opacity: 0.75 } : undefined}>
                                    <Icon size={14} color={color} aria-hidden="true" />
                                    <span>
                                        <strong>{formatClock(a.at)}</strong>
                                        {age && <span className="svc-muted"> ({age})</span>}
                                        {/* `cause` splits what used to be visible
                                            only in the prose; `note` is the
                                            fallback for a backend that predates it. */}
                                        {' '}— {a.previous} → {a.current}.{' '}
                                        {/* `count`, not `missed`: i18next selects the
                                            plural form on `count` and nothing else, and
                                            a gap of exactly one payload is the common
                                            case. */}
                                        {apiText(t, 'anomaly', a.cause, a.note, { count: a.missed })}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}

            {battery?.source === 'service_heartbeat' && (
                <p className="svc-muted svc-small svc-card-foot">{t('health.heartbeatVoltageNote')}</p>
            )}
        </div>
    );
};

export default NodeHealthPanel;
