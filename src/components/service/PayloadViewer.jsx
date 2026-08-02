import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Pause, Play, Trash2, Download, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatClock, formatAge } from '../../services/ServiceApi';
import { useNow } from '../../hooks/useNow';
import { copyText } from '../../utils/clipboard';

const TOPIC_COLORS = {
    telemetry: '#4dabf7',
    status: '#c084fc',
    cmd: '#facc15',
};

const shortTopic = (topic) => topic.split('/').pop();

const prettyPayload = (payload) => {
    if (!payload) return '(empty — retained cleared)';
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

    // Every 15 s is enough: ages are shown in minutes and hours, and a tick every
    // second would re-render hundreds of rows for nothing.
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
        // A cleared retained message arrives as an empty string: there's nothing
        // to copy, and saying "couldn't copy" would send you looking for a
        // problem that doesn't exist.
        if (!payload) {
            toast('The payload is empty — it is a cleared retained message.', { icon: 'ℹ️' });
            return;
        }
        if (await copyText(payload)) toast.success('Payload copied');
        else toast.error('Could not copy');
    };

    return (
        <div className="svc-card">
            <div className="svc-card-head">
                <h3>Broker payloads</h3>
                <div className="svc-toolbar">
                    {['all', 'telemetry', 'status', 'cmd'].map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`svc-range-btn ${filter === f ? 'active' : ''}`}
                        >
                            {f === 'all' ? 'all' : f}
                        </button>
                    ))}
                    <button onClick={onTogglePause} className="svc-icon-btn" title={paused ? 'Resume' : 'Pause'}>
                        {paused ? <Play size={15} /> : <Pause size={15} />}
                        {paused ? 'Resume' : 'Pause'}
                    </button>
                    <button onClick={exportNdjson} className="svc-icon-btn" title="Export to NDJSON">
                        <Download size={15} /> NDJSON
                    </button>
                    <button onClick={onClear} className="svc-icon-btn" title="Clear the view">
                        <Trash2 size={15} /> Clear
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
                        No messages yet. The node publishes telemetry every 60 s.
                    </p>
                )}
                {filtered.length > 0 && backlogUntilSeq != null && filtered[0].seq <= backlogUntilSeq && (
                    <p className="svc-muted svc-small">
                        On connect, the backend delivers what it had stored. It's the MQTT client and
                        always runs, with or without a browser open.
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
                                    {/* Without this, a payload from last night looks the same as one
                                        from just now: formatClock only prints HH:MM:SS. */}
                                    {age && <span className="svc-muted svc-small">{age}</span>}
                                    <span className="svc-log-topic" style={{ color }}>{p.topic}</span>
                                    {p.retained && <span className="svc-badge svc-badge-muted">retained</span>}
                                    <span className="svc-muted svc-small">{p.sizeBytes} B</span>
                                    <button
                                        className="svc-icon-btn svc-icon-btn-bare"
                                        onClick={(e) => { e.stopPropagation(); copyPayload(p.payload); }}
                                        title="Copy payload"
                                    >
                                        <Copy size={13} />
                                    </button>
                                </div>
                                <pre className={`svc-log-body ${isOpen ? 'open' : ''}`}>
                                    {isOpen ? prettyPayload(p.payload) : (p.payload || '(empty — retained cleared)')}
                                </pre>
                            </div>
                            {p.seq === backlogUntilSeq && (
                                <div className="svc-log-divider">
                                    everything above already happened — the backend stored it while no one was watching
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
