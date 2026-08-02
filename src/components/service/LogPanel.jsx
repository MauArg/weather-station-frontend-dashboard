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
        label: 'Anomalies',
        entriesPerCycle: 0.7,
        blurb: 'Only failures: WiFi, MQTT and publish. A healthy cycle writes nothing.',
    },
    {
        value: 2,
        label: 'Summary',
        entriesPerCycle: 1.7,
        blurb: 'One line per cycle stage, plus anomalies. This is the one that answers "WiFi or MQTT?".',
    },
    {
        value: 3,
        label: 'Verbose',
        entriesPerCycle: 5,
        blurb: 'Every WiFi attempt individually. For when level 2 is not enough.',
    },
];

// Observed interval between cycles. The node sleeps SLEEP_INTERVAL_SEC = 60, but
// each wake also spends time on WiFi, MQTT, waiting on the retained topic and
// sensors before publishing. Measured against InfluxDB this comes out to 60-67 s
// with a median of 64.
const CYCLE_SEC = 64;

const formatWindow = (ringEntries, entriesPerCycle) => {
    if (!ringEntries || !entriesPerCycle) return '—';
    const hours = (ringEntries / entriesPerCycle) * CYCLE_SEC / 3600;
    if (hours < 1) return `~${Math.round(hours * 60)} min`;
    return `~${hours.toFixed(1)} h`;
};

// The number and the name together, always in the same order. The level is what
// travels in the command and in the firmware; the name is the only part that is
// understood at a glance. Naming only one forces a mental translation between the
// screen and the `level` seen in the payloads.
const levelName = (value) => {
    const level = LEVELS.find((l) => l.value === value);
    return level ? `level ${value} (${level.label})` : `level ${value}`;
};

// How long the node can take to pick up a retained command before it's worth
// suspecting something: three cycles and change. One cycle is usually enough, but
// the confirmation payload travels the same path that loses 42% of telemetry, so
// a couple of quiet cycles don't prove anything.
const PENDING_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * How long the capture currently on the node has been running.
 *
 * A separate component because of the tick: it keeps its own clock so that the
 * passing minute doesn't re-render the list of transferred events, which can have
 * hundreds of rows. 15 s is enough because it's shown in minutes and hours.
 */
const CaptureUptime = ({ since, exact }) => {
    const now = useNow(15000);
    const started = new Date(since).getTime();
    if (isNaN(started)) return null;

    const elapsed = formatElapsed(Math.floor((now - started) / 1000));
    // The "≥" is not cosmetic: without having seen the capture start, the number
    // is a floor, not a measurement. See LogState.ActiveSinceExact in the backend.
    return exact ? elapsed : `≥ ${elapsed}`;
};

const LogPanel = ({ state, connected }) => {
    // An old backend does not send `logs` in the snapshot. This can genuinely
    // happen: the frontend and backend deploy as two separate images, so there's
    // a window where one is updated and the other isn't. Without this guard the
    // panel would look broken —a capture "off" that can't be started, a dead
    // button for no reason— and would look like a node bug instead of a half
    // deploy.
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

    // 'stop' | 'start' | null. Both actions empty the node's memory, so both get
    // confirmed — guarding only one would leave the other path open, and worse,
    // would suggest that the other one is harmless.
    const [confirm, setConfirm] = useState(null);

    // Capture command published, waiting for the node to apply it. See the
    // effect further down.
    const [pending, setPending] = useState(null);

    // The retained topic carries a single message, so what matters is which one
    // it is, not just whether one exists: the backend's session.armed turns on
    // for any of them, including the log_on we just published ourselves.
    const inServiceMode = state?.node?.state === 'service_mode';
    const maintenanceArmed = Boolean(
        state?.retainedCmd?.present && state.retainedCmd.cmd === 'maintenance'
    );
    const retainedIsLogCmd = Boolean(
        state?.retainedCmd?.present && state.retainedCmd.cmd === 'log_on'
    );
    const telemetryAt = state?.telemetry?.receivedAt ?? null;

    // The selector shows what you are about to apply, but it has to start from
    // what the node is actually doing. Showing "Summary" selected while the node
    // is capturing at "Verbose" is the kind of mismatch that makes the whole
    // screen feel untrustworthy. It syncs whenever the node reports a different
    // level, and after that it respects whatever you pick by hand.
    const nodeLevel = logs.active ? logs.level : 0;
    // Starts at 0, not at nodeLevel: initializing it with the first render's
    // value makes the comparison below false exactly on that first time, which is
    // when it matters most — the panel opens with a capture already running.
    const prevNodeLevel = useRef(0);
    useEffect(() => {
        if (nodeLevel && nodeLevel !== prevNodeLevel.current) setLevel(nodeLevel);
        prevNodeLevel.current = nodeLevel;
    }, [nodeLevel]);

    // ── Waiting for the capture command ───────────────────────────────────────
    //
    // Publishing the command changes nothing on the node: it stays retained until
    // the node wakes up, reads it and applies it, i.e. up to a full cycle. The
    // POST returns in milliseconds, so without this the click moved nothing on
    // screen —the chip kept saying the same thing— and read as if the button
    // didn't work.
    //
    // Confirmation requires three things at once, and all three are needed:
    //
    //  - `applied`: the node reports the state we asked for.
    //  - `fresh`: it reports it in a telemetry cycle after the click, not the one
    //    that was already on screen when the button was pressed.
    //  - `moved`: something actually changed. Without this, restarting a capture
    //    at the same level that was already running would be taken as applied on
    //    the very first telemetry that arrives, even if the node hasn't read the
    //    command yet.
    //
    // `moved` watches three signals because none alone covers every case: the
    // node clears the retained topic when it consumes it (but that publish can be
    // lost, like 42% of the others), the level changes (but not if it's restarted
    // at the same one), and the counter goes backward (logging_configure() empties
    // the ring, and the counter never drops on its own: it saturates at capacity
    // once it starts overwriting old entries).
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
                ? 'The node stopped the capture and cleared its memory.'
                : `The node is capturing at ${levelName(pending.level)}.`);
            return undefined;
        }

        // The wait ran out. Nothing is undone: the command stays retained and the
        // node will apply it whenever it manages to read it. The only thing that
        // gets released is the UI, which would otherwise stay blocked indefinitely
        // by a node that never shows up.
        const id = setTimeout(() => {
            setPending(null);
            toast.error(
                'The node did not confirm the capture change. The command is still retained: ' +
                'if the node shows up, it will apply it — check the status chip in a couple of cycles.'
            );
        }, Math.max(0, pending.deadline - Date.now()));
        return () => clearTimeout(id);
    }, [pending, logs.active, logs.level, logs.count, retainedIsLogCmd, telemetryAt]);

    // Retrieves the last capture the backend transferred, so reloading the page
    // doesn't cost another service mode session.
    useEffect(() => {
        let cancelled = false;
        getLastLogCapture()
            .then((c) => !cancelled && c && setCapture(c))
            .catch(() => { /* no previous capture: normal initial state */ });
        return () => { cancelled = true; };
    }, []);

    const setCaptureLevel = async (lvl) => {
        setBusy(true);
        // Snapshot of what the node was reporting before publishing. This is what
        // later decides whether the node applied the command or hasn't read it yet.
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
            // "Published", not "started": at this point all that happened is that
            // the message landed on the broker. Saying the capture had started was
            // the lie that made it look like nothing happened afterward.
            toast.success(
                (lvl === 0
                    ? 'Stop capture command published'
                    : `Capture command at ${levelName(lvl)} published`)
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
            if (n === 0) toast('The node had no captured events.', { icon: 'ℹ️' });
            else toast.success(`${n} events transferred${c.cleared ? ' — the node already cleared them' : ''}`);
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

    // Transferring needs the node awake and subscribed, i.e. in service mode.
    // This is the part of the flow that didn't explain itself: the status said
    // "capturing" and the button was dead, without saying what to do about it.
    const needsServiceMode = !logs.canFetch && !inServiceMode && connected && !logs.fetching;

    // Unlike transferring, changing the capture CANNOT be done with the node in
    // service mode, and it's not a matter of waiting longer: the command gets
    // lost. The service_mode.cpp loop only reacts to the retained topic when it
    // arrives empty —that's the "I left service mode" signal— and discards any
    // other payload; then, on closing the session, serviceMode_exit() clears the
    // topic and takes the waiting log_on down with it. And since the retained
    // topic holds only one message, publishing here overwrites the `maintenance`
    // message that is holding the OTA session open.
    const captureLocked = inServiceMode || maintenanceArmed;

    const armServiceMode = async () => {
        setBusy(true);
        try {
            const res = await sendServiceCommand({ cmd: 'maintenance', timeoutMin: 15 });
            toast.success(`Service mode requested${res.note ? ` — ${res.note}` : ''}`);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    // Shown collapsed or expanded, but never hidden: if a capture has been
    // running for weeks, it has to be visible without opening anything. For the
    // same reason the running time goes here and not only in the body: "has it
    // already been the 2 h I wanted to capture?" has to be answerable without
    // opening the panel.
    const stateChip = logs.active ? (
        <span className="svc-chip" style={{ borderColor: '#4ade80', color: '#4ade80' }}>
            <Play size={13} aria-hidden="true" /> Capturing · {levelName(logs.level)} · {logs.count}/{ring}
            {logs.activeSince && (
                <> · <CaptureUptime since={logs.activeSince} exact={logs.activeSinceExact} /></>
            )}
        </span>
    ) : (
        <span className="svc-chip svc-badge-muted">
            <Square size={13} aria-hidden="true" /> Capture stopped
        </span>
    );

    const head = (
        <button
            className="svc-collapse-head"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
        >
            {open ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronRight size={17} aria-hidden="true" />}
            <h3><ScrollText size={17} aria-hidden="true" /> Node logs</h3>
            {supported && stateChip}
            <span className="svc-muted svc-small svc-collapse-spacer">
                {open ? 'hide' : 'show'}
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
                            <strong>The backend does not expose the logging system yet.</strong>
                            <div className="svc-small">
                                This panel needs the <code>logs</code> field in the state snapshot.
                                Rebuild and redeploy the backend image; the node's firmware also needs
                                to be on 1.3.0 or newer.
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
                Capturing runs during normal cycles and costs no energy. Transferring is the only
                part that needs the node awake, which is why it's a separate step.
            </p>

            {logs.dictKnown && (
                <div className="svc-chips" style={{ marginTop: '0.5rem' }}>
                    <Tip
                        className="svc-chip svc-badge-muted"
                        text="The backend already has the code→text dictionary for this firmware version cached, so there's no need to ask the node for it on the next transfer."
                    >
                        dictionary cached
                    </Tip>
                </div>
            )}

            {logs.active && (
                <div className="svc-budget" style={{ marginTop: '0.5rem' }}>
                    <div className="svc-budget-head">
                        <span className="svc-small">Capture memory: {logs.count} / {ring} events</span>
                        <span className="svc-muted svc-small">
                            {fillPct >= 100
                                ? 'full — already overwriting the oldest events'
                                : `${Math.round(fillPct)}% full`}
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
                                <Tip text="When the window the node currently has stored started. It resets on a level change and on transfer, because in both cases the node empties its memory. The backend derives it by watching telemetry —the node has no clock— so it has the precision of one cycle.">
                                    Capturing since {formatClock(logs.activeSince)}
                                </Tip>
                            ) : (
                                <Tip text="The backend found the capture already running —it restarted after the capture started— so it doesn't know when it really began. The number is a floor: it could have been running for much longer.">
                                    Running since before {formatClock(logs.activeSince)}
                                </Tip>
                            )}
                            {' — '}
                            <CaptureUptime since={logs.activeSince} exact={logs.activeSinceExact} />
                        </p>
                    )}
                </div>
            )}

            {/* ── Step 1 ───────────────────────────────────────────────────── */}
            <h4 className="svc-h4" style={{ marginTop: '1rem' }}>1 · Capture on the node</h4>
            <label className="svc-kv-label" style={{ marginTop: '0.4rem' }}>Capture level</label>
            <div className="svc-toolbar">
                {LEVELS.map((l) => (
                    <button
                        key={l.value}
                        className={`svc-range-btn svc-tip ${level === l.value ? 'active' : ''}`}
                        data-tip={`Level ${l.value}. ${l.blurb} Lasts ${formatWindow(ring, l.entriesPerCycle)} before it starts overwriting the oldest events.`}
                        onClick={() => setLevel(l.value)}
                    >
                        {l.label} (N{l.value}) · {formatWindow(ring, l.entriesPerCycle)}
                    </button>
                ))}
            </div>
            <p className="svc-muted svc-small" style={{ marginTop: '0.4rem' }}>
                Level {level}: {LEVELS.find((l) => l.value === level)?.blurb}{' '}
                The estimated window assumes {CYCLE_SEC} s cycles. Capture memory lives in the ESP32's
                RTC memory and cannot be grown: more detail means fewer hours.
            </p>

            {logs.active && logs.level !== level && (
                <p className="svc-small" style={{ marginTop: '0.35rem', color: '#fde68a' }}>
                    The node is capturing at {levelName(logs.level)}. Starting again switches it to{' '}
                    {levelName(level)} and discards what has been captured so far.
                </p>
            )}

            <div className="svc-btn-row" style={{ marginTop: '0.6rem' }}>
                <button
                    className="svc-btn svc-btn-primary svc-tip"
                    data-tip="Publishes the command on the retained topic. The node picks it up on waking (up to one cycle of delay) and starts from zero: anything captured before is discarded."
                    disabled={busy || !connected || pending !== null || captureLocked}
                    onClick={() => (logs.active ? setConfirm('start') : setCaptureLevel(level))}
                >
                    {pending?.kind === 'start'
                        ? <><Loader2 size={16} className="animate-spin" /> Starting capture…</>
                        : <><Play size={16} /> Start capture</>}
                </button>
                <button
                    className="svc-btn svc-tip"
                    data-tip="Stops the capture and empties the node's memory. Any events not yet transferred are lost — transfer first if that matters."
                    disabled={busy || !connected || !logs.active || pending !== null || captureLocked}
                    onClick={() => setConfirm('stop')}
                >
                    {pending?.kind === 'stop'
                        ? <><Loader2 size={16} className="animate-spin" /> Stopping capture…</>
                        : <><Square size={16} /> Stop capture</>}
                </button>
            </div>

            {/* Waiting is the normal state for this step, not an exception: the node
                sleeps 60 s out of every 64 and only checks the retained topic on
                waking. */}
            {pending && (
                <div className="svc-alert svc-alert-info" style={{ marginTop: '0.6rem' }}>
                    <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                    <div>
                        <strong>
                            {pending.kind === 'stop'
                                ? 'Stopping the capture'
                                : `Starting the capture at ${levelName(pending.level)}`}
                            {' '}— waiting on the node.
                        </strong>
                        <div className="svc-small">
                            {pending.sawRetained && !retainedIsLogCmd ? (
                                <>The node picked up the command and is applying it. The telemetry that
                                confirms it is still needed, which comes in this same cycle.</>
                            ) : (
                                <>
                                    The command stayed retained on the broker. The node only reads it on
                                    waking
                                    {state?.node?.nextWakeInSec > 0
                                        ? `, in ~${state.node.nextWakeInSec} s`
                                        : ''}
                                    , and until then it keeps capturing as it was. If the cycle fails to
                                    publish —which happens often— confirmation is delayed until the next one.
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
                        <strong>Capture cannot be changed while the node is in service mode.</strong>
                        <div className="svc-small">
                            {inServiceMode
                                ? 'During the session the node ignores everything that arrives on the command topic except the request to exit, and closing the session clears the topic — so the command would not be delayed, it would be lost.'
                                : 'There is a retained maintenance command waiting for the node to wake up. The topic holds only one message, so publishing the capture command here would overwrite it and cancel service mode.'}
                            {' '}Transferring still works. To change the capture, exit service mode and
                            wait for the next normal cycle.
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={confirm !== null}
                title={confirm === 'start'
                    ? 'Starting discards the capture in progress'
                    : "Stopping empties the node's memory"}
                confirmLabel={confirm === 'start' ? 'Discard and start' : 'Stop and delete'}
                onCancel={() => setConfirm(null)}
                onConfirm={() => {
                    const kind = confirm;
                    setConfirm(null);
                    setCaptureLevel(kind === 'start' ? level : 0);
                }}
            >
                {confirm === 'start'
                    ? <>There is an active capture at {levelName(logs.level)}. Starting a new one erases it and starts from zero.</>
                    : <>On stopping, the node empties its capture memory.</>}
                {' '}The node reported <strong>{logs.count} events</strong> in its last telemetry
                {logs.count > 0 && <> — if you haven't transferred them, they will be lost</>}.
                {' '}The number can be up to one cycle behind, so there could be more.
                {logs.count > 0 && (
                    <> If they matter, cancel and use <em>Transfer logs from the node</em> first
                    {confirm === 'stop' && <> (this leaves the memory empty and the capture stopped, which is the same thing you were after)</>}.</>
                )}
            </ConfirmDialog>

            {/* ── Step 2 ───────────────────────────────────────────────────── */}
            <h4 className="svc-h4" style={{ marginTop: '1.2rem' }}>2 · Transfer to the backend</h4>

            {/* The requirement goes BEFORE the button and with the action inside it.
                This explanation used to hang below everything, so it read like the
                answer to "Start capture" — the button above— instead of the
                requirement for the one below. */}
            {needsServiceMode && (
                <div className="svc-alert svc-alert-info" style={{ marginTop: '0.4rem' }}>
                    <Info size={18} aria-hidden="true" />
                    <div>
                        <strong>The node needs to be woken up first.</strong>
                        <div className="svc-small">
                            Outside a service mode session the node sleeps 60 s out of every 70 and
                            doesn't listen to the request topic, so it can't respond to a transfer.
                            The capture keeps running fine in the meantime.
                        </div>
                        <button
                            className="svc-btn svc-tip"
                            style={{ marginTop: '0.6rem' }}
                            data-tip="Publishes the maintenance command with the default 15 min timeout. The node picks it up on its next wake and stays awake — only then can it be transferred."
                            disabled={busy || maintenanceArmed}
                            onClick={armServiceMode}
                        >
                            <Wrench size={16} /> {maintenanceArmed ? 'Service mode already requested — waiting on the node' : 'Activate service mode'}
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
                    data-tip="Fetches the captured events page by page. The node only clears them after the backend confirms they all arrived, so an interrupted transfer doesn't cost the capture."
                    disabled={busy || !logs.canFetch}
                    onClick={transfer}
                >
                    {/* The label watches `transferring`, not `busy`: `busy` is shared
                        by every action on the panel, so starting a capture would put
                        this button in "Transferring…" while nothing was transferring. */}
                    <DownloadCloud size={16} /> {transferring ? 'Transferring…' : 'Transfer logs from the node'}
                </button>
                <label className="svc-checkbox">
                    <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
                    <Tip text="Fetches a copy without stopping the capture or emptying the node's memory, for investigations that are still ongoing. By default the transfer empties and stops it.">
                        keep capture running
                    </Tip>
                </label>
            </div>
            {logs.lastError && (
                <div className="svc-alert svc-alert-warn" style={{ marginTop: '0.6rem' }}>
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div>
                        <strong>The last transfer failed.</strong>
                        <div className="svc-small">{logs.lastError}</div>
                    </div>
                </div>
            )}

            {/* ── Transferred capture ──────────────────────────────────────── */}
            {capture && (
                <>
                    <div className="svc-card-head" style={{ marginTop: '1.2rem' }}>
                        <h4 className="svc-h4">
                            3 · Review · {capture.count || capture.entries?.length || 0} events
                            {capture.firmware ? ` · ${capture.firmware}` : ''}
                        </h4>
                        <div className="svc-toolbar">
                            <a
                                className="svc-icon-btn svc-tip"
                                data-tip="Downloads the capture as JSON, with the code dictionary and time anchors included. Stays readable even after the firmware moves on and renumbers the codes."
                                href={LOG_EXPORT_JSON_URL}
                                download
                            >
                                <Download size={15} /> JSON
                            </a>
                            <a
                                className="svc-icon-btn svc-tip"
                                data-tip="Same as the JSON but one event per line, with a header line first. Same format as the payload viewer's export."
                                href={LOG_EXPORT_NDJSON_URL}
                                download
                            >
                                <Download size={15} /> NDJSON
                            </a>
                        </div>
                    </div>
                    <p className="svc-muted svc-small">
                        Transferred {formatClock(capture.fetchedAt)}.{' '}
                        {capture.cleared
                            ? (capture.kept
                                ? "The node's memory was cleared but the capture is still active."
                                : 'The node cleared its memory and stopped the capture.')
                            : 'The node did not confirm the clear: the capture is still occupying its memory.'}
                    </p>

                    {capture.dropped > 0 && (
                        <div className="svc-alert svc-alert-warn" style={{ marginTop: '0.5rem' }}>
                            <AlertTriangle size={18} aria-hidden="true" />
                            <div>
                                <strong>The oldest events are missing.</strong>
                                <div className="svc-small">
                                    The node's memory filled up and overwrote {capture.dropped} events with newer
                                    ones, so the capture doesn't reach back to the start of the window and may
                                    not cover what you were looking for. Next time, a leaner level lasts longer.
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
                                    all
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
                                    placeholder="Filter by text — e.g. rssi, timeout, mqtt"
                                    spellCheck={false}
                                />
                                <span className="svc-muted svc-small" style={{ alignSelf: 'center' }}>
                                    <Search size={13} aria-hidden="true" /> {filtered.length}
                                </span>
                            </div>

                            <div className="svc-log" style={{ marginTop: '0.5rem' }}>
                                {filtered.length === 0 && (
                                    <p className="svc-muted svc-small">No events match the filter.</p>
                                )}
                                {filtered.map((e, i) => (
                                    <div key={i} className="svc-log-row">
                                        <div className="svc-log-head">
                                            <span className="svc-log-time">
                                                {e.at ? formatClock(e.at) : '—'}
                                                {e.at && !e.atAnchored && (
                                                    <Tip text="Estimated time: this cycle did not publish telemetry, so it was interpolated from the nearest cycle with a real timestamp using the measured awake time. The deep sleep timer has ±5% drift, so the deviation grows with distance.">
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
