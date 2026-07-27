import React from 'react';
import { CheckCircle2, XCircle, Cpu, Wifi, Moon, Radio, AlertTriangle, HelpCircle, Bug, HardDrive } from 'lucide-react';
import { formatClock } from '../../services/ServiceApi';
import { useNow } from '../../hooks/useNow';
import Tip from './Tip';

const NODE_STATE_UI = {
    service_mode: {
        label: 'En service mode', color: '#4dabf7', Icon: Radio,
        tip: 'El nodo está despierto con ArduinoOTA escuchando. Durante la sesión no publica telemetría, solo heartbeats cada 30 s — por eso "último visto" pasa a contarse contra el heartbeat.',
    },
    sleeping: {
        label: 'Ciclo normal', color: '#4ade80', Icon: Moon,
        tip: 'El nodo duerme y despierta cada 60 s para medir, publicar y volver a dormir. Entre wakes no es alcanzable por red: para flashear hay que activar service mode.',
    },
    overdue: {
        label: 'Atrasado', color: '#f87171', Icon: AlertTriangle,
        tip: 'Pasó un ciclo completo más el margen de conexión sin que llegue telemetría. Lo habitual es que el nodo haya despertado pero no lograra conectar WiFi o MQTT en ese wake, así que se durmió sin publicar. Un ciclo suelto es normal con señal marginal; varios seguidos ya no.',
    },
    unknown: {
        label: 'Sin datos', color: '#a1a1aa', Icon: HelpCircle,
        tip: 'Todavía no llegó ningún mensaje del nodo desde que arrancó el backend. Si persiste más de un minuto, revisá la conexión con el broker.',
    },
};

// De dónde salió el último contacto. Importa mostrarlo porque cada fuente implica
// un ritmo distinto de reaparición, y por lo tanto una cuenta regresiva distinta.
const LAST_SEEN_SOURCE = {
    telemetry: 'telemetría',
    heartbeat: 'heartbeat de service mode',
    service_ended: 'fin de service mode',
    reboot: 'reinicio',
    ping: 'respuesta a ping',
};

const sensorTip = (key) => (
    key === 'dht11_ok'
        ? 'Campo dht11_ok del JSON. El sensor físico es un DHT22 desde 2026-07-25; el nombre se conservó para no partir la serie histórica en InfluxDB.'
        : `Campo ${key} del JSON de telemetría.`
);

const NodeHealthPanel = ({ state }) => {
    const { node, telemetry, battery, payloadBudget } = state;
    // Coalesce rather than destructure with defaults: Go marshals an empty slice
    // as null, and a default parameter only fires on undefined.
    const sensorCatalog = state.sensorCatalog ?? [];
    const bootAnomalies = state.bootAnomalies ?? [];

    const now = useNow(1000);
    const ui = NODE_STATE_UI[node?.state] ?? NODE_STATE_UI.unknown;
    const StateIcon = ui.Icon;

    // Ambos contadores se derivan de instantes absolutos contra un reloj que corre,
    // no del entero que mandó el backend: entre pushes ese número queda viejo, y el
    // caso que más importa mostrar —el nodo que no reaparece— es justamente aquel en
    // el que no hay pushes nuevos que lo actualicen.
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
                <h3>Estado del nodo</h3>
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
                            <Tip text="LOG_LEVEL=2: el setup() quema 2 s fijos en delay(2000) en cada wake, a 50-140 mA, sin ningún beneficio en campo. Reflashear con ota_production.">
                                <span className="svc-badge svc-badge-warn">
                                    <Bug size={12} aria-hidden="true" /> build de debug
                                </span>
                            </Tip>
                        )}
                    </span>
                </div>
                <div className="svc-kv">
                    <Tip className="svc-tip-left" text="Contador de wakes guardado en RTC memory. Incrementa al principio del setup(), antes de la red, así que un salto significa que el nodo despertó pero no llegó a publicar. Vuelve a cero al reflashear o si se corta la alimentación.">
                        <span className="svc-kv-label"><HardDrive size={13} aria-hidden="true" /> boot_count</span>
                    </Tip>
                    <span className="svc-kv-value">{telemetry?.bootCount ?? '—'}</span>
                </div>
                <div className="svc-kv">
                    <Tip className="svc-tip-left" text="Potencia de la señal WiFi vista por el nodo. Por encima de -70 dBm el enlace es sano; cerca de -80 se vuelve marginal y empiezan a aparecer wakes que no logran publicar.">
                        <span className="svc-kv-label"><Wifi size={13} aria-hidden="true" /> RSSI</span>
                    </Tip>
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
                                {' '}({LAST_SEEN_SOURCE[node.lastSeenSource] ?? node.lastSeenSource})
                            </span>
                        )}
                        {secondsSince != null && secondsSince >= 0 && (
                            <span className="svc-muted svc-small"> · hace {secondsSince}s</span>
                        )}
                    </span>
                </div>
                <div className="svc-lastseen-next">
                    <span className="svc-kv-label">
                        {node?.state === 'overdue' ? 'Se esperaba' : 'Próxima aparición'}
                    </span>
                    <span className="svc-kv-value">
                        {node?.nextExpectedAt ? `~${formatClock(node.nextExpectedAt)}` : '—'}
                        {secondsUntil != null && (
                            <Tip
                                text={
                                    secondsUntil > 0
                                        ? `Cuenta regresiva hasta el próximo mensaje esperado, cada ${node.expectedIntervalSec} s. Si llega a cero y sigue bajando, el nodo no apareció cuando debía.`
                                        : `El nodo debería haber publicado hace ${Math.abs(secondsUntil)} s. Un atraso corto es normal —el wake tarda unos segundos en conectar—, pero si sigue creciendo, ese ciclo se perdió.`
                                }
                            >
                                {' '}
                                <span className={countdownClass}>
                                    · {secondsUntil >= 0 ? `en ~${secondsUntil}s` : `~${secondsUntil}s`}
                                </span>
                            </Tip>
                        )}
                    </span>
                </div>
            </div>

            {/* Payload budget */}
            <div className="svc-budget">
                <div className="svc-budget-head">
                    <Tip className="svc-tip-left" text="Bytes útiles del buffer de PubSubClient: 768 menos el header y el nombre del topic. Si el payload no entra, el publish se descarta entero y en silencio — ya pasó en las madrugadas bajo cero, cuando cada temperatura negativa suma un dígito.">
                        <span className="svc-kv-label">Tamaño del payload de telemetría</span>
                    </Tip>
                    <span className="svc-kv-value">
                        {sizeBytes} B / {payloadBudget} B
                        <span className="svc-muted svc-small"> · {headroom} B de margen</span>
                    </span>
                </div>
                <div className="svc-budget-bar" role="img" aria-label={`Payload ${sizeBytes} de ${payloadBudget} bytes`}>
                    <div className="svc-budget-fill" style={{ width: `${usedPct}%`, background: budgetColor }} />
                </div>
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
                        <Tip key={key} text={sensorTip(key)}>
                            <span className="svc-chip" style={{ borderColor: `${color}55` }}>
                                <Icon size={14} color={color} aria-hidden="true" />
                                <span>{label}</span>
                                <span className="svc-muted svc-small">{present ? 'OK' : missing ? 'ausente' : 'FALLA'}</span>
                            </span>
                        </Tip>
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
