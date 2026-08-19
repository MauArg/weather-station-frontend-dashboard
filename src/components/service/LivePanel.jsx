import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Radio, Play, Square, FlaskConical, AlertTriangle } from 'lucide-react';
import { sendServiceCommand } from '../../services/ServiceApi';
import { formatAge } from '../../utils/timezone';
import { apiText, commandNote } from '../../i18n/apiText';
import { useNow } from '../../hooks/useNow';
import Tip from './Tip';

// Mirrors models.LiveIntervalSec / LiveSessionMin in the backend, and the caps in
// the firmware's parseCommand(). Shown rather than hidden because the cost of the
// mode is the whole decision.
const INTERVAL_SEC = 5;
const SESSION_MIN = 60;
const FORCED_CAP_MIN = 30;

const fmtDuration = (sec) => {
    if (sec == null || sec < 0) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
};

const LivePanel = ({ state, connected }) => {
    const { t } = useTranslation('service');
    const now = useNow(15000);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [note, setNote] = useState(null);

    const status = state?.status;
    // retainedCmd, not retained: the backend has only ever served this under
    // `retainedCmd` (models.ServiceState), so the old name read undefined and
    // quietly pinned isArmed and otherCommand below to false. That cost the
    // "armed, waiting for the wake" badge and, worse, the guard that stops a
    // live session from overwriting a retained maintenance command — the same
    // way a log_on used to silently eat an OTA session.
    const retained = state?.retainedCmd;
    const telemetry = state?.telemetry;

    // Three different sources, because they answer three different questions and
    // no single one covers the gap between arming and the node noticing.
    //
    //   retained.cmd  — what the node has been told, true the moment it is armed
    //   live_seq      — what the node is actually doing, only true once it started
    //   status.state  — the session's own reports, which carry elapsed/remaining
    //
    // A node that is asleep when the command is published takes up to a full wake
    // cycle to pick it up, so "armed" and "running" have to be separate states or
    // the panel would claim a session that has not begun.
    // live_seq keeps travelling in the *last* telemetry after a session ends,
    // because telemetry is only replaced when the next payload arrives — a full
    // sleep cycle later. Without this the panel would claim "running", with a
    // frozen Published count, for up to a minute after the node stopped. The
    // node publishes live_mode_ended at exit, before that final sleep, so a
    // newer ended-status is what settles it.
    const endedAt = status?.state === 'live_mode_ended' ? status.receivedAt : null;
    const endedAfterTelemetry =
        endedAt != null &&
        (!telemetry?.receivedAt || new Date(endedAt) >= new Date(telemetry.receivedAt));

    const isRunning = telemetry?.fields?.live_seq != null && !endedAfterTelemetry;
    const isArmed = retained?.present && retained?.cmd === 'live';
    const otherCommand = retained?.present && retained?.cmd !== 'live';

    const inLiveStatus = status?.state === 'live_mode_active' || status?.state === 'live_mode_alive';
    const elapsedSec = inLiveStatus ? status?.elapsedS : null;
    const remainingSec = inLiveStatus ? status?.remainingSec : null;
    const seq = telemetry?.fields?.live_seq;

    const lastEnded = endedAt ? status : null;
    // Same reason the payload viewer and the anomaly list carry one: this line
    // survives until the next status message, which can be days, and "last
    // session ended because…" with no age reads as if it just happened.
    const lastEndedAge = lastEnded ? formatAge(lastEnded.receivedAt, now) : null;

    const run = async (body, describe) => {
        setBusy(true);
        setError(null);
        setNote(null);
        try {
            const res = await sendServiceCommand(body);
            // commandNote, not commandToast: here the note stands alone as a
            // paragraph rather than trailing a message.
            setNote(commandNote(t, res) || describe);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const start = (force) =>
        run(
            { cmd: 'live', intervalSec: INTERVAL_SEC, timeoutMin: SESSION_MIN, force },
            force ? t('live.toast.forcedArmed') : t('live.toast.armed'),
        );

    // Stop is 'clear', not a live-specific command: an empty retained payload is
    // what every mode on the node reads as "stop". Same button the OTA wizard uses
    // to leave service mode.
    const stop = () => run({ cmd: 'clear' }, t('live.toast.stopped'));

    // The node publishes these verbatim in live_mode_ended, so they are codes
    // minted outside this repo and go through apiText like every other one:
    // the `api` namespace is the one exempt from the missing-key warning,
    // precisely because a firmware that adds a reason is the expected case.
    const exitReason = lastEnded?.reason
        ? apiText(t, 'exitReason', lastEnded.reason, lastEnded.reason)
        : t('api:exitReason.unreported');

    return (
        <div className="svc-card svc-span-2">
            <div className="svc-card-head">
                <h3 className="svc-h4"><Radio size={18} aria-hidden="true" /> {t('live.title')}</h3>
                {isRunning && <span className="svc-badge">{t('live.running')}</span>}
                {!isRunning && isArmed && <span className="svc-badge svc-badge-warn">{t('live.armed')}</span>}
            </div>

            {/* <Trans> rather than three t() calls: the tip sits mid-sentence, and
                splitting the paragraph around it would hand the translator three
                fragments whose order the JSX, not the grammar, decides. */}
            <p className="svc-small svc-muted">
                <Trans
                    t={t}
                    i18nKey="live.intro"
                    values={{ sec: INTERVAL_SEC }}
                    components={[<Tip key="cost" text={t('live.costTip')} />]}
                />
            </p>

            {isRunning && (
                <div className="svc-kv-grid">
                    <div className="svc-kv">
                        <span className="svc-kv-label">{t('live.elapsed')}</span>
                        <span className="svc-kv-value">{fmtDuration(elapsedSec)}</span>
                    </div>
                    <div className="svc-kv">
                        <span className="svc-kv-label">{t('live.remaining')}</span>
                        <span className="svc-kv-value">{fmtDuration(remainingSec)}</span>
                    </div>
                    <div className="svc-kv">
                        <span className="svc-kv-label">{t('live.published')}</span>
                        <span className="svc-kv-value">{seq ?? '—'}</span>
                    </div>
                </div>
            )}

            {!isRunning && lastEnded && (
                <p className="svc-small svc-muted">
                    {lastEndedAge
                        ? t('live.lastSessionAged', { age: lastEndedAge, reason: exitReason })
                        : t('live.lastSession', { reason: exitReason })}
                    {(lastEnded.reason === 'no_sun' || lastEnded.reason === 'low_battery') && t('live.floorCooldown')}
                </p>
            )}

            {otherCommand && (
                <div className="svc-alert svc-alert-warn">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div>
                        <strong>{t('live.otherCommandTitle', { cmd: retained.cmd })}</strong>
                        <div className="svc-small">{t('live.otherCommandBody')}</div>
                    </div>
                </div>
            )}

            <div className="svc-btn-row">
                <button
                    className="svc-btn svc-btn-primary"
                    disabled={!connected || busy || isArmed || isRunning || otherCommand}
                    onClick={() => start(false)}
                >
                    <Play size={16} aria-hidden="true" /> {t('live.start', { min: SESSION_MIN })}
                </button>

                {/* Its own button rather than a checkbox: forcing skips a safety
                    floor, and that should take a deliberate, differently-labelled
                    action instead of a state someone can leave ticked. */}
                <button
                    className="svc-btn svc-tip"
                    disabled={!connected || busy || isArmed || isRunning || otherCommand}
                    onClick={() => start(true)}
                    data-tip={t('live.forceTip', { min: FORCED_CAP_MIN })}
                >
                    <FlaskConical size={16} aria-hidden="true" /> {t('live.force')}
                </button>

                <button
                    className="svc-btn svc-btn-danger"
                    disabled={!connected || busy || (!isArmed && !isRunning)}
                    onClick={stop}
                >
                    <Square size={16} aria-hidden="true" /> {t('live.stop')}
                </button>
            </div>

            {note && <p className="svc-small svc-muted">{note}</p>}
            {error && (
                <div className="svc-alert svc-alert-danger">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div className="svc-small">{error}</div>
                </div>
            )}

            <p className="svc-small svc-muted">{t('live.footer')}</p>
        </div>
    );
};

export default LivePanel;
