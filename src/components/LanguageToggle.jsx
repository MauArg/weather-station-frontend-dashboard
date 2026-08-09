import React from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n';

/**
 * EN | ES, in the navbar.
 *
 * Two visible segments rather than a single button that flips: with one button
 * there is no way to tell whether the label names the current language or the one
 * you would switch to, and that ambiguity is worst for the reader who cannot read
 * the language currently on screen — which is exactly who needs the control.
 *
 * Each option's tooltip is written in its own language for the same reason.
 */
const LABELS = { en: 'EN', es: 'ES' };
const TITLE_KEYS = { en: 'language.toEnglish', es: 'language.toSpanish' };

const LanguageToggle = () => {
    const { t, i18n } = useTranslation();

    // resolvedLanguage, not `language`: a browser reporting es-AR resolves to the
    // 'es' bundle, and comparing against the raw tag would leave neither segment
    // looking active.
    const active = i18n.resolvedLanguage;

    return (
        <div className="lang-toggle" role="group" aria-label={t('language.switch')}>
            {SUPPORTED_LANGUAGES.map((lng) => (
                <button
                    key={lng}
                    type="button"
                    className={`lang-btn ${active === lng ? 'active' : ''}`}
                    aria-pressed={active === lng}
                    title={t(TITLE_KEYS[lng])}
                    onClick={() => i18n.changeLanguage(lng)}
                >
                    {LABELS[lng]}
                </button>
            ))}
        </div>
    );
};

export default LanguageToggle;
