import React, { useMemo, useState } from 'react';
import {
    Wrench, Clock, CheckCircle2, Copy, Power, Loader2, AlertTriangle, ShieldX, Terminal, ArrowRight, HelpCircle, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { sendServiceCommand, formatDuration, formatClock } from '../../services/ServiceApi';
import { useNow } from '../../hooks/useNow';
import { copyText } from '../../utils/clipboard';

const OTA_ENVS = [
    { id: 'ota_production', label: 'Production', hint: 'LOG_LEVEL=0 — the one that goes to the field' },
    { id: 'ota_development', label: 'Development', hint: 'LOG_LEVEL=2 — costs 2 s of delay per wake' },
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
    const now = useNow(1000);

    const step = deriveStep(state, session);
    const battery = state.battery;
    // "No reading yet" is not the same claim as "the reading is dangerous", and
    // defaulting the former to the latter produced a red "Battery at V" gate on a
    // cold start. Unknown gets its own neutral state and does not block: the first
    // telemetry cycle lands within 60 s and will raise the real gate if warranted.
    const risk = battery?.flashRisk ?? 'unknown';
    const connected = state.broker?.connected;
    const restarts = state.session?.starts ?? 0;

    // The 1 s tick is what makes the countdown move between the node's 30 s
    // heartbeats. Each heartbeat re-anchors it, so it doesn't accumulate drift.
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
            toast.success(`Service mode activated${res.note ? ` — ${res.note}` : ''}`);
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
            toast.success('Service mode deactivated — the node returns to its normal cycle');
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    const copyCommand = async () => {
        if (await copyText(pioCommand)) toast.success('Command copied');
        else toast.error('Could not copy');
    };

    return (
        <div className="svc-card svc-wizard">
            <div className="svc-card-head">
                <h3>OTA session</h3>
                <ol className="svc-steps">
                    {[
                        ['idle', 'Arm'],
                        ['armed', 'Wait for wake'],
                        ['ready', 'Flash'],
                        ['flashed', 'Verify'],
                    ].map(([id, label]) => (
                        <li key={id} className={`svc-step ${step === id ? 'active' : ''}`}>{label}</li>
                    ))}
                </ol>
            </div>

            {/* ── Step 1 — arm ────────────────────────────────────────────── */}
            {step === 'idle' && (
                <>
                    <p className="svc-muted">
                        Publishes <code>{'{"cmd":"maintenance"}'}</code> retained. The node picks it up on its next wake,
                        brings up ArduinoOTA and announces it on the status topic — no need to ping it.
                    </p>

                    <div className="svc-field">
                        <label className="svc-kv-label"><Clock size={13} aria-hidden="true" /> Session timeout: <strong>{timeoutMin} min</strong></label>
                        <input
                            type="range" min={1} max={60} value={timeoutMin}
                            onChange={(e) => setTimeoutMin(Number(e.target.value))}
                            className="svc-slider"
                        />
                        <span className="svc-muted svc-small">
                            The firmware caps this at 60 min (SERVICE_MODE_MAX_TIMEOUT_MIN). During the session the
                            node stays awake at 50-140 mA with no deep sleep.
                        </span>
                    </div>

                    {risk === 'unsafe' && (
                        <div className="svc-alert svc-alert-danger">
                            <ShieldX size={18} aria-hidden="true" />
                            <div>
                                <strong>Battery at {battery?.volts?.toFixed(3)} V — flashing is not advisable.</strong>
                                <div className="svc-small">{battery?.riskNote}</div>
                                <label className="svc-checkbox" style={{ marginTop: '0.5rem' }}>
                                    <input type="checkbox" checked={overrideRisk} onChange={(e) => setOverrideRisk(e.target.checked)} />
                                    I understand the risk, arm anyway
                                </label>
                            </div>
                        </div>
                    )}
                    {risk === 'caution' && (
                        <div className="svc-alert svc-alert-warn">
                            <AlertTriangle size={18} aria-hidden="true" />
                            <div>
                                <strong>Battery at {battery?.volts?.toFixed(3)} V.</strong>
                                <div className="svc-small">{battery?.riskNote}</div>
                            </div>
                        </div>
                    )}
                    {risk === 'unknown' && (
                        <div className="svc-alert svc-alert-info">
                            <HelpCircle size={18} aria-hidden="true" />
                            <div className="svc-small">
                                No battery reading yet — it arrives with the first telemetry cycle, within
                                60 s. If it's better to wait, the warning will show up on its own.
                            </div>
                        </div>
                    )}

                    <button
                        className="svc-btn svc-btn-primary"
                        disabled={busy || !connected || (risk === 'unsafe' && !overrideRisk)}
                        onClick={arm}
                    >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Wrench size={16} />}
                        Activate service mode
                    </button>
                    {!connected && <p className="svc-muted svc-small">No connection to the MQTT broker.</p>}
                </>
            )}

            {/* ── Step 2 — waiting for the wake ────────────────────────────────── */}
            {step === 'armed' && (
                <>
                    <div className="svc-waiting">
                        <Loader2 size={32} className="animate-spin" color="#4dabf7" />
                        <div>
                            <strong>Waiting for the node to wake up</strong>
                            <div className="svc-muted svc-small">
                                {state.node?.nextWakeInSec > 0
                                    ? `Next wake estimated in ~${state.node.nextWakeInSec}s`
                                    : 'The node should be waking up right now'}
                                {' · '}the command stays retained until it reads it
                            </div>
                        </div>
                    </div>
                    <p className="svc-muted svc-small">
                        This replaces the old <code>ping</code> window: the node publishes <code>service_mode_active</code> when
                        ArduinoOTA is up, which is the real signal that it's ready to flash.
                    </p>
                    <button className="svc-btn" disabled={busy} onClick={disarm}>
                        <Power size={16} /> Cancel
                    </button>
                </>
            )}

            {/* ── Step 3 — ready to flash ──────────────────────────────── */}
            {(step === 'ready' || step === 'flashed') && (
                <>
                    <div className={`svc-ready ${step === 'flashed' ? 'done' : ''}`}>
                        <CheckCircle2 size={28} color={step === 'flashed' ? '#4ade80' : '#4dabf7'} aria-hidden="true" />
                        <div>
                            <strong>
                                {step === 'flashed' ? 'Flashed and verified' : 'Node ready — ArduinoOTA listening'}
                            </strong>
                            <div className="svc-muted svc-small">
                                {remainingSec != null && <><strong>{formatDuration(remainingSec)}</strong> left in the session · </>}
                                running <strong>{state.status?.firmware || '—'}</strong>
                                {step === 'flashed' && session?.firmwareAtArm && (
                                    <> (was {session.firmwareAtArm})</>
                                )}
                                {state.session?.deadline && (
                                    <> · backend cutoff {formatClock(state.session.deadline)}</>
                                )}
                            </div>
                        </div>
                    </div>

                    {restarts > 1 && (
                        <div className="svc-alert svc-alert-warn">
                            <RefreshCw size={18} aria-hidden="true" />
                            <div>
                                <strong>The node restarted the session {restarts} times.</strong>
                                <div className="svc-small">
                                    It loses MQTT partway through, goes to sleep unable to clear the retained
                                    command, and reads it again on waking. With firmware ≤ 1.1.0 each restart
                                    gets a brand new full timeout. The backend still cuts it off at
                                    {state.session?.timeoutMin} min from when it was armed — if the flash doesn't
                                    fit in that window, arm it again.
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 'ready' && (
                        <>
                            <div className="svc-field">
                                <label className="svc-kv-label">PlatformIO environment</label>
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
                                            The development build burns a fixed 2 s in <code>delay(2000)</code> on every wake,
                                            at 50-140 mA. Don't leave it in the field longer than necessary.
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="svc-cmdline">
                                <Terminal size={16} aria-hidden="true" />
                                <code>{pioCommand}</code>
                                <button className="svc-icon-btn" onClick={copyCommand}><Copy size={14} /> Copy</button>
                            </div>
                            <p className="svc-muted svc-small">
                                Run it from <code>weather-station-station-iot/</code>. When it's done, the node reboots,
                                re-enters service mode on its own (it's flagged in RTC memory) and publishes its new
                                version — that's when this view verifies it automatically.
                            </p>
                        </>
                    )}

                    {step === 'flashed' && (
                        <p className="svc-muted svc-small">
                            The version changed, so the OTA went through. Deactivate so it returns to its normal
                            cycle: otherwise it stays awake until the timeout runs out.
                        </p>
                    )}

                    <button
                        className={`svc-btn ${step === 'flashed' ? 'svc-btn-primary' : ''}`}
                        disabled={busy}
                        onClick={disarm}
                    >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
                        Deactivate service mode
                        {step === 'flashed' && <ArrowRight size={16} />}
                    </button>
                </>
            )}
        </div>
    );
};

export default OtaWizard;
