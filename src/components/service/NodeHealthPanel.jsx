import React, { useState } from 'react';
import { CheckCircle2, XCircle, Cpu, Wifi, Moon, Radio, AlertTriangle, HelpCircle, Bug, HardDrive, Info, Eye, EyeOff } from 'lucide-react';
import { formatClock, formatAge } from '../../services/ServiceApi';
import { useNow } from '../../hooks/useNow';
import Tip from './Tip';

const NODE_STATE_UI = {
    service_mode: {
        label: 'In service mode', color: '#4dabf7', Icon: Radio,
        tip: 'The node is awake with ArduinoOTA listening. During the session it does not publish telemetry, only heartbeats every 30 s — that\'s why "last seen" switches to counting against the heartbeat.',
    },
    sleeping: {
        label: 'Normal cycle', color: '#4ade80', Icon: Moon,
        tip: 'The node sleeps and wakes every 60 s to measure, publish and go back to sleep. Between wakes it is not reachable over the network: flashing requires activating service mode.',
    },
    overdue: {
        label: 'Overdue', color: '#f87171', Icon: AlertTriangle,
        tip: 'A full cycle plus the connection margin has passed with no telemetry arriving. Usually the node woke up but failed to connect to WiFi or MQTT on that wake, so it went back to sleep without publishing. One isolated cycle is normal with marginal signal; several in a row is not.',
    },
    unknown: {
        label: 'No data', color: '#a1a1aa', Icon: HelpCircle,
        tip: 'No message from the node has arrived yet since the backend started. If this persists for more than a minute, check the connection to the broker.',
    },
};

// Where the last contact came from. Worth showing because each source implies
// a different reappearance rhythm, and therefore a different countdown.
const LAST_SEEN_SOURCE = {
    telemetry: 'telemetry',
    heartbeat: 'service mode heartbeat',
    service_ended: 'service mode ended',
    reboot: 'reboot',
    ping: 'ping response',
};

const sensorTip = (key) => (
    key === 'dht11_ok'
        ? 'dht11_ok field in the JSON. The physical sensor has been a DHT22 since 2026-07-25; the name was kept so as not to split the historical series in InfluxDB.'
        : `${key} field in the telemetry JSON.`
);

const NodeHealthPanel = ({ state }) => {
    const { node, telemetry, battery, payloadBudget } = state;
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

    const now = useNow(1000);
    const ui = NODE_STATE_UI[node?.state] ?? NODE_STATE_UI.unknown;
    const StateIcon = ui.Icon;

    // Both counters are derived from absolute instants against a running clock,
    // not from the integer the backend sent: between pushes that number goes
    // stale, and the case that matters most to show —the node that never comes
    // back— is exactly the one with no new pushes to update it.
    const lastSeenMs = node?.lastSeenAt ? new Date(node.lastSeenAt).getTime() : null;
    const nextMs = node?.nextExpectedAt ? new Date(node.nextExpectedAt).getTime() : null;
    const secondsSince = lastSeenMs != null ? Math.round((now - lastSeenMs) / 1000) : null;
    const secondsUntil = nextMs != null ? Math.round((nextMs - now) / 1000) : null;

    const countdownClass = node?.state === 'overdue'
        ? 'svc-countdown svc-countdown-late'
        : secondsUntil != null && secondsUntil <= 0
            ? 'svc-countdown svc-countdown-due'
            : 'svc-countdown';

    const sizeBytes = telemetry?.sizeBytes ?? 0;
    const usedPct = payloadBudget ? Math.min(100, (sizeBytes / payloadBudget) * 100) : 0;
    // The firmware drops the whole publish silently when the payload does not fit,
    // so the interesting question is how much headroom is left, not the raw size.
    const headroom = payloadBudget - sizeBytes;
    const budgetColor = headroom < 30 ? '#f87171' : headroom < 80 ? '#facc15' : '#4ade80';

    return (
        <div className="svc-card">
            <div className="svc-card-head">
                <h3>Node health</h3>
                <Tip text={ui.tip}>
                    <span className="svc-status-pill" style={{ borderColor: ui.color, color: ui.color }}>
                        <StateIcon size={15} aria-hidden="true" /> {ui.label}
                    </span>
                </Tip>
            </div>

            <div className="svc-kv-grid">
                <div className="svc-kv">
                    <span className="svc-kv-label"><Cpu size={13} aria-hidden="true" /> Firmware</span>
                    <span className="svc-kv-value">
                        {telemetry?.firmware || '—'}
                        {node?.firmwareIsDebug && (
                            <Tip text="LOG_LEVEL=2: setup() burns a fixed 2 s in delay(2000) on every wake, at 50-140 mA, with no benefit in the field. Reflash with ota_production.">
                                <span className="svc-badge svc-badge-warn">
                                    <Bug size={12} aria-hidden="true" /> debug build
                                </span>
                            </Tip>
                        )}
                    </span>
                </div>
                <div className="svc-kv">
                    <Tip className="svc-tip-left" text="Wake counter stored in RTC memory. It increments at the start of setup(), before networking, so a jump means the node woke up but did not get to publish. Resets to zero on reflash or on power loss.">
                        <span className="svc-kv-label"><HardDrive size={13} aria-hidden="true" /> boot_count</span>
                    </Tip>
                    <span className="svc-kv-value">{telemetry?.bootCount ?? '—'}</span>
                </div>
                <div className="svc-kv">
                    <Tip className="svc-tip-left" text="WiFi signal strength as seen by the node. Above -70 dBm the link is healthy; near -80 it becomes marginal and wakes that fail to publish start showing up.">
                        <span className="svc-kv-label"><Wifi size={13} aria-hidden="true" /> RSSI</span>
                    </Tip>
                    <span className="svc-kv-value">{telemetry?.rssiDbm != null ? `${telemetry.rssiDbm} dBm` : '—'}</span>
                </div>
            </div>

            {/* Its own row rather than another grid cell: with the source and the
                next expected time it doesn't fit a 150px column and wrapped across
                several lines. The source matters — in service mode the node does
                not publish telemetry, only heartbeats, so watching the telemetry
                clock would show a frozen time exactly when the node is most alive. */}
            <div className="svc-lastseen">
                <div>
                    <span className="svc-kv-label">Last seen</span>
                    <span className="svc-kv-value">
                        {node?.lastSeenAt ? formatClock(node.lastSeenAt) : '—'}
                        {node?.lastSeenSource && (
                            <span className="svc-muted svc-small">
                                {' '}({LAST_SEEN_SOURCE[node.lastSeenSource] ?? node.lastSeenSource})
                            </span>
                        )}
                        {secondsSince != null && secondsSince >= 0 && (
                            <span className="svc-muted svc-small"> · {secondsSince}s ago</span>
                        )}
                    </span>
                </div>
                <div className="svc-lastseen-next">
                    <span className="svc-kv-label">
                        {node?.state === 'overdue' ? 'Was expected' : 'Next expected'}
                    </span>
                    <span className="svc-kv-value">
                        {node?.nextExpectedAt ? `~${formatClock(node.nextExpectedAt)}` : '—'}
                        {secondsUntil != null && (
                            <Tip
                                text={
                                    secondsUntil > 0
                                        ? `Countdown to the next expected message, every ${node.expectedIntervalSec} s. If it reaches zero and keeps dropping, the node did not show up when it should have.`
                                        : `The node should have published ${Math.abs(secondsUntil)} s ago. A short delay is normal —the wake takes a few seconds to connect— but if it keeps growing, that cycle was lost.`
                                }
                            >
                                {' '}
                                <span className={countdownClass}>
                                    · {secondsUntil >= 0 ? `in ~${secondsUntil}s` : `~${secondsUntil}s`}
                                </span>
                            </Tip>
                        )}
                    </span>
                </div>
            </div>

            {/* Payload budget */}
            <div className="svc-budget">
                <div className="svc-budget-head">
                    <Tip className="svc-tip-left" text="Usable bytes of the PubSubClient buffer: 768 minus the header and the topic name. If the payload doesn't fit, the whole publish is silently dropped — it has already happened on sub-zero early mornings, when every negative temperature adds a digit.">
                        <span className="svc-kv-label">Telemetry payload size</span>
                    </Tip>
                    <span className="svc-kv-value">
                        {sizeBytes} B / {payloadBudget} B
                        <span className="svc-muted svc-small"> · {headroom} B of headroom</span>
                    </span>
                </div>
                <div className="svc-budget-bar" role="img" aria-label={`Payload ${sizeBytes} of ${payloadBudget} bytes`}>
                    <div className="svc-budget-fill" style={{ width: `${usedPct}%`, background: budgetColor }} />
                </div>
            </div>

            {/* Sensor chips */}
            <h4 className="svc-h4">Sensors</h4>
            <div className="svc-chips">
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
                                <span>{label}</span>
                                <span className="svc-muted svc-small">{present ? 'OK' : missing ? 'missing' : 'FAILED'}</span>
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
                            boot_count discontinuities · {bootAnomalies.length}
                            {unexplained > 0
                                ? <span style={{ color: '#facc15' }}> · {unexplained} unexplained</span>
                                : <span className="svc-muted"> · all explained</span>}
                        </h4>
                        {expectedCount > 0 && (
                            <button
                                className="svc-icon-btn svc-tip"
                                data-tip="Hides reboots that explain themselves —a reboot you requested, a reflash— to leave only what deserves attention."
                                onClick={() => setOnlyUnexplained((v) => !v)}
                            >
                                {onlyUnexplained ? <Eye size={14} /> : <EyeOff size={14} />}
                                {onlyUnexplained ? `show the ${expectedCount} expected` : 'hide expected'}
                            </button>
                        )}
                    </div>
                    <ul className="svc-anomalies">
                        {visibleAnomalies.length === 0 && (
                            <li className="svc-muted svc-small">
                                None unexplained. All discontinuities come from a reboot or a reflash.
                            </li>
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
                                        {' '}— {a.previous} → {a.current}. {a.note}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}

            {battery?.source === 'service_heartbeat' && (
                <p className="svc-muted svc-small svc-card-foot">
                    The voltage shown comes from the service mode heartbeat, i.e. measured with the node awake and draining.
                </p>
            )}
        </div>
    );
};

export default NodeHealthPanel;
