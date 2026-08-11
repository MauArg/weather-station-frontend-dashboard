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

/**
 * Pulls the node's captured log ring.
 *
 * Synchronous on purpose: the whole download is ~14 request/response round trips
 * over the LAN, so it returns in about a second with the node awake. It only
 * works during service mode — outside a session the node sleeps 60 s out of every
 * 70 and is not subscribed to the request topic.
 *
 * keep=true takes a snapshot without turning capture off; the default clears the
 * ring on the node and disarms it.
 */
export const fetchNodeLogs = async (keep = false) => {
    const response = await fetch(`${API_BASE_URL}/logs/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `API Error (${response.status})`);
    return JSON.parse(text);
};

/**
 * The last capture this backend instance downloaded, so a page reload does not
 * cost another service mode session. Returns null when there is none.
 */
export const getLastLogCapture = async () => {
    const response = await fetch(`${API_BASE_URL}/logs/capture`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`API Error (${response.status})`);
    return response.json();
};

// Exports are served by the backend rather than rebuilt here because they are
// self-contained: the file carries the code dictionary and the time anchors, so
// it stays readable months later even after the firmware renumbers codes.
export const LOG_EXPORT_JSON_URL = `${API_BASE_URL}/logs/capture?download=1`;
export const LOG_EXPORT_NDJSON_URL = `${API_BASE_URL}/logs/capture.ndjson`;

/** Battery voltage history for the sparkline. */
export const getBatteryTrend = async (hours = 72) => {
    const response = await fetch(`${API_BASE_URL}/service/battery-trend?hours=${hours}`);
    if (!response.ok) throw new Error(`API Error (${response.status})`);
    return response.json();
};
