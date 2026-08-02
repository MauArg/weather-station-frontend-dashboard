/**
 * The one timezone this dashboard renders in.
 *
 * The backend serves every timestamp in UTC, which is the right thing for it to
 * do, but nothing here is meant to be read that way: the station sits in
 * Argentina and so does whoever is looking at the screen. Every formatter in the
 * app already converts, and the backend now cuts its "day" boundaries — daily
 * extremes, the calendar cells — on local days too.
 *
 * That conversion used to be invisible, which is a problem for a page full of
 * bare HH:MM:SS: there was nothing on screen saying which clock they belonged
 * to. TZ_LABEL exists to be shown, not just used.
 *
 * These constants are deliberately the seed of the i18n work already queued in
 * STATUS.md, where the locale has to come from the language layer or it drifts
 * out of sync with the text. The existing call sites still hardcode the same two
 * strings; they get migrated there, not here, so this change stays reviewable.
 */
export const TIME_ZONE = 'America/Argentina/Buenos_Aires';
export const LOCALE = 'es-AR';

/** Short form for badges and column headers. */
export const TZ_LABEL = 'ART (UTC−3)';

/** Long form, for tooltips that have room to explain the consequence. */
export const TZ_TOOLTIP =
    'All dates and times are shown in Argentina time (ART, UTC−3). ' +
    'The backend delivers them in UTC and the dashboard converts them, including ' +
    'day cutoffs: daily extremes and every calendar cell run from local midnight ' +
    'to midnight, not UTC.';
