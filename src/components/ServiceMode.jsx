import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Wifi, WifiOff, ArrowLeft, Cpu } from 'lucide-react';
import OtaWizard from './service/OtaWizard';
import BatteryPanel from './service/BatteryPanel';
import NodeHealthPanel from './service/NodeHealthPanel';
import PayloadViewer from './service/PayloadViewer';
import CommandConsole from './service/CommandConsole';
import LogPanel from './service/LogPanel';
import LivePanel from './service/LivePanel';
import { openServiceStream, getServiceState } from '../services/ServiceApi';

const MAX_PAYLOADS = 500;

const ServiceMode = ({ onBack }) => {
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
                <button className="back-btn" onClick={onBack}><ArrowLeft size={18} /> Back</button>
                <div className="svc-card">
                    <h3>Couldn't load state</h3>
                    <p className="svc-muted">{error}</p>
                </div>
            </div>
        );
    }

    if (!state) {
        return (
            <div className="svc-container" style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: '1rem', padding: '3rem' }}>
                <Loader2 className="animate-spin" size={40} color="#4dabf7" />
                <p className="svc-muted">Connecting to the broker…</p>
            </div>
        );
    }

    const connected = state.broker?.connected;

    return (
        <div className="svc-container">
            <div className="svc-header">
                <button className="back-btn" onClick={onBack}><ArrowLeft size={18} /> Dashboard</button>
                <div className="svc-header-meta">
                    <span className="svc-status-pill" style={{ borderColor: connected ? '#4ade80' : '#f87171', color: connected ? '#4ade80' : '#f87171' }}>
                        {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
                        {connected ? `Broker ${state.broker.address}` : 'Broker disconnected'}
                    </span>
                    {state.stationIp && (
                        <span
                            className="svc-status-pill svc-pill-muted"
                            title="The node's static IP — this is the OTA target. It comes from the backend config, not telemetry."
                        >
                            <Cpu size={15} /> Node {state.stationIp}
                        </span>
                    )}
                    <span className="svc-muted svc-small">
                        station {state.stationId} · stream {streamUp ? 'live' : 'reconnecting…'}
                    </span>
                </div>
            </div>

            {!connected && state.broker?.lastError && (
                <div className="svc-alert svc-alert-danger">
                    <WifiOff size={18} aria-hidden="true" />
                    <div>
                        <strong>No connection to the MQTT broker.</strong>
                        <div className="svc-small">{state.broker.lastError}</div>
                    </div>
                </div>
            )}

            {/* Two columns pairing a tall card with a short one on each row, so the
                cards stretch to a common height instead of leaving ragged gaps:
                battery ↔ node health, then command console ↔ payloads. */}
            <div className="svc-grid">
                <OtaWizard state={state} session={session} onSession={setSession} />
                <BatteryPanel battery={state.battery} />
                <NodeHealthPanel state={state} />
                <CommandConsole connected={connected} />
                <PayloadViewer
                    payloads={payloads}
                    paused={paused}
                    onTogglePause={() => setPaused((p) => !p)}
                    onClear={() => { setPayloads([]); setBacklogUntilSeq(null); }}
                    backlogUntilSeq={backlogUntilSeq}
                />
                {/* Both full width, like the wizard, and both below the paired
                    cards on purpose. Live mode and the log panel are occasional
                    controls, and giving either one a half column would leave the
                    four cards above it unpaired — which is the ragged edge the
                    pairing exists to avoid. Log rows also carry a time, a cycle
                    number and a whole sentence, unreadable at half width. */}
                <LivePanel state={state} connected={connected} />
                <LogPanel state={state} connected={connected} />
            </div>
        </div>
    );
};

export default ServiceMode;
