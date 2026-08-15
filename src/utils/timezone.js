import i18n from '../i18n';

/**
 * Every rule this dashboard uses to turn a number or an instant into text.
 *
 * The backend serves every timestamp in UTC, which is the right thing for it to
 * do, but nothing here is meant to be read that way: the station sits in
 * Argentina and so does whoever is looking at the screen. Every formatter here
 * converts, and the backend cuts its "day" boundaries — daily extremes, the
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
 *
 * The relative-time helpers at the bottom are the exception that proves the
 * rule: they are words, so they do read the dictionary.
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
 * Formatters are built once and reused, and at these list sizes that is not a
 * micro-optimisation.
 *
 * Constructing an Intl.DateTimeFormat costs about 60 µs; calling format() on an
 * existing one costs about 2 µs. The service view re-renders wholesale on every
 * SSE push — roughly once a second while the node is awake — and both long
 * lists format a clock per row: the log ring holds up to 768 entries and the
 * payload viewer caps at 500. Rebuilding a formatter per row put that at 30-46
 * ms of the frame, every second, for text that never changes shape.
 *
 * The chart axes were never the problem: ~15 ticks per axis is nothing either
 * way. It is the lists that made this worth doing.
 */
const TIME = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE, hourCycle: HOUR_CYCLE, hour: '2-digit', minute: '2-digit',
});
const CLOCK = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE, hourCycle: HOUR_CYCLE, hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const DAY_TIME = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE, hourCycle: HOUR_CYCLE,
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
const DAY = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE, day: '2-digit', month: '2-digit',
});

/** Parses once and rejects the unusable, so each formatter below stays one line. */
const toDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return isNaN(date) ? null : date;
};

/**
 * HH:MM. Returns '' rather than a dash for a missing value, because every call
 * site is a chart tick or axis label where a stray glyph reads as data.
 */
export const formatTime = (value) => {
    const date = toDate(value);
    return date ? TIME.format(date) : '';
};

/**
 * HH:MM:SS, for the service view, where the second matters: it is watching a
 * node that publishes on a 60 s cycle. Returns an em dash — here the value sits
 * in a labelled field, so the slot has to stay occupied.
 */
export const formatClock = (value) => {
    const date = toDate(value);
    return date ? CLOCK.format(date) : '—';
};

/**
 * DD/MM HH:MM, for axes spanning more than a day. The battery trend runs out to
 * 7 d, where a bare clock would repeat itself seven times over.
 */
export const formatDayTime = (value) => {
    const date = toDate(value);
    return date ? DAY_TIME.format(date) : '';
};

/**
 * DD/MM, for axes spanning more than a couple of days.
 *
 * Past about three days the hour stops carrying information on a tick: the
 * samples are 15 min apart and the axis can only fit a handful of labels, so
 * whichever minute a tick lands on is an accident of where the window started.
 * The hour still belongs in the tooltip, where it describes one specific point
 * rather than a region of the axis.
 */
export const formatDay = (value) => {
    const date = toDate(value);
    return date ? DAY.format(date) : '';
};

// Number formatters vary by call site, so they are cached by their option set
// rather than declared up front. Half a dozen distinct shapes exist in the app.
const numberFormatters = new Map();
const numberFormatter = (digits, minDigits, grouping) => {
    const key = `${digits}|${minDigits}|${grouping}`;
    let fmt = numberFormatters.get(key);
    if (!fmt) {
        fmt = new Intl.NumberFormat(LOCALE, {
            maximumFractionDigits: digits,
            minimumFractionDigits: minDigits,
            useGrouping: grouping,
        });
        numberFormatters.set(key, fmt);
    }
    return fmt;
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
export const formatNumber = (value, { digits = 2, minDigits = 0, grouping = true } = {}) => {
    if (typeof value !== 'number') return value;
    return numberFormatter(digits, minDigits, grouping).format(value);
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

/*
 * ─── Durations, which are words ───────────────────────────────────────────────
 *
 * These three used to live in services/ServiceApi.js, next to the fetch calls,
 * which left the app with two homes for display formatting and one of them
 * re-exporting from the other. They are here now, with every other formatting
 * rule.
 *
 * The two that read the dictionary do it through the i18n instance rather than
 * the hook, because they are not components. They do not re-render on their own
 * when the language changes — nothing here is subscribed. It works because every
 * call site is inside a component that *is* subscribed via useTranslation, so the
 * switch re-renders the caller and the string is recomputed on the way through.
 * Anything that memoised one of these across a language change would keep the
 * stale wording.
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
export const formatAge = (value, now = Date.now()) => {
    const date = toDate(value);
    if (!date) return null;

    const seconds = Math.floor((now - date.getTime()) / 1000);
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

/** MM:SS, for a countdown short enough that the seconds are worth watching. */
export const formatDuration = (totalSeconds) => {
    if (totalSeconds == null || totalSeconds < 0) return '—';
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};
