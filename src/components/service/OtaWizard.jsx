import React, { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
    Wrench, Clock, CheckCircle2, Copy, Power, Loader2, AlertTriangle, ShieldX, Terminal, ArrowRight, HelpCircle, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { sendServiceCommand, formatDuration, formatClock } from '../../services/ServiceApi';
import { apiNote, apiText } from '../../i18n/apiText';
import { formatFixed } from '../../utils/timezone';
import { useNow } from '../../hooks/useNow';
import { copyText } from '../../utils/clipboard';

// The ids are PlatformIO environment names and never translate; the label and
// the hint beside them do.
const OTA_ENVS = ['ota_production', 'ota_development'];
const ENV_KEY = { ota_production: 'production', ota_development: 'development' };

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
    const { t } = useTranslation('service');
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
    // Same rule as BatteryPanel: the note is derived from flashRisk, with the
    // backend's own sentence as the fallback.
    const riskNote = apiText(t, 'riskNote', battery?.flashRisk, battery?.riskNote);
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
            const note = apiNote(t, 'note', res.noteCode, res.note);
            toast.success(`${t('ota.toast.activated')}${note ? ` — ${note}` : ''}`);
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
            toast.success(t('ota.toast.deactivated'));
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    const copyCommand = async () => {
        if (await copyText(pioCommand)) toast.success(t('ota.toast.copied'));
        else toast.error(t('ota.toast.copyFailed'));
    };

    return (
        <div className="svc-card svc-wizard">
            <div className="svc-card-head">
                <h3>{t('ota.title')}</h3>
                <ol className="svc-steps">
                    {['idle', 'armed', 'ready', 'flashed'].map((id) => (
                        <li key={id} className={`svc-step ${step === id ? 'active' : ''}`}>
                            {t(`ota.step.${id}`)}
                        </li>
                    ))}
                </ol>
            </div>

            {/* ── Step 1 — arm ────────────────────────────────────────────── */}
            {step === 'idle' && (
                <>
                    <p className="svc-muted"><Trans t={t} i18nKey="ota.intro" /></p>

                    <div className="svc-field">
                        <label className="svc-kv-label">
                            <Clock size={13} aria-hidden="true" />{' '}
                            <Trans t={t} i18nKey="ota.timeoutLabel" values={{ min: timeoutMin }} />
                        </label>
                        <input
                            type="range" min={1} max={60} value={timeoutMin}
                            onChange={(e) => setTimeoutMin(Number(e.target.value))}
                            className="svc-slider"
                        />
                        <span className="svc-muted svc-small">{t('ota.timeoutHint')}</span>
                    </div>

                    {risk === 'unsafe' && (
                        <div className="svc-alert svc-alert-danger">
                            <ShieldX size={18} aria-hidden="true" />
                            <div>
                                <strong>{t('ota.unsafeTitle', { volts: formatFixed(battery?.volts, 3) })}</strong>
                                <div className="svc-small">{riskNote}</div>
                                <label className="svc-checkbox" style={{ marginTop: '0.5rem' }}>
                                    <input type="checkbox" checked={overrideRisk} onChange={(e) => setOverrideRisk(e.target.checked)} />
                                    {t('ota.override')}
                                </label>
                            </div>
                        </div>
                    )}
                    {risk === 'caution' && (
                        <div className="svc-alert svc-alert-warn">
                            <AlertTriangle size={18} aria-hidden="true" />
                            <div>
                                <strong>{t('ota.cautionTitle', { volts: formatFixed(battery?.volts, 3) })}</strong>
                                <div className="svc-small">{riskNote}</div>
                            </div>
                        </div>
                    )}
                    {risk === 'unknown' && (
                        <div className="svc-alert svc-alert-info">
                            <HelpCircle size={18} aria-hidden="true" />
                            <div className="svc-small">{t('ota.unknownRisk')}</div>
                        </div>
                    )}

                    <button
                        className="svc-btn svc-btn-primary"
                        disabled={busy || !connected || (risk === 'unsafe' && !overrideRisk)}
                        onClick={arm}
                    >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Wrench size={16} />}
                        {t('ota.activate')}
                    </button>
                    {!connected && <p className="svc-muted svc-small">{t('ota.noBroker')}</p>}
                </>
            )}

            {/* ── Step 2 — waiting for the wake ────────────────────────────────── */}
            {step === 'armed' && (
                <>
                    <div className="svc-waiting">
                        <Loader2 size={32} className="animate-spin" color="#4dabf7" />
                        <div>
                            <strong>{t('ota.waitingTitle')}</strong>
                            <div className="svc-muted svc-small">
                                {state.node?.nextWakeInSec > 0
                                    ? t('ota.nextWake', { sec: state.node.nextWakeInSec })
                                    : t('ota.wakingNow')}
                                {t('ota.stillRetained')}
                            </div>
                        </div>
                    </div>
                    <p className="svc-muted svc-small"><Trans t={t} i18nKey="ota.replacesPing" /></p>
                    <button className="svc-btn" disabled={busy} onClick={disarm}>
                        <Power size={16} /> {t('ota.cancel')}
                    </button>
                </>
            )}

            {/* ── Step 3 — ready to flash ──────────────────────────────── */}
            {(step === 'ready' || step === 'flashed') && (
                <>
                    <div className={`svc-ready ${step === 'flashed' ? 'done' : ''}`}>
                        <CheckCircle2 size={28} color={step === 'flashed' ? '#4ade80' : '#4dabf7'} aria-hidden="true" />
                        <div>
                            <strong>{step === 'flashed' ? t('ota.flashedTitle') : t('ota.readyTitle')}</strong>
                            <div className="svc-muted svc-small">
                                {remainingSec != null && (
                                    <Trans t={t} i18nKey="ota.sessionLeft" values={{ duration: formatDuration(remainingSec) }} />
                                )}
                                <Trans t={t} i18nKey="ota.running" values={{ firmware: state.status?.firmware || '—' }} />
                                {step === 'flashed' && session?.firmwareAtArm &&
                                    t('ota.wasVersion', { firmware: session.firmwareAtArm })}
                                {state.session?.deadline &&
                                    t('ota.backendCutoff', { time: formatClock(state.session.deadline) })}
                            </div>
                        </div>
                    </div>

                    {restarts > 1 && (
                        <div className="svc-alert svc-alert-warn">
                            <RefreshCw size={18} aria-hidden="true" />
                            <div>
                                <strong>{t('ota.restartsTitle', { count: restarts })}</strong>
                                <div className="svc-small">
                                    {t('ota.restartsBody', { min: state.session?.timeoutMin })}
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 'ready' && (
                        <>
                            <div className="svc-field">
                                <label className="svc-kv-label">{t('ota.pioEnv')}</label>
                                <div className="svc-btn-row">
                                    {OTA_ENVS.map((id) => (
                                        <button
                                            key={id}
                                            className={`svc-range-btn ${env === id ? 'active' : ''}`}
                                            onClick={() => setEnv(id)}
                                            title={t(`ota.env.${ENV_KEY[id]}Hint`)}
                                        >
                                            {t(`ota.env.${ENV_KEY[id]}`)}
                                        </button>
                                    ))}
                                </div>
                                {env === 'ota_development' && (
                                    <div className="svc-alert svc-alert-warn" style={{ marginTop: '0.5rem' }}>
                                        <AlertTriangle size={18} aria-hidden="true" />
                                        <div className="svc-small"><Trans t={t} i18nKey="ota.devWarning" /></div>
                                    </div>
                                )}
                            </div>

                            <div className="svc-cmdline">
                                <Terminal size={16} aria-hidden="true" />
                                <code>{pioCommand}</code>
                                <button className="svc-icon-btn" onClick={copyCommand}><Copy size={14} /> {t('ota.copy')}</button>
                            </div>
                            <p className="svc-muted svc-small"><Trans t={t} i18nKey="ota.runFrom" /></p>
                        </>
                    )}

                    {step === 'flashed' && (
                        <p className="svc-muted svc-small">{t('ota.flashedNote')}</p>
                    )}

                    <button
                        className={`svc-btn ${step === 'flashed' ? 'svc-btn-primary' : ''}`}
                        disabled={busy}
                        onClick={disarm}
                    >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
                        {t('ota.deactivate')}
                        {step === 'flashed' && <ArrowRight size={16} />}
                    </button>
                </>
            )}
        </div>
    );
};

export default OtaWizard;
