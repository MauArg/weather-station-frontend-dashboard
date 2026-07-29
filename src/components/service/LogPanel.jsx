import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ScrollText, Download, Play, Square, DownloadCloud, AlertTriangle, Search,
    ChevronRight, ChevronDown, Info, Wrench, Loader2, Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Tip from './Tip';
import ConfirmDialog from './ConfirmDialog';
import { useNow } from '../../hooks/useNow';
import {
    sendServiceCommand,
    fetchNodeLogs,
    getLastLogCapture,
    formatClock,
    formatElapsed,
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

// El número y el nombre juntos, siempre en el mismo orden. El nivel es lo que
// viaja en el comando y en el firmware; el nombre es lo único que se entiende de
// un vistazo. Nombrar uno solo obliga a traducir mentalmente entre la pantalla y
// el `level` que se ve en los payloads.
const levelName = (value) => {
    const level = LEVELS.find((l) => l.value === value);
    return level ? `nivel ${value} (${level.label})` : `nivel ${value}`;
};

// Cuánto puede tardar el nodo en levantar un comando retenido antes de que valga
// la pena sospechar: tres ciclos y monedas. Un ciclo suele alcanzar, pero el
// payload de confirmación viaja por el mismo camino que pierde el 42% de la
// telemetría, así que un par de ciclos sin novedades no prueban nada.
const PENDING_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * Hace cuánto corre la captura que hay ahora en el nodo.
 *
 * Componente aparte por el tick: lleva su propio reloj para que el minuto que
 * pasa no re-renderice la lista de eventos transferidos, que puede tener cientos
 * de renglones. 15 s alcanza porque se muestra en minutos y horas.
 */
const CaptureUptime = ({ since, exact }) => {
    const now = useNow(15000);
    const started = new Date(since).getTime();
    if (isNaN(started)) return null;

    const elapsed = formatElapsed(Math.floor((now - started) / 1000));
    // El "≥" no es cosmético: sin haber visto arrancar la captura, el número es un
    // piso y no una medición. Ver LogState.ActiveSinceExact en el backend.
    return exact ? elapsed : `≥ ${elapsed}`;
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
    const [transferring, setTransferring] = useState(false);
    const [capture, setCapture] = useState(null);
    const [codeFilter, setCodeFilter] = useState('all');
    const [text, setText] = useState('');

    // 'stop' | 'start' | null. Las dos acciones vacían la memoria del nodo, así
    // que las dos se confirman — guardar sólo una dejaría el otro camino abierto,
    // y peor, haría creer que ese otro es inofensivo.
    const [confirm, setConfirm] = useState(null);

    // Comando de captura publicado, esperando que el nodo lo aplique. Ver el
    // efecto de más abajo.
    const [pending, setPending] = useState(null);

    // El comando retenido lleva un solo mensaje, así que hay que mirar cuál es y
    // no sólo si hay alguno: session.armed del backend se prende con cualquiera,
    // incluido el log_on que acabamos de publicar nosotros.
    const inServiceMode = state?.node?.state === 'service_mode';
    const maintenanceArmed = Boolean(
        state?.retainedCmd?.present && state.retainedCmd.cmd === 'maintenance'
    );
    const retainedIsLogCmd = Boolean(
        state?.retainedCmd?.present && state.retainedCmd.cmd === 'log_on'
    );
    const telemetryAt = state?.telemetry?.receivedAt ?? null;

    // El selector muestra lo que vas a aplicar, pero tiene que arrancar en lo que
    // el nodo está haciendo de verdad. Mostrar "Resumen" seleccionado mientras el
    // nodo captura en "Verboso" es la clase de desajuste que hace desconfiar de
    // toda la pantalla. Se sincroniza cuando el nodo reporta un nivel distinto, y
    // después respeta lo que elijas a mano.
    const nodeLevel = logs.active ? logs.level : 0;
    // Arranca en 0 y no en nodeLevel: inicializarlo con el valor del primer render
    // hace que la comparación de abajo sea falsa justo esa primera vez, que es
    // cuando más importa — el panel se abre con una captura ya corriendo.
    const prevNodeLevel = useRef(0);
    useEffect(() => {
        if (nodeLevel && nodeLevel !== prevNodeLevel.current) setLevel(nodeLevel);
        prevNodeLevel.current = nodeLevel;
    }, [nodeLevel]);

    // ── Espera del comando de captura ─────────────────────────────────────────
    //
    // Publicar el comando no cambia nada en el nodo: queda retenido hasta que
    // despierte, lo lea y lo aplique, o sea hasta un ciclo entero. El POST vuelve
    // en milisegundos, así que sin esto el click no movía nada en pantalla —el
    // chip seguía diciendo lo mismo— y se leía como que el botón no funcionaba.
    //
    // La confirmación pide tres cosas a la vez, y las tres hacen falta:
    //
    //  - `applied`: el nodo reporta el estado que le pedimos.
    //  - `fresh`: lo reporta en una telemetría posterior al click, no en la que ya
    //    estaba en pantalla cuando se apretó el botón.
    //  - `moved`: algo cambió de verdad. Sin esto, volver a arrancar una captura en
    //    el mismo nivel que ya corría se daría por aplicada con la primera
    //    telemetría que llegue, aunque el nodo todavía no haya leído el comando.
    //
    // `moved` mira tres señales porque ninguna sola cubre todos los casos: el nodo
    // limpia el retenido al consumirlo (pero ese publish puede perderse, como el
    // 42% de los otros), el nivel cambia (pero no si se re-arranca en el mismo), y
    // el contador retrocede (logging_configure() vacía el ring, y el contador nunca
    // baja solo: satura en la capacidad cuando empieza a pisar lo viejo).
    useEffect(() => {
        if (!pending) return undefined;

        if (retainedIsLogCmd && !pending.sawRetained) {
            setPending((p) => (p && !p.sawRetained ? { ...p, sawRetained: true } : p));
            return undefined;
        }

        const applied = pending.kind === 'stop'
            ? !logs.active
            : logs.active && logs.level === pending.level;
        const fresh = telemetryAt != null && telemetryAt !== pending.telemetryAt;
        const moved = (pending.sawRetained && !retainedIsLogCmd)
            || logs.active !== pending.before.active
            || logs.level !== pending.before.level
            || logs.count < pending.before.count;

        if (applied && fresh && moved) {
            setPending(null);
            toast.success(pending.kind === 'stop'
                ? 'El nodo detuvo la captura y vació su memoria.'
                : `El nodo está capturando en ${levelName(pending.level)}.`);
            return undefined;
        }

        // Se agotó la espera. No se deshace nada: el comando sigue retenido y el
        // nodo lo va a aplicar cuando logre leerlo. Lo único que se suelta es la UI,
        // que si no quedaría bloqueada indefinidamente por un nodo que no aparece.
        const id = setTimeout(() => {
            setPending(null);
            toast.error(
                'El nodo no confirmó el cambio de captura. El comando sigue retenido: ' +
                'si el nodo aparece, lo va a aplicar — mirá el chip de estado en un par de ciclos.'
            );
        }, Math.max(0, pending.deadline - Date.now()));
        return () => clearTimeout(id);
    }, [pending, logs.active, logs.level, logs.count, retainedIsLogCmd, telemetryAt]);

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
        // Foto de lo que el nodo reportaba antes de publicar. Es contra esto que se
        // decide después si el nodo aplicó el comando o todavía no lo leyó.
        const before = { active: logs.active, level: logs.level, count: logs.count };
        try {
            const res = await sendServiceCommand({ cmd: 'log_on', level: lvl, entries: 0 });
            setPending({
                kind: lvl === 0 ? 'stop' : 'start',
                level: lvl,
                before,
                telemetryAt,
                sawRetained: false,
                deadline: Date.now() + PENDING_TIMEOUT_MS,
            });
            // "Publicado" y no "iniciada": en este punto lo único que pasó es que el
            // mensaje quedó en el broker. Decir que la captura arrancó era la mentira
            // que hacía parecer que después no pasaba nada.
            toast.success(
                (lvl === 0
                    ? 'Comando de detener captura publicado'
                    : `Comando de captura en ${levelName(lvl)} publicado`)
                + (res.note ? ` — ${res.note}` : '')
            );
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    const transfer = async () => {
        setBusy(true);
        setTransferring(true);
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
            setTransferring(false);
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

    // La transferencia necesita al nodo despierto y suscripto, o sea en service
    // mode. Es la parte del flujo que no se explicaba sola: el estado decía
    // "capturando" y el botón estaba muerto, sin decir qué hacer al respecto.
    const needsServiceMode = !logs.canFetch && !inServiceMode && connected && !logs.fetching;

    // Al revés que transferir, cambiar la captura NO se puede hacer con el nodo en
    // service mode, y no es una cuestión de esperar más: el comando se pierde.
    // El loop de service_mode.cpp sólo reacciona al retenido cuando llega vacío
    // —ese es el "salí de service mode"— y descarta cualquier otro payload; después,
    // al cerrar la sesión, serviceMode_exit() limpia el topic y se lleva puesto el
    // log_on que estaba esperando. Y como el topic retenido guarda un solo mensaje,
    // publicarlo pisa el `maintenance` que sostiene la sesión de OTA.
    const captureLocked = inServiceMode || maintenanceArmed;

    const armServiceMode = async () => {
        setBusy(true);
        try {
            const res = await sendServiceCommand({ cmd: 'maintenance', timeoutMin: 15 });
            toast.success(`Service mode pedido${res.note ? ` — ${res.note}` : ''}`);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    // Se muestra plegado o desplegado, pero nunca oculto: si quedó una captura
    // corriendo hace semanas, tiene que verse sin abrir nada. Por el mismo motivo
    // el tiempo corriendo va acá y no sólo en el cuerpo: "¿ya pasaron las 2 h que
    // quería capturar?" se tiene que contestar sin abrir el panel.
    const stateChip = logs.active ? (
        <span className="svc-chip" style={{ borderColor: '#4ade80', color: '#4ade80' }}>
            <Play size={13} aria-hidden="true" /> Capturando · {levelName(logs.level)} · {logs.count}/{ring}
            {logs.activeSince && (
                <> · <CaptureUptime since={logs.activeSince} exact={logs.activeSinceExact} /></>
            )}
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
                Capturar corre durante los ciclos normales y no cuesta energía. Transferir es lo
                único que necesita al nodo despierto, y por eso va en un paso aparte.
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
                    {logs.activeSince && (
                        <p className="svc-muted svc-small" style={{ marginTop: '0.4rem' }}>
                            <Clock size={13} aria-hidden="true" />{' '}
                            {logs.activeSinceExact ? (
                                <Tip text="Cuándo arrancó la ventana que el nodo tiene guardada ahora. Se reinicia al cambiar de nivel y al transferir, porque en los dos casos el nodo vacía su memoria. Lo deriva el backend mirando la telemetría —el nodo no tiene reloj—, así que tiene la precisión de un ciclo.">
                                    Capturando desde las {formatClock(logs.activeSince)}
                                </Tip>
                            ) : (
                                <Tip text="El backend encontró la captura ya corriendo —se reinició después de que arrancó—, así que no sabe cuándo empezó de verdad. El número es un piso: puede llevar mucho más.">
                                    Corriendo desde antes de las {formatClock(logs.activeSince)}
                                </Tip>
                            )}
                            {' — '}
                            <CaptureUptime since={logs.activeSince} exact={logs.activeSinceExact} />
                        </p>
                    )}
                </div>
            )}

            {/* ── Paso 1 ───────────────────────────────────────────────────── */}
            <h4 className="svc-h4" style={{ marginTop: '1rem' }}>1 · Capturar en el nodo</h4>
            <label className="svc-kv-label" style={{ marginTop: '0.4rem' }}>Nivel de captura</label>
            <div className="svc-toolbar">
                {LEVELS.map((l) => (
                    <button
                        key={l.value}
                        className={`svc-range-btn svc-tip ${level === l.value ? 'active' : ''}`}
                        data-tip={`Nivel ${l.value}. ${l.blurb} Dura ${formatWindow(ring, l.entriesPerCycle)} antes de empezar a reemplazar los eventos más viejos.`}
                        onClick={() => setLevel(l.value)}
                    >
                        {l.label} (N{l.value}) · {formatWindow(ring, l.entriesPerCycle)}
                    </button>
                ))}
            </div>
            <p className="svc-muted svc-small" style={{ marginTop: '0.4rem' }}>
                Nivel {level}: {LEVELS.find((l) => l.value === level)?.blurb}{' '}
                La ventana estimada asume ciclos de {CYCLE_SEC} s. La memoria de captura vive en la RTC
                memory del ESP32 y no se puede agrandar: más detalle es menos horas.
            </p>

            {logs.active && logs.level !== level && (
                <p className="svc-small" style={{ marginTop: '0.35rem', color: '#fde68a' }}>
                    El nodo está capturando en {levelName(logs.level)}. Comenzar de nuevo lo cambia a{' '}
                    {levelName(level)} y descarta lo capturado hasta ahora.
                </p>
            )}

            <div className="svc-btn-row" style={{ marginTop: '0.6rem' }}>
                <button
                    className="svc-btn svc-btn-primary svc-tip"
                    data-tip="Publica el comando en el topic retenido. El nodo lo levanta al despertar (hasta un ciclo de demora) y arranca de cero: lo que hubiera capturado antes se descarta."
                    disabled={busy || !connected || pending !== null || captureLocked}
                    onClick={() => (logs.active ? setConfirm('start') : setCaptureLevel(level))}
                >
                    {pending?.kind === 'start'
                        ? <><Loader2 size={16} className="animate-spin" /> Comenzando captura…</>
                        : <><Play size={16} /> Comenzar captura</>}
                </button>
                <button
                    className="svc-btn svc-tip"
                    data-tip="Detiene la captura y vacía la memoria del nodo. Si quedaron eventos sin transferir, se pierden — conviene transferir primero."
                    disabled={busy || !connected || !logs.active || pending !== null || captureLocked}
                    onClick={() => setConfirm('stop')}
                >
                    {pending?.kind === 'stop'
                        ? <><Loader2 size={16} className="animate-spin" /> Deteniendo captura…</>
                        : <><Square size={16} /> Detener captura</>}
                </button>
            </div>

            {/* La espera es el estado normal de este paso, no una excepción: el nodo
                duerme 60 s de cada 64 y sólo mira el topic retenido al despertar. */}
            {pending && (
                <div className="svc-alert svc-alert-info" style={{ marginTop: '0.6rem' }}>
                    <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                    <div>
                        <strong>
                            {pending.kind === 'stop'
                                ? 'Deteniendo la captura'
                                : `Comenzando la captura en ${levelName(pending.level)}`}
                            {' '}— esperando al nodo.
                        </strong>
                        <div className="svc-small">
                            {pending.sawRetained && !retainedIsLogCmd ? (
                                <>El nodo levantó el comando y lo está aplicando. Falta la telemetría que
                                lo confirme, que sale en este mismo ciclo.</>
                            ) : (
                                <>
                                    El comando quedó retenido en el broker. El nodo lo lee recién al
                                    despertar
                                    {state?.node?.nextWakeInSec > 0
                                        ? `, en ~${state.node.nextWakeInSec} s`
                                        : ''}
                                    , y hasta entonces sigue capturando como estaba. Si el ciclo no logra
                                    publicar —pasa seguido— la confirmación se atrasa hasta el siguiente.
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {captureLocked && !pending && (
                <div className="svc-alert svc-alert-warn" style={{ marginTop: '0.6rem' }}>
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div>
                        <strong>No se puede cambiar la captura con el nodo en service mode.</strong>
                        <div className="svc-small">
                            {inServiceMode
                                ? 'Durante la sesión el nodo ignora todo lo que llegue al topic de comandos salvo el pedido de salir, y al cerrarla limpia el topic — así que el comando no se demoraría, se perdería.'
                                : 'Hay un comando de mantenimiento retenido esperando a que el nodo despierte. El topic guarda un mensaje solo, así que publicar la captura acá lo pisaría y cancelaría el service mode.'}
                            {' '}Transferir sí funciona. Para cambiar la captura, salí de service mode y
                            esperá al próximo ciclo normal.
                        </div>
                    </div>
                </div>
            )}

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
                    ? <>Hay una captura activa en {levelName(logs.level)}. Comenzar una nueva la borra y arranca de cero.</>
                    : <>Al detenerse, el nodo vacía su memoria de captura.</>}
                {' '}El nodo reportó <strong>{logs.count} eventos</strong> en su última telemetría
                {logs.count > 0 && <> — si no los transferiste, se pierden</>}.
                {' '}El número puede estar hasta un ciclo atrasado, así que podría haber más.
                {logs.count > 0 && (
                    <> Si te interesan, cancelá y usá <em>Transferir logs desde el nodo</em> primero
                    {confirm === 'stop' && <> (deja la memoria vacía y la captura detenida, que es lo mismo que buscabas)</>}.</>
                )}
            </ConfirmDialog>

            {/* ── Paso 2 ───────────────────────────────────────────────────── */}
            <h4 className="svc-h4" style={{ marginTop: '1.2rem' }}>2 · Transferir al backend</h4>

            {/* El requisito va ANTES del botón y con la acción adentro. Antes esta
                explicación colgaba debajo de todo, así que se leía como si fuera la
                respuesta a "Comenzar captura" — el botón de arriba— en vez del
                requisito del de abajo. */}
            {needsServiceMode && (
                <div className="svc-alert svc-alert-info" style={{ marginTop: '0.4rem' }}>
                    <Info size={18} aria-hidden="true" />
                    <div>
                        <strong>Primero hay que despertar al nodo.</strong>
                        <div className="svc-small">
                            Fuera de una sesión de service mode el nodo duerme 60 s de cada 70 y no
                            escucha el topic de pedidos, así que no puede responder una transferencia.
                            La captura mientras tanto sigue corriendo sin problema.
                        </div>
                        <button
                            className="svc-btn svc-tip"
                            style={{ marginTop: '0.6rem' }}
                            data-tip="Publica el comando de mantenimiento con el timeout por defecto de 15 min. El nodo lo levanta en su próximo despertar y queda despierto — recién ahí se puede transferir."
                            disabled={busy || maintenanceArmed}
                            onClick={armServiceMode}
                        >
                            <Wrench size={16} /> {maintenanceArmed ? 'Service mode ya pedido — esperando al nodo' : 'Activar service mode'}
                        </button>
                    </div>
                </div>
            )}

            {!logs.canFetch && !needsServiceMode && logs.cantWhy && (
                <p className="svc-muted svc-small" style={{ marginTop: '0.4rem' }}>{logs.cantWhy}</p>
            )}

            <div className="svc-btn-row" style={{ marginTop: '0.6rem' }}>
                <button
                    className="svc-btn svc-btn-primary svc-tip"
                    data-tip="Trae los eventos capturados página por página. El nodo sólo los borra después de que el backend confirma que llegaron todos, así que una transferencia cortada no cuesta la captura."
                    disabled={busy || !logs.canFetch}
                    onClick={transfer}
                >
                    {/* El label mira `transferring` y no `busy`: `busy` lo comparten
                        todas las acciones del panel, así que arrancar una captura
                        ponía este botón en "Transfiriendo…" sin que nadie transfiera. */}
                    <DownloadCloud size={16} /> {transferring ? 'Transfiriendo…' : 'Transferir logs desde el nodo'}
                </button>
                <label className="svc-checkbox">
                    <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
                    <Tip text="Trae una copia sin detener la captura ni vaciar la memoria del nodo, para investigaciones que siguen corriendo. Por defecto la transferencia vacía y detiene.">
                        mantener captura activa
                    </Tip>
                </label>
            </div>
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
                    <div className="svc-card-head" style={{ marginTop: '1.2rem' }}>
                        <h4 className="svc-h4">
                            3 · Revisar · {capture.count || capture.entries?.length || 0} eventos
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
