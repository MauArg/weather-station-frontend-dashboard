import React, { useEffect, useMemo, useState } from 'react';
import { ScrollText, Download, Play, Square, DownloadCloud, AlertTriangle, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import Tip from './Tip';
import {
    sendServiceCommand,
    fetchNodeLogs,
    getLastLogCapture,
    formatClock,
    LOG_EXPORT_JSON_URL,
    LOG_EXPORT_NDJSON_URL,
} from '../../services/ServiceApi';

/**
 * Node logging: arm a capture, let it run, pull it back.
 *
 * The node has no observability in the field — LOG_LEVEL=0 compiles its Serial
 * macros to no-ops, and the only sink is a USB cable inside a sealed enclosure.
 * This is the replacement: a ring of 8-byte events in RTC memory, armed on
 * demand and retrieved over MQTT.
 *
 * Two things worth knowing when reading this component:
 *
 * - Capturing is free. Writing an entry is an 8-byte memcpy, so leaving a capture
 *   running costs no measurable energy. The expensive half is the download, which
 *   needs the node awake in service mode. That is why the UI nudges towards
 *   arming generously and only warns about the retrieval.
 * - Timestamps are reconstructed by the backend, not sent by the node, which has
 *   no clock. Cycles that published telemetry are anchored to real time; the rest
 *   are interpolated — and those are precisely the cycles worth looking at, so
 *   every row says which kind it is.
 */

// Entries per wake cycle at each level, used only to estimate how long a capture
// will last. They are rough averages measured against the firmware's own
// instrumentation, not a contract.
const LEVELS = [
    {
        value: 1,
        label: 'Anomalías',
        entriesPerCycle: 0.7,
        blurb: 'Sólo los fallos: WiFi, MQTT y publish. Un ciclo sano no escribe nada.',
    },
    {
        value: 2,
        label: 'Resumen',
        entriesPerCycle: 1.7,
        blurb: 'Un renglón por etapa del ciclo, más las anomalías. Es el que responde “¿WiFi o MQTT?”.',
    },
    {
        value: 3,
        label: 'Verboso',
        entriesPerCycle: 5,
        blurb: 'Cada intento de WiFi por separado. Para cuando el nivel 2 no alcanza.',
    },
];

// Intervalo observable entre ciclos. El nodo duerme SLEEP_INTERVAL_SEC = 60, pero
// cada wake gasta además WiFi, MQTT, la espera del retenido y los sensores antes
// de publicar. Medido contra InfluxDB da 60-67 s con mediana de 64.
const CYCLE_SEC = 64;

const formatWindow = (ringEntries, entriesPerCycle) => {
    if (!ringEntries || !entriesPerCycle) return '—';
    const hours = (ringEntries / entriesPerCycle) * CYCLE_SEC / 3600;
    if (hours < 1) return `~${Math.round(hours * 60)} min`;
    return `~${hours.toFixed(1)} h`;
};

const LogPanel = ({ state, connected }) => {
    // El backend viejo no manda `logs` en el snapshot. Puede pasar de verdad: el
    // frontend y el backend se despliegan como dos imágenes distintas, así que hay
    // una ventana en la que uno está actualizado y el otro no. Sin este guard el
    // panel se vería roto —captura "apagada" que no se puede armar, botón muerto
    // sin motivo— y parecería un bug del nodo en vez de un deploy a medias.
    const supported = state?.logs !== undefined;
    const logs = state?.logs ?? {};
    const [level, setLevel] = useState(2);
    const [keep, setKeep] = useState(false);
    const [busy, setBusy] = useState(false);
    const [capture, setCapture] = useState(null);
    const [codeFilter, setCodeFilter] = useState('all');
    const [text, setText] = useState('');

    // Recupera la última captura bajada por el backend, para que recargar la
    // página no cueste otra sesión de service mode.
    useEffect(() => {
        let cancelled = false;
        getLastLogCapture()
            .then((c) => !cancelled && c && setCapture(c))
            .catch(() => { /* sin captura previa: estado inicial normal */ });
        return () => { cancelled = true; };
    }, []);

    const arm = async (lvl) => {
        setBusy(true);
        try {
            const res = await sendServiceCommand({ cmd: 'log_on', level: lvl, entries: 0 });
            toast.success(
                lvl === 0
                    ? `Captura desactivada${res.note ? ` — ${res.note}` : ''}`
                    : `Captura armada en nivel ${lvl}${res.note ? ` — ${res.note}` : ''}`
            );
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    const pull = async () => {
        setBusy(true);
        try {
            const c = await fetchNodeLogs(keep);
            setCapture(c);
            setCodeFilter('all');
            const n = c.entries?.length ?? 0;
            if (n === 0) toast('El nodo no tenía entries capturadas.', { icon: 'ℹ️' });
            else toast.success(`${n} entries bajadas${c.cleared ? ' — el nodo ya las borró' : ''}`);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    const codeNames = useMemo(() => {
        const seen = new Set();
        (capture?.entries ?? []).forEach((e) => seen.add(e.name));
        return Array.from(seen).sort();
    }, [capture]);

    const filtered = useMemo(() => {
        let rows = capture?.entries ?? [];
        if (codeFilter !== 'all') rows = rows.filter((e) => e.name === codeFilter);
        if (text.trim()) {
            const needle = text.trim().toLowerCase();
            rows = rows.filter((e) => e.text?.toLowerCase().includes(needle));
        }
        return rows;
    }, [capture, codeFilter, text]);

    const ring = logs.ringEntries || 768;
    const fillPct = logs.active && ring ? Math.min(100, (logs.count / ring) * 100) : 0;
    const activeLevel = LEVELS.find((l) => l.value === logs.level);

    if (!supported) {
        return (
            <div className="svc-card svc-span-2">
                <div className="svc-card-head">
                    <h3><ScrollText size={17} aria-hidden="true" /> Logs del nodo</h3>
                </div>
                <div className="svc-alert svc-alert-info">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div>
                        <strong>El backend todavía no expone el sistema de logs.</strong>
                        <div className="svc-small">
                            Este panel necesita el campo <code>logs</code> en el snapshot de estado.
                            Rebuildeá y redesplegá la imagen del backend; el firmware del nodo además
                            tiene que estar en 1.3.0 o superior.
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="svc-card svc-span-2">
            <div className="svc-card-head">
                <h3><ScrollText size={17} aria-hidden="true" /> Logs del nodo</h3>
                <span className="svc-muted svc-small">
                    Capturar no cuesta energía; bajar los logs necesita el nodo en service mode
                </span>
            </div>

            {/* ── Estado de la captura ─────────────────────────────────────── */}
            <div className="svc-chips" style={{ marginBottom: '0.75rem' }}>
                {logs.active ? (
                    <span className="svc-chip" style={{ borderColor: '#4ade80', color: '#4ade80' }}>
                        <Play size={13} aria-hidden="true" /> Capturando · nivel {logs.level}
                        {activeLevel ? ` (${activeLevel.label})` : ''}
                    </span>
                ) : (
                    <span className="svc-chip svc-badge-muted">
                        <Square size={13} aria-hidden="true" /> Captura apagada
                    </span>
                )}
                {logs.dictKnown && (
                    <Tip
                        className="svc-chip svc-badge-muted"
                        text="El backend ya tiene cacheado el diccionario código→texto de esta versión de firmware, así que no hace falta pedírselo al nodo en la próxima descarga."
                    >
                        diccionario en caché
                    </Tip>
                )}
            </div>

            {logs.active && (
                <div className="svc-budget">
                    <div className="svc-budget-head">
                        <span className="svc-small">Ring: {logs.count} / {ring} entries</span>
                        <span className="svc-muted svc-small">
                            {fillPct >= 100
                                ? 'lleno — ya está pisando lo más viejo'
                                : `${Math.round(fillPct)}% ocupado`}
                        </span>
                    </div>
                    <div className="svc-budget-bar">
                        <div
                            className="svc-budget-fill"
                            style={{ width: `${fillPct}%`, background: fillPct >= 100 ? '#facc15' : '#4dabf7' }}
                        />
                    </div>
                </div>
            )}

            {/* ── Armar ────────────────────────────────────────────────────── */}
            <label className="svc-kv-label" style={{ marginTop: '0.75rem' }}>Nivel de captura</label>
            <div className="svc-toolbar">
                {LEVELS.map((l) => (
                    <button
                        key={l.value}
                        className={`svc-range-btn ${level === l.value ? 'active' : ''}`}
                        onClick={() => setLevel(l.value)}
                    >
                        {l.label} · {formatWindow(ring, l.entriesPerCycle)}
                    </button>
                ))}
            </div>
            <p className="svc-muted svc-small" style={{ marginTop: '0.4rem' }}>
                {LEVELS.find((l) => l.value === level)?.blurb}{' '}
                La ventana estimada asume ciclos de {CYCLE_SEC} s. El ring vive en RTC memory y no se
                puede agrandar: más detalle es menos horas.
            </p>

            <div className="svc-btn-row" style={{ marginTop: '0.6rem' }}>
                <button
                    className="svc-btn svc-btn-primary"
                    disabled={busy || !connected}
                    onClick={() => arm(level)}
                >
                    <Play size={16} /> Armar captura
                </button>
                <button
                    className="svc-btn"
                    disabled={busy || !connected || !logs.active}
                    onClick={() => arm(0)}
                >
                    <Square size={16} /> Desactivar
                </button>
            </div>
            <p className="svc-muted svc-small svc-card-foot">
                Armar borra lo que hubiera capturado antes. El comando se publica retenido, así que
                el nodo lo levanta recién en su próximo despertar — hasta un ciclo de demora.
            </p>

            {/* ── Bajar ────────────────────────────────────────────────────── */}
            <div className="svc-btn-row" style={{ marginTop: '0.9rem' }}>
                <button
                    className="svc-btn svc-btn-primary"
                    disabled={busy || !logs.canFetch}
                    onClick={pull}
                >
                    <DownloadCloud size={16} /> {busy ? 'Bajando…' : 'Traer logs del nodo'}
                </button>
                <label className="svc-checkbox">
                    <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
                    <Tip text="Trae una copia sin desactivar la captura ni vaciar el ring, para investigaciones que siguen corriendo. Por defecto la descarga borra y desarma.">
                        mantener capturando
                    </Tip>
                </label>
            </div>
            {!logs.canFetch && logs.cantWhy && (
                <p className="svc-muted svc-small svc-card-foot">{logs.cantWhy}</p>
            )}
            {logs.lastError && (
                <div className="svc-alert svc-alert-warn" style={{ marginTop: '0.6rem' }}>
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div>
                        <strong>La última descarga falló.</strong>
                        <div className="svc-small">{logs.lastError}</div>
                    </div>
                </div>
            )}

            {/* ── Captura ──────────────────────────────────────────────────── */}
            {capture && (
                <>
                    <div className="svc-card-head" style={{ marginTop: '1rem' }}>
                        <h4 className="svc-h4">
                            Captura · {capture.count || capture.entries?.length || 0} entries
                            {capture.firmware ? ` · ${capture.firmware}` : ''}
                        </h4>
                        <div className="svc-toolbar">
                            <a className="svc-icon-btn" href={LOG_EXPORT_JSON_URL} download>
                                <Download size={15} /> JSON
                            </a>
                            <a className="svc-icon-btn" href={LOG_EXPORT_NDJSON_URL} download>
                                <Download size={15} /> NDJSON
                            </a>
                        </div>
                    </div>
                    <p className="svc-muted svc-small">
                        Bajada {formatClock(capture.fetchedAt)}.{' '}
                        {capture.cleared
                            ? (capture.kept ? 'El ring se vació pero la captura sigue activa.' : 'El nodo borró el ring y desarmó la captura.')
                            : 'El nodo no confirmó el borrado: la captura sigue ocupando el ring.'}{' '}
                        Los exports incluyen el diccionario y las anclas de tiempo, así que se leen aunque
                        el firmware avance.
                    </p>

                    {capture.dropped > 0 && (
                        <div className="svc-alert svc-alert-warn" style={{ marginTop: '0.5rem' }}>
                            <AlertTriangle size={18} aria-hidden="true" />
                            <div>
                                <strong>Captura truncada.</strong>
                                <div className="svc-small">
                                    El ring pisó {capture.dropped} entries por wraparound: falta el principio de la
                                    ventana y puede faltar justo el evento que buscabas. Para la próxima, un nivel
                                    más magro dura más.
                                </div>
                            </div>
                        </div>
                    )}

                    {capture.notes?.map((n, i) => (
                        <p key={i} className="svc-muted svc-small" style={{ marginTop: '0.35rem' }}>{n}</p>
                    ))}

                    {(capture.entries?.length ?? 0) > 0 && (
                        <>
                            <div className="svc-toolbar" style={{ marginTop: '0.6rem' }}>
                                <button
                                    className={`svc-range-btn ${codeFilter === 'all' ? 'active' : ''}`}
                                    onClick={() => setCodeFilter('all')}
                                >
                                    todos
                                </button>
                                {codeNames.map((n) => (
                                    <button
                                        key={n}
                                        className={`svc-range-btn ${codeFilter === n ? 'active' : ''}`}
                                        onClick={() => setCodeFilter(n)}
                                    >
                                        {n.replace(/^LOG_/, '').toLowerCase()}
                                    </button>
                                ))}
                            </div>

                            <div className="svc-raw-row" style={{ marginTop: '0.5rem' }}>
                                <input
                                    className="svc-input"
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    placeholder="Filtrar por texto — p. ej. rssi, timeout, mqtt"
                                    spellCheck={false}
                                />
                                <span className="svc-muted svc-small" style={{ alignSelf: 'center' }}>
                                    <Search size={13} aria-hidden="true" /> {filtered.length}
                                </span>
                            </div>

                            <div className="svc-log" style={{ marginTop: '0.5rem' }}>
                                {filtered.length === 0 && (
                                    <p className="svc-muted svc-small">Ninguna entry coincide con el filtro.</p>
                                )}
                                {filtered.map((e, i) => (
                                    <div key={i} className="svc-log-row">
                                        <div className="svc-log-head">
                                            <span className="svc-log-time">
                                                {e.at ? formatClock(e.at) : '—'}
                                                {e.at && !e.atAnchored && (
                                                    <Tip text="Hora estimada: este ciclo no publicó telemetría, así que se interpoló desde el ciclo anclado más cercano usando el tiempo despierto real. El timer de deep sleep tiene ±5%, así que la deriva crece con la distancia.">
                                                        {' '}≈
                                                    </Tip>
                                                )}
                                            </span>
                                            <span className="svc-badge svc-badge-muted">#{e.boot}</span>
                                            <span className="svc-muted svc-small">{e.ms} ms</span>
                                            <span className="svc-log-topic">{e.text}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
};

export default LogPanel;
