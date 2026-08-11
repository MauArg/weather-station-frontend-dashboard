/**
 * The one timezone and the one number format this dashboard renders in.
 *
 * The backend serves every timestamp in UTC, which is the right thing for it to
 * do, but nothing here is meant to be read that way: the station sits in
 * Argentina and so does whoever is looking at the screen. Every formatter in the
 * app converts, and the backend cuts its "day" boundaries — daily extremes, the
 * calendar cells — on local days too.
 *
 * That conversion used to be invisible, which is a problem for a page full of
 * bare HH:MM:SS: there was nothing on screen saying which clock they belonged
 * to. The label in the navbar exists to be shown, not just used.
 *
 * **These constants do not follow the UI language, and that is deliberate.**
 * When the dashboard is read in English the clock stays ART on a 24 h dial and
 * decimals stay commas. ART is a property of the data, not a reader preference:
 * switching to MM/DD and AM/PM would make a timestamp here ambiguous against the
 * same instant in the node's telemetry, and would contradict the badge in the
 * navbar promising Argentina time. Only words change with the language; see
 * src/i18n/index.js.
 *
 * (An earlier version of this comment said the locale should come from the
 * language layer. That conflated two axes that move independently — it does not.)
 */
export const TIME_ZONE = 'America/Argentina/Buenos_Aires';
export const LOCALE = 'es-AR';

/**
 * Forces the 24 h clock, and it is not optional.
 *
 * Asking Intl for es-AR with an explicit `hour` resolves to hourCycle 'h12' in
 * Chrome — 19:00 UTC came out as "04:00 p. m." on every chart axis, tooltip and
 * service-view clock in the app. Argentina writes 16:00, and so does everything
 * this dashboard is read against: the ISO timestamps from the backend, InfluxDB,
 * and the MQTT payload viewer beside it. A 12 h clock also loses to a glance
 * exactly where it matters most here, on an overnight battery-drift chart where
 * "04:00" appearing twice is the whole question.
 *
 * 'h23' rather than `hour12: false`, which yields the h24 cycle in some engines
 * and renders midnight as 24:00.
 */
const HOUR_CYCLE = 'h23';

/**
 * HH:MM. Returns '' rather than a dash for a missing value, because every call
 * site is a chart tick or axis label where a stray glyph reads as data.
 */
export const formatTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (isNaN(date)) return '';
    return date.toLocaleTimeString(LOCALE, {
        timeZone: TIME_ZONE,
        hourCycle: HOUR_CYCLE,
        hour: '2-digit',
        minute: '2-digit',
    });
};

/**
 * HH:MM:SS, for the service view, where the second matters: it is watching a
 * node that publishes on a 60 s cycle. Returns an em dash — here the value sits
 * in a labelled field, so the slot has to stay occupied.
 */
export const formatClock = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (isNaN(date)) return '—';
    return date.toLocaleTimeString(LOCALE, {
        timeZone: TIME_ZONE,
        hourCycle: HOUR_CYCLE,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

/**
 * DD/MM HH:MM, for axes spanning more than a day. The battery trend runs out to
 * 7 d, where a bare clock would repeat itself seven times over.
 */
export const formatDayTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (isNaN(date)) return '';
    return date.toLocaleString(LOCALE, {
        timeZone: TIME_ZONE,
        hourCycle: HOUR_CYCLE,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
};

/**
 * A reading, with the decimal comma this locale uses.
 *
 * Non-numbers pass through untouched: the API omits a field rather than sending
 * zero when a sensor did not report, and the call sites hand that straight to
 * this function.
 *
 * `grouping` is off for pressure. Sea-level pressure crosses 1000 hPa, and es-AR
 * renders that as "1.012,53" — a thousands separator on a four-digit reading
 * that meteorology always writes plain, and one a quick glance mistakes for the
 * decimal point.
 */
export const formatNumber = (value, { digits = 2, minDigits, grouping = true } = {}) => {
    if (typeof value !== 'number') return value;
    return value.toLocaleString(LOCALE, {
        maximumFractionDigits: digits,
        minimumFractionDigits: minDigits ?? 0,
        useGrouping: grouping,
    });
};

/**
 * A reading with a fixed number of decimals — the localised counterpart to
 * Number.prototype.toFixed.
 *
 * toFixed always emits a dot, whatever the locale, and the service view used it
 * everywhere. The result was two decimal separators on the same screen: the
 * battery card read "3.992 V" while the threshold line on the chart right below
 * it read "3,85V". Same quantity, same card, different punctuation.
 *
 * Trailing zeros are kept —"4,00 V", not "4 V"— because these are instrument
 * readings and the precision is part of what is being shown.
 */
export const formatFixed = (value, digits) =>
    formatNumber(value, { digits, minDigits: digits });
