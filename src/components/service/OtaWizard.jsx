import React, { useEffect, useMemo, useState } from 'react';
import {
    Wrench, Clock, CheckCircle2, Copy, Power, Loader2, AlertTriangle, ShieldX, Terminal, ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { sendServiceCommand, formatDuration } from '../../services/ServiceApi';

const OTA_ENVS = [
    { id: 'ota_production', label: 'Producción', hint: 'LOG_LEVEL=0 — el que va a campo' },
    { id: 'ota_development', label: 'Desarrollo', hint: 'LOG_LEVEL=2 — paga 2 s de delay por wake' },
];

/**
 * Derives the wizard step from live node state rather than tracking it locally.
 *
 * The node is what actually drives this workflow: it only reads the retained
 * command when it wakes, and it announces service mode itself on the status topic.
 * Deriving the step means the UI cannot drift out of sync with the hardware — a
 * manual stepper would happily show "waiting" after the node had already left.
 */
const deriveStep = (state, session) => {
    const armed = state.retainedCmd?.present && state.retainedCmd?.cmd === 'maintenance';
    const inService = state.node?.state === 'service_mode';

    if (inService) {
        const running = state.status?.firmware;
        if (session?.firmwareAtArm && running && running !== session.firmwareAtArm) {
            return 'flashed';
        }
        return 'ready';
    }
    if (armed) return 'armed';
    return 'idle';
};

const OtaWizard = ({ state, session, onSession }) => {
    const [busy, setBusy] = useState(false);
    const [timeoutMin, setTimeoutMin] = useState(15);
    const [env, setEnv] = useState('ota_production');
    const [overrideRisk, setOverrideRisk] = useState(false);
    const [now, setNow] = useState(Date.now());

    const step = deriveStep(state, session);
    const battery = state.battery;
    const risk = battery?.flashRisk ?? 'unsafe';
    const connected = state.broker?.connected;

    // Local 1s tick so the countdown moves between the node's 30 s heartbeats.
    // Each heartbeat resets the anchor, so drift never accumulates.
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const remainingSec = useMemo(() => {
        if (step !== 'ready' && step !== 'flashed') return null;
        if (!state.status?.remainingSec) return null;
        const elapsed = (now - new Date(state.status.receivedAt).getTime()) / 1000;
        return Math.max(0, Math.round(state.status.remainingSec - elapsed));
    }, [step, state.status, now]);

    const pioCommand = `pio run -e ${env} -t upload`;

    const arm = async () => {
        setBusy(true);
        try {
            const res = await sendServiceCommand({ cmd: 'maintenance', timeoutMin });
            onSession({
                armedAt: new Date().toISOString(),
                firmwareAtArm: state.telemetry?.firmware ?? null,
                timeoutMin,
            });
            toast.success(`Service mode armado${res.note ? ` — ${res.note}` : ''}`);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    const disarm = async () => {
        setBusy(true);
        try {
            await sendServiceCommand({ cmd: 'clear' });
            onSession(null);
            toast.success('Service mode desarmado — el nodo vuelve al ciclo normal');
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    const copyCommand = async () => {
        try {
            await navigator.clipboard.writeText(pioCommand);
            toast.success('Comando copiado');
        } catch {
            toast.error('No se pudo copiar');
        }
    };

    return (
        <div className="svc-card svc-wizard">
            <div className="svc-card-head">
                <h3>Sesión de OTA</h3>
                <ol className="svc-steps">
                    {[
                        ['idle', 'Armar'],
                        ['armed', 'Esperar wake'],
                        ['ready', 'Flashear'],
                        ['flashed', 'Verificar'],
                    ].map(([id, label]) => (
                        <li key={id} className={`svc-step ${step === id ? 'active' : ''}`}>{label}</li>
                    ))}
                </ol>
            </div>

            {/* ── Paso 1 — armar ────────────────────────────────────────────── */}
            {step === 'idle' && (
                <>
                    <p className="svc-muted">
                        Publica <code>{'{"cmd":"maintenance"}'}</code> retenido. El nodo lo toma en su próximo wake,
                        levanta ArduinoOTA y avisa por el topic de status — no hace falta hacerle ping.
                    </p>

                    <div className="svc-field">
                        <label className="svc-kv-label"><Clock size={13} aria-hidden="true" /> Timeout de la sesión: <strong>{timeoutMin} min</strong></label>
                        <input
                            type="range" min={1} max={60} value={timeoutMin}
                            onChange={(e) => setTimeoutMin(Number(e.target.value))}
                            className="svc-slider"
                        />
                        <span className="svc-muted svc-small">
                            El firmware recorta a 60 min (SERVICE_MODE_MAX_TIMEOUT_MIN). Durante la sesión el nodo
                            queda despierto a 50-140 mA sin deep sleep.
                        </span>
                    </div>

                    {risk === 'unsafe' && (
                        <div className="svc-alert svc-alert-danger">
                            <ShieldX size={18} aria-hidden="true" />
                            <div>
                                <strong>Batería en {battery?.volts?.toFixed(3)} V — no conviene flashear.</strong>
                                <div className="svc-small">{battery?.riskNote}</div>
                                <label className="svc-checkbox" style={{ marginTop: '0.5rem' }}>
                                    <input type="checkbox" checked={overrideRisk} onChange={(e) => setOverrideRisk(e.target.checked)} />
                                    Entiendo el riesgo, armar igual
                                </label>
                            </div>
                        </div>
                    )}
                    {risk === 'caution' && (
                        <div className="svc-alert svc-alert-warn">
                            <AlertTriangle size={18} aria-hidden="true" />
                            <div>
                                <strong>Batería en {battery?.volts?.toFixed(3)} V.</strong>
                                <div className="svc-small">{battery?.riskNote}</div>
                            </div>
                        </div>
                    )}

                    <button
                        className="svc-btn svc-btn-primary"
                        disabled={busy || !connected || (risk === 'unsafe' && !overrideRisk)}
                        onClick={arm}
                    >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Wrench size={16} />}
                        Armar service mode
                    </button>
                    {!connected && <p className="svc-muted svc-small">Sin conexión al broker MQTT.</p>}
                </>
            )}

            {/* ── Paso 2 — esperando el wake ────────────────────────────────── */}
            {step === 'armed' && (
                <>
                    <div className="svc-waiting">
                        <Loader2 size={32} className="animate-spin" color="#4dabf7" />
                        <div>
                            <strong>Esperando que el nodo despierte</strong>
                            <div className="svc-muted svc-small">
                                {state.node?.nextWakeInSec > 0
                                    ? `Próximo wake estimado en ~${state.node.nextWakeInSec}s`
                                    : 'El nodo debería estar despertando ahora'}
                                {' · '}el comando queda retenido hasta que lo lea
                            </div>
                        </div>
                    </div>
                    <p className="svc-muted svc-small">
                        Esto reemplaza la ventana de <code>ping</code>: el nodo publica <code>service_mode_active</code> cuando
                        ArduinoOTA está levantado, que es la señal real de que se puede flashear.
                    </p>
                    <button className="svc-btn" disabled={busy} onClick={disarm}>
                        <Power size={16} /> Cancelar
                    </button>
                </>
            )}

            {/* ── Paso 3 — listo para flashear ──────────────────────────────── */}
            {(step === 'ready' || step === 'flashed') && (
                <>
                    <div className={`svc-ready ${step === 'flashed' ? 'done' : ''}`}>
                        <CheckCircle2 size={28} color={step === 'flashed' ? '#4ade80' : '#4dabf7'} aria-hidden="true" />
                        <div>
                            <strong>
                                {step === 'flashed' ? 'Flasheado y verificado' : 'Nodo listo — ArduinoOTA escuchando'}
                            </strong>
                            <div className="svc-muted svc-small">
                                {remainingSec != null && <>Quedan <strong>{formatDuration(remainingSec)}</strong> de sesión · </>}
                                corriendo <strong>{state.status?.firmware || '—'}</strong>
                                {step === 'flashed' && session?.firmwareAtArm && (
                                    <> (antes {session.firmwareAtArm})</>
                                )}
                            </div>
                        </div>
                    </div>

                    {step === 'ready' && (
                        <>
                            <div className="svc-field">
                                <label className="svc-kv-label">Entorno de PlatformIO</label>
                                <div className="svc-btn-row">
                                    {OTA_ENVS.map((e) => (
                                        <button
                                            key={e.id}
                                            className={`svc-range-btn ${env === e.id ? 'active' : ''}`}
                                            onClick={() => setEnv(e.id)}
                                            title={e.hint}
                                        >
                                            {e.label}
                                        </button>
                                    ))}
                                </div>
                                {env === 'ota_development' && (
                                    <div className="svc-alert svc-alert-warn" style={{ marginTop: '0.5rem' }}>
                                        <AlertTriangle size={18} aria-hidden="true" />
                                        <div className="svc-small">
                                            El build de desarrollo quema 2 s fijos en <code>delay(2000)</code> en cada wake,
                                            a 50-140 mA. No dejarlo en campo más de lo necesario.
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="svc-cmdline">
                                <Terminal size={16} aria-hidden="true" />
                                <code>{pioCommand}</code>
                                <button className="svc-icon-btn" onClick={copyCommand}><Copy size={14} /> Copiar</button>
                            </div>
                            <p className="svc-muted svc-small">
                                Corrélo desde <code>weather-station-station-iot/</code>. Cuando termine, el nodo reinicia,
                                vuelve a entrar en service mode solo (queda marcado en RTC memory) y publica su versión
                                nueva — ahí esta vista lo verifica sola.
                            </p>
                        </>
                    )}

                    {step === 'flashed' && (
                        <p className="svc-muted svc-small">
                            La versión cambió, así que el OTA entró bien. Desarmá para que vuelva al ciclo normal:
                            si no, sigue despierto hasta que se agote el timeout.
                        </p>
                    )}

                    <button
                        className={`svc-btn ${step === 'flashed' ? 'svc-btn-primary' : ''}`}
                        disabled={busy}
                        onClick={disarm}
                    >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
                        Desarmar y volver al ciclo normal
                        {step === 'flashed' && <ArrowRight size={16} />}
                    </button>
                </>
            )}
        </div>
    );
};

export default OtaWizard;
