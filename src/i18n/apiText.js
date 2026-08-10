/**
 * Text that originates outside this repo.
 *
 * The backend and the node do not send finished sentences any more — they send
 * a code and the numbers that go in it, and the wording lives in each locale's
 * api.json next to every other string on screen. Most of these codes come from
 * the backend's own catalogue (models/i18n.go) and one group from the
 * firmware's LOG_CODES table.
 *
 * **Both helpers fall back to the prose the sender shipped.** That is the whole
 * reason the API change is additive: the backend, the dashboard and the node
 * are three artifacts that deploy on their own schedules, so at any moment one
 * of them can be ahead. A code this build has never seen renders the English
 * sentence that arrived with it, rather than a blank or a raw key name. The
 * `api` namespace is exempt from the missing-key warning for the same reason —
 * see i18n/index.js.
 */

/**
 * A message identified by a bare code: LogState.cantWhyCode, BootAnomaly.cause,
 * a sensorCatalog key, a battery tier, a flash-risk level, a LOG_* entry name.
 *
 * `params` is separate here because the numbers the sentence needs are already
 * fields on the object the code came from, rather than travelling with it.
 */
export const apiText = (t, group, code, fallback, params) =>
    code
        ? t(`api:${group}.${code}`, { ...params, defaultValue: fallback ?? '' })
        : fallback;

/**
 * A message that arrived as the backend's `{ code, params }` envelope —
 * CommandResponse.noteCode and each entry of LogCapture.noteCodes.
 *
 * Params travel by name rather than by position precisely so a translation can
 * put them wherever its grammar wants them.
 */
export const apiNote = (t, group, coded, fallback) =>
    apiText(t, group, coded?.code, fallback, coded?.params);
