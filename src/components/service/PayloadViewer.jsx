import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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

const PayloadViewer = ({ payloads, paused, onTogglePause, onClear, backlogUntilSeq }) => {
    const { t } = useTranslation('service');

    const prettyPayload = (payload) => {
        if (!payload) return t('payloads.empty');
        try {
            return JSON.stringify(JSON.parse(payload), null, 2);
        } catch {
            return payload;
        }
    };

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
            toast(t('payloads.toast.emptyPayload'), { icon: 'ℹ️' });
            return;
        }
        if (await copyText(payload)) toast.success(t('payloads.toast.copied'));
        else toast.error(t('payloads.toast.copyFailed'));
    };

    return (
        <div className="svc-card">
            <div className="svc-card-head">
                <h3>{t('payloads.title')}</h3>
                <div className="svc-toolbar">
                    {/* Only "all" is a word; the other three are MQTT topic
                        segments and stay verbatim. */}
                    {['all', 'telemetry', 'status', 'cmd'].map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`svc-range-btn ${filter === f ? 'active' : ''}`}
                        >
                            {f === 'all' ? t('payloads.filterAll') : f}
                        </button>
                    ))}
                    <button
                        onClick={onTogglePause}
                        className="svc-icon-btn"
                        title={paused ? t('payloads.resume') : t('payloads.pause')}
                    >
                        {paused ? <Play size={15} /> : <Pause size={15} />}
                        {paused ? t('payloads.resume') : t('payloads.pause')}
                    </button>
                    <button onClick={exportNdjson} className="svc-icon-btn" title={t('payloads.exportNdjson')}>
                        <Download size={15} /> NDJSON
                    </button>
                    <button onClick={onClear} className="svc-icon-btn" title={t('payloads.clearTip')}>
                        <Trash2 size={15} /> {t('payloads.clear')}
                    </button>
                </div>
            </div>

            <label className="svc-checkbox">
                <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
                {t('payloads.autoScroll')}
            </label>

            <div className="svc-log" ref={listRef}>
                {filtered.length === 0 && (
                    <p className="svc-muted svc-small">{t('payloads.noMessages')}</p>
                )}
                {filtered.length > 0 && backlogUntilSeq != null && filtered[0].seq <= backlogUntilSeq && (
                    <p className="svc-muted svc-small">{t('payloads.backlogNote')}</p>
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
                                    {p.retained && <span className="svc-badge svc-badge-muted">{t('payloads.retained')}</span>}
                                    <span className="svc-muted svc-small">{p.sizeBytes} B</span>
                                    <button
                                        className="svc-icon-btn svc-icon-btn-bare"
                                        onClick={(e) => { e.stopPropagation(); copyPayload(p.payload); }}
                                        title={t('payloads.copyPayload')}
                                    >
                                        <Copy size={13} />
                                    </button>
                                </div>
                                <pre className={`svc-log-body ${isOpen ? 'open' : ''}`}>
                                    {isOpen ? prettyPayload(p.payload) : (p.payload || t('payloads.empty'))}
                                </pre>
                            </div>
                            {p.seq === backlogUntilSeq && (
                                <div className="svc-log-divider">{t('payloads.backlogDivider')}</div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
};

export default PayloadViewer;
