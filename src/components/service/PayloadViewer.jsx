import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Pause, Play, Trash2, Download, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatClock, formatAge } from '../../services/ServiceApi';
import { useNow } from '../../hooks/useNow';

const TOPIC_COLORS = {
    telemetry: '#4dabf7',
    status: '#c084fc',
    cmd: '#facc15',
};

const shortTopic = (topic) => topic.split('/').pop();

const prettyPayload = (payload) => {
    if (!payload) return '(vacío — retained limpiado)';
    try {
        return JSON.stringify(JSON.parse(payload), null, 2);
    } catch {
        return payload;
    }
};

const PayloadViewer = ({ payloads, paused, onTogglePause, onClear, backlogUntilSeq }) => {
    const [filter, setFilter] = useState('all');
    const [expanded, setExpanded] = useState(() => new Set());
    const [autoScroll, setAutoScroll] = useState(true);
    const listRef = useRef(null);

    // Cada 15 s alcanza: las edades se muestran en minutos y horas, y un tick por
    // segundo re-renderizaría cientos de renglones para nada.
    const now = useNow(15000);

    const filtered = useMemo(() => {
        if (filter === 'all') return payloads;
        return payloads.filter((p) => shortTopic(p.topic) === filter);
    }, [payloads, filter]);

    useEffect(() => {
        if (autoScroll && !paused && listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [filtered, autoScroll, paused]);

    const toggleExpanded = (seq) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(seq)) next.delete(seq);
            else next.add(seq);
            return next;
        });
    };

    const exportNdjson = () => {
        const lines = filtered
            .map((p) => JSON.stringify({ receivedAt: p.receivedAt, topic: p.topic, retained: p.retained, sizeBytes: p.sizeBytes, payload: p.payload }))
            .join('\n');
        const blob = new Blob([lines], { type: 'application/x-ndjson' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `station-payloads-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const copyPayload = async (payload) => {
        try {
            await navigator.clipboard.writeText(payload);
            toast.success('Payload copiado');
        } catch {
            toast.error('No se pudo copiar');
        }
    };

    return (
        <div className="svc-card">
            <div className="svc-card-head">
                <h3>Payloads del broker</h3>
                <div className="svc-toolbar">
                    {['all', 'telemetry', 'status', 'cmd'].map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`svc-range-btn ${filter === f ? 'active' : ''}`}
                        >
                            {f === 'all' ? 'todos' : f}
                        </button>
                    ))}
                    <button onClick={onTogglePause} className="svc-icon-btn" title={paused ? 'Reanudar' : 'Pausar'}>
                        {paused ? <Play size={15} /> : <Pause size={15} />}
                        {paused ? 'Reanudar' : 'Pausar'}
                    </button>
                    <button onClick={exportNdjson} className="svc-icon-btn" title="Exportar a NDJSON">
                        <Download size={15} /> NDJSON
                    </button>
                    <button onClick={onClear} className="svc-icon-btn" title="Limpiar la vista">
                        <Trash2 size={15} /> Limpiar
                    </button>
                </div>
            </div>

            <label className="svc-checkbox">
                <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
                Auto-scroll
            </label>

            <div className="svc-log" ref={listRef}>
                {filtered.length === 0 && (
                    <p className="svc-muted svc-small">
                        Sin mensajes todavía. El nodo publica telemetría cada 60 s.
                    </p>
                )}
                {filtered.length > 0 && backlogUntilSeq != null && filtered[0].seq <= backlogUntilSeq && (
                    <p className="svc-muted svc-small">
                        Al conectar, el backend entrega lo que tenía guardado. Él es el cliente MQTT y
                        corre siempre, con o sin browser abierto.
                    </p>
                )}
                {filtered.map((p) => {
                    const short = shortTopic(p.topic);
                    const color = TOPIC_COLORS[short] ?? '#a1a1aa';
                    const isOpen = expanded.has(p.seq);
                    const age = formatAge(p.receivedAt, now);
                    return (
                        <React.Fragment key={p.seq}>
                            <div className="svc-log-row">
                                <div className="svc-log-head" onClick={() => toggleExpanded(p.seq)}>
                                    <span className="svc-log-time">{formatClock(p.receivedAt)}</span>
                                    {/* Sin esto, un payload de anoche se ve igual que uno de recién:
                                        formatClock imprime HH:MM:SS y nada más. */}
                                    {age && <span className="svc-muted svc-small">{age}</span>}
                                    <span className="svc-log-topic" style={{ color }}>{p.topic}</span>
                                    {p.retained && <span className="svc-badge svc-badge-muted">retained</span>}
                                    <span className="svc-muted svc-small">{p.sizeBytes} B</span>
                                    <button
                                        className="svc-icon-btn svc-icon-btn-bare"
                                        onClick={(e) => { e.stopPropagation(); copyPayload(p.payload); }}
                                        title="Copiar payload"
                                    >
                                        <Copy size={13} />
                                    </button>
                                </div>
                                <pre className={`svc-log-body ${isOpen ? 'open' : ''}`}>
                                    {isOpen ? prettyPayload(p.payload) : (p.payload || '(vacío — retained limpiado)')}
                                </pre>
                            </div>
                            {p.seq === backlogUntilSeq && (
                                <div className="svc-log-divider">
                                    lo de arriba ya había pasado — el backend lo guardó mientras no había nadie mirando
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
};

export default PayloadViewer;
