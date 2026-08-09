import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dashboard from './components/Dashboard';
import CalendarView from './components/CalendarView';
import ServiceMode from './components/ServiceMode';
import VersionBadge from './components/VersionBadge';
import LanguageToggle from './components/LanguageToggle';
import { Calendar as CalendarIcon, Activity, Wrench, AlertTriangle, Globe } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import { getServiceState } from './services/ServiceApi';
import './index.css';

/**
 * Watches for a command left retained on the station's command topic.
 *
 * Forgetting to clear it is the expensive mistake in this workflow: the node stays
 * awake at 50-140 mA instead of sleeping, and nothing in the old SSH-based flow
 * surfaced that. The banner is deliberately global — it has to be visible from the
 * dashboard, not only from the view where you would already be looking for it.
 */
const useRetainedCommandWatch = (enabled) => {
    const [retained, setRetained] = useState(null);

    useEffect(() => {
        if (!enabled) return undefined;
        let isMounted = true;

        const check = async () => {
            try {
                const state = await getServiceState();
                if (isMounted) setRetained(state.retainedCmd?.present ? state.retainedCmd : null);
            } catch {
                // Backend or broker down — the service view reports it in detail.
            }
        };

        check();
        const id = setInterval(check, 20000);
        return () => { isMounted = false; clearInterval(id); };
    }, [enabled]);

    return retained;
};

function App() {
    const { t } = useTranslation();
    const [view, setView] = useState('dashboard'); // 'dashboard' | 'calendar' | 'service'

    // In the service view the SSE stream already carries this state live.
    const retained = useRetainedCommandWatch(view !== 'service');

    return (
        <div className="app-container">
            <Toaster position="top-right" />
            <nav className="navbar">
                <div className="logo">
                    <Activity className="logo-icon" />
                    <h1>Weather Station<span className="highlight">UI</span></h1>
                </div>
                <div className="nav-actions">
                    {/*
                      The timezone badge sits in the navbar rather than inside a
                      view because it is true of all three, and because the
                      ambiguity it resolves — bare HH:MM:SS with no zone — is
                      worst on the dashboard, which is exactly where nobody would
                      go looking for a note about timezones.

                      It stays put when the language changes: the label names a
                      real zone the data is in, not a preference, so both
                      languages read the same clock. The tooltip is what
                      translates.
                    */}
                    <span className="tz-badge" title={t('timezone.tooltip')}>
                        <Globe size={14} aria-hidden="true" />
                        {t('timezone.label')}
                    </span>
                    <LanguageToggle />
                    {view !== 'dashboard' && (
                        <button onClick={() => setView('dashboard')} className="nav-btn">
                            <Activity size={18} /> {t('nav.dashboard')}
                        </button>
                    )}
                    {view !== 'calendar' && (
                        <button onClick={() => setView('calendar')} className="nav-btn">
                            <CalendarIcon size={18} /> {t('nav.history')}
                        </button>
                    )}
                    {view !== 'service' && (
                        <button onClick={() => setView('service')} className="nav-btn">
                            <Wrench size={18} /> {t('nav.service')}
                        </button>
                    )}
                </div>
            </nav>

            {retained && view !== 'service' && (
                <button className="svc-banner" onClick={() => setView('service')}>
                    <AlertTriangle size={18} aria-hidden="true" />
                    <span>
                        <strong>{t('retainedBanner.title', { cmd: retained.cmd || t('unknown') })}</strong>
                        {retained.cmd === 'maintenance'
                            ? t('retainedBanner.maintenance')
                            : t('retainedBanner.other')}
                    </span>
                    <span className="svc-banner-cta">{t('retainedBanner.cta')}</span>
                </button>
            )}

            <main className="main-content">
                {view === 'dashboard' && <Dashboard />}
                {view === 'calendar' && <CalendarView onBack={() => setView('dashboard')} />}
                {view === 'service' && <ServiceMode onBack={() => setView('dashboard')} />}
            </main>

            <VersionBadge />
        </div>
    );
}

export default App;
