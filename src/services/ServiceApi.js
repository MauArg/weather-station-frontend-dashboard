const API_BASE_URL = '/api/v1';

/**
 * Opens the SSE stream carrying service mode state and raw MQTT payloads.
 *
 * EventSource reconnects on its own, and the backend replays current state on
 * every connect, so a dropped connection self-heals without extra logic here.
 *
 * Returns a close function.
 */
export const openServiceStream = ({ onState, onPayload, onBacklog, onOpen, onError }) => {
    const source = new EventSource(`${API_BASE_URL}/service/stream?backlog=100`);

    source.onopen = () => onOpen?.();

    source.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return; // keepalive comments never reach onmessage, so this is a real malformed frame
        }

        if (data.type === 'state') onState?.(data.state);
        else if (data.type === 'payload') onPayload?.(data.payload);
        else if (data.type === 'backlog') onBacklog?.(data.backlog || []);
    };

    source.onerror = () => onError?.();

    return () => source.close();
};

/** One-shot state snapshot, for the initial render before the stream is up. */
export const getServiceState = async () => {
    const response = await fetch(`${API_BASE_URL}/service/state`);
    if (!response.ok) throw new Error(`API Error (${response.status})`);
    return response.json();
};

/**
 * Publishes to the station command topic.
 * cmd: 'maintenance' | 'ping' | 'reboot' | 'clear' | 'raw'
 */
export const sendServiceCommand = async (body) => {
    const response = await fetch(`${API_BASE_URL}/service/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `API Error (${response.status})`);
    return JSON.parse(text);
};

/** Battery voltage history for the sparkline. */
export const getBatteryTrend = async (hours = 72) => {
    const response = await fetch(`${API_BASE_URL}/service/battery-trend?hours=${hours}`);
    if (!response.ok) throw new Error(`API Error (${response.status})`);
    return response.json();
};

export const formatClock = (iso) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (isNaN(date)) return '—';
    return date.toLocaleTimeString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

export const formatDuration = (totalSeconds) => {
    if (totalSeconds == null || totalSeconds < 0) return '—';
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};
