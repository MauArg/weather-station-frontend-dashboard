import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
    ScrollText, Download, Play, Square, DownloadCloud, AlertTriangle, Search,
    ChevronRight, ChevronDown, Info, Wrench, Loader2, Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Tip from './Tip';
import ConfirmDialog from './ConfirmDialog';
import { apiNote, apiText } from '../../i18n/apiText';
import { formatFixed } from '../../utils/timezone';
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
// instrumentation, not a contract. The name and the one-line description of each
// level live in the dictionary, keyed by the same number.
const LEVELS = [
    { value: 1, entriesPerCycle: 0.7 },
    { value: 2, entriesPerCycle: 1.7 },
    { value: 3, entriesPerCycle: 5 },
];

// Observed interval between cycles. The node sleeps SLEEP_INTERVAL_SEC = 60, but
// each wake also spends time on WiFi, MQTT, waiting on the retained topic and
// sensors before publishing. Measured against InfluxDB this comes out to 60-67 s
// with a median of 64.
const CYCLE_SEC = 64;

// `value` rather than i18next's `count`: `count` is the plural selector, and
// handing it "8.0" would quietly make the plural rules depend on a decimal
// string. These keys have no plural forms and should not grow one by accident.
const formatWindow = (t, ringEntries, entriesPerCycle) => {
    if (!ringEntries || !entriesPerCycle) return '—';
    const hours = (ringEntries / entriesPerCycle) * CYCLE_SEC / 3600;
    return hours < 1
        ? t('log.windowMinutes', { value: Math.round(hours * 60) })
        : t('log.windowHours', { value: formatFixed(hours, 1) });
};

// The number and the name together, always in the same order. The level is what
// travels in the command and in the firmware; the name is the only part that is
// understood at a glance. Naming only one forces a mental translation between the
// screen and the `level` seen in the payloads.
const levelName = (t, value) =>
    LEVELS.some((l) => l.value === value)
        ? t('log.levelNamed', { level: value, label: t(`log.level.${value}`) })
        : t('log.levelBare', { level: value });

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
    const { t } = useTranslation('service');

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
                ? t('log.toast.stopped')
                : t('log.toast.capturingAt', { level: levelName(t, pending.level) }));
            return undefined;
        }

        // The wait ran out. Nothing is undone: the command stays retained and the
        // node will apply it whenever it manages to read it. The only thing that
        // gets released is the UI, which would otherwise stay blocked indefinitely
        // by a node that never shows up.
        const id = setTimeout(() => {
            setPending(null);
            toast.error(t('log.toast.notConfirmed'));
        }, Math.max(0, pending.deadline - Date.now()));
        return () => clearTimeout(id);
        // `t` is out of the deps deliberately: including it would re-arm the
        // timeout on a language change, restarting a wait that is anchored to an
        // absolute deadline.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
            const note = apiNote(t, 'note', res.noteCode, res.note);
            toast.success(
                (lvl === 0
                    ? t('log.toast.stopPublished')
                    : t('log.toast.startPublished', { level: levelName(t, lvl) }))
                + (note ? ` — ${note}` : '')
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
            if (n === 0) toast(t('log.toast.noEvents'), { icon: 'ℹ️' });
            else {
                toast.success(
                    t('log.toast.transferred', { count: n })
                    + (c.cleared ? t('log.toast.transferredCleared') : '')
                );
            }
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

    /**
     * Which codes this build is still allowed to render in the operator's
     * language.
     *
     * The node is the authority on its own dictionary — that is the whole
     * reason there is no code→text map in the backend (see models/logs.go).
     * Translating here reintroduces exactly the map that design avoids, so the
     * translation is only allowed to stand in for the template it was actually
     * written against.
     *
     * The check is local because every capture carries the node's dictionary
     * with it: compare the firmware's template against the English source of
     * our translation, and if they differ, the firmware moved on and its own
     * rendering wins. This is not hypothetical — several of these lines carry
     * magic-number legends ("1=maintenance 2=reboot …") that grow whenever a
     * command is added, without the code name ever changing. Silently showing a
     * stale legend would be worse than showing English.
     */
    const translatable = useMemo(() => {
        const ok = new Set();
        for (const entry of capture?.dictionary ?? []) {
            // Our copy uses i18next placeholders; the firmware uses printf-ish ones.
            // Always read the English copy: it is the one the translation was
            // written from, and the only one comparable to the firmware's.
            const ours = t(`api:logCode.${entry.name}`, { lng: 'en', defaultValue: '' });
            if (ours && ours.replace(/\{\{([ab])\}\}/g, '%$1') === entry.template) ok.add(entry.name);
        }
        return ok;
    }, [capture, t]);

    // Rendered once, here, so the free-text filter searches the same string the
    // row displays. Filtering on the node's English `text` while showing the
    // translation meant typing a word you could read on screen matched nothing.
    const rows = useMemo(() => (capture?.entries ?? []).map((e) => ({
        entry: e,
        text: translatable.has(e.name)
            ? t(`api:logCode.${e.name}`, { a: e.a, b: e.b })
            : e.text,
    })), [capture, translatable, t]);

    const filtered = useMemo(() => {
        let list = rows;
        if (codeFilter !== 'all') list = list.filter((r) => r.entry.name === codeFilter);
        if (text.trim()) {
            const needle = text.trim().toLowerCase();
            list = list.filter((r) => r.text?.toLowerCase().includes(needle));
        }
        return list;
    }, [rows, codeFilter, text]);

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
            const note = apiNote(t, 'note', res.noteCode, res.note);
            toast.success(`${t('log.toast.serviceRequested')}${note ? ` — ${note}` : ''}`);
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
            <Play size={13} aria-hidden="true" />{' '}
            {t('log.chipCapturing', { level: levelName(t, logs.level), count: logs.count, ring })}
            {logs.activeSince && (
                <> · <CaptureUptime since={logs.activeSince} exact={logs.activeSinceExact} /></>
            )}
        </span>
    ) : (
        <span className="svc-chip svc-badge-muted">
            <Square size={13} aria-hidden="true" /> {t('log.chipStopped')}
        </span>
    );

    const head = (
        <button
            className="svc-collapse-head"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
        >
            {open ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronRight size={17} aria-hidden="true" />}
            <h3><ScrollText size={17} aria-hidden="true" /> {t('log.title')}</h3>
            {supported && stateChip}
            <span className="svc-muted svc-small svc-collapse-spacer">
                {open ? t('log.hide') : t('log.show')}
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
                            <strong>{t('log.unsupportedTitle')}</strong>
                            <div className="svc-small"><Trans t={t} i18nKey="log.unsupportedBody" /></div>
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

            <p className="svc-muted svc-small" style={{ marginTop: '0.5rem' }}>{t('log.intro')}</p>

            {logs.dictKnown && (
                <div className="svc-chips" style={{ marginTop: '0.5rem' }}>
                    <Tip className="svc-chip svc-badge-muted" text={t('log.dictCachedTip')}>
                        {t('log.dictCached')}
                    </Tip>
                </div>
            )}

            {logs.active && (
                <div className="svc-budget" style={{ marginTop: '0.5rem' }}>
                    <div className="svc-budget-head">
                        <span className="svc-small">{t('log.memory', { count: logs.count, ring })}</span>
                        <span className="svc-muted svc-small">
                            {fillPct >= 100
                                ? t('log.memoryFull')
                                : t('log.memoryPct', { pct: Math.round(fillPct) })}
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
                                <Tip text={t('log.capturingSinceTip')}>
                                    {t('log.capturingSince', { time: formatClock(logs.activeSince) })}
                                </Tip>
                            ) : (
                                <Tip text={t('log.runningSinceBeforeTip')}>
                                    {t('log.runningSinceBefore', { time: formatClock(logs.activeSince) })}
                                </Tip>
                            )}
                            {' — '}
                            <CaptureUptime since={logs.activeSince} exact={logs.activeSinceExact} />
                        </p>
                    )}
                </div>
            )}

            {/* ── Step 1 ───────────────────────────────────────────────────── */}
            <h4 className="svc-h4" style={{ marginTop: '1rem' }}>{t('log.step1')}</h4>
            <label className="svc-kv-label" style={{ marginTop: '0.4rem' }}>{t('log.captureLevel')}</label>
            <div className="svc-toolbar">
                {LEVELS.map((l) => {
                    const window = formatWindow(t, ring, l.entriesPerCycle);
                    return (
                        <button
                            key={l.value}
                            className={`svc-range-btn svc-tip ${level === l.value ? 'active' : ''}`}
                            data-tip={t('log.levelButtonTip', {
                                level: l.value,
                                blurb: t(`log.level.${l.value}blurb`),
                                window,
                            })}
                            onClick={() => setLevel(l.value)}
                        >
                            {t('log.levelButton', { label: t(`log.level.${l.value}`), level: l.value, window })}
                        </button>
                    );
                })}
            </div>
            <p className="svc-muted svc-small" style={{ marginTop: '0.4rem' }}>
                {t('log.levelHint', {
                    level,
                    blurb: t(`log.level.${level}blurb`),
                    sec: CYCLE_SEC,
                })}
            </p>

            {logs.active && logs.level !== level && (
                <p className="svc-small" style={{ marginTop: '0.35rem', color: '#fde68a' }}>
                    {t('log.levelMismatch', {
                        current: levelName(t, logs.level),
                        next: levelName(t, level),
                    })}
                </p>
            )}

            <div className="svc-btn-row" style={{ marginTop: '0.6rem' }}>
                <button
                    className="svc-btn svc-btn-primary svc-tip"
                    data-tip={t('log.startTip')}
                    disabled={busy || !connected || pending !== null || captureLocked}
                    onClick={() => (logs.active ? setConfirm('start') : setCaptureLevel(level))}
                >
                    {pending?.kind === 'start'
                        ? <><Loader2 size={16} className="animate-spin" /> {t('log.starting')}</>
                        : <><Play size={16} /> {t('log.start')}</>}
                </button>
                <button
                    className="svc-btn svc-tip"
                    data-tip={t('log.stopTip')}
                    disabled={busy || !connected || !logs.active || pending !== null || captureLocked}
                    onClick={() => setConfirm('stop')}
                >
                    {pending?.kind === 'stop'
                        ? <><Loader2 size={16} className="animate-spin" /> {t('log.stopping')}</>
                        : <><Square size={16} /> {t('log.stop')}</>}
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
                                ? t('log.pendingStop')
                                : t('log.pendingStart', { level: levelName(t, pending.level) })}
                            {t('log.pendingSuffix')}
                        </strong>
                        <div className="svc-small">
                            {pending.sawRetained && !retainedIsLogCmd
                                ? t('log.pendingPickedUp')
                                : t('log.pendingRetained', {
                                    when: state?.node?.nextWakeInSec > 0
                                        ? t('log.pendingWhen', { sec: state.node.nextWakeInSec })
                                        : '',
                                })}
                        </div>
                    </div>
                </div>
            )}

            {captureLocked && !pending && (
                <div className="svc-alert svc-alert-warn" style={{ marginTop: '0.6rem' }}>
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div>
                        <strong>{t('log.lockedTitle')}</strong>
                        <div className="svc-small">
                            {inServiceMode ? t('log.lockedInService') : t('log.lockedArmed')}
                            {t('log.lockedTail')}
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={confirm !== null}
                title={confirm === 'start' ? t('log.confirm.startTitle') : t('log.confirm.stopTitle')}
                confirmLabel={confirm === 'start' ? t('log.confirm.startLabel') : t('log.confirm.stopLabel')}
                onCancel={() => setConfirm(null)}
                onConfirm={() => {
                    const kind = confirm;
                    setConfirm(null);
                    setCaptureLevel(kind === 'start' ? level : 0);
                }}
            >
                {/* Whole sentences chosen by condition rather than a run of
                    fragments. The English original was assembled from six pieces
                    whose order the JSX decided; that leaves a translator unable to
                    see, or reorder, the sentence they are writing. */}
                {confirm === 'start'
                    ? t('log.confirm.startBody', { level: levelName(t, logs.level) })
                    : t('log.confirm.stopBody')}
                {' '}
                <Trans
                    t={t}
                    i18nKey={logs.count > 0 ? 'log.confirm.reportedLost' : 'log.confirm.reportedNone'}
                    values={{ count: logs.count }}
                />
                {logs.count > 0 && (
                    <>
                        {' '}
                        <Trans
                            t={t}
                            i18nKey={confirm === 'stop'
                                ? 'log.confirm.transferFirstStop'
                                : 'log.confirm.transferFirstStart'}
                        />
                    </>
                )}
            </ConfirmDialog>

            {/* ── Step 2 ───────────────────────────────────────────────────── */}
            <h4 className="svc-h4" style={{ marginTop: '1.2rem' }}>{t('log.step2')}</h4>

            {/* The requirement goes BEFORE the button and with the action inside it.
                This explanation used to hang below everything, so it read like the
                answer to "Start capture" — the button above— instead of the
                requirement for the one below. */}
            {needsServiceMode && (
                <div className="svc-alert svc-alert-info" style={{ marginTop: '0.4rem' }}>
                    <Info size={18} aria-hidden="true" />
                    <div>
                        <strong>{t('log.needsWakeTitle')}</strong>
                        <div className="svc-small">{t('log.needsWakeBody')}</div>
                        <button
                            className="svc-btn svc-tip"
                            style={{ marginTop: '0.6rem' }}
                            data-tip={t('log.armTip')}
                            disabled={busy || maintenanceArmed}
                            onClick={armServiceMode}
                        >
                            <Wrench size={16} /> {maintenanceArmed ? t('log.armAlreadyRequested') : t('log.arm')}
                        </button>
                    </div>
                </div>
            )}

            {!logs.canFetch && !needsServiceMode && logs.cantWhy && (
                <p className="svc-muted svc-small" style={{ marginTop: '0.4rem' }}>
                    {apiText(t, 'cantWhy', logs.cantWhyCode, logs.cantWhy)}
                </p>
            )}

            <div className="svc-btn-row" style={{ marginTop: '0.6rem' }}>
                <button
                    className="svc-btn svc-btn-primary svc-tip"
                    data-tip={t('log.transferTip')}
                    disabled={busy || !logs.canFetch}
                    onClick={transfer}
                >
                    {/* The label watches `transferring`, not `busy`: `busy` is shared
                        by every action on the panel, so starting a capture would put
                        this button in "Transferring…" while nothing was transferring. */}
                    <DownloadCloud size={16} /> {transferring ? t('log.transferring') : t('log.transfer')}
                </button>
                <label className="svc-checkbox">
                    <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
                    <Tip text={t('log.keepTip')}>{t('log.keep')}</Tip>
                </label>
            </div>
            {logs.lastError && (
                <div className="svc-alert svc-alert-warn" style={{ marginTop: '0.6rem' }}>
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div>
                        {/* lastError itself stays untranslated: it is the raw text
                            from paho or from the network, and the verbatim message
                            is worth more to whoever is debugging than a rendering
                            of it. */}
                        <strong>{t('log.lastErrorTitle')}</strong>
                        <div className="svc-small">{logs.lastError}</div>
                    </div>
                </div>
            )}

            {/* ── Transferred capture ──────────────────────────────────────── */}
            {capture && (
                <>
                    <div className="svc-card-head" style={{ marginTop: '1.2rem' }}>
                        <h4 className="svc-h4">
                            {t('log.step3', { count: capture.count || capture.entries?.length || 0 })}
                            {capture.firmware ? t('log.step3Firmware', { firmware: capture.firmware }) : ''}
                        </h4>
                        <div className="svc-toolbar">
                            <a
                                className="svc-icon-btn svc-tip"
                                data-tip={t('log.exportJsonTip')}
                                href={LOG_EXPORT_JSON_URL}
                                download
                            >
                                <Download size={15} /> JSON
                            </a>
                            <a
                                className="svc-icon-btn svc-tip"
                                data-tip={t('log.exportNdjsonTip')}
                                href={LOG_EXPORT_NDJSON_URL}
                                download
                            >
                                <Download size={15} /> NDJSON
                            </a>
                        </div>
                    </div>
                    <p className="svc-muted svc-small">
                        {t('log.transferredAt', { time: formatClock(capture.fetchedAt) })}{' '}
                        {capture.cleared
                            ? (capture.kept ? t('log.clearedKept') : t('log.clearedStopped'))
                            : t('log.notCleared')}
                    </p>

                    {capture.dropped > 0 && (
                        <div className="svc-alert svc-alert-warn" style={{ marginTop: '0.5rem' }}>
                            <AlertTriangle size={18} aria-hidden="true" />
                            <div>
                                <strong>{t('log.droppedTitle')}</strong>
                                <div className="svc-small">{t('log.droppedBody', { count: capture.dropped })}</div>
                            </div>
                        </div>
                    )}

                    {/* noteCodes runs parallel to notes and in the same order, so
                        the index lines them up; the prose is the fallback for a
                        backend that predates the codes. */}
                    {capture.notes?.map((n, i) => (
                        <p key={i} className="svc-muted svc-small" style={{ marginTop: '0.35rem' }}>
                            {apiNote(t, 'captureNote', capture.noteCodes?.[i], n)}
                        </p>
                    ))}

                    {(capture.entries?.length ?? 0) > 0 && (
                        <>
                            <div className="svc-toolbar" style={{ marginTop: '0.6rem' }}>
                                <button
                                    className={`svc-range-btn ${codeFilter === 'all' ? 'active' : ''}`}
                                    onClick={() => setCodeFilter('all')}
                                >
                                    {t('log.filterAll')}
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
                                    placeholder={t('log.filterPlaceholder')}
                                    spellCheck={false}
                                />
                                <span className="svc-muted svc-small" style={{ alignSelf: 'center' }}>
                                    <Search size={13} aria-hidden="true" /> {filtered.length}
                                </span>
                            </div>

                            <div className="svc-log" style={{ marginTop: '0.5rem' }}>
                                {filtered.length === 0 && (
                                    <p className="svc-muted svc-small">{t('log.noMatches')}</p>
                                )}
                                {filtered.map(({ entry: e, text: rendered }, i) => (
                                    <div key={i} className="svc-log-row">
                                        <div className="svc-log-head">
                                            <span className="svc-log-time">
                                                {e.at ? formatClock(e.at) : '—'}
                                                {e.at && !e.atAnchored && (
                                                    <Tip text={t('log.estimatedTimeTip')}>
                                                        {' '}≈
                                                    </Tip>
                                                )}
                                            </span>
                                            <span className="svc-badge svc-badge-muted">#{e.boot}</span>
                                            <span className="svc-muted svc-small">{e.ms} ms</span>
                                            {/* Already resolved above, alongside the filter, so the
                                                two can never disagree. The node's LOG_CODES templates
                                                are hashed into its dictionary fingerprint and so cannot
                                                be translated at the source — see `translatable`. */}
                                            <span className="svc-log-topic">{rendered}</span>
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
