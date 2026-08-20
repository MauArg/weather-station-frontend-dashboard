import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Wifi, WifiOff, ArrowLeft, Cpu, Activity, SlidersHorizontal, ScrollText, Radio } from 'lucide-react';
import OtaWizard from './service/OtaWizard';
import BatteryPanel from './service/BatteryPanel';
import NodeHealthPanel from './service/NodeHealthPanel';
import EnclosurePanel from './service/EnclosurePanel';
import WifiPanel from './service/WifiPanel';
import PayloadViewer from './service/PayloadViewer';
import CommandConsole from './service/CommandConsole';
import LogPanel from './service/LogPanel';
import LivePanel from './service/LivePanel';
import NodeStatusStrip from './service/NodeStatusStrip';
import TabBar from './service/TabBar';
import { openServiceStream, getServiceState } from '../services/ServiceApi';

const MAX_PAYLOADS = 500;

// The view grew one loose card at a time until seven of them shared a single
// screen. These four group them by the question being asked: Status is what the
// node reports, Control is what you do to it, and the two heavy instruments get
// a surface each. It is also where the enclosure and RSSI charts land later —
// Status — which is the reason the split happened before they were written.
const TAB_IDS = ['status', 'control', 'logs', 'mqtt'];
const TAB_STORAGE_KEY = 'serviceTab';

const ServiceMode = ({ onBack }) => {
    const { t } = useTranslation('service');
    const [state, setState] = useState(null);
    const [payloads, setPayloads] = useState([]);
    const [paused, setPaused] = useState(false);
    const [streamUp, setStreamUp] = useState(false);
    const [session, setSession] = useState(null);
    const [error, setError] = useState(null);

    // Last payload of the backlog the backend sent on connect. Marks where what
    // already happened ends and what's arriving live begins — without that
    // boundary, opening the dashboard after a few hours shows a wall of old
    // messages that look like they just arrived.
    const [backlogUntilSeq, setBacklogUntilSeq] = useState(null);

    // Same idiom as pressureMode in Dashboard.jsx: read lazily, write in an
    // effect, and let storage failures pass in silence — localStorage throws
    // when cookies are blocked, and the cost of that is landing on Status.
    const [activeTab, setActiveTab] = useState(() => {
        try {
            const saved = localStorage.getItem(TAB_STORAGE_KEY);
            return TAB_IDS.includes(saved) ? saved : 'status';
        } catch {
            return 'status';
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(TAB_STORAGE_KEY, activeTab);
        } catch {
            // Not worth surfacing: the choice just does not survive a reload.
        }
    }, [activeTab]);

    // Held in a ref so the SSE callbacks, which are registered once, always see the
    // current value instead of the one captured when the stream opened.
    const pausedRef = useRef(paused);
    useEffect(() => { pausedRef.current = paused; }, [paused]);

    const appendPayloads = useCallback((incoming) => {
        if (pausedRef.current) return;
        setPayloads((prev) => {
            const next = prev.concat(incoming);
            return next.length > MAX_PAYLOADS ? next.slice(next.length - MAX_PAYLOADS) : next;
        });
    }, []);

    useEffect(() => {
        let cancelled = false;

        getServiceState()
            .then((s) => !cancelled && setState(s))
            .catch((err) => !cancelled && setError(err.message));

        const close = openServiceStream({
            onOpen: () => { setStreamUp(true); setError(null); },
            onState: (s) => setState(s),
            onPayload: (p) => appendPayloads([p]),
            onBacklog: (list) => {
                if (list.length > 0) setBacklogUntilSeq(list[list.length - 1].seq);
                appendPayloads(list);
            },
            onError: () => setStreamUp(false),
        });

        return () => { cancelled = true; close(); };
    }, [appendPayloads]);

    if (error && !state) {
        return (
            <div className="svc-container">
                <button className="back-btn" onClick={onBack}><ArrowLeft size={18} /> {t('shell.back')}</button>
                <div className="svc-card">
                    <h3>{t('shell.couldntLoadState')}</h3>
                    <p className="svc-muted">{error}</p>
                </div>
            </div>
        );
    }

    if (!state) {
        return (
            <div className="svc-container" style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: '1rem', padding: '3rem' }}>
                <Loader2 className="animate-spin" size={40} color="#4dabf7" />
                <p className="svc-muted">{t('shell.connecting')}</p>
            </div>
        );
    }

    const connected = state.broker?.connected;

    // What the tab dots are for: the two things that keep running after you look
    // away. A capture left on was already a known way to lose months of nothing,
    // and a retained command is the "did I leave the node armed?" check — both
    // used to be visible because every panel was on screen at once.
    const liveRunning = state.status?.state === 'live_mode_active' || state.status?.state === 'live_mode_alive';
    const tabs = [
        { id: 'status', label: t('tabs.status'), Icon: Activity },
        {
            id: 'control',
            label: t('tabs.control'),
            Icon: SlidersHorizontal,
            badge: state.retainedCmd?.present
                ? t('tabs.badge.retained', { cmd: state.retainedCmd.cmd })
                : liveRunning ? t('tabs.badge.live') : null,
        },
        {
            id: 'logs',
            label: t('tabs.logs'),
            Icon: ScrollText,
            badge: state.logs?.active ? t('tabs.badge.capturing') : null,
        },
        { id: 'mqtt', label: t('tabs.mqtt'), Icon: Radio },
    ];

    // hidden rather than unmounted, and the distinction is load-bearing. LogPanel
    // holds the wait for a capture command to be confirmed —- a four minute
    // timeout plus the effect watching for it — in its own state, with nothing
    // that rebuilds it from the server. Unmounting would drop the spinner while
    // the command was still in flight and re-enable the buttons on top of it.
    // BatteryPanel would also re-query InfluxDB on every switch, and the range,
    // the filters and a half-typed raw command would all reset.
    //
    // It costs nothing: all seven panels already re-render on every SSE push, so
    // keeping them mounted is exactly today's behaviour. These tabs are a
    // visibility mechanism, not a mounting one.
    //
    // The two-column grid only survives where a tab actually holds a pair to
    // balance. Alone in a tab, a half-width card leaves the other half empty,
    // so the rest stack full width — which is what the wizard, live mode and the
    // log table already asked for by spanning both columns.
    const panel = (id, children, layout = 'svc-stack') => (
        <div
            id={`svc-tabpanel-${id}`}
            role="tabpanel"
            aria-labelledby={`svc-tab-${id}`}
            className={`svc-tabpanel ${layout}`}
            hidden={activeTab !== id}
        >
            {children}
        </div>
    );

    return (
        <div className="svc-container">
            <div className="svc-header">
                <button className="back-btn" onClick={onBack}><ArrowLeft size={18} /> {t('shell.dashboard')}</button>
                <div className="svc-header-meta">
                    <span className="svc-status-pill" style={{ borderColor: connected ? '#4ade80' : '#f87171', color: connected ? '#4ade80' : '#f87171' }}>
                        {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
                        {connected
                            ? t('shell.brokerConnected', { address: state.broker.address })
                            : t('shell.brokerDisconnected')}
                    </span>
                    {state.stationIp && (
                        <span className="svc-status-pill svc-pill-muted" title={t('shell.nodeIpTip')}>
                            <Cpu size={15} /> {t('shell.node')} {state.stationIp}
                        </span>
                    )}
                    <span className="svc-muted svc-small">
                        {t('shell.stationLine', {
                            id: state.stationId,
                            stream: streamUp ? t('shell.streamLive') : t('shell.streamReconnecting'),
                        })}
                    </span>
                </div>
            </div>

            {!connected && state.broker?.lastError && (
                <div className="svc-alert svc-alert-danger">
                    <WifiOff size={18} aria-hidden="true" />
                    <div>
                        <strong>{t('shell.noBrokerTitle')}</strong>
                        <div className="svc-small">{state.broker.lastError}</div>
                    </div>
                </div>
            )}

            <NodeStatusStrip node={state.node} />

            <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} label={t('tabs.aria')} />

            {/* Within a tab the two columns still pair a tall card with a short one
                so they stretch to a common height instead of leaving a ragged gap. */}
            {/* All three history charts gate their render on `active`, and that is
                load-bearing rather than an optimisation — see BatteryPanel for the
                measurement. They keep their series and their selected range in
                state, so a hidden tab costs a skipped render and nothing else. */}
            {panel('status', (
                <>
                    <BatteryPanel battery={state.battery} active={activeTab === 'status'} />
                    <NodeHealthPanel state={state} />
                    <EnclosurePanel node={state.node} active={activeTab === 'status'} />
                    <WifiPanel node={state.node} active={activeTab === 'status'} />
                </>
            ), 'svc-grid')}

            {panel('control', (
                <>
                    <OtaWizard state={state} session={session} onSession={setSession} />
                    <LivePanel state={state} connected={connected} />
                    <CommandConsole connected={connected} />
                </>
            ), 'svc-grid')}

            {panel('logs', <LogPanel state={state} connected={connected} />)}

            {panel('mqtt', (
                <PayloadViewer
                    payloads={payloads}
                    paused={paused}
                    onTogglePause={() => setPaused((p) => !p)}
                    onClear={() => { setPayloads([]); setBacklogUntilSeq(null); }}
                    backlogUntilSeq={backlogUntilSeq}
                    active={activeTab === 'mqtt'}
                />
            ))}
        </div>
    );
};

export default ServiceMode;
