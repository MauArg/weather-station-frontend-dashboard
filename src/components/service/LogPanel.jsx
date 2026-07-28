import React, { useEffect, useMemo, useState } from 'react';
import {
    ScrollText, Download, Play, Square, DownloadCloud, AlertTriangle, Search,
    ChevronRight, ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Tip from './Tip';
import ConfirmDialog from './ConfirmDialog';
import {
    sendServiceCommand,
    fetchNodeLogs,
    getLastLogCapture,
    formatClock,
    LOG_EXPORT_JSON_URL,
    LOG_EXPORT_NDJSON_URL,
} from '../../services/ServiceApi';

/**
 * Node logging: start a capture, let it run, transfer it back.
 *
 * The node has no observability in the field — LOG_LEVEL=0 compiles its Serial
 * macros to no-ops, and the only sink is a USB cable inside a sealed enclosure.
 * This is the replacement: a ring of 8-byte events in RTC memory, started on
 * demand and retrieved over MQTT.
 *
 * Three things worth knowing when reading this component:
 *
 * - Capturing is free. Writing an entry is an 8-byte memcpy, so leaving a capture
 *   running costs no measurable energy. The expensive half is the transfer, which
 *   needs the node awake in service mode.
 * - Timestamps are reconstructed by the backend, not sent by the node, which has
 *   no clock. Cycles that published telemetry are anchored to real time; the rest
 *   are interpolated — and those are precisely the cycles worth looking at, so
 *   every row says which kind it is.
 * - The panel is collapsed by default because debugging the node is occasional.
 *   The capture state stays visible in the collapsed header anyway: the whole
 *   reason the firmware spends payload bytes on log_active is so a capture left
 *   running cannot be forgotten, and hiding it behind a click would undo that.
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
    // panel se vería roto —captura "apagada" que no se puede iniciar, botón muerto
    // sin motivo— y parecería un bug del nodo en vez de un deploy a medias.
    const supported = state?.logs !== undefined;
    const logs = state?.logs ?? {};

    const [open, setOpen] = useState(false);
    const [level, setLevel] = useState(2);
    const [keep, setKeep] = useState(false);
    const [busy, setBusy] = useState(false);
    const [capture, setCapture] = useState(null);
    const [codeFilter, setCodeFilter] = useState('all');
    const [text, setText] = useState('');

    // 'stop' | 'start' | null. Las dos acciones vacían la memoria del nodo, así
    // que las dos se confirman — guardar sólo una dejaría el otro camino abierto,
    // y peor, haría creer que ese otro es inofensivo.
    const [confirm, setConfirm] = useState(null);

    // Recupera la última captura transferida por el backend, para que recargar la
    // página no cueste otra sesión de service mode.
    useEffect(() => {
        let cancelled = false;
        getLastLogCapture()
            .then((c) => !cancelled && c && setCapture(c))
            .catch(() => { /* sin captura previa: estado inicial normal */ });
        return () => { cancelled = true; };
    }, []);

    const setCaptureLevel = async (lvl) => {
        setBusy(true);
        try {
            const res = await sendServiceCommand({ cmd: 'log_on', level: lvl, entries: 0 });
            toast.success(
                lvl === 0
                    ? `Captura detenida${res.note ? ` — ${res.note}` : ''}`
                    : `Captura iniciada en nivel ${lvl}${res.note ? ` — ${res.note}` : ''}`
            );
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    const transfer = async () => {
        setBusy(true);
        try {
            const c = await fetchNodeLogs(keep);
            setCapture(c);
            setCodeFilter('all');
            const n = c.entries?.length ?? 0;
            if (n === 0) toast('El nodo no tenía eventos capturados.', { icon: 'ℹ️' });
            else toast.success(`${n} eventos transferidos${c.cleared ? ' — el nodo ya los borró' : ''}`);
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

    // Se muestra plegado o desplegado, pero nunca oculto: si quedó una captura
    // corriendo hace semanas, tiene que verse sin abrir nada.
    const stateChip = logs.active ? (
        <span className="svc-chip" style={{ borderColor: '#4ade80', color: '#4ade80' }}>
            <Play size={13} aria-hidden="true" /> Capturando · nivel {logs.level}
            {activeLevel ? ` (${activeLevel.label})` : ''} · {logs.count}/{ring}
        </span>
    ) : (
        <span className="svc-chip svc-badge-muted">
            <Square size={13} aria-hidden="true" /> Captura detenida
        </span>
    );

    const head = (
        <button
            className="svc-collapse-head"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
        >
            {open ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronRight size={17} aria-hidden="true" />}
            <h3><ScrollText size={17} aria-hidden="true" /> Logs del nodo</h3>
            {supported && stateChip}
            <span className="svc-muted svc-small svc-collapse-spacer">
                {open ? 'ocultar' : 'mostrar'}
            </span>
        </button>
    );

    if (!supported) {
        return (
            <div className="svc-card svc-span-2">
                {head}
                {open && (
                    <div className="svc-alert svc-alert-info" style={{ marginTop: '0.75rem' }}>
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
                )}
            </div>
        );
    }

    if (!open) {
        return <div className="svc-card svc-span-2">{head}</div>;
    }

    return (
        <div className="svc-card svc-span-2">
            {head}

            <p className="svc-muted svc-small" style={{ marginTop: '0.5rem' }}>
                Capturar no cuesta energía; transferir los logs necesita el nodo en service mode.
            </p>

            {logs.dictKnown && (
                <div className="svc-chips" style={{ marginTop: '0.5rem' }}>
                    <Tip
                        className="svc-chip svc-badge-muted"
                        text="El backend ya tiene cacheado el diccionario código→texto de esta versión de firmware, así que no hace falta pedírselo al nodo en la próxima transferencia."
                    >
                        diccionario en caché
                    </Tip>
                </div>
            )}

            {logs.active && (
                <div className="svc-budget" style={{ marginTop: '0.5rem' }}>
                    <div className="svc-budget-head">
                        <span className="svc-small">Memoria de captura: {logs.count} / {ring} eventos</span>
                        <span className="svc-muted svc-small">
                            {fillPct >= 100
                                ? 'llena — ya está reemplazando los eventos más viejos'
                                : `${Math.round(fillPct)}% ocupada`}
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

            {/* ── Iniciar / detener ────────────────────────────────────────── */}
            <label className="svc-kv-label" style={{ marginTop: '0.75rem' }}>Nivel de captura</label>
            <div className="svc-toolbar">
                {LEVELS.map((l) => (
                    <button
                        key={l.value}
                        className={`svc-range-btn svc-tip ${level === l.value ? 'active' : ''}`}
                        data-tip={`${l.blurb} Dura ${formatWindow(ring, l.entriesPerCycle)} antes de empezar a reemplazar los eventos más viejos.`}
                        onClick={() => setLevel(l.value)}
                    >
                        {l.label} · {formatWindow(ring, l.entriesPerCycle)}
                    </button>
                ))}
            </div>
            <p className="svc-muted svc-small" style={{ marginTop: '0.4rem' }}>
                {LEVELS.find((l) => l.value === level)?.blurb}{' '}
                La ventana estimada asume ciclos de {CYCLE_SEC} s. La memoria de captura vive en la RTC
                memory del ESP32 y no se puede agrandar: más detalle es menos horas.
            </p>

            <div className="svc-btn-row" style={{ marginTop: '0.6rem' }}>
                <button
                    className="svc-btn svc-btn-primary svc-tip"
                    data-tip="Publica el comando en el topic retenido. El nodo lo levanta al despertar (hasta un ciclo de demora) y arranca de cero: lo que hubiera capturado antes se descarta."
                    disabled={busy || !connected}
                    onClick={() => (logs.active ? setConfirm('start') : setCaptureLevel(level))}
                >
                    <Play size={16} /> Comenzar captura
                </button>
                <button
                    className="svc-btn svc-tip"
                    data-tip="Detiene la captura y vacía la memoria del nodo. Si quedaron eventos sin transferir, se pierden — conviene transferir primero."
                    disabled={busy || !connected || !logs.active}
                    onClick={() => setConfirm('stop')}
                >
                    <Square size={16} /> Detener captura
                </button>
            </div>

            <ConfirmDialog
                open={confirm !== null}
                title={confirm === 'start'
                    ? 'Comenzar descarta la captura en curso'
                    : 'Detener vacía la memoria del nodo'}
                confirmLabel={confirm === 'start' ? 'Descartar y comenzar' : 'Detener y borrar'}
                onCancel={() => setConfirm(null)}
                onConfirm={() => {
                    const kind = confirm;
                    setConfirm(null);
                    setCaptureLevel(kind === 'start' ? level : 0);
                }}
            >
                {confirm === 'start'
                    ? <>Hay una captura activa en nivel {logs.level}. Comenzar una nueva la borra y arranca de cero.</>
                    : <>Al detenerse, el nodo vacía su memoria de captura.</>}
                {' '}El nodo reportó <strong>{logs.count} eventos</strong> en su última telemetría
                {logs.count > 0 && <> — si no los transferiste, se pierden</>}.
                {' '}El número puede estar hasta un ciclo atrasado, así que podría haber más.
                {logs.count > 0 && (
                    <> Si te interesan, cancelá y usá <em>Transferir logs desde el nodo</em> primero
                    {confirm === 'stop' && <> (deja la memoria vacía y la captura detenida, que es lo mismo que buscabas)</>}.</>
                )}
            </ConfirmDialog>

            {/* ── Transferir ───────────────────────────────────────────────── */}
            <div className="svc-btn-row" style={{ marginTop: '0.9rem' }}>
                <button
                    className="svc-btn svc-btn-primary svc-tip"
                    data-tip="Trae los eventos capturados página por página. El nodo sólo los borra después de que el backend confirma que llegaron todos, así que una transferencia cortada no cuesta la captura."
                    disabled={busy || !logs.canFetch}
                    onClick={transfer}
                >
                    <DownloadCloud size={16} /> {busy ? 'Transfiriendo…' : 'Transferir logs desde el nodo'}
                </button>
                <label className="svc-checkbox">
                    <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
                    <Tip text="Trae una copia sin detener la captura ni vaciar la memoria del nodo, para investigaciones que siguen corriendo. Por defecto la transferencia vacía y detiene.">
                        mantener captura activa
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
                        <strong>La última transferencia falló.</strong>
                        <div className="svc-small">{logs.lastError}</div>
                    </div>
                </div>
            )}

            {/* ── Captura transferida ──────────────────────────────────────── */}
            {capture && (
                <>
                    <div className="svc-card-head" style={{ marginTop: '1rem' }}>
                        <h4 className="svc-h4">
                            Captura · {capture.count || capture.entries?.length || 0} eventos
                            {capture.firmware ? ` · ${capture.firmware}` : ''}
                        </h4>
                        <div className="svc-toolbar">
                            <a
                                className="svc-icon-btn svc-tip"
                                data-tip="Descarga la captura como JSON, con el diccionario de códigos y las anclas de tiempo adentro. Se lee aunque el firmware avance y renumere los códigos."
                                href={LOG_EXPORT_JSON_URL}
                                download
                            >
                                <Download size={15} /> JSON
                            </a>
                            <a
                                className="svc-icon-btn svc-tip"
                                data-tip="Igual que el JSON pero un evento por línea, con una primera línea de cabecera. Mismo formato que el export del visor de payloads."
                                href={LOG_EXPORT_NDJSON_URL}
                                download
                            >
                                <Download size={15} /> NDJSON
                            </a>
                        </div>
                    </div>
                    <p className="svc-muted svc-small">
                        Transferida {formatClock(capture.fetchedAt)}.{' '}
                        {capture.cleared
                            ? (capture.kept
                                ? 'La memoria del nodo se vació pero la captura sigue activa.'
                                : 'El nodo vació su memoria y detuvo la captura.')
                            : 'El nodo no confirmó el borrado: la captura sigue ocupando su memoria.'}
                    </p>

                    {capture.dropped > 0 && (
                        <div className="svc-alert svc-alert-warn" style={{ marginTop: '0.5rem' }}>
                            <AlertTriangle size={18} aria-hidden="true" />
                            <div>
                                <strong>Faltan los eventos más viejos.</strong>
                                <div className="svc-small">
                                    La memoria del nodo se llenó y reemplazó {capture.dropped} eventos por otros
                                    más nuevos, así que la captura no llega hasta el principio de la ventana y
                                    puede no cubrir lo que buscabas. Para la próxima, un nivel más magro dura más.
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
                                    <p className="svc-muted svc-small">Ningún evento coincide con el filtro.</p>
                                )}
                                {filtered.map((e, i) => (
                                    <div key={i} className="svc-log-row">
                                        <div className="svc-log-head">
                                            <span className="svc-log-time">
                                                {e.at ? formatClock(e.at) : '—'}
                                                {e.at && !e.atAnchored && (
                                                    <Tip text="Hora estimada: este ciclo no publicó telemetría, así que se interpoló desde el ciclo con hora real más cercano usando el tiempo despierto medido. El timer de deep sleep tiene ±5%, así que la desviación crece con la distancia.">
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
