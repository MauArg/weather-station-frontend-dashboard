import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import enDashboard from './locales/en/dashboard.json';
import enCalendar from './locales/en/calendar.json';

import esCommon from './locales/es/common.json';
import esDashboard from './locales/es/dashboard.json';
import esCalendar from './locales/es/calendar.json';

/**
 * The language layer.
 *
 * Two things this deliberately does NOT do, because conflating them is the usual
 * way an i18n layer starts lying:
 *
 * - It does not touch number or date formatting. Those stay pinned to es-AR and
 *   America/Argentina/Buenos_Aires in utils/timezone.js, in both languages. The
 *   station is physically in Argentina and the backend cuts its days on local
 *   midnight, so ART and the 24 h clock are properties of the data, not a reader
 *   preference — switching to MM/DD and AM/PM would make a timestamp ambiguous
 *   against the node's own telemetry, and would contradict the badge in the
 *   navbar that promises Argentina time.
 * - It does not reach the firmware. The node's LOG_CODES templates are hashed by
 *   _dictFingerprint() in logging.cpp, so editing that text resets the log ring in
 *   RTC memory and forces the backend to re-fetch its dictionary. Those strings
 *   are translated here instead, keyed by code name, falling back to whatever the
 *   node sent.
 *
 * English is the fallback because it is the source language: it is the one
 * guaranteed to be complete, so a key that has not been translated yet degrades
 * to a readable sentence rather than to its own key name.
 */

const resources = {
    en: { common: enCommon, dashboard: enDashboard, calendar: enCalendar },
    es: { common: esCommon, dashboard: esDashboard, calendar: esCalendar },
};

export const SUPPORTED_LANGUAGES = ['en', 'es'];

// Same key style and the same failure mode as `pressureMode` in Dashboard.jsx:
// localStorage throws when cookies are blocked. The detector swallows that on its
// own — a language that does not survive a reload is not worth an error on screen.
const STORAGE_KEY = 'language';

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources,
        fallbackLng: 'en',
        supportedLngs: SUPPORTED_LANGUAGES,
        // Without this, a browser reporting es-AR —which is the expected case
        // here— would miss the 'es' bundle and silently fall back to English.
        nonExplicitSupportedLngs: true,
        defaultNS: 'common',
        ns: ['common', 'dashboard', 'calendar'],
        detection: {
            order: ['localStorage', 'navigator'],
            lookupLocalStorage: STORAGE_KEY,
            caches: ['localStorage'],
        },
        interpolation: {
            // React escapes everything it renders already; leaving i18next's own
            // escaping on double-encodes anything with an & or a quote in it.
            escapeValue: false,
        },
        // Resources are bundled rather than fetched, so init is synchronous and
        // there is no loading state to guard against.
        saveMissing: false,
        missingKeyHandler: import.meta.env.DEV
            ? (lngs, ns, key) => console.warn(`[i18n] missing key: ${ns}:${key} (${lngs.join(', ')})`)
            : undefined,
    });

/**
 * Keeps <html lang> in step with the chosen language.
 *
 * index.html ships lang="en" as a static default. It is not decoration: screen
 * readers pick pronunciation from it, and so does the browser's spellchecker in
 * the raw-JSON and log-filter inputs of the service view.
 */
const syncDocumentLang = (lng) => {
    document.documentElement.lang = lng;
};

syncDocumentLang(i18n.resolvedLanguage);
i18n.on('languageChanged', syncDocumentLang);

export default i18n;
