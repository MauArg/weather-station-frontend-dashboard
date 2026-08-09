import { formatTime } from '../utils/timezone';

const API_BASE_URL = '/api/v1';

const handleResponse = async (response) => {
    if (!response.ok) {
        const errorMsg = await response.text();
        throw new Error(`API Error (${response.status}): ${errorMsg || response.statusText}`);
    }
    return response.json();
};

// The two guards stay here rather than moving into formatTime, because this call
// site wants different fallbacks than a chart axis does: null for a missing value
// (the caller then leaves the field untouched) and the raw string for an
// unparseable one, which would be a backend bug worth seeing rather than hiding.
const convertToLocalTime = (isoString) => {
    if (!isoString) return null;
    if (isNaN(new Date(isoString))) return isoString;
    return formatTime(isoString);
};

export const getRealTimeData = async () => {
    const response = await fetch(`${API_BASE_URL}/weather/current`);
    return handleResponse(response);
};

export const getDailyStats = async () => {
    const response = await fetch(`${API_BASE_URL}/weather/stats/daily`);
    const data = await handleResponse(response);
    
    // Convert extreme times if they come as full dates or try our best
    // Assumes backend might send ISO string in `time` or we leave it if it's just "14:30:00"
    const today = new Date().toISOString().split('T')[0];
    for (const key of Object.keys(data)) {
        if (data[key] && data[key].time) {
            let timeStr = data[key].time;
            if (!timeStr.includes('T')) {
                timeStr = `${today}T${timeStr}Z`;
            }
            data[key].time = convertToLocalTime(timeStr);
        }
    }
    return data;
};

export const getRecentHistory = async (hours = 24) => {
    const response = await fetch(`${API_BASE_URL}/weather/history/recent?hours=${hours}`);
    const data = await handleResponse(response);
    return data.map(item => {
        const ts = item.fullResDate || item.timestamp;
        if (ts) {
            item.time = convertToLocalTime(ts);
            item.uniqueTime = ts; // Used for unique XAxis
        }
        return item;
    });
};

export const getHistoricData = async (date) => {
    const d = new Date(date);
    // Format as YYYY-MM-DD in local time to avoid UTC shift
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const response = await fetch(`${API_BASE_URL}/weather/history/day?date=${dateStr}`);
    const data = await handleResponse(response);
    return data.map(item => {
        const ts = item.fullResDate || item.timestamp;
        if (ts) {
            item.time = convertToLocalTime(ts);
            item.uniqueTime = ts;
        }
        return item;
    });
};

export const getYearlyTableData = async (yearDate) => {
    const yearStr = yearDate instanceof Date ? yearDate.getFullYear() : yearDate;
    const response = await fetch(`${API_BASE_URL}/weather/history/year?year=${yearStr}`);
    return handleResponse(response);
};

/**
 * Which build of the backend is answering.
 *
 * Returns null instead of throwing when it cannot be read. The version legend is
 * a diagnostic, not a feature: an old backend that lacks this endpoint answers
 * 404, and that must degrade to showing the dashboard's own version rather than
 * putting an error on screen. Silence here is a real answer — it says the two
 * halves of the deploy are out of step, which is precisely what the legend is
 * there to reveal.
 */
export const getBackendVersion = async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/version`);
        if (!response.ok) return null;
        const data = await response.json();
        return data.version ?? null;
    } catch {
        return null;
    }
};
