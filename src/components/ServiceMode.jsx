import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Wifi, WifiOff, ArrowLeft } from 'lucide-react';
import OtaWizard from './service/OtaWizard';
import BatteryPanel from './service/BatteryPanel';
import NodeHealthPanel from './service/NodeHealthPanel';
import PayloadViewer from './service/PayloadViewer';
import CommandConsole from './service/CommandConsole';
import { openServiceStream, getServiceState } from '../services/ServiceApi';

const MAX_PAYLOADS = 500;

const ServiceMode = ({ onBack }) => {
    const [state, setState] = useState(null);
    const [payloads, setPayloads] = useState([]);
    const [paused, setPaused] = useState(false);
    const [streamUp, setStreamUp] = useState(false);
    const [session, setSession] = useState(null);
    const [error, setError] = useState(null);

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
            onBacklog: (list) => appendPayloads(list),
            onError: () => setStreamUp(false),
        });

        return () => { cancelled = true; close(); };
    }, [appendPayloads]);

    if (error && !state) {
        return (
            <div className="svc-container">
                <button className="back-btn" onClick={onBack}><ArrowLeft size={18} /> Volver</button>
                <div className="svc-card">
                    <h3>No se pudo cargar el estado</h3>
                    <p className="svc-muted">{error}</p>
                </div>
            </div>
        );
    }

    if (!state) {
        return (
            <div className="svc-container" style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: '1rem', padding: '3rem' }}>
                <Loader2 className="animate-spin" size={40} color="#4dabf7" />
                <p className="svc-muted">Conectando al broker…</p>
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
                        {connected ? `Broker ${state.broker.address}` : 'Broker desconectado'}
                    </span>
                    <span className="svc-muted svc-small">
                        estación {state.stationId} · stream {streamUp ? 'en vivo' : 'reconectando…'}
                    </span>
                </div>
            </div>

            {!connected && state.broker?.lastError && (
                <div className="svc-alert svc-alert-danger">
                    <WifiOff size={18} aria-hidden="true" />
                    <div>
                        <strong>Sin conexión al broker MQTT.</strong>
                        <div className="svc-small">{state.broker.lastError}</div>
                    </div>
                </div>
            )}

            {/* Two columns pairing a tall card with a short one on each row, so the
                cards stretch to a common height instead of leaving ragged gaps:
                batería ↔ estado del nodo, then consola ↔ payloads. */}
            <div className="svc-grid">
                <OtaWizard state={state} session={session} onSession={setSession} />
                <BatteryPanel battery={state.battery} />
                <NodeHealthPanel state={state} />
                <CommandConsole connected={connected} />
                <PayloadViewer
                    payloads={payloads}
                    paused={paused}
                    onTogglePause={() => setPaused((p) => !p)}
                    onClear={() => setPayloads([])}
                />
            </div>
        </div>
    );
};

export default ServiceMode;
