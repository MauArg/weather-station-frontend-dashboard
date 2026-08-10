import i18n from '../i18n';

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

// Re-exported rather than defined here: the formatting rules live in one place
// now, but every service component imports the clock from this module. The
// imports get pointed at utils/timezone when those components are migrated, and
// this line goes with them.
export { formatClock } from '../utils/timezone';

/*
 * The two functions below are the one place text is produced outside a React
 * component, so they read i18n.t off the instance rather than through the hook.
 *
 * They do not re-render on their own when the language changes — nothing here
 * is subscribed. It works because every call site is inside a component that
 * *is* subscribed via useTranslation, so the switch re-renders the caller and
 * the string is recomputed on the way through. Anything that memoised one of
 * these across a language change would keep the stale wording.
 */

/**
 * How long ago something happened, or null when it is recent enough that the
 * clock alone is unambiguous.
 *
 * This exists because formatClock() prints HH:MM:SS with no date, and the
 * backend is the MQTT client: it runs 24/7 and primes every new browser
 * connection with its ring buffer. So opening the dashboard after a night away
 * shows an hour-plus of history whose timestamps look exactly like live ones —
 * which reads as "the session stayed open" rather than "this is a replay".
 */
export const formatAge = (iso, now = Date.now()) => {
    if (!iso) return null;
    const at = new Date(iso).getTime();
    if (isNaN(at)) return null;

    const seconds = Math.floor((now - at) / 1000);
    // Below two minutes the clock is already enough, and a suffix on every row
    // would be noise on top of traffic that actually is live.
    if (seconds < 120) return null;
    if (seconds < 3600) return i18n.t('age.minutes', { count: Math.floor(seconds / 60) });
    if (seconds < 86400) return i18n.t('age.hours', { count: Math.floor(seconds / 3600) });

    // The only genuine plural in the app, and the reason it is a plural rather
    // than a hand-written special case: "1 day" / "N days" happens to need two
    // forms in both languages, but that is a fact about these two languages.
    return i18n.t('age.days', { count: Math.floor(seconds / 86400) });
};

/**
 * How long something has been running, in hours and minutes.
 *
 * Different from formatDuration(), which is a MM:SS for a short countdown:
 * here the useful range is hours — a log capture is thought of in windows of
 * 2 h, 8 h — and seconds would be noise that would also force a refresh every
 * second.
 */
export const formatElapsed = (totalSeconds) => {
    if (totalSeconds == null || totalSeconds < 0) return '—';
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 1) return i18n.t('elapsed.lessThanAMinute');
    if (minutes < 60) return i18n.t('elapsed.minutes', { count: minutes });

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0
        ? i18n.t('elapsed.hours', { count: hours })
        : i18n.t('elapsed.hoursMinutes', { hours, minutes: rest });
};

export const formatDuration = (totalSeconds) => {
    if (totalSeconds == null || totalSeconds < 0) return '—';
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};
