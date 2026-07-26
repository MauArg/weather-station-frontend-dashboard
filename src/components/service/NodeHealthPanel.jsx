import React from 'react';
import { CheckCircle2, XCircle, Cpu, Wifi, Moon, Radio, AlertTriangle, HelpCircle, Bug, HardDrive } from 'lucide-react';
import { formatClock } from '../../services/ServiceApi';

const NODE_STATE_UI = {
    service_mode: { label: 'En service mode', color: '#4dabf7', Icon: Radio },
    sleeping: { label: 'Ciclo normal', color: '#4ade80', Icon: Moon },
    overdue: { label: 'Atrasado', color: '#f87171', Icon: AlertTriangle },
    unknown: { label: 'Sin datos', color: '#a1a1aa', Icon: HelpCircle },
};

const NodeHealthPanel = ({ state }) => {
    const { node, telemetry, battery, payloadBudget } = state;
    // Coalesce rather than destructure with defaults: Go marshals an empty slice
    // as null, and a default parameter only fires on undefined.
    const sensorCatalog = state.sensorCatalog ?? [];
    const bootAnomalies = state.bootAnomalies ?? [];
    const ui = NODE_STATE_UI[node?.state] ?? NODE_STATE_UI.unknown;
    const StateIcon = ui.Icon;

    const sizeBytes = telemetry?.sizeBytes ?? 0;
    const usedPct = payloadBudget ? Math.min(100, (sizeBytes / payloadBudget) * 100) : 0;
    // The firmware drops the whole publish silently when the payload does not fit,
    // so the interesting question is how much headroom is left, not the raw size.
    const headroom = payloadBudget - sizeBytes;
    const budgetColor = headroom < 30 ? '#f87171' : headroom < 80 ? '#facc15' : '#4ade80';

    return (
        <div className="svc-card">
            <div className="svc-card-head">
                <h3>Estado del nodo</h3>
                <span className="svc-status-pill" style={{ borderColor: ui.color, color: ui.color }}>
                    <StateIcon size={15} aria-hidden="true" /> {ui.label}
                </span>
            </div>

            <div className="svc-kv-grid">
                <div className="svc-kv">
                    <span className="svc-kv-label"><Cpu size={13} aria-hidden="true" /> Firmware</span>
                    <span className="svc-kv-value">
                        {telemetry?.firmware || '—'}
                        {node?.firmwareIsDebug && (
                            <span className="svc-badge svc-badge-warn" title="LOG_LEVEL=2: el setup() quema 2s fijos en delay(2000) por cada wake, a 50-140 mA, sin beneficio en campo">
                                <Bug size={12} aria-hidden="true" /> build de debug
                            </span>
                        )}
                    </span>
                </div>
                <div className="svc-kv">
                    <span className="svc-kv-label"><HardDrive size={13} aria-hidden="true" /> boot_count</span>
                    <span className="svc-kv-value">{telemetry?.bootCount ?? '—'}</span>
                </div>
                <div className="svc-kv">
                    <span className="svc-kv-label"><Wifi size={13} aria-hidden="true" /> RSSI</span>
                    <span className="svc-kv-value">{telemetry?.rssiDbm != null ? `${telemetry.rssiDbm} dBm` : '—'}</span>
                </div>
            </div>

            {/* Fila propia y no una celda más del grid: con la fuente y la próxima
                aparición no entra en una columna de 150px y se partía en varias
                líneas. La fuente importa — en service mode el nodo no publica
                telemetría, solo heartbeats, así que mirar el reloj de la telemetría
                mostraría una hora congelada justo cuando el nodo está más vivo. */}
            <div className="svc-lastseen">
                <div>
                    <span className="svc-kv-label">Último visto</span>
                    <span className="svc-kv-value">
                        {node?.lastSeenAt ? formatClock(node.lastSeenAt) : '—'}
                        {node?.lastSeenSource && (
                            <span className="svc-muted svc-small">
                                {' '}({node.lastSeenSource === 'heartbeat' ? 'heartbeat de service mode' : 'telemetría'})
                            </span>
                        )}
                        {node?.secondsSinceSeen > 0 && (
                            <span className="svc-muted svc-small"> · hace {node.secondsSinceSeen}s</span>
                        )}
                    </span>
                </div>
                <div className="svc-lastseen-next">
                    <span className="svc-kv-label">
                        {node?.state === 'overdue' ? 'Se esperaba' : 'Próxima aparición'}
                    </span>
                    <span className="svc-kv-value">
                        {node?.nextExpectedAt ? `~${formatClock(node.nextExpectedAt)}` : '—'}
                        {node?.state === 'overdue' ? (
                            <span className="svc-muted svc-small"> · atrasado, cada {node.expectedIntervalSec}s</span>
                        ) : node?.nextWakeInSec > 0 ? (
                            <span className="svc-muted svc-small"> · en ~{node.nextWakeInSec}s</span>
                        ) : null}
                    </span>
                </div>
            </div>

            {/* Payload budget */}
            <div className="svc-budget">
                <div className="svc-budget-head">
                    <span className="svc-kv-label">Tamaño del payload de telemetría</span>
                    <span className="svc-kv-value">
                        {sizeBytes} B / {payloadBudget} B
                        <span className="svc-muted svc-small"> · {headroom} B de margen</span>
                    </span>
                </div>
                <div className="svc-budget-bar" role="img" aria-label={`Payload ${sizeBytes} de ${payloadBudget} bytes`}>
                    <div className="svc-budget-fill" style={{ width: `${usedPct}%`, background: budgetColor }} />
                </div>
                <p className="svc-muted svc-small">
                    PubSubClient descarta el publish entero y en silencio si el payload no entra en el buffer.
                    Con temperaturas bajo cero cada campo suma un dígito.
                </p>
            </div>

            {/* Sensor chips */}
            <h4 className="svc-h4">Sensores</h4>
            <div className="svc-chips">
                {sensorCatalog.map(({ key, label }) => {
                    const value = telemetry?.sensors?.[key];
                    const present = value === true;
                    const missing = value === undefined;
                    const Icon = present ? CheckCircle2 : XCircle;
                    const color = present ? '#4ade80' : missing ? '#a1a1aa' : '#f87171';
                    return (
                        <span key={key} className="svc-chip" style={{ borderColor: `${color}55` }}>
                            <Icon size={14} color={color} aria-hidden="true" />
                            <span>{label}</span>
                            <span className="svc-muted svc-small">{present ? 'OK' : missing ? 'ausente' : 'FALLA'}</span>
                        </span>
                    );
                })}
            </div>

            {/* Boot anomalies */}
            {bootAnomalies.length > 0 && (
                <>
                    <h4 className="svc-h4">Anomalías de boot_count</h4>
                    <ul className="svc-anomalies">
                        {bootAnomalies.slice().reverse().map((a, i) => (
                            <li key={`${a.at}-${i}`}>
                                <AlertTriangle size={14} color={a.kind === 'gap' ? '#facc15' : '#f87171'} aria-hidden="true" />
                                <span>
                                    <strong>{formatClock(a.at)}</strong> — {a.previous} → {a.current}. {a.note}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {battery?.source === 'service_heartbeat' && (
                <p className="svc-muted svc-small svc-card-foot">
                    El voltaje que se muestra viene del heartbeat de service mode, o sea medido con el nodo despierto y drenando.
                </p>
            )}
        </div>
    );
};

export default NodeHealthPanel;
