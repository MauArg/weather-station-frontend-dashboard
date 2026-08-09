import React, { useState } from 'react';
import { Radio, Play, Square, FlaskConical, AlertTriangle } from 'lucide-react';
import { sendServiceCommand } from '../../services/ServiceApi';
import Tip from './Tip';

// Mirrors models.LiveIntervalSec / LiveSessionMin in the backend, and the caps in
// the firmware's parseCommand(). Shown rather than hidden because the cost of the
// mode is the whole decision.
const INTERVAL_SEC = 5;
const SESSION_MIN = 60;
const FORCED_CAP_MIN = 30;

// Why the node ended a session, in the operator's words. The node publishes these
// verbatim in live_mode_ended.
const EXIT_REASON = {
    no_sun: 'the panel stopped producing',
    low_battery: 'the pack dropped below its floor',
    timeout: 'it used up its budget',
    mqtt_lost: 'the broker became unreachable',
    cleared_by_server: 'it was stopped from here',
    budget_exhausted: 'no budget was left from earlier sessions',
};

const fmtDuration = (sec) => {
    if (sec == null || sec < 0) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
};

const LivePanel = ({ state, connected }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [note, setNote] = useState(null);

    const status = state?.status;
    const retained = state?.retained;
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
    const isRunning = telemetry?.fields?.live_seq != null;
    const isArmed = retained?.present && retained?.cmd === 'live';
    const otherCommand = retained?.present && retained?.cmd !== 'live';

    const inLiveStatus = status?.state === 'live_mode_active' || status?.state === 'live_mode_alive';
    const elapsedSec = inLiveStatus ? status?.elapsedS : null;
    const remainingSec = inLiveStatus ? status?.remainingSec : null;
    const seq = telemetry?.fields?.live_seq;

    const lastEnded = status?.state === 'live_mode_ended' ? status : null;

    const run = async (body, describe) => {
        setBusy(true);
        setError(null);
        setNote(null);
        try {
            const res = await sendServiceCommand(body);
            setNote(res.note || describe);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const start = (force) =>
        run(
            { cmd: 'live', intervalSec: INTERVAL_SEC, timeoutMin: SESSION_MIN, force },
            force ? 'Forced session armed.' : 'Live mode armed.',
        );

    // Stop is 'clear', not a live-specific command: an empty retained payload is
    // what every mode on the node reads as "stop". Same button the OTA wizard uses
    // to leave service mode.
    const stop = () => run({ cmd: 'clear' }, 'Stop sent.');

    return (
        <div className="svc-card svc-span-2">
            <div className="svc-card-head">
                <h3 className="svc-h4"><Radio size={18} aria-hidden="true" /> Live mode</h3>
                {isRunning && <span className="svc-badge">running</span>}
                {!isRunning && isArmed && <span className="svc-badge svc-badge-warn">armed · waiting for wake</span>}
            </div>

            <p className="svc-small svc-muted">
                The node stops sleeping and publishes every ~{INTERVAL_SEC}s instead of every 60.
                Only worth it while the charger is already rejecting energy:{' '}
                <Tip text="Measured over a 47 min field session: 53.1 mA sustained, 41.3 mAh consumed. The normal duty cycle uses about 47 mAh for a whole day, so an hour of live mode costs roughly a day of ordinary operation.">
                    <strong>~53 mAh per hour</strong>
                </Tip>
                , against ~47 mAh for a full day of the normal cycle.
            </p>

            {isRunning && (
                <div className="svc-kv-grid">
                    <div className="svc-kv">
                        <span className="svc-kv-label">Elapsed</span>
                        <span className="svc-kv-value">{fmtDuration(elapsedSec)}</span>
                    </div>
                    <div className="svc-kv">
                        <span className="svc-kv-label">Remaining</span>
                        <span className="svc-kv-value">{fmtDuration(remainingSec)}</span>
                    </div>
                    <div className="svc-kv">
                        <span className="svc-kv-label">Published</span>
                        <span className="svc-kv-value">{seq ?? '—'}</span>
                    </div>
                </div>
            )}

            {!isRunning && lastEnded && (
                <p className="svc-small svc-muted">
                    Last session ended because {EXIT_REASON[lastEnded.reason] || lastEnded.reason || 'of an unreported reason'}.
                    {(lastEnded.reason === 'no_sun' || lastEnded.reason === 'low_battery') && (
                        <> The node judged conditions from its own sensors, so automatic arming stands down for an hour.</>
                    )}
                </p>
            )}

            {otherCommand && (
                <div className="svc-alert svc-alert-warn">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div>
                        <strong>“{retained.cmd}” is already retained.</strong>
                        <div className="svc-small">
                            The node has a single command slot and every mode reads an empty payload as
                            “stop”, so they cannot be queued against each other. Clear that one first.
                        </div>
                    </div>
                </div>
            )}

            <div className="svc-btn-row">
                <button
                    className="svc-btn svc-btn-primary"
                    disabled={!connected || busy || isArmed || isRunning || otherCommand}
                    onClick={() => start(false)}
                >
                    <Play size={16} aria-hidden="true" /> Start ({SESSION_MIN} min)
                </button>

                <button
                    className="svc-btn"
                    disabled={!connected || busy || isArmed || isRunning || otherCommand}
                    onClick={() => start(true)}
                    // Its own button rather than a checkbox: forcing skips a safety
                    // floor, and that should take a deliberate, differently-labelled
                    // action instead of a state someone can leave ticked.
                    data-tip={`Skips only the node's panel-voltage floor, so the mode can be exercised without sun. The node caps a forced session at ${FORCED_CAP_MIN} min, and the pack floor, the budget and the broker floor all still apply.`}
                >
                    <FlaskConical size={16} aria-hidden="true" /> Force (test)
                </button>

                <button
                    className="svc-btn svc-btn-danger"
                    disabled={!connected || busy || (!isArmed && !isRunning)}
                    onClick={stop}
                >
                    <Square size={16} aria-hidden="true" /> Stop
                </button>
            </div>

            {note && <p className="svc-small svc-muted">{note}</p>}
            {error && (
                <div className="svc-alert svc-alert-danger">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div className="svc-small">{error}</div>
                </div>
            )}

            <p className="svc-small svc-muted">
                The node exits on its own when the panel, the pack, the budget or the broker say so —
                nothing here can leave it awake indefinitely.
            </p>
        </div>
    );
};

export default LivePanel;
